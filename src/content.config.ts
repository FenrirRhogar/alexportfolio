import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// flip-through books and folded print pieces — used by both Design and Fine
// Art (e.g. a comic shown as a book)
const booklets = z
  .array(
    z.object({
      title: z.string(),
      pdf: z.string().optional(),
      width: z.number(),
      height: z.number(),
      pages: z.array(z.string()),
      size: z.string().optional(),
    }),
  )
  .default([]);

// a trifold is one sheet printed on both sides and folded into three —
// not a sequence of pages, so it gets its own "two flat sides" display
// rather than the page-flip treatment `booklets` gives real booklets
const trifolds = z
  .array(
    z.object({
      title: z.string(),
      outside: z.string(),
      inside: z.string(),
      size: z.string().optional(),
    }),
  )
  .default([]);

const design = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/design' }),
  schema: z.object({
    title: z.string(),
    client: z.string().optional(),
    year: z.string().optional(),
    category: z.string(),
    summary: z.string(),
    cover: z.string(),
    gallery: z.array(z.string()).default([]),
    booklets,
    trifolds,
    // display sizes, see src/lib/sizes.ts
    imageSize: z.string().optional(),
    gallerySize: z.string().optional(),
    galleryColumns: z.string().optional(),
    tags: z.array(z.string()).default([]),
    featured: z.boolean().default(false),
    order: z.number().default(0),
  }),
});

const motion = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/motion' }),
  schema: z.object({
    title: z.string(),
    role: z.string().optional(),
    year: z.string().optional(),
    summary: z.string(),
    poster: z.string(),
    video: z.string(),
    videoWebm: z.string().optional(),
    vertical: z.boolean().default(true),
    featured: z.boolean().default(false),
    order: z.number().default(0),
  }),
});

const fineart = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/fineart' }),
  schema: z.object({
    title: z.string(),
    medium: z.string(),
    dimensions: z.string().optional(),
    year: z.string().optional(),
    status: z.string().optional(),
    summary: z.string().optional(),
    image: z.string(),
    gallery: z.array(z.string()).default([]),
    booklets,
    trifolds,
    // display sizes, see src/lib/sizes.ts
    imageSize: z.string().optional(),
    gallerySize: z.string().optional(),
    galleryColumns: z.string().optional(),
    featured: z.boolean().default(false),
    order: z.number().default(0),
  }),
});

// a singleton — one entry ("global"), holding every bit of site-wide text
// (hero, about bio, contact blurb, social links, ...) that would otherwise
// be hardcoded in the page templates, so it's editable from the admin
// dashboard instead of requiring a code change.
const site = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/site' }),
  schema: z.object({
    brandName: z.string(),
    email: z.string(),
    instagram: z.string().optional(),
    linkedin: z.string().optional(),

    heroEyebrow: z.string(),
    heroHeading: z.string(),
    heroSubheading: z.string(),

    aboutEyebrow: z.string(),
    aboutHeading: z.string(),
    aboutPhoto: z.string().optional(),
    aboutBio: z.string(),
    aboutAvailability: z.string().optional(),
    skills: z.array(z.string()).default([]),

    contactEyebrow: z.string(),
    contactBlurb: z.string().optional(),

    footerTagline: z.string(),

    // everything below has a default, so an older global.md without these
    // keys still builds — the admin dashboard fills them in on first save
    siteDescription: z.string().default('Design, motion, and fine art — a working studio.'),

    navWork: z.string().default('Work'),
    navDesign: z.string().default('Design & Branding'),
    navMotion: z.string().default('Motion & Video'),
    navFineArt: z.string().default('Fine Art'),
    navAbout: z.string().default('About'),
    navContact: z.string().default('Contact'),

    marqueeText: z.string().default('Brand Identity · Editorial · Motion · Video Editing · Painting · Illustration'),
    homeWorkHeading: z.string().default('Selected Work'),
    homeWorkLink: z.string().default('View everything'),
    homeFeaturedCount: z.coerce.number().int().min(1).default(6),

    designEyebrow: z.string().default('Design & Branding'),
    designHeading: z.string().default('Identity systems built to survive contact with reality.'),
    designDescription: z.string().default('Brand identity, packaging, and editorial design case studies.'),
    motionEyebrow: z.string().default('Motion & Video'),
    motionHeading: z.string().default('Cut for rhythm, not just coverage.'),
    motionDescription: z.string().default('Short-form edits, teasers, and social cuts.'),
    fineartEyebrow: z.string().default('Fine Art'),
    fineartHeading: z.string().default('Paintings, mostly made before sunrise.'),
    fineartDescription: z.string().default('Paintings and studies.'),

    colorPaper: hexColor('#f7f5f0'),
    colorInk: hexColor('#201c18'),
    colorAccent: hexColor('#c1633d'),
    colorDesign: hexColor('#c1633d'),
    colorMotion: hexColor('#5c7285'),
    colorFineArt: hexColor('#d3a13b'),

    autoplayVideos: z.boolean().default(true),
    showMarquee: z.boolean().default(true),
    animateHero: z.boolean().default(true),
  }),
});

// colors are injected into a <style> attribute, so only a strict #rrggbb
// is accepted — anything else falls back to the default rather than
// letting arbitrary text into the page's CSS
function hexColor(fallback: string) {
  return z
    .string()
    .optional()
    .transform((v) => (v && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback));
}

export const collections = { design, motion, fineart, site };
