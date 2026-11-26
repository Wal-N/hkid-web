import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { normalizeMeasurementId } from './measurement-id.mjs';
import { publicFiles } from './site-files.mjs';

const root = new URL('../', import.meta.url);
const output = resolve(process.argv[2] || 'dist');
const configuredId = process.env.GA4_MEASUREMENT_ID;
const measurementId = normalizeMeasurementId(configuredId);
if (configuredId?.trim() && !measurementId) {
  const warning = 'Google Analytics is disabled because GA4_MEASUREMENT_ID does not match the linked stream.';
  console.warn(process.env.GITHUB_ACTIONS === 'true' ? '::warning::' + warning : warning);
}

for (const file of publicFiles) {
  const destination = join(output, file);
  await mkdir(dirname(destination), { recursive: true });
  if (file === 'analytics-config.json') {
    const config = JSON.parse(await readFile(new URL(file, root), 'utf8'));
    await writeFile(destination, JSON.stringify({ ...config, measurementId }, null, 2) + '\n');
  } else {
    await copyFile(new URL(file, root), destination);
  }
}
