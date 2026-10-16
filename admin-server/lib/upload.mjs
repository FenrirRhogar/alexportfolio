import multer from 'multer';
import { mkdirSync, readdirSync, unlinkSync, existsSync, copyFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { imageSize } from 'image-size';
import { SITE_REPO } from './content.mjs';

// The only file types this app will ever write to disk, and the exact
// extension each gets — deliberately NOT derived from the uploaded file's
// original name, which is attacker-controlled and easy to lie about (a
// request can claim Content-Type: image/jpeg while naming the file
// "evil.html"; trusting that name would get it served back as HTML from
// the same origin). Keying the extension off the (filter-verified) MIME
// type instead means what lands on disk always matches how it'll be
// served. SVG is deliberately excluded even though it's "an image" — it
// can contain a <script> that runs if the file is opened directly.
export const MIME_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
};
export const PDF_MIME = 'application/pdf';

// Uploads land in a scratch dir first (multer needs a destination before
// we know the slug for a brand-new entry); the route handler then moves
// each file to its real public/media/... path once the slug is settled.
const TMP_DIR = join(SITE_REPO, 'admin-server', '.uploads-tmp');
mkdirSync(TMP_DIR, { recursive: true });

/** Turns a multer/fileFilter error into a short, safe message to show the
 * user — never the raw error (which can include internal file paths). */
export function friendlyUploadError(err) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return 'That file is too large (500MB max).';
    return 'There was a problem with that upload.';
  }
  // fileFilter throws plain Errors with messages we wrote ourselves above —
  // safe to show directly, unlike anything from deeper in the stack.
  return err?.message && err.message.length < 200 ? err.message : 'There was a problem with that upload.';
}

export const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB — generous for video
  fileFilter(req, file, cb) {
    // page images must be real images; a flipbook's optional source file
    // is the one upload field allowed to be a PDF instead
    const isPdfField = file.fieldname === 'newBookletPdf' || file.fieldname === 'bookletPdf';
    if (isPdfField) {
      return file.mimetype === PDF_MIME ? cb(null, true) : cb(new Error('That file must be a PDF.'));
    }
    // the media library takes anything the site can show, PDFs included
    if (file.fieldname === 'libraryFiles' && file.mimetype === PDF_MIME) return cb(null, true);
    if (MIME_EXTENSIONS[file.mimetype]) return cb(null, true);
    cb(new Error('Unsupported file type — use JPG, PNG, WEBP, GIF, AVIF, MP4, or WEBM.'));
  },
});

/** Removes any existing `<basename>.*` in `dir`, so replacing e.g. a .jpg
 * cover with a .png doesn't leave the old file behind. */
function clearExisting(dir, basename) {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    if (f === basename || f.startsWith(`${basename}.`)) {
      unlinkSync(join(dir, f));
    }
  }
}

/**
 * Moves an uploaded temp file into its final public/media/ location and
 * returns the site-relative path (e.g. "/media/design/my-project/cover.jpg")
 * to store in frontmatter. `publicDir` is relative to the site's public/
 * folder (e.g. "media/design/my-project").
 */
export function placeUpload(tmpFile, { publicDir, baseName }) {
  const ext = MIME_EXTENSIONS[tmpFile.mimetype] || (tmpFile.mimetype === PDF_MIME ? '.pdf' : null);
  if (!ext) throw new Error(`Unsupported file type: ${tmpFile.mimetype}`);
  const fsDir = join(SITE_REPO, 'public', publicDir);
  mkdirSync(fsDir, { recursive: true });
  clearExisting(fsDir, baseName);

  const destFs = join(fsDir, `${baseName}${ext}`);
  copyFileSync(tmpFile.path, destFs);
  unlinkSync(tmpFile.path);

  return `/${publicDir}/${baseName}${ext}`;
}

/** Moves a batch of uploaded files into the same publicDir, named
 * "<prefix>-<timestamp>-<i>.ext" so repeated batches (e.g. adding more
 * flipbook pages later) can never collide with an earlier one. Returns
 * the site-relative paths in the same order as `tmpFiles`. */
export function placeMultiple(tmpFiles, { publicDir, prefix }) {
  const stamp = Date.now();
  return tmpFiles.map((file, i) => placeUpload(file, { publicDir, baseName: `${prefix}-${stamp}-${i}` }));
}

/** Reads a just-uploaded temp file's real pixel dimensions, before it's
 * moved/deleted by placeUpload — used so Alexandra never has to type in
 * pixel sizes herself when adding a new flipbook. */
export function readImageDimensions(tmpFile) {
  const { width, height } = imageSize(readFileSync(tmpFile.path));
  return { width, height };
}

/** Deletes a previously-uploaded file given its site-relative path (as
 * stored in frontmatter, e.g. "/media/design/my-project/gallery-1.jpg"). */
export function deleteMediaFile(sitePath) {
  const fsPath = join(SITE_REPO, 'public', sitePath);
  if (existsSync(fsPath)) unlinkSync(fsPath);
}

/** Given a site-relative file path (as stored in frontmatter), returns the
 * publicDir of the folder it lives in, for placing more files alongside
 * it later (e.g. appending pages to an existing flipbook). */
export function siteDirOf(sitePath) {
  return dirname(sitePath).replace(/^\//, '');
}

/** Deletes the whole folder a given site-relative file lives in — used to
 * clean up an entire flipbook/trifold's folder (pages + optional pdf) when
 * it's removed, rather than deleting each file one at a time. */
export function deleteMediaFileDir(sitePath) {
  const fsDir = dirname(join(SITE_REPO, 'public', sitePath));
  rmSync(fsDir, { recursive: true, force: true });
}

/** Removes everything under public/media/<collection>/ that belongs to a
 * deleted entry — design keeps each project in its own <slug>/ subfolder,
 * motion/fineart prefix every flat filename with the slug instead. */
export function deleteEntryMedia(collectionKey, slug) {
  if (collectionKey === 'design') {
    rmSync(join(SITE_REPO, 'public', 'media', 'design', slug), { recursive: true, force: true });
    return;
  }
  const dir = join(SITE_REPO, 'public', 'media', collectionKey);
  if (!existsSync(dir)) return;
  // exact basenames only (plus the gallery-NNN prefix) — a loose
  // `startsWith(slug + '-')` would also match a different entry whose
  // slug happens to start with this one, e.g. deleting "test" wrongly
  // sweeping up "test-2-poster.jpg"
  const exactBases = new Set([slug, `${slug}-poster`, `${slug}-video`, `${slug}-webm`]);
  const galleryPrefix = `${slug}-gallery-`;
  for (const f of readdirSync(dir)) {
    const base = f.replace(/\.[^.]+$/, '');
    if (exactBases.has(base) || f.startsWith(galleryPrefix)) {
      unlinkSync(join(dir, f));
    }
  }
}
