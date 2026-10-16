import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SITE_REPO } from './content.mjs';

const run = promisify(execFile);

// The public site is served straight out of dist/ (see README.md, "Self-
// hosting the public site"). Each build goes to a scratch directory first
// and is swapped in only once it's finished, so visitors never see a
// half-built site and a failed build leaves the last good one live.
const DIST = join(SITE_REPO, 'dist');
const NEXT = join(SITE_REPO, '.dist-next');
const OLD = join(SITE_REPO, '.dist-old');
const DEPS_STAMP = join(SITE_REPO, 'node_modules', '.package-lock.sha256');

let status = { state: 'idle', finishedAt: null, error: null };
let running = false;
let pending = false;

export function buildStatus() {
  return status;
}

/** Queues a rebuild. Requests that arrive mid-build collapse into a single
 * follow-up build, so a burst of saves doesn't stack up a build per save. */
export function requestBuild() {
  pending = true;
  if (running) return;
  running = true;
  (async () => {
    while (pending) {
      pending = false;
      await buildOnce();
    }
    running = false;
  })();
}

async function installDepsIfNeeded() {
  const lockHash = createHash('sha256').update(readFileSync(join(SITE_REPO, 'package-lock.json'))).digest('hex');
  if (existsSync(DEPS_STAMP) && readFileSync(DEPS_STAMP, 'utf8') === lockHash) return;
  await run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: SITE_REPO, maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(DEPS_STAMP, lockHash);
}

async function buildOnce() {
  status = { ...status, state: 'building' };
  try {
    await installDepsIfNeeded();
    rmSync(NEXT, { recursive: true, force: true });
    await run('npx', ['astro', 'build', '--outDir', NEXT], { cwd: SITE_REPO, maxBuffer: 64 * 1024 * 1024 });
    rmSync(OLD, { recursive: true, force: true });
    if (existsSync(DIST)) renameSync(DIST, OLD);
    renameSync(NEXT, DIST);
    rmSync(OLD, { recursive: true, force: true });
    status = { state: 'ok', finishedAt: new Date(), error: null };
  } catch (err) {
    console.error('Site build failed:', err.stderr || err.message);
    status = { state: 'failed', finishedAt: new Date(), error: String(err.stderr || err.message).slice(-500) };
  }
}
