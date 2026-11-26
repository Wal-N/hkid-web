import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { updateStats } from '../scripts/update-stats.mjs';

const env = {
  GA4_PROPERTY_ID: '1234', GA4_ACCESS_TOKEN: 'test-token', GA4_START_DATE: '2024-02-01',
  GA4_HOSTNAME: 'example.github.io', GA4_PAGE_PATH: '/hkid-web/',
};
// Just after midnight in Hong Kong on 2 March (leap year).
const now = new Date('2024-03-01T16:01:00Z');
const report = (name, value) => ({
  metricHeaders: [{ name, type: 'TYPE_INTEGER' }],
  rows: [{ metricValues: [{ value }] }], rowCount: 1,
});
async function snapshotPath(t) {
  const directory = await mkdtemp(join(tmpdir(), 'hkid-stats-'));
  const path = join(directory, 'stats.json');
  t.after(async () => {
    await rm(path, { force: true });
    await rmdir(directory);
  });
  return path;
}

test('publishes two production-only whole-period counts through today in Hong Kong', async t => {
  const output = await snapshotPath(t);
  await writeFile(output, '{}');
  const request = async (url, options) => {
    assert.equal(url, 'https://analyticsdata.googleapis.com/v1beta/properties/1234:batchRunReports');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.authorization, 'Bearer test-token');
    const { requests } = JSON.parse(options.body);
    assert.equal(requests.length, 2);
    for (const [i, item] of requests.entries()) {
      assert.deepEqual(item.dateRanges, [{ startDate: '2024-02-01', endDate: '2024-03-02' }]);
      assert.equal(item.dimensions, undefined);
      assert.deepEqual(item.metrics, [{ name: ['totalUsers', 'eventCount'][i] }]);
      const filters = Object.fromEntries(item.dimensionFilter.andGroup.expressions.map(({ filter }) => [filter.fieldName, filter]));
      assert.equal(filters.eventName.stringFilter.value, ['page_view', 'hkid_generated'][i]);
      assert.equal(filters.hostName.stringFilter.value, 'example.github.io');
      assert.deepEqual(filters.pagePath.inListFilter.values, ['/hkid-web/', '/hkid-web/index.html', '/hkid-web']);
    }
    return Response.json({ reports: [report('totalUsers', '11'), report('eventCount', '283')] });
  };
  const stats = await updateStats(output, { env, now, request });
  assert.deepEqual(stats, { visitors: 11, generated: 283, through: '2024-03-02' });
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), stats);
});

test('an empty, unrestricted report counts as zero', async t => {
  const output = await snapshotPath(t);
  const request = () => Response.json({ reports: [
    { metricHeaders: [{ name: 'totalUsers' }] }, report('eventCount', '0'),
  ] });
  assert.deepEqual(await updateStats(output, { env, now, request }),
    { visitors: 0, generated: 0, through: '2024-03-02' });
});

test('accepts a typed report without columns only for an unrestricted empty table', async t => {
  const output = await snapshotPath(t);
  const empty = { kind: 'analyticsData#runReport', metadata: { timeZone: 'Asia/Hong_Kong' } };
  const request = visitors => () => Response.json({ reports: [visitors, empty] });
  assert.deepEqual(await updateStats(output, { env, now, request: request(empty) }),
    { visitors: 0, generated: 0, through: '2024-03-02' });
  for (const invalid of [{}, { ...empty, rows: [{ metricValues: [{ value: '3' }] }] },
    { ...empty, rowCount: 1 }, { ...empty, metadata: { subjectToThresholding: true } }]) {
    await assert.rejects(updateStats(output, { env, now, request: request(invalid) }), /GA4/);
  }
});

test('matches out-of-order batch results by metric and reports missing data without publishing it', async t => {
  const output = await snapshotPath(t);
  const generated = report('eventCount', '9');
  const getReport = visitors => () => Response.json({ reports: [generated, visitors] });
  await updateStats(output, { env, now, request: getReport(report('totalUsers', '3')) });
  const saved = await readFile(output, 'utf8');
  assert.deepEqual(JSON.parse(saved), { visitors: 3, generated: 9, through: '2024-03-02' });
  await assert.rejects(updateStats(output, {
    env, now, request: getReport({ metadata: { emptyReason: 'Report is unavailable' } }),
  }), /empty totalUsers report \(Report is unavailable\)/);
  await assert.rejects(updateStats(output, { env, now, request: getReport(generated) }),
    /expected totalUsers, received metric headers \[eventCount\]/);
  assert.equal(await readFile(output, 'utf8'), saved);
});

test('unsuccessful, partial or malformed responses preserve the previous snapshot', async t => {
  const output = await snapshotPath(t);
  const good = report('totalUsers', '4');
  const missing = { metricHeaders: [{ name: 'eventCount' }], metadata: { subjectToThresholding: true } };
  await writeFile(output, 'existing');
  for (const response of [
    new Response('private error details', { status: 403 }),
    Response.json({ reports: [good] }),
    Response.json({ reports: [good, missing] }),
    Response.json({ reports: [good, { ...report('eventCount', '7'), metadata: { dataTruncationReasons: [{}] } }] }),
    Response.json({ reports: [good, { ...report('eventCount', '7'), metadata: { samplingMetadatas: [{}] } }] }),
    Response.json({ reports: [{ ...good, metadata: { dataLossFromOtherRow: true } }, report('eventCount', '7')] }),
    Response.json({ reports: [good, report('eventCount', 'NaN')] }),
    Response.json({ reports: [good, report('eventCount', '999999999999999999')] }),
  ]) {
    await assert.rejects(updateStats(output, { env, now, request: () => response }), /GA4/);
    assert.equal(await readFile(output, 'utf8'), 'existing');
  }
});

test('reports the first day of tracking even before the UTC date rolls over', async t => {
  const output = await snapshotPath(t);
  const start = '2024-03-02';
  const request = (_, options) => {
    const { requests } = JSON.parse(options.body);
    for (const item of requests) assert.deepEqual(item.dateRanges, [{ startDate: start, endDate: start }]);
    return Response.json({ reports: [report('totalUsers', '1'), report('eventCount', '2')] });
  };
  const stats = await updateStats(output, { now, env: { ...env, GA4_START_DATE: start }, request });
  assert.deepEqual(stats, { visitors: 1, generated: 2, through: start });
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), stats);
});

test('future start dates and bad config fail without an API request', async t => {
  const output = await snapshotPath(t);
  const request = () => assert.fail('unexpected network request');
  for (const change of [{ GA4_START_DATE:'2024-02-30' }, { GA4_START_DATE:'2024-03-03' },
    { GA4_PROPERTY_ID:'bad' }, { GA4_ACCESS_TOKEN:'' }, { GA4_HOSTNAME:'https://example.github.io' },
    { GA4_PAGE_PATH:'hkid-web' }]) {
    await assert.rejects(updateStats(output, { now, env: { ...env, ...change }, request }), /GA4_/);
  }
  await assert.rejects(readFile(output), { code: 'ENOENT' });
});
