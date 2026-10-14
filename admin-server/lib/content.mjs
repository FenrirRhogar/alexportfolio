import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { readFrontmatter, writeFrontmatter } from './frontmatter.mjs';
import { getCollection } from './schema.mjs';

const SITE_REPO = process.env.SITE_REPO_PATH;
if (!SITE_REPO) throw new Error('SITE_REPO_PATH is not set (see .env.example)');

function contentDir(collectionKey) {
  return join(SITE_REPO, 'src', 'content', collectionKey);
}

export function slugify(title) {
  return (
    title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'untitled'
  );
}

export function uniqueSlug(base, collectionKey, skipSlug = null) {
  const dir = contentDir(collectionKey);
  let slug = base;
  let n = 2;
  while (existsSync(join(dir, `${slug}.md`)) && slug !== skipSlug) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

export function listEntries(collectionKey) {
  const dir = contentDir(collectionKey);
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((file) => {
      const slug = file.replace(/\.md$/, '');
      const { data, content } = readFrontmatter(readFileSync(join(dir, file), 'utf8'));
      return { slug, data, body: content };
    });
  entries.sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0));
  return entries;
}

export function getEntry(collectionKey, slug) {
  const file = join(contentDir(collectionKey), `${slug}.md`);
  if (!existsSync(file)) return null;
  const { data, content } = readFrontmatter(readFileSync(file, 'utf8'));
  return { slug, data, body: content };
}

function writeEntry(collectionKey, slug, data, body) {
  const dir = contentDir(collectionKey);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${slug}.md`), writeFrontmatter(data, body));
}

function nextOrder(collectionKey) {
  const entries = listEntries(collectionKey);
  return entries.reduce((max, e) => Math.max(max, e.data.order ?? 0), 0) + 1;
}

/**
 * Create a new entry. `formData` is the flat set of form fields (already
 * coerced to the right types by the route handler); `mediaPaths` maps
 * field name (cover/poster/video/videoWebm) -> the /media/... path that
 * was just written to disk by the upload handler.
 */
export function createEntry(collectionKey, formData, mediaPaths) {
  const schema = getCollection(collectionKey);
  const title = formData.title || schema.fields.find((f) => f.name === 'title')?.default || 'Untitled';
  const slug = uniqueSlug(slugify(title), collectionKey);
  const data = { ...formData, ...mediaPaths, gallery: mediaPaths.gallery || [], order: nextOrder(collectionKey) };
  delete data.body;
  writeEntry(collectionKey, slug, data, formData.body);
  return slug;
}

/**
 * Update an existing entry. Loads the file fresh and merges only the
 * fields this app knows about on top of it, so anything else already in
 * the file (booklets, trifolds, a field added later by hand) survives
 * the round-trip untouched.
 */
export function updateEntry(collectionKey, slug, formData, mediaPaths) {
  const existing = getEntry(collectionKey, slug);
  if (!existing) throw new Error(`${collectionKey}/${slug} not found`);

  const data = { ...existing.data, ...formData, ...mediaPaths };
  if (mediaPaths.gallery) data.gallery = mediaPaths.gallery;
  delete data.body;

  const body = formData.body !== undefined ? formData.body : existing.body;
  writeEntry(collectionKey, slug, data, body);
}

export function deleteEntry(collectionKey, slug) {
  const file = join(contentDir(collectionKey), `${slug}.md`);
  if (existsSync(file)) unlinkSync(file);
}

/** Reorders by rewriting each file's `order` field to match array position. */
export function reorderEntries(collectionKey, orderedSlugs) {
  orderedSlugs.forEach((slug, i) => {
    const entry = getEntry(collectionKey, slug);
    if (!entry) return;
    writeEntry(collectionKey, slug, { ...entry.data, order: i + 1 }, entry.body);
  });
}

export { SITE_REPO };
