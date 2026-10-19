import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { COLLECTIONS, getCollection, SITE_SECTIONS, SIZE_OPTIONS } from './lib/schema.mjs';
import { listEntries, getEntry, createEntry, updateEntry, upsertEntry, deleteEntry, reorderEntries, SITE_REPO } from './lib/content.mjs';
import { readFrontmatter } from './lib/frontmatter.mjs';
import {
  listMedia,
  listFolders,
  placeLibraryUploads,
  deleteLibraryFile,
  isLibraryFile,
  isUsedAnywhere,
  copyLibraryFiles,
  imageDimensionsOf,
} from './lib/media.mjs';
import { clientIp, loginLimiterPerIp, loginLimiterGlobal, requireCloudflareAccess } from './lib/auth.mjs';
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

// first of all: nothing under /admin answers without Cloudflare Access (if configured)
admin.use(requireCloudflareAccess);

// Uploads sent by public/upload.js (to show a progress bar) can't stop the
// browser from silently following a redirect — which would also use up the
// one-time "Saved" message. So for those, answer with where to go next and
// let the page navigate there itself.
const isScriptUpload = (req) => req.get('x-requested-with') === 'upload';
admin.use((req, res, next) => {
  if (isScriptUpload(req)) {
    res.redirect = (status, url) => res.json({ redirect: typeof status === 'string' ? status : url });
  }
  next();
});

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
        imgSrc: ["'self'", 'blob:'], // blob: — upload.js reads photos locally to shrink them before upload
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
admin.use(
  rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(clientIp(req)),
  }),
);

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

/** Which featured projects actually appear on the homepage — the same
 * pick as src/pages/index.astro: one from each collection in turn, each in
 * its own order, up to the homepage's limit. Returns { shown: Set of
 * "collection/slug", limit }. */
function homepageSelection() {
  const limit = Number(getEntry('site', 'global')?.data.homeFeaturedCount) || 6;
  const queues = Object.keys(COLLECTIONS).map((key) =>
    listEntries(key)
      .filter((e) => e.data.featured)
      .map((e) => `${key}/${e.slug}`),
  );
  const shown = [];
  for (let i = 0; shown.length < limit && queues.some((q) => q[i]); i++) {
    shown.push(...queues.map((q) => q[i]).filter(Boolean));
  }
  return { shown: new Set(shown.slice(0, limit)), limit };
}

// the header shows whether the last rebuild of the public site went through
admin.use((req, res, next) => {
  res.locals.build = buildStatus();
  res.locals.accessEmail = req.accessEmail;
  res.locals.sizeOptions = SIZE_OPTIONS;
  next();
});

// With Cloudflare Access configured, its verified email sign-in *is* the
// login (requireCloudflareAccess has already rejected anything else); the
// password below is only the fallback for when Access is switched off.
const signedIn = (req) => Boolean(req.accessEmail || req.session.authed);

function requireAuth(req, res, next) {
  if (signedIn(req)) return next();
  return res.redirect(303, '/admin/login');
}


// ---------- auth ----------

admin.get('/login', (req, res) => {
  if (signedIn(req)) return res.redirect(303, '/admin');
  res.render('login', { flash: flash(req) });
});

admin.post('/login', loginLimiterGlobal, loginLimiterPerIp, async (req, res, next) => {
  const ok = typeof req.body.password === 'string' && (await bcrypt.compare(req.body.password, PASSWORD_HASH));
  if (!ok) {
    console.warn(`Failed admin login from ${clientIp(req)}`);
    // a 401 (not a redirect) is what counts toward the login limits
    return res.status(401).render('login', { error: 'Wrong password.' });
  }
  // a brand-new session id on login, so one picked up before logging in
  // can never become a logged-in one
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.authed = true;
    req.session.save((saveErr) => (saveErr ? next(saveErr) : res.redirect(303, '/admin')));
  });
});

admin.post('/logout', (req, res) => {
  // also end the Cloudflare Access session, or the next visit would sign
  // straight back in
  req.session.destroy(() => res.redirect(303, req.accessEmail ? '/cdn-cgi/access/logout' : '/admin/login'));
});

