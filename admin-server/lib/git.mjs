import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SITE_REPO } from './content.mjs';

const run = promisify(execFile);

async function git(args) {
  return run('git', args, { cwd: SITE_REPO });
}

// Every git operation goes through this queue, so a dashboard save and the
// background sync from GitHub never run git in the same checkout at once.
let queue = Promise.resolve();
function serialized(fn) {
  const result = queue.then(fn, fn);
  queue = result.catch(() => {});
  return result;
}

/** Rebases local commits onto whatever's on GitHub (e.g. pushed from a
 * laptop), then pushes. Leaves the checkout untouched if the rebase
 * conflicts, so nothing is lost — the commits just stay local. */
async function pullRebaseAndPush() {
  try {
    await git(['pull', '--rebase', '--quiet']);
  } catch (err) {
    await git(['rebase', '--abort']).catch(() => {});
    throw err;
  }
  await git(['push', '--quiet']);
}

/**
 * Commits every change currently in the working tree and pushes it.
 * Returns { pushed: boolean, message: string } — a commit that succeeds
 * but fails to push isn't lost (it's still committed locally), so the
 * caller can tell the user to retry the push rather than losing work.
 */
export function commitAndPush(message) {
  return serialized(async () => {
    await git(['add', '-A']);

    const { stdout: status } = await git(['status', '--porcelain']);
    if (!status.trim()) {
      return { committed: false, pushed: false, message: 'Nothing to commit.' };
    }

    await git(['commit', '-m', message]);

    try {
      await pullRebaseAndPush();
      return { committed: true, pushed: true, message: 'Committed and pushed.' };
    } catch (err) {
      return {
        committed: true,
        pushed: false,
        message: `Saved locally, but push failed: ${err.stderr || err.message}`,
      };
    }
  });
}

/**
 * Picks up commits pushed to GitHub from elsewhere (and retries pushing any
 * local commits whose earlier push failed). Skips the round if the working
 * tree is mid-save. Returns { changed: boolean } — true when new commits
 * came in and the site needs rebuilding.
 */
export function syncFromRemote() {
  return serialized(async () => {
    const { stdout: status } = await git(['status', '--porcelain']);
    if (status.trim()) return { changed: false };

    await git(['fetch', '--quiet']);
    const { stdout } = await git(['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
    const [ahead, behind] = stdout.trim().split(/\s+/).map(Number);
    if (!ahead && !behind) return { changed: false };

    await pullRebaseAndPush();
    return { changed: behind > 0 };
  });
}
