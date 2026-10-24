import multer from 'multer';
import { mkdirSync, readdirSync, unlinkSync, existsSync, copyFileSync, rmSync, readFileSync, appendFileSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
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
    if (err.code === 'LIMIT_FILE_SIZE') return `That file is too large (${MAX_FILE_MB} MB max).`;
    return 'There was a problem with that upload.';
  }
  // fileFilter throws plain Errors with messages we wrote ourselves above —
  // safe to show directly, unlike anything from deeper in the stack.
  return err?.message && err.message.length < 200 ? err.message : 'There was a problem with that upload.';
}

export const MAX_FILE_MB = 300;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

/** The same type rules multer applies, for files that arrive in pieces too. */
function checkFileType(fieldname, mimetype) {
  // page images must be real images; a flipbook's optional source file
  // is the one upload field allowed to be a PDF instead
  const isPdfField = fieldname === 'newBookletPdf' || fieldname === 'bookletPdf';
  if (isPdfField) {
    if (mimetype !== PDF_MIME) throw new Error('That file must be a PDF.');
    return;
  }
  // the media library takes anything the site can show, PDFs included
  if (fieldname === 'libraryFiles' && mimetype === PDF_MIME) return;
  if (!MIME_EXTENSIONS[mimetype]) throw new Error('Unsupported file type — use JPG, PNG, WEBP, GIF, AVIF, MP4, or WEBM.');
}

const multerUpload = multer({
  dest: TMP_DIR,
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter(req, file, cb) {
    try {
      checkFileType(file.fieldname, file.mimetype);
      cb(null, true);
    } catch (err) {
      cb(err);
    }
  },
});

// ---------- files sent in pieces ----------
// Cloudflare refuses any single request over 100MB, so upload.js sends big
// files (videos) ahead of the form in smaller pieces, each appended to a
// temp file here. The form then carries only the piece-upload's id in a
// "_chunked" field, and the middleware below turns it back into an
// ordinary req.files entry — so route handlers can't tell the difference.

const pieces = new Map(); // id -> { path, field, name, type, size, next, count, done, touched }
const ID_RE = /^[a-f0-9]{32}$/;

export function startPieces({ field, name, type, count, size }) {
  count = Number(count);
  size = Number(size);
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('There was a problem with that upload.');
  if (!Number.isFinite(size) || size > MAX_FILE_BYTES) throw new Error(`That file is too large (${MAX_FILE_MB} MB max).`);
  checkFileType(String(field), String(type));
  const id = randomBytes(16).toString('hex');
  const path = join(TMP_DIR, `pieces-${id}`);
  pieces.set(id, { path, field: String(field), name: String(name || 'file').slice(0, 200), type: String(type), size, next: 0, count, done: false, touched: Date.now() });
  return id;
}

export function addPiece(id, index, buffer) {
  const p = ID_RE.test(id) && pieces.get(id);
  if (!p || p.done || Number(index) !== p.next) throw new Error('That upload got out of step. Please try again.');
  if ((existsSync(p.path) ? statSync(p.path).size : 0) + buffer.length > MAX_FILE_BYTES) {
    discardPieces(id);
    throw new Error(`That file is too large (${MAX_FILE_MB} MB max).`);
  }
  appendFileSync(p.path, buffer);
  p.next += 1;
  p.touched = Date.now();
  if (p.next === p.count) p.done = true;
}

function discardPieces(id) {
  const p = pieces.get(id);
  pieces.delete(id);
  if (p) rmSync(p.path, { force: true });
}

// half-finished or never-submitted piece uploads are dropped after a few hours
setInterval(() => {
  for (const [id, p] of pieces) if (Date.now() - p.touched > 6 * 60 * 60 * 1000) discardPieces(id);
}, 30 * 60 * 1000).unref();
for (const f of readdirSync(TMP_DIR)) if (f.startsWith('pieces-')) rmSync(join(TMP_DIR, f), { force: true });

/** Adds finished piece uploads named in req.body._chunked to req.files,
 * in the shape multer itself produces (`asArray` for upload.array). */
function attachPieces(allowed, asArray) {
  return (req, res, next) => {
    const ids = [].concat(req.body?._chunked ?? []);
    delete req.body?._chunked;
    try {
      for (const id of ids) {
        const p = ID_RE.test(id) && pieces.get(id);
        if (!p || !p.done) throw new Error('Part of that upload never arrived. Please try again.');
        const max = allowed[p.field];
        if (!max) throw new Error('There was a problem with that upload.');
        const file = { fieldname: p.field, originalname: p.name, mimetype: p.type, path: p.path, size: statSync(p.path).size };
        pieces.delete(id);
        if (asArray) {
          req.files = req.files || [];
          if (req.files.length >= max) throw new Error('Too many files in one go.');
          req.files.push(file);
        } else {
          req.files = req.files || {};
          const list = (req.files[p.field] = req.files[p.field] || []);
          if (list.length >= max) throw new Error('Too many files in one go.');
          list.push(file);
        }
      }
      next();
    } catch (err) {
      for (const id of ids) discardPieces(id);
      next(err);
    }
  };
}

// same calls as multer's own (.array / .fields), plus piece-upload support
export const upload = {
  array: (name, maxCount) => [multerUpload.array(name, maxCount), attachPieces({ [name]: maxCount }, true)],
  fields: (spec) => [
    multerUpload.fields(spec),
    attachPieces(Object.fromEntries(spec.map((f) => [f.name, f.maxCount ?? Infinity])), false),
  ],
};

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
  // only a flipbook/trifold's own folder (".../flipbook-<time>" or
  // ".../trifold-<time>") — never wherever some library file happens to live
  if (!/[\\/](flipbook|trifold)-\d+$/.test(fsDir)) return;
  rmSync(fsDir, { recursive: true, force: true });
}

/** Removes everything under public/media/<collection>/ that belongs to a
 * deleted entry — design keeps each project in its own <slug>/ subfolder,
 * motion/fineart prefix every flat filename with the slug instead. */
export function deleteEntryMedia(collectionKey, slug) {
  // the entry's own folder: all of a design project's files, and any
  // flipbooks/trifolds of other collections
  rmSync(join(SITE_REPO, 'public', 'media', collectionKey, slug), { recursive: true, force: true });
  if (collectionKey === 'design') return;
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
