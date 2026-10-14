import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLLECTIONS, getCollection } from './lib/schema.mjs';
import { listEntries, getEntry, createEntry, updateEntry, deleteEntry, reorderEntries } from './lib/content.mjs';
import { upload, placeUpload, deleteMediaFile, deleteEntryMedia } from './lib/upload.mjs';
import { commitAndPush } from './lib/git.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!PASSWORD_HASH || !SESSION_SECRET) {
  console.error('ADMIN_PASSWORD_HASH and SESSION_SECRET must be set — see .env.example');
  process.exit(1);
}

const app = express();
app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));
app.set('trust proxy', 1); // sitting behind a reverse proxy on the home server

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE === 'true',
      maxAge: 1000 * 60 * 60 * 12, // 12 hours
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
  return res.redirect(303, '/login');
}

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true });

// ---------- auth ----------

app.get('/login', (req, res) => {
  if (req.session.authed) return res.redirect(303, '/');
  res.render('login', { flash: flash(req) });
});

app.post('/login', loginLimiter, async (req, res) => {
  const ok = req.body.password && (await bcrypt.compare(req.body.password, PASSWORD_HASH));
  if (!ok) {
    setFlash(req, 'error', 'Wrong password.');
    return res.redirect(303, '/login');
  }
  req.session.authed = true;
  res.redirect(303, '/');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect(303, '/login'));
});

// ---------- dashboard ----------

app.get('/', requireAuth, (req, res) => {
  const collections = Object.values(COLLECTIONS).map((c) => ({
    key: c.key,
    label: c.label,
    singular: c.singular,
    count: listEntries(c.key).length,
  }));
  res.render('dashboard', { collections, flash: flash(req) });
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

  app.get(`/${key}`, requireAuth, (req, res) => {
    res.render('list', { schema, entries: listEntries(key), flash: flash(req) });
  });

  app.post(`/${key}/reorder`, requireAuth, async (req, res) => {
    reorderEntries(key, req.body.slugs || []);
    await commitAndPush(`Admin: reorder ${key}`);
    res.json({ ok: true });
  });

  app.get(`/${key}/new`, requireAuth, (req, res) => {
    res.render('form', { schema, entry: null, flash: flash(req) });
  });

  app.post(`/${key}/new`, requireAuth, uploadMw, async (req, res) => {
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
      res.redirect(303, `/${key}`);
    } catch (err) {
      console.error(err);
      setFlash(req, 'error', `Could not save: ${err.message}`);
      res.redirect(303, `/${key}/new`);
    }
  });

  app.get(`/${key}/:slug/edit`, requireAuth, (req, res) => {
    const entry = getEntry(key, req.params.slug);
    if (!entry) return res.status(404).send('Not found');
    res.render('form', { schema, entry, flash: flash(req) });
  });

  app.post(`/${key}/:slug/edit`, requireAuth, uploadMw, async (req, res) => {
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
      res.redirect(303, `/${key}`);
    } catch (err) {
      console.error(err);
      setFlash(req, 'error', `Could not save: ${err.message}`);
      res.redirect(303, `/${key}/${slug}/edit`);
    }
  });

  app.post(`/${key}/:slug/delete`, requireAuth, async (req, res) => {
    const { slug } = req.params;
    deleteEntry(key, slug);
    deleteEntryMedia(key, slug);
    const result = await commitAndPush(`Admin: delete ${key}/${slug}`);
    setFlash(req, result.pushed ? 'success' : 'error', `Deleted. ${result.message}`);
    res.redirect(303, `/${key}`);
  });
}

app.listen(PORT, () => {
  console.log(`Portfolio admin listening on http://localhost:${PORT}`);
});
