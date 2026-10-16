import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { COLLECTIONS, getCollection, SITE_SECTIONS } from './lib/schema.mjs';
import { listEntries, getEntry, createEntry, updateEntry, upsertEntry, deleteEntry, reorderEntries, SITE_REPO } from './lib/content.mjs';
import { readFrontmatter } from './lib/frontmatter.mjs';
import { listMedia, listFolders, placeLibraryUploads, deleteLibraryFile } from './lib/media.mjs';
import {
  upload,
  placeUpload,
  placeMultiple,
  readImageDimensions,
  deleteMediaFile,
  deleteMediaFileDir,
  deleteEntryMedia,
  siteDirOf,
  friendlyUploadError,
} from './lib/upload.mjs';
import { requestBuild, buildStatus } from './lib/build.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
const SESSION_SECRET = process.env.SESSION_SECRET;
// the public site is built into dist/ inside the site folder (lib/build.mjs)
// and served from here, so visitors and Alexandra share one URL, with
// /admin as her edit panel
const SITE_DIST = join(process.env.SITE_REPO_PATH, 'dist');

if (!PASSWORD_HASH || !SESSION_SECRET) {
  console.error('ADMIN_PASSWORD_HASH and SESSION_SECRET must be set — see .env.example');
  process.exit(1);
}

const app = express();
app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));
app.set('trust proxy', 1); // sitting behind a reverse proxy on the home server

// ---------- everything admin-related lives under /admin ----------

const admin = express.Router();

// Security headers — scoped to /admin only (not the proxied public site,
// which has its own headers from wherever it's actually served).
admin.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"], // every admin script is an external file — no inline handlers anywhere
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'"],
        mediaSrc: ["'self'"],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"], // this dashboard should never be embedded in another page
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    frameguard: { action: 'deny' }, // X-Frame-Options backstop for browsers that don't honor CSP frame-ancestors
  }),
);

// Blunt instrument against scripted abuse of any /admin endpoint, on top
// of the much stricter limiter on /login below.
admin.use(rateLimit({ windowMs: 10 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));

admin.use(express.static(join(__dirname, 'public')));
admin.use(express.urlencoded({ extended: true }));
admin.use(express.json());

admin.use(
  session({
    name: 'portfolio_admin_sid', // avoid advertising "this is an Express app" via the default connect.sid name
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'strict', // this dashboard never needs to send its cookie on a cross-site request — strict CSRF defense
      secure: process.env.COOKIE_SECURE === 'true',
      maxAge: 1000 * 60 * 60 * 12, // 12 hours
      path: '/admin',
    },
  }),
);

function flash(req) {
  const f = req.session.flash;
  delete req.session.flash;
  return f;
}
function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

// Every save publishes by rebuilding the public site — kicked off in the
// background so the dashboard stays snappy.
const PUBLISHED = 'Live on the site in a few seconds.';
function publish() {
  requestBuild();
}

// the header shows whether the last rebuild of the public site went through
admin.use((req, res, next) => {
  res.locals.build = buildStatus();
  next();
});

function requireAuth(req, res, next) {
  if (req.session.authed) return next();
  return res.redirect(303, '/admin/login');
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts. Wait a while and try again.',
});

// ---------- auth ----------

admin.get('/login', (req, res) => {
  if (req.session.authed) return res.redirect(303, '/admin');
  res.render('login', { flash: flash(req) });
});

admin.post('/login', loginLimiter, async (req, res) => {
  const ok = req.body.password && (await bcrypt.compare(req.body.password, PASSWORD_HASH));
  if (!ok) {
    setFlash(req, 'error', 'Wrong password.');
    return res.redirect(303, '/admin/login');
  }
  req.session.authed = true;
  res.redirect(303, '/admin');
});

admin.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect(303, '/admin/login'));
});

// ---------- dashboard ----------

admin.get('/', requireAuth, (req, res) => {
  const collections = Object.values(COLLECTIONS).map((c) => {
    const entries = listEntries(c.key);
    return {
      key: c.key,
      label: c.label,
      singular: c.singular,
      count: entries.length,
      featured: entries.filter((e) => e.data.featured).length,
    };
  });
  const media = listMedia();
  res.render('dashboard', {
    collections,
    media: {
      count: media.length,
      size: media.reduce((sum, m) => sum + m.size, 0),
      unused: media.filter((m) => !m.usedBy.length).length,
    },
    flash: flash(req),
  });
});

