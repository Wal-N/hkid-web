import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const measurementIds = [
  [undefined, null],
  ['', null],
  [' \t\r\n ', null],
  ['bad-id', null],
  ['G-SAMPLE\n123', null],
  ['G-SAMPLE123', null],
  ['GTM-MTSLZZ7V', null],
  ['G-PE5SLFMXFY', 'G-PE5SLFMXFY'],
  ['\t\r\n G-PE5SLFMXFY \n\t', 'G-PE5SLFMXFY'],
];

function runScript(name, args, measurementId) {
  const script = fileURLToPath(new URL('../scripts/' + name, import.meta.url));
  const result = spawnSync(process.execPath, [script, ...args], {
    env: { ...process.env, GA4_MEASUREMENT_ID: measurementId },
    encoding: 'utf8',
  });
  assert.ifError(result.error);
  return result;
}

test('site builds with analytics disabled, misconfigured or enabled', async t => {
  const temp = resolve(tmpdir());
  const output = await mkdtemp(join(temp, 'hkid-build-'));
  t.after(async () => {
    assert.equal(dirname(output), temp);
    await rm(output, { recursive: true, force: true });
  });
  for (const [setting, expected] of measurementIds) {
    const result = runScript('build-site.mjs', [output], setting);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr.includes('GA4_MEASUREMENT_ID does not match'), Boolean(setting?.trim()) && !expected);
    const config = JSON.parse(await readFile(join(output, 'analytics-config.json'), 'utf8'));
    assert.equal(config.destinationId, 'G-PE5SLFMXFY');
    assert.equal(config.measurementId, expected);
  }
});

test('usage report precheck requires a valid measurement ID after trimming', () => {
  for (const [setting, expected] of measurementIds) {
    const result = runScript('measurement-id.mjs', [], setting);
    assert.equal(result.status, expected === null ? 1 : 0, JSON.stringify(setting));
    assert.equal(result.stderr.includes('GA4_MEASUREMENT_ID'), expected === null);
  }
});
