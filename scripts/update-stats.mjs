import { randomUUID } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const hkCalendar = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit',
});

function readConfig(env) {
  const property = env.GA4_PROPERTY_ID?.trim();
  const token = env.GA4_ACCESS_TOKEN?.trim();
  const start = env.GA4_START_DATE?.trim();
  const hostname = env.GA4_HOSTNAME?.trim().toLowerCase();
  const pagePath = env.GA4_PAGE_PATH?.trim();
  if (!/^\d+$/.test(property ?? '')) throw new Error('Set a numeric GA4_PROPERTY_ID.');
  if (!token) throw new Error('Set GA4_ACCESS_TOKEN with Analytics read access.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start ?? '') ||
      !Number.isFinite(Date.parse(start)) || new Date(start).toISOString().slice(0, 10) !== start) {
    throw new Error('Set GA4_START_DATE to a valid YYYY-MM-DD date.');
  }
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(hostname ?? '')) {
    throw new Error('Set GA4_HOSTNAME to the production hostname.');
  }
  if (!/^\/(?:[\w-]+\/)*$/.test(pagePath ?? '')) {
    throw new Error('Set GA4_PAGE_PATH to the site path, including its trailing slash.');
  }
  return { property, token, start, hostname, pagePath };
}

function buildReport(metric, event, config, through) {
  const exact = (fieldName, value) => ({
    filter: { fieldName, stringFilter: { matchType: 'EXACT', value, caseSensitive: true } },
  });
  const paths = [config.pagePath, config.pagePath + 'index.html'];
  if (config.pagePath !== '/') paths.push(config.pagePath.slice(0, -1));
  return {
    dateRanges: [{ startDate: config.start, endDate: through }],
    metrics: [{ name: metric }],
    // Omitting dimensions lets GA deduplicate visitors over the whole interval.
    dimensionFilter: { andGroup: { expressions: [
      exact('hostName', config.hostname),
      { filter: { fieldName: 'pagePath', inListFilter: { values: paths, caseSensitive: true } } },
      exact('eventName', event),
    ] } },
  };
}

function readCount(report, metric) {
  if (report?.metadata?.emptyReason) {
    // Google can omit metric headers when it explains why a report is unavailable.
    const reason = String(report.metadata.emptyReason).replace(/[\r\n]/g, ' ').slice(0, 160);
    throw new Error(`GA4 returned an empty ${metric} report (${reason}).`);
  }
  const rows = report?.rows ?? [];
  if (!Array.isArray(rows) || rows.length > 1 || (report?.rowCount ?? rows.length) !== rows.length) {
    throw new Error(`Unexpected GA4 row count for ${metric}.`);
  }
  const headers = report?.metricHeaders ?? [];
  // A new property can return a typed, empty report with no columns until the first events are processed.
  const emptyTable = report?.kind === 'analyticsData#runReport' && rows.length === 0 &&
    Array.isArray(headers) && headers.length === 0;
  if (!emptyTable && (!Array.isArray(headers) || headers.length !== 1 || headers[0]?.name !== metric)) {
    const names = Array.isArray(headers) ? headers.map(header => header?.name).join(', ') : '';
    const fields = Object.keys(report ?? {}).join(', ');
    throw new Error(`GA4 expected ${metric}, received metric headers [${names}] with ${rows.length} rows and fields [${fields}].`);
  }
  if (report.metadata?.dataTruncationReasons?.length) throw new Error('GA4 returned a truncated date range.');
  if (report.metadata?.samplingMetadatas?.length || report.metadata?.dataLossFromOtherRow) {
    throw new Error('GA4 returned sampled or incomplete totals.');
  }
  if (report.metadata?.schemaRestrictionResponse?.activeMetricRestrictions?.length) {
    throw new Error('GA4 restricted the requested metric.');
  }
  if (rows.length === 0) {
    if (report.metadata?.subjectToThresholding) throw new Error('GA4 withheld the aggregate count.');
    return 0;
  }
  const value = rows[0]?.metricValues?.[0]?.value;
  if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`Invalid GA4 count for ${metric}.`);
  }
  return Number(value);
}

export async function updateStats(output, { env = process.env, now = new Date(), request = fetch } = {}) {
  if (!output) throw new Error('Usage: node scripts/update-stats.mjs <output-file>');
  const config = readConfig(env);
  const through = hkCalendar.format(now);
  if (config.start > through) throw new Error('GA4_START_DATE is in the future.');

  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${config.property}:batchRunReports`;
  const result = await request(url, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + config.token, 'content-type': 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({ requests: [
      buildReport('totalUsers', 'page_view', config, through),
      buildReport('eventCount', 'hkid_generated', config, through),
    ] }),
  });
  if (!result.ok) throw new Error(`GA4 reporting request failed (HTTP ${result.status}).`);
  const { reports } = await result.json().catch(() => { throw new Error('GA4 did not return JSON.'); });
  if (!Array.isArray(reports) || reports.length !== 2) throw new Error('Expected two GA4 reports.');
  // Match each aggregate to its metric even when the batch returns it in a different position.
  if (reports[0]?.metricHeaders?.[0]?.name === 'eventCount' || reports[1]?.metricHeaders?.[0]?.name === 'totalUsers') {
    reports.reverse();
  }
  const stats = {
    visitors: readCount(reports[0], 'totalUsers'),
    generated: readCount(reports[1], 'eventCount'),
    through,
  };
  // Readers see the previous complete snapshot until both new counts have been validated.
  const temporary = output + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, JSON.stringify(stats) + '\n', { flag: 'wx' });
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }
  return stats;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const stats = await updateStats(process.argv[2]);
    console.log(`Updated site statistics through ${stats.through}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
