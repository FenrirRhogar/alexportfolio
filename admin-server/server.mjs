import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLLECTIONS, getCollection, SITE_SECTIONS } from './lib/schema.mjs';
import { listEntries, getEntry, createEntry, updateEntry, upsertEntry, deleteEntry, reorderEntries } from './lib/content.mjs';
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
import { commitAndPush } from './lib/git.mjs';
import { proxyTo } from './lib/proxy.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
const SESSION_SECRET = process.env.SESSION_SECRET;
// where the public portfolio itself is served from — the Astro dev server
// while testing, or wherever the built site is served from in production
// (see README.md). Everything that isn't under /admin gets proxied there,
// so visitors and Alexandra share one URL, with /admin as her edit panel.
const PUBLIC_SITE_ORIGIN = process.env.PUBLIC_SITE_ORIGIN;

if (!PASSWORD_HASH || !SESSION_SECRET) {
  console.error('ADMIN_PASSWORD_HASH and SESSION_SECRET must be set — see .env.example');
  process.exit(1);
}
if (!PUBLIC_SITE_ORIGIN) {
  console.error('PUBLIC_SITE_ORIGIN must be set — see .env.example');
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
  const collections = Object.values(COLLECTIONS).map((c) => ({
    key: c.key,
    label: c.label,
    singular: c.singular,
    count: listEntries(c.key).length,
  }));
  res.render('dashboard', { collections, flash: flash(req) });
});

// ---------- site-wide content (singleton: src/content/site/global.md) ----------

const SITE_FIELDS_FLAT = SITE_SECTIONS.flatMap((s) => s.fields);
const siteUpload = upload.fields([{ name: 'aboutPhoto', maxCount: 1 }]);

function coerceSiteFields(body) {
  const data = {};
  for (const f of SITE_FIELDS_FLAT) {
    if (f.type === 'tags') {
      data[f.name] = (body[f.name] || '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    } else {
      data[f.name] = (body[f.name] || '').trim();
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
    const result = await commitAndPush('Admin: update site content');
    setFlash(req, result.pushed ? 'success' : 'error', `Saved. ${result.message}`);
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
    await commitAndPush(`Admin: reorder ${key}`);
    res.json({ ok: true });
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

      const result = await commitAndPush(`Admin: add ${key}/${slug}`);
      setFlash(req, result.pushed ? 'success' : 'error', `Created "${fields.title}". ${result.message}`);
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
      const result = await commitAndPush(`Admin: edit ${key}/${slug}`);
      setFlash(req, result.pushed ? 'success' : 'error', `Saved. ${result.message}`);
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
    const result = await commitAndPush(`Admin: delete ${key}/${slug}`);
    setFlash(req, result.pushed ? 'success' : 'error', `Deleted. ${result.message}`);
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
    const result = await commitAndPush(`Admin: add flipbook to design/${slug}`);
    setFlash(req, result.pushed ? 'success' : 'error', `Flipbook added. ${result.message}`);
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
    const result = await commitAndPush(`Admin: add pages to a design/${slug} flipbook`);
    setFlash(req, result.pushed ? 'success' : 'error', `Pages added. ${result.message}`);
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
  await commitAndPush(`Admin: reorder a design/${slug} flipbook's pages`);
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
    const result = await commitAndPush(`Admin: remove a page from a design/${slug} flipbook`);
    setFlash(req, result.pushed ? 'success' : 'error', `Page removed. ${result.message}`);
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
    const result = await commitAndPush(`Admin: update a design/${slug} flipbook`);
    setFlash(req, result.pushed ? 'success' : 'error', `Saved. ${result.message}`);
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
    const result = await commitAndPush(`Admin: delete a flipbook from design/${slug}`);
    setFlash(req, result.pushed ? 'success' : 'error', `Flipbook deleted. ${result.message}`);
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
    const result = await commitAndPush(`Admin: add trifold to design/${slug}`);
    setFlash(req, result.pushed ? 'success' : 'error', `Trifold added. ${result.message}`);
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
    const result = await commitAndPush(`Admin: update a design/${slug} trifold`);
    setFlash(req, result.pushed ? 'success' : 'error', `Saved. ${result.message}`);
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
    const result = await commitAndPush(`Admin: delete a trifold from design/${slug}`);
    setFlash(req, result.pushed ? 'success' : 'error', `Trifold deleted. ${result.message}`);
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

// ---------- everything else: proxy through to the public site ----------
// so Alexandra (and everyone else) can use one URL — the public pages at
// "/", her edit panel at "/admin" — regardless of where the public site
// is actually served from.

app.use(proxyTo(PUBLIC_SITE_ORIGIN));

app.listen(PORT, () => {
  console.log(`Portfolio admin listening on http://localhost:${PORT} (public site proxied from ${PUBLIC_SITE_ORIGIN})`);
});