// ---------- dashboard ----------

admin.get('/', requireAuth, (req, res) => {
  const { shown, limit } = homepageSelection();
  const collections = Object.values(COLLECTIONS).map((c) => {
    const entries = listEntries(c.key);
    return {
      key: c.key,
      label: c.label,
      singular: c.singular,
      count: entries.length,
      featured: entries.filter((e) => e.data.featured).length,
      onHomepage: entries.filter((e) => shown.has(`${c.key}/${e.slug}`)).length,
    };
  });
  const featuredTotal = collections.reduce((n, c) => n + c.featured, 0);
  const media = listMedia();
  res.render('dashboard', {
    collections,
    homepage: { limit, featuredTotal },
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

// browsers submit textarea line breaks as \r\n — store plain \n
const plain = (v) => String(v || '').replace(/\r\n?/g, '\n').trim();
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
      data[f.name] = plain(body[f.name]) || f.default || '';
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
    const oldPhoto = existing?.data.aboutPhoto;
    if (photoFile) fields.aboutPhoto = placeUpload(photoFile, { publicDir: 'media', baseName: `about-photo-${Date.now().toString(36)}` });

    upsertEntry('site', 'global', fields);
    // the replaced photo, if this page uploaded it and nothing else uses it
    if (photoFile && oldPhoto?.startsWith('/media/about-photo') && !isUsedAnywhere(oldPhoto)) deleteMediaFile(oldPhoto);
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
      let val = plain(body[f.name]);
      // a dropdown only ever stores one of its own options
      if (f.type === 'select' && !f.options.some((o) => (typeof o === 'object' ? o.value : o) === val)) val = '';
      // every text/select field is always present in the submitted body
      // (the form never hides a field), so an empty value here means the
      // user genuinely cleared it — write that through rather than
      // silently keeping whatever was there before
      data[f.name] = !val && f.name === 'title' && f.default ? f.default : val;
    }
  }
  data.body = plain(body.body);
  return data;
}

function uploadFieldsFor(schema) {
  const fields = [];
  if (schema.image) fields.push({ name: schema.image.name, maxCount: 1 });
  if (schema.poster) fields.push({ name: schema.poster.name, maxCount: 1 });
  if (schema.video) fields.push({ name: schema.video.name, maxCount: 1 });
  if (schema.videoWebm) fields.push({ name: schema.videoWebm.name, maxCount: 1 });
  if (schema.gallery) fields.push({ name: 'galleryNew', maxCount: 50 });
  // the new-entry form can create a first flipbook and/or trifold in one go
  if (schema.hasFlipbooks) {
    fields.push(
      { name: 'newBookletPages', maxCount: 200 },
      { name: 'newBookletPdf', maxCount: 1 },
      { name: 'outside', maxCount: 1 },
      { name: 'inside', maxCount: 1 },
    );
  }
  return fields;
}

/** Places any uploaded single-file fields (cover/poster/video/...) and
 * returns { fieldName: "/media/...path" } for just the ones that got a
 * new file this submission — existing values are left untouched by the
 * caller (content.mjs merges on top of the existing entry). */
function placeSingleUploads(schema, files, slug) {
  // a fresh name on every upload: browsers and Cloudflare keep /media files
  // for hours, so a replaced image reusing the old name could keep showing
  // the old picture (cleanupDropped removes the file it replaced)
  const stamp = Date.now().toString(36);
  const result = {};
  const singles = [schema.image, schema.poster, schema.video, schema.videoWebm].filter(Boolean);
  for (const f of singles) {
    const file = files?.[f.name]?.[0];
    if (!file) continue;
    // design uses a per-slug subfolder; motion/fineart use flat filenames
    if (schema.key === 'design') {
      result[f.name] = placeUpload(file, {
        publicDir: `media/design/${slug}`,
        baseName: `${f.name === schema.image.name ? 'cover' : f.name}-${stamp}`,
      });
    } else {
      result[f.name] = placeUpload(file, {
        publicDir: `media/${schema.key}`,
        baseName: `${f.name === 'poster' ? `${slug}-poster` : f.name === 'video' ? `${slug}-video` : f.name === 'videoWebm' ? `${slug}-webm` : slug}-${stamp}`,
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

/** Files chosen from the media library instead of uploaded ("pick_<field>"
 * for cover/poster/video…, "galleryPick" for gallery images) — only ever
 * existing library files of the right kind. */
function pickedSingles(schema, body) {
  const picked = {};
  for (const f of [schema.image, schema.poster, schema.video, schema.videoWebm].filter(Boolean)) {
    const path = body[`pick_${f.name}`];
    if (path && isLibraryFile(path, f.kind)) picked[f.name] = path;
  }
  return picked;
}

function pickedGallery(schema, body) {
  if (!schema.gallery) return [];
  return [].concat(body.galleryPick || []).filter((path) => isLibraryFile(path, 'image'));
}

/** Library images/videos for the form's "choose from the media library"
 * pickers — unused ones first, since those are usually what was just uploaded. */
function pickerLibrary() {
  const files = listMedia().filter((m) => m.kind === 'image' || m.kind === 'video');
  files.sort((a, b) => Number(a.usedBy.length > 0) - Number(b.usedBy.length > 0) || b.modified - a.modified);
  return { image: files.filter((m) => m.kind === 'image'), video: files.filter((m) => m.kind === 'video') };
}

/** Whether a media file was uploaded through this entry's own form (as
 * opposed to picked from the library, which may be shared). */
function ownedBy(key, slug, sitePath) {
  // everything in the entry's own folder (design files, any flipbook/trifold)
  if (sitePath.startsWith(`/media/${key}/${slug}/`)) return true;
  if (key === 'design') return false;
  const name = sitePath.split('/').pop();
  return sitePath.startsWith(`/media/${key}/`) && (name.startsWith(`${slug}.`) || name.startsWith(`${slug}-`));
}

/** After a save, deletes files this entry had uploaded itself that it no
 * longer uses — unless some other entry uses them too. Library files picked
 * into the entry are never deleted; they just become unused again. */
function cleanupDropped(key, slug, schema, before, after) {
  const fields = [schema.image, schema.poster, schema.video, schema.videoWebm].filter(Boolean).map((f) => f.name);
  const paths = (data) => [...fields.map((f) => data[f]), ...(schema.gallery ? data[schema.gallery.name] || [] : [])].filter(Boolean);
  const still = new Set(paths(after));
  for (const path of paths(before)) {
    if (!still.has(path) && ownedBy(key, slug, path) && !isUsedAnywhere(path)) deleteMediaFile(path);
  }
}

// ---------- collection routes ----------

for (const key of Object.keys(COLLECTIONS)) {
  const schema = getCollection(key);
  const uploadMw = upload.fields(uploadFieldsFor(schema));

  admin.get(`/${key}`, requireAuth, (req, res) => {
    res.render('list', { schema, entries: listEntries(key), homepage: homepageSelection(), flash: flash(req) });
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
    res.render('form', { schema, entry: null, library: pickerLibrary(), flash: flash(req) });
  });

  admin.post(`/${key}/new`, requireAuth, uploadMw, async (req, res) => {
    try {
      const fields = coerceFields(schema, req.body);
      const picked = pickedSingles(schema, req.body);
      for (const f of [schema.image, schema.poster, schema.video].filter(Boolean)) {
        if (!f.optional && !req.files?.[f.name]?.[0] && !picked[f.name]) {
          throw new Error(`${f.label} is missing — upload one or choose one from the media library.`);
        }
      }
      if (Boolean(req.files?.outside?.[0]) !== Boolean(req.files?.inside?.[0])) {
        throw new Error('A trifold needs both its outside and inside image — or leave both empty.');
      }
      // create the entry first (gets us a real, unique slug), then place
      // uploads using that slug, then patch the entry with the paths
      const slug = createEntry(key, fields, {});
      // an uploaded file wins over one picked from the library for the same slot
      const mediaPaths = { ...picked, ...placeSingleUploads(schema, req.files, slug) };
      if (schema.gallery) mediaPaths.gallery = placeGalleryUploads(schema, req.files, slug, pickedGallery(schema, req.body));
      if (schema.hasFlipbooks) {
        const bookletPages = req.files?.newBookletPages || [];
        const bookletPicks = pickedPages(req.body);
        const outside = req.files?.outside?.[0];
        const inside = req.files?.inside?.[0];
        if (bookletPages.length || bookletPicks.length) {
          mediaPaths.booklets = [
            createBooklet(key, slug, bookletPages, req.files?.newBookletPdf?.[0], req.body.newBookletTitle, bookletPicks),
          ];
        }
        if (outside || inside) mediaPaths.trifolds = [createTrifold(key, slug, outside, inside, req.body.newTrifoldTitle)];
      }
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
    res.render('form', { schema, entry, library: pickerLibrary(), flash: flash(req) });
  });

  admin.post(`/${key}/:slug/edit`, requireAuth, uploadMw, async (req, res) => {
    const { slug } = req.params;
    try {
      const existing = getEntry(key, slug);
      if (!existing) return res.status(404).send('Not found');

      const fields = coerceFields(schema, req.body);
      // an uploaded file wins over one picked from the library for the same slot
      const mediaPaths = { ...pickedSingles(schema, req.body), ...placeSingleUploads(schema, req.files, slug) };

      if (schema.gallery) {
        const existingGallery = existing.data[schema.gallery.name] || [];
        const toRemove = new Set([].concat(req.body.removeGallery || []));
        const kept = existingGallery.filter((src) => !toRemove.has(src));
        const picked = pickedGallery(schema, req.body).filter((src) => !kept.includes(src));
        mediaPaths.gallery = placeGalleryUploads(schema, req.files, slug, [...kept, ...picked]);
      }

      updateEntry(key, slug, fields, mediaPaths);
      cleanupDropped(key, slug, schema, existing.data, getEntry(key, slug).data);
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
    const entry = getEntry(key, slug);
    deleteEntry(key, slug);
    deleteEntryMedia(key, slug);
    // files this entry uploaded under its own name and nothing else uses
    if (entry) cleanupDropped(key, slug, schema, entry.data, {});
    publish();
    setFlash(req, 'success', `Deleted. ${PUBLISHED}`);
    res.redirect(303, `/admin/${key}`);
  });
}

// ---------- uploads for flipbooks (booklets) and trifolds ----------
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

function requireEntry(key, req, res) {
  const entry = getEntry(key, req.params.slug);
  if (!entry) {
    res.status(404).send('Not found');
    return null;
  }
  return entry;
}

/** Flipbook pages chosen from the media library, in the order they were
 * clicked (upload.js/picker.js keep that in "<name>Order"), library images only. */
function pickedPages(body, name = 'pagePick') {
  const chosen = [].concat(body[name] || []);
  let order = [];
  try {
    order = JSON.parse(body[`${name}Order`] || '[]');
  } catch {
    // no click order sent — fall back to the order on the page
  }
  const ordered = [...order.filter((p) => chosen.includes(p)), ...chosen.filter((p) => !order.includes(p))];
  return [...new Set(ordered)].filter((p) => isLibraryFile(p, 'image'));
}

/** Adds pages to a flipbook folder: uploaded images first (in the order
 * selected), then library images (in the order clicked), copied in. */
function placePages(publicDir, pageFiles = [], picked = []) {
  return [
    ...placeMultiple(pageFiles, { publicDir, prefix: 'page' }),
    ...copyLibraryFiles(picked, { publicDir, prefix: 'page' }),
  ];
}

/** Builds a flipbook from page images (uploaded and/or chosen from the
 * media library) plus an optional source PDF, in its own folder under the
 * entry's media folder. */
function createBooklet(key, slug, pageFiles = [], pdfFile, title, picked = []) {
  if (!pageFiles.length && !picked.length) throw new Error('Choose at least one page image.');
  // every page is shown at the first page's proportions
  const { width, height } = pageFiles.length ? readImageDimensions(pageFiles[0]) : imageDimensionsOf(picked[0]);
  const publicDir = `media/${key}/${slug}/flipbook-${Date.now()}`;
  const booklet = {
    title: (title || 'Untitled flipbook').trim(),
    width,
    height,
    pages: placePages(publicDir, pageFiles, picked),
  };
  if (pdfFile) booklet.pdf = placeUpload(pdfFile, { publicDir, baseName: 'source' });
  return booklet;
}

/** Sets a flipbook/trifold's display size from the form — only known sizes;
 * "Standard" removes the setting. Leaves it alone if the form sent none. */
function withSize(item, size) {
  if (size === undefined) return item;
  const { size: _old, ...rest } = item;
  return size && SIZE_OPTIONS.some((o) => o.value === size) ? { ...rest, size } : rest;
}

/** A trifold: one sheet's outside and inside, in its own folder. */
function createTrifold(key, slug, outsideFile, insideFile, title) {
  if (!outsideFile || !insideFile) throw new Error('Both outside and inside images are required.');
  const publicDir = `media/${key}/${slug}/trifold-${Date.now()}`;
  return {
    title: (title || 'Untitled trifold').trim(),
    outside: placeUpload(outsideFile, { publicDir, baseName: 'outside' }),
    inside: placeUpload(insideFile, { publicDir, baseName: 'inside' }),
  };
}

// ---------- flipbooks & trifolds (every collection with hasFlipbooks) ----------

for (const key of Object.keys(COLLECTIONS).filter((k) => COLLECTIONS[k].hasFlipbooks)) {

  admin.post(`/${key}/:slug/booklets`, requireAuth, bookletCreateUpload, async (req, res) => {
    const { slug } = req.params;
    try {
      const entry = requireEntry(key, req, res);
      if (!entry) return;
      const booklet = createBooklet(key, slug, req.files?.newBookletPages, req.files?.newBookletPdf?.[0], req.body.title, pickedPages(req.body));
      const booklets = [...(entry.data.booklets || []), booklet];
      updateEntry(key, slug, {}, { booklets });
      publish();
      setFlash(req, 'success', `Flipbook added. ${PUBLISHED}`);
    } catch (err) {
      console.error(err);
      setFlash(req, 'error', `Could not add flipbook: ${err.message}`);
    }
    res.redirect(303, `/admin/${key}/${slug}/edit#flipbooks`);
  });

  admin.post(`/${key}/:slug/booklets/:index/pages`, requireAuth, bookletPagesUpload, async (req, res) => {
    const { slug, index } = req.params;
    const idx = Number(index);
    try {
      const entry = requireEntry(key, req, res);
      if (!entry) return;
      const booklets = entry.data.booklets || [];
      const booklet = booklets[idx];
      if (!booklet) throw new Error('Flipbook not found.');
      const newFiles = req.files?.morePages || [];
      const picked = pickedPages(req.body);
      if (!newFiles.length && !picked.length) throw new Error('Choose at least one page image.');

      const publicDir = booklet.pages.length ? siteDirOf(booklet.pages[0]) : `media/${key}/${slug}/flipbook-${Date.now()}`;
      const added = placePages(publicDir, newFiles, picked);
      booklets[idx] = { ...booklet, pages: [...booklet.pages, ...added] };
      updateEntry(key, slug, {}, { booklets });
      publish();
      setFlash(req, 'success', `Pages added. ${PUBLISHED}`);
    } catch (err) {
      console.error(err);
      setFlash(req, 'error', `Could not add pages: ${err.message}`);
    }
    res.redirect(303, `/admin/${key}/${slug}/edit#flipbooks`);
  });

  admin.post(`/${key}/:slug/booklets/:index/reorder-pages`, requireAuth, async (req, res) => {
    const { slug, index } = req.params;
    const idx = Number(index);
    const entry = getEntry(key, slug);
    const booklets = entry?.data.booklets || [];
    const booklet = booklets[idx];
    const incoming = req.body.pages;
    const validSet = Array.isArray(incoming) && new Set(incoming).size === incoming.length && incoming.every((p) => booklet?.pages.includes(p));

    if (!entry || !booklet || !validSet || incoming.length !== booklet.pages.length) {
      return res.status(400).json({ ok: false });
    }

    booklets[idx] = { ...booklet, pages: incoming };
    updateEntry(key, slug, {}, { booklets });
    publish();
    res.json({ ok: true });
  });

  admin.post(`/${key}/:slug/booklets/:index/delete-page`, requireAuth, async (req, res) => {
    const { slug, index } = req.params;
    const idx = Number(index);
    try {
      const entry = requireEntry(key, req, res);
      if (!entry) return;
      const booklets = entry.data.booklets || [];
      const booklet = booklets[idx];
      if (!booklet) throw new Error('Flipbook not found.');

      const page = req.body.page;
      deleteMediaFile(page);
      booklets[idx] = { ...booklet, pages: booklet.pages.filter((p) => p !== page) };
      updateEntry(key, slug, {}, { booklets });
      publish();
      setFlash(req, 'success', `Page removed. ${PUBLISHED}`);
    } catch (err) {
      console.error(err);
      setFlash(req, 'error', `Could not remove page: ${err.message}`);
    }
    res.redirect(303, `/admin/${key}/${slug}/edit#flipbooks`);
  });

  admin.post(`/${key}/:slug/booklets/:index/rename`, requireAuth, bookletRenameUpload, async (req, res) => {
    const { slug, index } = req.params;
    const idx = Number(index);
    try {
      const entry = requireEntry(key, req, res);
      if (!entry) return;
      const booklets = entry.data.booklets || [];
      const booklet = booklets[idx];
      if (!booklet) throw new Error('Flipbook not found.');

      const updated = withSize({ ...booklet, title: (req.body.title || booklet.title).trim() }, req.body.size);
      const pdfFile = req.files?.bookletPdf?.[0];
      if (pdfFile) {
        const publicDir = booklet.pages.length ? siteDirOf(booklet.pages[0]) : `media/${key}/${slug}/flipbook-${Date.now()}`;
        updated.pdf = placeUpload(pdfFile, { publicDir, baseName: `source-${Date.now().toString(36)}` });
      }
      booklets[idx] = updated;
      updateEntry(key, slug, {}, { booklets });
      if (pdfFile && booklet.pdf && booklet.pdf !== updated.pdf && !isUsedAnywhere(booklet.pdf)) deleteMediaFile(booklet.pdf);
      publish();
      setFlash(req, 'success', `Saved. ${PUBLISHED}`);
    } catch (err) {
      console.error(err);
      setFlash(req, 'error', `Could not save: ${err.message}`);
    }
    res.redirect(303, `/admin/${key}/${slug}/edit#flipbooks`);
  });

  admin.post(`/${key}/:slug/booklets/:index/delete`, requireAuth, async (req, res) => {
    const { slug, index } = req.params;
    const idx = Number(index);
    try {
      const entry = requireEntry(key, req, res);
      if (!entry) return;
      const booklets = entry.data.booklets || [];
      const booklet = booklets[idx];
      if (!booklet) throw new Error('Flipbook not found.');

      if (booklet.pages[0]) deleteMediaFileDir(booklet.pages[0]);
      booklets.splice(idx, 1);
      updateEntry(key, slug, {}, { booklets });
      publish();
      setFlash(req, 'success', `Flipbook deleted. ${PUBLISHED}`);
    } catch (err) {
      console.error(err);
      setFlash(req, 'error', `Could not delete: ${err.message}`);
    }
    res.redirect(303, `/admin/${key}/${slug}/edit#flipbooks`);
  });

  admin.post(`/${key}/:slug/trifolds`, requireAuth, trifoldUpload, async (req, res) => {
    const { slug } = req.params;
    try {
      const entry = requireEntry(key, req, res);
      if (!entry) return;
      const trifold = createTrifold(key, slug, req.files?.outside?.[0], req.files?.inside?.[0], req.body.title);
      const trifolds = [...(entry.data.trifolds || []), trifold];
      updateEntry(key, slug, {}, { trifolds });
      publish();
      setFlash(req, 'success', `Trifold added. ${PUBLISHED}`);
    } catch (err) {
      console.error(err);
      setFlash(req, 'error', `Could not add trifold: ${err.message}`);
    }
    res.redirect(303, `/admin/${key}/${slug}/edit#trifolds`);
  });

  admin.post(`/${key}/:slug/trifolds/:index`, requireAuth, trifoldUpload, async (req, res) => {
    const { slug, index } = req.params;
    const idx = Number(index);
    try {
      const entry = requireEntry(key, req, res);
      if (!entry) return;
      const trifolds = entry.data.trifolds || [];
      const trifold = trifolds[idx];
      if (!trifold) throw new Error('Trifold not found.');

      const publicDir = siteDirOf(trifold.outside);
      const updated = withSize({ ...trifold, title: (req.body.title || trifold.title).trim() }, req.body.size);
      const outsideFile = req.files?.outside?.[0];
      const insideFile = req.files?.inside?.[0];
      const stamp = Date.now().toString(36);
      if (outsideFile) updated.outside = placeUpload(outsideFile, { publicDir, baseName: `outside-${stamp}` });
      if (insideFile) updated.inside = placeUpload(insideFile, { publicDir, baseName: `inside-${stamp}` });

      trifolds[idx] = updated;
      updateEntry(key, slug, {}, { trifolds });
      // the replaced sides, now that the entry no longer points at them
      for (const side of ['outside', 'inside']) {
        if (updated[side] !== trifold[side] && !isUsedAnywhere(trifold[side])) deleteMediaFile(trifold[side]);
      }
      publish();
      setFlash(req, 'success', `Saved. ${PUBLISHED}`);
    } catch (err) {
      console.error(err);
      setFlash(req, 'error', `Could not save: ${err.message}`);
    }
    res.redirect(303, `/admin/${key}/${slug}/edit#trifolds`);
  });

  admin.post(`/${key}/:slug/trifolds/:index/delete`, requireAuth, async (req, res) => {
    const { slug, index } = req.params;
    const idx = Number(index);
    try {
      const entry = requireEntry(key, req, res);
      if (!entry) return;
      const trifolds = entry.data.trifolds || [];
      const trifold = trifolds[idx];
      if (!trifold) throw new Error('Trifold not found.');

      deleteMediaFileDir(trifold.outside);
      trifolds.splice(idx, 1);
      updateEntry(key, slug, {}, { trifolds });
      publish();
      setFlash(req, 'success', `Trifold deleted. ${PUBLISHED}`);
    } catch (err) {
      console.error(err);
      setFlash(req, 'error', `Could not delete: ${err.message}`);
    }
    res.redirect(303, `/admin/${key}/${slug}/edit#trifolds`);
  });
}

// Catches anything thrown above (most notably a multer/fileFilter upload
// rejection, which happens before any route handler's own try/catch runs)
// and shows a clean message instead of leaking a raw stack trace — which
// by default includes internal file paths and dependency internals — to
// the browser.
// eslint-disable-next-line no-unused-vars
admin.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status && err.status < 500 ? err.status : 400);
  if (isScriptUpload(req)) return res.json({ error: friendlyUploadError(err) });
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
// a file uploaded moments ago isn't in dist/ until the rebuild finishes —
// serve it straight from public/media meanwhile, so it never shows as broken
app.use('/media', express.static(join(process.env.SITE_REPO_PATH, 'public', 'media')));
// never let a browser or Cloudflare remember a "not found" — the file may
// exist a moment later (e.g. right after an upload)
app.use((req, res) => res.status(404).set('Cache-Control', 'no-store').type('text').send('Not found'));

// build once at startup so dist/ always matches the content on disk
requestBuild();

app.listen(PORT, () => {
  console.log(`Portfolio listening on http://localhost:${PORT} (public site at /, dashboard at /admin)`);
});
