import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../scripts/stats-branch.mjs', import.meta.url));

test('publishes new dates and same-day revisions on their own branch and restores them on release', async t => {
  const temporary = resolve(tmpdir());
  const directory = await mkdtemp(join(temporary, 'hkid-stats-branch-'));
  t.after(async () => {
    assert.equal(dirname(directory), temporary);
    await rm(directory, { recursive: true, force: true });
  });
  const remote = join(directory, 'upstream.git');
  let cwd = join(directory, 'source');
  const output = join(directory, 'published.json');
  await mkdir(cwd);
  const env = {
    ...process.env, GIT_ALLOW_PROTOCOL: 'file', GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(directory, 'empty.gitconfig'),
  };
  const run = (command, args, input, environment = env) => execFileSync(command, args, { cwd, env: environment, encoding: 'utf8', stdio: 'pipe', input }).trim();
  const git = (...args) => run('git', args);
  const store = (data, minute = '00') => run(process.execPath, [cli, 'store'], JSON.stringify(data), {
    ...env, GA4_REPORT_STARTED_AT: data.through + 'T02:' + minute + ':00.000Z',
  });
  const restore = () => run(process.execPath, [cli, 'restore', output]);
  git('init', '--bare', '-b', 'main', remote);
  git('init', '-b', 'main');
  git('remote', 'add', 'origin', remote);
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'site');
  git('push', 'origin', 'main');
  const originalHead = git('ls-remote', 'origin', 'refs/heads/main');

  await writeFile(output, 'pending');
  restore();
  assert.equal(await readFile(output, 'utf8'), 'pending');

  const first = { visitors: 3, generated: 7, through: '2026-11-21' };
  assert.equal(store({ ...first, privateField: 'discard me' }), 'true');
  // A new Actions job receives a fresh, shallow checkout of main.
  const nextCheckout = join(directory, 'next-checkout');
  git('clone', '--quiet', '--depth=1', '--branch', 'main', pathToFileURL(remote).href, nextCheckout);
  cwd = nextCheckout;
  restore();
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), first);
  // Reports written by earlier versions have no query timestamp.
  const legacy = git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
    'commit-tree', 'FETCH_HEAD^{tree}', '-p', 'FETCH_HEAD', '-m', 'Usage totals through ' + first.through);
  git('push', 'origin', legacy + ':refs/heads/usage-stats');
  restore();
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), first);
  assert.equal(store({ ...first, generated: 8 }, '01'), 'true');

  const second = { visitors: 4, generated: 9, through: '2026-11-22' };
  assert.equal(store(second), 'true');
  assert.equal(store({ ...second, visitors: 5 }, '01'), 'true');
  assert.equal(store({ ...second, visitors: 5, generated: 12 }, '02'), 'true');
  const revised = { ...second, visitors: 0, generated: 0 };
  assert.equal(store(revised, '03'), 'true');
  assert.equal(store({ ...revised, privateField: 'discard me' }, '05'), 'false');
  // Even an unchanged report at 02:05 prevents a failed 02:04 store from overwriting it.
  assert.equal(store(second, '04'), 'false');
  assert.equal(store(second, '05'), 'false');
  assert.equal(store(revised, '05'), 'false');
  assert.equal(store(first), 'false');
  assert.throws(() => store(revised, 'invalid'), /GA4_REPORT_STARTED_AT/);
  assert.throws(() => store({ ...second, through: '2026-02-30' }));
  restore();
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), revised);
  const nextDay = { ...revised, through: '2026-11-23' };
  assert.equal(store(nextDay), 'true');
  restore();
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), nextDay);

  assert.equal(git('ls-remote', 'origin', 'refs/heads/main'), originalHead);
  assert.equal(git('--git-dir', remote, 'ls-tree', '--name-only', 'usage-stats'), 'stats.json');
  assert.equal(git('--git-dir', remote, 'rev-list', '--count', 'usage-stats'), '9');
  assert.equal(git('status', '--porcelain'), '');
  git('remote', 'set-url', 'origin', join(directory, 'unavailable.git'));
  assert.throws(restore);
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), nextDay);
});