// ---------- media library: every file under public/media ----------

const libraryUpload = upload.array('libraryFiles', 50);

admin.get('/media', requireAuth, (req, res) => {
  const folder = typeof req.query.folder === 'string' ? req.query.folder : '';
  const unused = req.query.unused === '1';
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  const files = listMedia().filter(
    (m) =>
      (!folder || m.folder === folder) &&
      (!unused || !m.usedBy.length) &&
      (!q || m.path.toLowerCase().includes(q)),
  );
  res.render('media', { files, folders: listFolders(), folder, unused, q, flash: flash(req) });
});

admin.post('/media/upload', requireAuth, libraryUpload, (req, res) => {
  try {
    if (!req.files?.length) throw new Error('Choose at least one file to upload.');
    const placed = placeLibraryUploads(req.files, req.body.folder, req.body.newFolder);
    publish();
    setFlash(req, 'success', `Uploaded ${placed.length} file${placed.length === 1 ? '' : 's'}. Copy a file's path to use it anywhere.`);
  } catch (err) {
    console.error(err);
    setFlash(req, 'error', `Could not upload: ${err.message}`);
  }
  res.redirect(303, '/admin/media');
});

admin.post('/media/delete', requireAuth, (req, res) => {
  try {
    deleteLibraryFile(req.body.path);
    publish();
    setFlash(req, 'success', `Deleted ${req.body.path}.`);
  } catch (err) {
    setFlash(req, 'error', `Could not delete: ${err.message}`);
  }
  res.redirect(303, req.get('referer')?.includes('/admin/media') ? req.get('referer') : '/admin/media');
});

// ---------- raw file editor: the full file behind any entry ----------
// an escape hatch for anything the forms don't cover — the frontmatter is
// checked before saving, and a build that still fails leaves the last good
// site live (the header's Republish button shows the error)

const RAW_COLLECTIONS = [...Object.keys(COLLECTIONS), 'site'];

