import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SITE_REPO } from './content.mjs';

const run = promisify(execFile);

async function git(args) {
  return run('git', args, { cwd: SITE_REPO });
}

/**
 * Commits every change currently in the working tree and pushes it.
 * Returns { pushed: boolean, message: string } — a commit that succeeds
 * but fails to push isn't lost (it's still committed locally), so the
 * caller can tell the user to retry the push rather than losing work.
 */
export async function commitAndPush(message) {
  await git(['add', '-A']);

  const { stdout: status } = await git(['status', '--porcelain']);
  if (!status.trim()) {
    return { committed: false, pushed: false, message: 'Nothing to commit.' };
  }

  await git(['commit', '-m', message]);

  try {
    await git(['push']);
    return { committed: true, pushed: true, message: 'Committed and pushed.' };
  } catch (err) {
    return {
      committed: true,
      pushed: false,
      message: `Saved locally, but push failed: ${err.stderr || err.message}`,
    };
  }
}
