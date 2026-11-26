import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseStats } from '../stats.js';

// Keep the last successful report independently of site revisions and artifact expiry.
const ref = 'refs/heads/usage-stats';
const git = (args, input) => execFileSync('git', args, { encoding: 'utf8', input }).trim();

function readSnapshot(json) {
  const stats = parseStats(JSON.parse(json));
  if (!stats) throw new Error('Expected valid public counts and cutoff date.');
  return stats;
}

function readStored() {
  if (!git(['ls-remote', '--heads', 'origin', ref])) return null;
  git(['fetch', '--quiet', '--no-tags', '--depth=1', 'origin', ref]);
  const commit = git(['rev-parse', 'FETCH_HEAD']);
  return { commit, stats: readSnapshot(git(['show', commit + ':stats.json'])) };
}

function store(stats, previous) {
  const startedAt = process.env.GA4_REPORT_STARTED_AT;
  const time = Date.parse(startedAt);
  if (!Number.isFinite(time) || startedAt.length !== 24 || new Date(time).toISOString() !== startedAt) {
    throw new Error('Set GA4_REPORT_STARTED_AT to the UTC query start in YYYY-MM-DDTHH:mm:ss.sssZ format.');
  }

  let changed = true;
  if (previous) {
    const saved = previous.stats;
    if (saved.through > stats.through) return false;
    if (saved.through === stats.through) {
      // A retried store job keeps the timestamp of the original query.
      const savedStart = git(['show', '-s', '--format=%(trailers:key=Report-Started-At,valueonly)', previous.commit]);
      if (savedStart && savedStart >= startedAt) return false;
      changed = saved.visitors !== stats.visitors || saved.generated !== stats.generated;
    }
  }
  const blob = git(['hash-object', '-w', '--stdin'], JSON.stringify(stats) + '\n');
  const tree = git(['mktree'], `100644 blob ${blob}\tstats.json\n`);
  const parents = previous ? ['-p', previous.commit] : [];
  const commit = git([
    '-c', 'user.name=github-actions[bot]',
    '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
    'commit-tree', tree, ...parents, '-m', 'Usage totals through ' + stats.through, '-m', 'Report-Started-At: ' + startedAt,
  ]);
  // A non-fast-forward push fails safely if another writer has advanced the branch.
  git(['push', '--quiet', 'origin', commit + ':' + ref]);
  // An unchanged observation advances the query timestamp without republishing the site.
  return changed;
}

try {
  const [command, file] = process.argv.slice(2);
  if (command === 'restore' && file) {
    const previous = readStored();
    if (previous) writeFileSync(file, JSON.stringify(previous.stats) + '\n');
  } else if (command === 'store' && !file) {
    console.log(store(readSnapshot(readFileSync(0, 'utf8')), readStored()));
  } else {
    throw new Error('Usage: stats-branch.mjs restore <output-file> or stats-branch.mjs store < report.json');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