function rawFilePath(collection, slug) {
  if (!RAW_COLLECTIONS.includes(collection) || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null;
  const file = join(SITE_REPO, 'src', 'content', collection, `${slug}.md`);
  return existsSync(file) ? file : null;
}

function rawBackUrl(collection, slug) {
  return collection === 'site' ? '/admin/site' : `/admin/${collection}/${slug}/edit`;
}

admin.get('/raw/:collection/:slug', requireAuth, (req, res, next) => {
  const { collection, slug } = req.params;
  const file = rawFilePath(collection, slug);
  if (!file) return next();
  res.render('raw', {
    collection,
    slug,
    raw: readFileSync(file, 'utf8'),
    backUrl: rawBackUrl(collection, slug),
    flash: flash(req),
  });
});

admin.post('/raw/:collection/:slug', requireAuth, (req, res, next) => {
  const { collection, slug } = req.params;
  const file = rawFilePath(collection, slug);
  if (!file) return next();
  const raw = String(req.body.raw || '').replace(/\r\n/g, '\n');
  try {
    if (!/^---\n[\s\S]*?\n---/.test(raw)) throw new Error('The file must start with a --- block of settings, closed by another ---.');
    readFrontmatter(raw); // throws on broken YAML
    writeFileSync(file, raw.endsWith('\n') ? raw : `${raw}\n`);
    publish();
    setFlash(req, 'success', `Saved. ${PUBLISHED}`);
    return res.redirect(303, `/admin/raw/${collection}/${slug}`);
  } catch (err) {
    // re-show what they typed rather than throwing their edits away
    res.status(400).render('raw', {
      collection,
      slug,
      raw,
      backUrl: rawBackUrl(collection, slug),
      flash: { type: 'error', message: `Not saved — ${err.message.split('\n')[0]}` },
    });
  }
});

// ---------- backup: every content file and media file in one download ----------

admin.get('/backup', requireAuth, (req, res) => {
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="portfolio-backup-${stamp}.tar.gz"`);
  const tar = spawn('tar', ['-czf', '-', '-C', SITE_REPO, 'src/content', 'public/media']);
  tar.stdout.pipe(res);
  tar.stderr.on('data', (d) => console.error('backup:', String(d)));
  tar.on('error', (err) => {
    console.error('backup failed:', err);
    res.destroy();
  });
  req.on('close', () => tar.kill());
});

admin.post('/rebuild', requireAuth, (req, res) => {
  requestBuild();
  setFlash(req, 'success', 'Rebuilding the public site — changes go live in about a minute.');
  res.redirect(303, '/admin');
});

// ---------- site-wide content (singleton: src/content/site/global.md) ----------

const SITE_FIELDS_FLAT = SITE_SECTIONS.flatMap((s) => s.fields);
const siteUpload = upload.fields([{ name: 'aboutPhoto', maxCount: 1 }]);

function coerceSiteFields(body) {
  const data = {};
  for (const f of SITE_FIELDS_FLAT) {
    if (f.type === 'checkbox') {
      data[f.name] = body[f.name] === 'on' || body[f.name] === 'true';
    } else if (f.type === 'number') {
      const n = Number.parseInt(body[f.name], 10);
      data[f.name] = Number.isFinite(n) ? Math.min(Math.max(n, f.min ?? n), f.max ?? n) : f.default;
    } else if (f.type === 'color') {
      // only a strict #rrggbb ever reaches the page's CSS
      data[f.name] = /^#[0-9a-f]{6}$/i.test(body[f.name] || '') ? body[f.name].toLowerCase() : f.default;
    } else if (f.type === 'tags') {
      data[f.name] = (body[f.name] || '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    } else {
      // a cleared field that has a default (menu labels, page headings…)
      // goes back to that default rather than leaving a blank on the site
      data[f.name] = (body[f.name] || '').trim() || f.default || '';
    }
  }
  return data;
}

admin.get('/site', requireAuth, (req, res) => {
  const entry = getEntry('site', 'global');
  res.render('site', { sections: SITE_SECTIONS, site: entry?.data || {}, flash: flash(req) });
});

admin.post('/site', requireAuth, siteUpload, async (req, res) => {
  try {
    const existing = getEntry('site', 'global');
    const fields = coerceSiteFields(req.body);

    if (req.body.removeAboutPhoto && existing?.data.aboutPhoto) {
      deleteMediaFile(existing.data.aboutPhoto);
      fields.aboutPhoto = '';
    }

    const photoFile = req.files?.aboutPhoto?.[0];
    if (photoFile) fields.aboutPhoto = placeUpload(photoFile, { publicDir: 'media', baseName: 'about-photo' });

    upsertEntry('site', 'global', fields);
    publish();
    setFlash(req, 'success', `Saved. ${PUBLISHED}`);
  } catch (err) {
    console.error(err);
    setFlash(req, 'error', `Could not save: ${err.message}`);
  }
  res.redirect(303, '/admin/site');
});

// ---------- helpers shared by the collection routes ----------

function coerceFields(schema, body) {
  const data = {};
  for (const f of schema.fields) {
    if (f.type === 'checkbox') {
      data[f.name] = body[f.name] === 'on' || body[f.name] === 'true';
    } else if (f.type === 'tags') {
      data[f.name] = (body[f.name] || '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    } else {
      const val = (body[f.name] || '').trim();
      // every text/select field is always present in the submitted body
      // (the form never hides a field), so an empty value here means the
      // user genuinely cleared it — write that through rather than
      // silently keeping whatever was there before
      data[f.name] = !val && f.name === 'title' && f.default ? f.default : val;
    }
  }
  data.body = (body.body || '').trim();
  return data;
}

function uploadFieldsFor(schema) {
  const fields = [];
  if (schema.image) fields.push({ name: schema.image.name, maxCount: 1 });
  if (schema.poster) fields.push({ name: schema.poster.name, maxCount: 1 });
  if (schema.video) fields.push({ name: schema.video.name, maxCount: 1 });
  if (schema.videoWebm) fields.push({ name: schema.videoWebm.name, maxCount: 1 });
  if (schema.gallery) fields.push({ name: 'galleryNew', maxCount: 50 });
  return fields;
}

/** Places any uploaded single-file fields (cover/poster/video/...) and
 * returns { fieldName: "/media/...path" } for just the ones that got a
 * new file this submission — existing values are left untouched by the
 * caller (content.mjs merges on top of the existing entry). */
function placeSingleUploads(schema, files, slug) {
  const result = {};
  const singles = [schema.image, schema.poster, schema.video, schema.videoWebm].filter(Boolean);
  for (const f of singles) {
    const file = files?.[f.name]?.[0];
    if (!file) continue;
    // design uses a per-slug subfolder; motion/fineart use flat filenames
    if (schema.key === 'design') {
      result[f.name] = placeUpload(file, {
        publicDir: `media/design/${slug}`,
        baseName: f.name === schema.image.name ? 'cover' : f.name,
      });
    } else {
      result[f.name] = placeUpload(file, {
        publicDir: `media/${schema.key}`,
        baseName: f.name === 'poster' ? `${slug}-poster` : f.name === 'video' ? `${slug}-video` : f.name === 'videoWebm' ? `${slug}-webm` : `${slug}`,
      });
    }
  }
  return result;
}

function placeGalleryUploads(schema, files, slug, keepExisting) {
  if (!schema.gallery) return undefined;
  const newFiles = files?.galleryNew || [];
  // keepExisting images keep whatever number they already have in their
  // filename (never renamed), so a plain "count of kept + 1" counter can
  // collide with one of those numbers once a removal leaves a gap — e.g.
  // removing gallery-1 and adding one new image would both compute
  // "gallery-2", silently overwriting the kept gallery-2.png. A per-save
  // timestamp prefix can't collide with anything, kept or past.
  const stamp = Date.now();
  const added = newFiles.map((file, i) => {
    const publicDir = schema.key === 'design' ? `media/design/${slug}` : `media/${schema.key}`;
    const baseName = schema.key === 'design' ? `gallery-${stamp}-${i}` : `${slug}-gallery-${stamp}-${i}`;
    return placeUpload(file, { publicDir, baseName });
  });
  return [...keepExisting, ...added];
}

// ---------- collection routes ----------

for (const key of Object.keys(COLLECTIONS)) {
  const schema = getCollection(key);
  const uploadMw = upload.fields(uploadFieldsFor(schema));

  admin.get(`/${key}`, requireAuth, (req, res) => {
    res.render('list', { schema, entries: listEntries(key), flash: flash(req) });
  });

  admin.post(`/${key}/reorder`, requireAuth, async (req, res) => {
    reorderEntries(key, req.body.slugs || []);
    publish();
    res.json({ ok: true });
  });

  admin.post(`/${key}/:slug/feature`, requireAuth, (req, res) => {
    const entry = getEntry(key, req.params.slug);
    if (entry) {
      updateEntry(key, req.params.slug, { featured: !entry.data.featured }, {});
      publish();
      setFlash(req, 'success', `"${entry.data.title}" is ${entry.data.featured ? 'no longer' : 'now'} on the homepage. ${PUBLISHED}`);
    }
    res.redirect(303, `/admin/${key}`);
  });

  admin.get(`/${key}/new`, requireAuth, (req, res) => {
    res.render('form', { schema, entry: null, flash: flash(req) });
  });

  admin.post(`/${key}/new`, requireAuth, uploadMw, async (req, res) => {
    try {
      const fields = coerceFields(schema, req.body);
      // create the entry first (gets us a real, unique slug), then place
      // uploads using that slug, then patch the entry with the paths
      const slug = createEntry(key, fields, {});
      const mediaPaths = placeSingleUploads(schema, req.files, slug);
      if (schema.gallery) mediaPaths.gallery = placeGalleryUploads(schema, req.files, slug, []);
      updateEntry(key, slug, {}, mediaPaths);

      publish();
      setFlash(req, 'success', `Created "${fields.title}". ${PUBLISHED}`);
      res.redirect(303, `/admin/${key}`);
    } catch (err) {
      console.error(err);
      setFlash(req, 'error', `Could not save: ${err.message}`);
      res.redirect(303, `/admin/${key}/new`);
    }
  });

  admin.get(`/${key}/:slug/edit`, requireAuth, (req, res) => {
    const entry = getEntry(key, req.params.slug);
    if (!entry) return res.status(404).send('Not found');
    res.render('form', { schema, entry, flash: flash(req) });
  });

  admin.post(`/${key}/:slug/edit`, requireAuth, uploadMw, async (req, res) => {
    const { slug } = req.params;
    try {
      const existing = getEntry(key, slug);
      if (!existing) return res.status(404).send('Not found');

      const fields = coerceFields(schema, req.body);
      const mediaPaths = placeSingleUploads(schema, req.files, slug);

      if (schema.gallery) {
        const existingGallery = existing.data[schema.gallery.name] || [];
        const toRemove = new Set([].concat(req.body.removeGallery || []));
        const kept = existingGallery.filter((src) => !toRemove.has(src));
        for (const src of toRemove) deleteMediaFile(src);
        mediaPaths.gallery = placeGalleryUploads(schema, req.files, slug, kept);
      }

      updateEntry(key, slug, fields, mediaPaths);
      publish();
      setFlash(req, 'success', `Saved. ${PUBLISHED}`);
      res.redirect(303, `/admin/${key}`);
    } catch (err) {
      console.error(err);
      setFlash(req, 'error', `Could not save: ${err.message}`);
      res.redirect(303, `/admin/${key}/${slug}/edit`);
    }
  });

  admin.post(`/${key}/:slug/delete`, requireAuth, async (req, res) => {
    const { slug } = req.params;
    deleteEntry(key, slug);
    deleteEntryMedia(key, slug);
    publish();
    setFlash(req, 'success', `Deleted. ${PUBLISHED}`);
    res.redirect(303, `/admin/${key}`);
  });
}

// ---------- design-only: flipbooks (booklets) and trifolds ----------
// Both are ordered image sequences rather than a single value, so they get
// their own small sub-resource routes instead of the generic field form.

const bookletCreateUpload = upload.fields([
  { name: 'newBookletPages', maxCount: 200 },
  { name: 'newBookletPdf', maxCount: 1 },
]);
const bookletPagesUpload = upload.fields([{ name: 'morePages', maxCount: 200 }]);
const bookletRenameUpload = upload.fields([{ name: 'bookletPdf', maxCount: 1 }]);
const trifoldUpload = upload.fields([
  { name: 'outside', maxCount: 1 },
  { name: 'inside', maxCount: 1 },
]);

function requireDesignEntry(req, res) {
  const entry = getEntry('design', req.params.slug);
  if (!entry) {
    res.status(404).send('Not found');
    return null;
  }
  return entry;
}

admin.post('/design/:slug/booklets', requireAuth, bookletCreateUpload, async (req, res) => {
  const { slug } = req.params;
  try {
    const entry = requireDesignEntry(req, res);
    if (!entry) return;
    const pageFiles = req.files?.newBookletPages || [];
    if (pageFiles.length === 0) throw new Error('Choose at least one page image.');

    const { width, height } = readImageDimensions(pageFiles[0]);
    const publicDir = `media/design/${slug}/flipbook-${Date.now()}`;
    const pages = placeMultiple(pageFiles, { publicDir, prefix: 'page' });

    const booklet = { title: (req.body.title || 'Untitled flipbook').trim(), width, height, pages };
    const pdfFile = req.files?.newBookletPdf?.[0];
    if (pdfFile) booklet.pdf = placeUpload(pdfFile, { publicDir, baseName: 'source' });

    const booklets = [...(entry.data.booklets || []), booklet];
    updateEntry('design', slug, {}, { booklets });
    publish();
    setFlash(req, 'success', `Flipbook added. ${PUBLISHED}`);
  } catch (err) {
    console.error(err);
    setFlash(req, 'error', `Could not add flipbook: ${err.message}`);
  }
  res.redirect(303, `/admin/design/${slug}/edit#flipbooks`);
});

admin.post('/design/:slug/booklets/:index/pages', requireAuth, bookletPagesUpload, async (req, res) => {
  const { slug, index } = req.params;
  const idx = Number(index);
  try {
    const entry = requireDesignEntry(req, res);
    if (!entry) return;
    const booklets = entry.data.booklets || [];
    const booklet = booklets[idx];
    if (!booklet) throw new Error('Flipbook not found.');
    const newFiles = req.files?.morePages || [];
    if (newFiles.length === 0) throw new Error('Choose at least one page image.');

    const publicDir = booklet.pages.length ? siteDirOf(booklet.pages[0]) : `media/design/${slug}/flipbook-${Date.now()}`;
    const added = placeMultiple(newFiles, { publicDir, prefix: 'page' });
    booklets[idx] = { ...booklet, pages: [...booklet.pages, ...added] };
    updateEntry('design', slug, {}, { booklets });
    publish();
    setFlash(req, 'success', `Pages added. ${PUBLISHED}`);
  } catch (err) {
    console.error(err);
    setFlash(req, 'error', `Could not add pages: ${err.message}`);
  }
  res.redirect(303, `/admin/design/${slug}/edit#flipbooks`);
});

admin.post('/design/:slug/booklets/:index/reorder-pages', requireAuth, async (req, res) => {
  const { slug, index } = req.params;
  const idx = Number(index);
  const entry = getEntry('design', slug);
  const booklets = entry?.data.booklets || [];
  const booklet = booklets[idx];
  const incoming = req.body.pages;
  const validSet = Array.isArray(incoming) && new Set(incoming).size === incoming.length && incoming.every((p) => booklet?.pages.includes(p));

  if (!entry || !booklet || !validSet || incoming.length !== booklet.pages.length) {
    return res.status(400).json({ ok: false });
  }

  booklets[idx] = { ...booklet, pages: incoming };
  updateEntry('design', slug, {}, { booklets });
  publish();
  res.json({ ok: true });
});

admin.post('/design/:slug/booklets/:index/delete-page', requireAuth, async (req, res) => {
  const { slug, index } = req.params;
  const idx = Number(index);
  try {
    const entry = requireDesignEntry(req, res);
    if (!entry) return;
    const booklets = entry.data.booklets || [];
    const booklet = booklets[idx];
    if (!booklet) throw new Error('Flipbook not found.');

    const page = req.body.page;
    deleteMediaFile(page);
    booklets[idx] = { ...booklet, pages: booklet.pages.filter((p) => p !== page) };
    updateEntry('design', slug, {}, { booklets });
    publish();
    setFlash(req, 'success', `Page removed. ${PUBLISHED}`);
  } catch (err) {
    console.error(err);
    setFlash(req, 'error', `Could not remove page: ${err.message}`);
  }
  res.redirect(303, `/admin/design/${slug}/edit#flipbooks`);
});

admin.post('/design/:slug/booklets/:index/rename', requireAuth, bookletRenameUpload, async (req, res) => {
  const { slug, index } = req.params;
  const idx = Number(index);
  try {
    const entry = requireDesignEntry(req, res);
    if (!entry) return;
    const booklets = entry.data.booklets || [];
    const booklet = booklets[idx];
    if (!booklet) throw new Error('Flipbook not found.');

    const updated = { ...booklet, title: (req.body.title || booklet.title).trim() };
    const pdfFile = req.files?.bookletPdf?.[0];
    if (pdfFile) {
      const publicDir = booklet.pages.length ? siteDirOf(booklet.pages[0]) : `media/design/${slug}/flipbook-${Date.now()}`;
      updated.pdf = placeUpload(pdfFile, { publicDir, baseName: 'source' });
    }
    booklets[idx] = updated;
    updateEntry('design', slug, {}, { booklets });
    publish();
    setFlash(req, 'success', `Saved. ${PUBLISHED}`);
  } catch (err) {
    console.error(err);
    setFlash(req, 'error', `Could not save: ${err.message}`);
  }
  res.redirect(303, `/admin/design/${slug}/edit#flipbooks`);
});

admin.post('/design/:slug/booklets/:index/delete', requireAuth, async (req, res) => {
  const { slug, index } = req.params;
  const idx = Number(index);
  try {
    const entry = requireDesignEntry(req, res);
    if (!entry) return;
    const booklets = entry.data.booklets || [];
    const booklet = booklets[idx];
    if (!booklet) throw new Error('Flipbook not found.');

    if (booklet.pages[0]) deleteMediaFileDir(booklet.pages[0]);
    booklets.splice(idx, 1);
    updateEntry('design', slug, {}, { booklets });
    publish();
    setFlash(req, 'success', `Flipbook deleted. ${PUBLISHED}`);
  } catch (err) {
    console.error(err);
    setFlash(req, 'error', `Could not delete: ${err.message}`);
  }
  res.redirect(303, `/admin/design/${slug}/edit#flipbooks`);
});

admin.post('/design/:slug/trifolds', requireAuth, trifoldUpload, async (req, res) => {
  const { slug } = req.params;
  try {
    const entry = requireDesignEntry(req, res);
    if (!entry) return;
    const outsideFile = req.files?.outside?.[0];
    const insideFile = req.files?.inside?.[0];
    if (!outsideFile || !insideFile) throw new Error('Both outside and inside images are required.');

    const publicDir = `media/design/${slug}/trifold-${Date.now()}`;
    const trifold = {
      title: (req.body.title || 'Untitled trifold').trim(),
      outside: placeUpload(outsideFile, { publicDir, baseName: 'outside' }),
      inside: placeUpload(insideFile, { publicDir, baseName: 'inside' }),
    };
    const trifolds = [...(entry.data.trifolds || []), trifold];
    updateEntry('design', slug, {}, { trifolds });
    publish();
    setFlash(req, 'success', `Trifold added. ${PUBLISHED}`);
  } catch (err) {
    console.error(err);
    setFlash(req, 'error', `Could not add trifold: ${err.message}`);
  }
  res.redirect(303, `/admin/design/${slug}/edit#trifolds`);
});

admin.post('/design/:slug/trifolds/:index', requireAuth, trifoldUpload, async (req, res) => {
  const { slug, index } = req.params;
  const idx = Number(index);
  try {
    const entry = requireDesignEntry(req, res);
    if (!entry) return;
    const trifolds = entry.data.trifolds || [];
    const trifold = trifolds[idx];
    if (!trifold) throw new Error('Trifold not found.');

    const publicDir = siteDirOf(trifold.outside);
    const updated = { ...trifold, title: (req.body.title || trifold.title).trim() };
    const outsideFile = req.files?.outside?.[0];
    const insideFile = req.files?.inside?.[0];
    if (outsideFile) updated.outside = placeUpload(outsideFile, { publicDir, baseName: 'outside' });
    if (insideFile) updated.inside = placeUpload(insideFile, { publicDir, baseName: 'inside' });

    trifolds[idx] = updated;
    updateEntry('design', slug, {}, { trifolds });
    publish();
    setFlash(req, 'success', `Saved. ${PUBLISHED}`);
  } catch (err) {
    console.error(err);
    setFlash(req, 'error', `Could not save: ${err.message}`);
  }
  res.redirect(303, `/admin/design/${slug}/edit#trifolds`);
});

admin.post('/design/:slug/trifolds/:index/delete', requireAuth, async (req, res) => {
  const { slug, index } = req.params;
  const idx = Number(index);
  try {
    const entry = requireDesignEntry(req, res);
    if (!entry) return;
    const trifolds = entry.data.trifolds || [];
    const trifold = trifolds[idx];
    if (!trifold) throw new Error('Trifold not found.');

    deleteMediaFileDir(trifold.outside);
    trifolds.splice(idx, 1);
    updateEntry('design', slug, {}, { trifolds });
    publish();
    setFlash(req, 'success', `Trifold deleted. ${PUBLISHED}`);
  } catch (err) {
    console.error(err);
    setFlash(req, 'error', `Could not delete: ${err.message}`);
  }
  res.redirect(303, `/admin/design/${slug}/edit#trifolds`);
});

// Catches anything thrown above (most notably a multer/fileFilter upload
// rejection, which happens before any route handler's own try/catch runs)
// and shows a clean message instead of leaking a raw stack trace — which
// by default includes internal file paths and dependency internals — to
// the browser.
// eslint-disable-next-line no-unused-vars
admin.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status && err.status < 500 ? err.status : 400);
  res.render('error', { message: friendlyUploadError(err) });
});

app.use('/admin', admin);

// ---------- everything else: the public site ----------

app.use(
  express.static(SITE_DIST, {
    extensions: ['html'],
    setHeaders(res, path) {
      // Astro fingerprints everything under _astro/, so it can be cached forever
      if (path.includes('/_astro/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }),
);
app.use((req, res) => res.status(404).type('text').send('Not found'));

// build once at startup so dist/ always matches the content on disk
requestBuild();

app.listen(PORT, () => {
  console.log(`Portfolio listening on http://localhost:${PORT} (public site at /, dashboard at /admin)`);
});
