import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, copyFileSync, unlinkSync } from 'node:fs';
import { join, relative, resolve, sep, extname } from 'node:path';
import { SITE_REPO } from './content.mjs';
import { MIME_EXTENSIONS, PDF_MIME } from './upload.mjs';

// Everything the media library touches lives under public/media/ — every
// path coming in from a request is resolved and checked against this root
// so nothing outside it can ever be listed, written, or deleted.
const PUBLIC_DIR = join(SITE_REPO, 'public');
const MEDIA_ROOT = join(PUBLIC_DIR, 'media');
const CONTENT_DIR = join(SITE_REPO, 'src', 'content');

const KIND_BY_EXT = {
  '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.webp': 'image', '.gif': 'image', '.avif': 'image', '.svg': 'image',
  '.mp4': 'video', '.webm': 'video',
  '.pdf': 'pdf',
};

/** Resolves a site path like "/media/design/x.jpg" (or a folder like
 * "media/design") to its absolute location, or null if it would land
 * anywhere outside public/media/. */
export function resolveMediaPath(sitePath) {
  const abs = resolve(PUBLIC_DIR, String(sitePath || '').replace(/^\/+/, ''));
  return abs === MEDIA_ROOT || abs.startsWith(MEDIA_ROOT + sep) ? abs : null;
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (d.name.startsWith('.')) return [];
    const abs = join(dir, d.name);
    return d.isDirectory() ? walk(abs) : [abs];
  });
}

/** Every content file (projects + site text), as { label, editUrl, raw }
 * — used to work out which media files are referenced where. */
function contentFiles() {
  if (!existsSync(CONTENT_DIR)) return [];
  return readdirSync(CONTENT_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) =>
      readdirSync(join(CONTENT_DIR, d.name))
        .filter((f) => f.endsWith('.md'))
        .map((f) => {
          const slug = f.replace(/\.md$/, '');
          const raw = readFileSync(join(CONTENT_DIR, d.name, f), 'utf8');
          const title = raw.match(/^title:\s*"?(.*?)"?\s*$/m)?.[1];
          return d.name === 'site'
            ? { label: 'Site content', editUrl: '/admin/site', raw }
            : { label: title || slug, editUrl: `/admin/${d.name}/${slug}/edit`, raw };
        }),
    );
}

/** All files under public/media/, newest first, each with where it's used. */
export function listMedia() {
  const docs = contentFiles();
  return walk(MEDIA_ROOT)
    .map((abs) => {
      const sitePath = '/' + relative(PUBLIC_DIR, abs).split(sep).join('/');
      const st = statSync(abs);
      return {
        path: sitePath,
        name: sitePath.split('/').pop(),
        folder: sitePath.slice(0, sitePath.lastIndexOf('/')),
        kind: KIND_BY_EXT[extname(abs).toLowerCase()] || 'other',
        size: st.size,
        modified: st.mtimeMs,
        usedBy: docs.filter((d) => d.raw.includes(sitePath)).map(({ label, editUrl }) => ({ label, editUrl })),
      };
    })
    .sort((a, b) => b.modified - a.modified);
}

export function listFolders() {
  const folders = new Set(['/media']);
  for (const abs of walk(MEDIA_ROOT)) {
    folders.add('/' + relative(PUBLIC_DIR, join(abs, '..')).split(sep).join('/'));
  }
  return [...folders].sort();
}

const safeSegment = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Moves uploaded temp files into `folder` (an existing /media/... folder),
 * optionally inside a new sub-folder. Files keep a cleaned-up version of
 * their original name — but the extension always comes from the verified
 * file type, never the name — and get a -2, -3… suffix rather than ever
 * overwriting an existing file. Returns the new site paths.
 */
export function placeLibraryUploads(tmpFiles, folder, newSubfolder) {
  let dir = resolveMediaPath(folder);
  if (!dir) throw new Error('That folder is outside the media library.');
  const sub = safeSegment(newSubfolder);
  if (sub) dir = join(dir, sub);
  mkdirSync(dir, { recursive: true });

  return tmpFiles.map((file) => {
    const ext = MIME_EXTENSIONS[file.mimetype] || (file.mimetype === PDF_MIME ? '.pdf' : null);
    if (!ext) throw new Error(`Unsupported file type: ${file.mimetype}`);
    const base = safeSegment(file.originalname.replace(/\.[^.]*$/, '')) || 'file';
    let name = `${base}${ext}`;
    for (let n = 2; existsSync(join(dir, name)); n += 1) name = `${base}-${n}${ext}`;
    copyFileSync(file.path, join(dir, name));
    unlinkSync(file.path);
    return '/' + relative(PUBLIC_DIR, join(dir, name)).split(sep).join('/');
  });
}

/** Deletes one media file — refused while any content still uses it, so
 * the site can never end up pointing at a missing image. */
export function deleteLibraryFile(sitePath) {
  const abs = resolveMediaPath(sitePath);
  if (!abs || abs === MEDIA_ROOT || !existsSync(abs) || !statSync(abs).isFile()) {
    throw new Error('That file does not exist.');
  }
  const usedBy = contentFiles().filter((d) => d.raw.includes(sitePath));
  if (usedBy.length) {
    throw new Error(`Still used by: ${usedBy.map((d) => d.label).join(', ')}. Remove it there first.`);
  }
  unlinkSync(abs);
}

export function mediaKindOf(sitePath) {
  return KIND_BY_EXT[extname(String(sitePath || '')).toLowerCase()] || 'other';
}

/** True when `sitePath` is an existing library file of the given kind
 * (image/video) — the check behind "choose from the media library". */
export function isLibraryFile(sitePath, kind) {
  const abs = resolveMediaPath(sitePath);
  return Boolean(abs && abs !== MEDIA_ROOT && existsSync(abs) && statSync(abs).isFile() && mediaKindOf(sitePath) === kind);
}

export function isUsedAnywhere(sitePath) {
  return contentFiles().some((d) => d.raw.includes(sitePath));
}
