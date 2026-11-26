import { pathToFileURL } from 'node:url';
import config from '../analytics-config.json' with { type: 'json' };

export function normalizeMeasurementId(value) {
  const id = value?.trim() ?? '';
  return id === config.destinationId ? id : null;
}

// Daily reporting requires an ID. Static builds can still publish without one.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (!normalizeMeasurementId(process.env.GA4_MEASUREMENT_ID)) {
    console.error('Set GA4_MEASUREMENT_ID to the linked stream ' + config.destinationId + '.');
    process.exitCode = 1;
  }
}
