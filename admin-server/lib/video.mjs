import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { requestBuild } from './build.mjs';

const run = promisify(execFile);

// .mov files (straight off an iPhone or out of Premiere/Final Cut) only play
// reliably in Safari — Chrome and Firefox often can't, especially the HEVC
// ones iPhones record. So each one is turned into an ordinary .mp4 here,
// after the upload has already been saved: a long video can take minutes to
// convert, far longer than Cloudflare waits for a reply. The .mp4 path goes
// into the project straight away; the file itself appears when it's ready,
// followed by a rebuild.

const queue = [];
const pending = new Set(); // destination paths still being converted
let working = false;
let lastError = null;

export function conversionStatus() {
  return { converting: pending.size, error: lastError };
}

/** True while `absPath` is the destination of an unfinished conversion. */
export function isConverting(absPath) {
  return pending.has(absPath);
}

/** Queues the conversion of `srcPath` (a temp file, removed afterwards)
 * into an .mp4 at `destPath`. */
export function convertToMp4(srcPath, destPath) {
  pending.add(destPath);
  queue.push({ srcPath, destPath });
  if (!working) work();
}

async function work() {
  working = true;
  while (queue.length) {
    const job = queue.shift();
    try {
      await convertOne(job);
      lastError = null;
    } catch (err) {
      console.error('Video conversion failed:', err.stderr || err.message);
      lastError = 'A .mov video could not be converted. Try exporting it as .mp4 instead.';
    } finally {
      rmSync(job.srcPath, { force: true });
      pending.delete(job.destPath);
    }
    requestBuild();
  }
  working = false;
}

async function probe(srcPath, stream) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-select_streams', stream, '-show_entries', 'stream=codec_name,pix_fmt', '-of', 'csv=p=0', srcPath,
  ]);
  return stdout.trim();
}

async function convertOne({ srcPath, destPath }) {
  const [codec, pixFmt] = (await probe(srcPath, 'v:0')).split(',');
  if (!codec) throw new Error('no video stream');
  // H.264 in 8-bit 4:2:0 plays everywhere as it is — just rewrap it (a few
  // seconds). Anything else (HEVC, ProRes, 10-bit HDR…) is re-encoded.
  const video = codec === 'h264' && pixFmt === 'yuv420p'
    ? ['-c:v', 'copy']
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p'];
  const audio = (await probe(srcPath, 'a:0')).split(',')[0] === 'aac' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '160k'];
  const tmpOut = join(dirname(srcPath), `converted-${randomBytes(6).toString('hex')}.mp4`);
  try {
    await run('ffmpeg', [
      '-v', 'error', '-y', '-i', srcPath,
      '-map', '0:v:0', '-map', '0:a:0?', ...video, ...audio,
      '-movflags', '+faststart', // start playing before the whole file has loaded
      tmpOut,
    ], { maxBuffer: 16 * 1024 * 1024 });
    // the project (or library folder) may have been deleted meanwhile
    if (existsSync(dirname(destPath))) renameSync(tmpOut, destPath);
  } finally {
    rmSync(tmpOut, { force: true });
  }
}
