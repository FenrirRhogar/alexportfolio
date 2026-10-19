// Plain-JS mirror of src/content.config.ts, used to drive the generic
// list/add/edit forms. Keep in sync by hand if the real schema changes —
// this app is plain Node and can't import the Astro/Zod config directly.
export const COLLECTIONS = {
  design: {
    key: 'design',
    label: 'Design & Branding',
    singular: 'Project',
    publicPath: '/design/',
    mediaDir: 'public/media/design',
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'client', label: 'Client', type: 'text' },
      { name: 'year', label: 'Year', type: 'text', placeholder: 'e.g. 2026' },
      { name: 'category', label: 'Category', type: 'text', required: true, placeholder: 'e.g. Brand Identity' },
      { name: 'summary', label: 'Summary', type: 'textarea', required: true },
      { name: 'tags', label: 'Tags', type: 'tags', placeholder: 'comma, separated, tags' },
      { name: 'featured', label: 'Feature on homepage', type: 'checkbox' },
    ],
    image: { name: 'cover', label: 'Cover image', kind: 'image' },
    gallery: { name: 'gallery', label: 'Gallery images', kind: 'image' },
    // flipbooks/trifolds have their own dedicated management UI (see
    // form.ejs + the /design/:slug/booklets|trifolds routes) rather than
    // the generic field list above — they're ordered image sequences, not
    // a single value a plain text/file input can represent.
    hasFlipbooks: true,
  },
  motion: {
    key: 'motion',
    label: 'Motion & Video',
    singular: 'Video',
    publicPath: '/motion/',
    mediaDir: 'public/media/motion',
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'role', label: 'Role', type: 'text', placeholder: 'e.g. Editor' },
      { name: 'year', label: 'Year', type: 'text', placeholder: 'e.g. 2026' },
      { name: 'summary', label: 'Summary', type: 'textarea', required: true },
      { name: 'vertical', label: 'Vertical video (9:16)', type: 'checkbox', default: true },
      { name: 'featured', label: 'Feature on homepage', type: 'checkbox' },
    ],
    poster: { name: 'poster', label: 'Poster image', kind: 'image' },
    video: { name: 'video', label: 'Video (mp4)', kind: 'video' },
    videoWebm: { name: 'videoWebm', label: 'Video (webm, optional)', kind: 'video', optional: true },
  },
  fineart: {
    key: 'fineart',
    label: 'Fine Art',
    singular: 'Artwork',
    publicPath: '/fine-art/',
    mediaDir: 'public/media/fineart',
    fields: [
      { name: 'title', label: 'Title', type: 'text', default: 'Untitled' },
      { name: 'medium', label: 'Medium', type: 'text', required: true, placeholder: 'e.g. Oil on canvas' },
      { name: 'dimensions', label: 'Dimensions', type: 'text' },
      { name: 'year', label: 'Year', type: 'text' },
      {
        name: 'status',
        label: 'Status',
        type: 'select',
        options: ['', 'Available', 'Sold', 'Private Collection', 'Not for Sale'],
      },
      { name: 'summary', label: 'Summary', type: 'textarea' },
      { name: 'featured', label: 'Feature on homepage', type: 'checkbox' },
    ],
    image: { name: 'image', label: 'Image', kind: 'image' },
    gallery: { name: 'gallery', label: 'Gallery images', kind: 'image' },
    // e.g. comic pages shown as a flip-through book
    hasFlipbooks: true,
  },
};

// The one global, singleton record (src/content/site/global.md) holding
// every bit of site-wide text that would otherwise be hardcoded in the
// page templates — grouped into sections for the dedicated /admin/site
// edit screen, rather than the generic per-collection list/add/edit forms.
export const SITE_SECTIONS = [
  {
    heading: 'Brand & contact',
    fields: [
      { name: 'brandName', label: 'Name shown as the site logo / copyright', type: 'text', required: true },
      { name: 'email', label: 'Contact email', type: 'text', required: true, placeholder: 'you@example.com' },
      { name: 'instagram', label: 'Instagram link', type: 'text', placeholder: 'https://instagram.com/yourname' },
      { name: 'linkedin', label: 'LinkedIn link', type: 'text', placeholder: 'https://linkedin.com/in/yourname' },
      {
        name: 'siteDescription',
        label: 'Site description',
        type: 'textarea',
        rows: 2,
        default: 'Design, motion, and fine art — a working studio.',
        hint: 'Shown by Google and in link previews when a page has no description of its own.',
      },
    ],
  },
  {
    heading: 'Look & feel',
    fields: [
      { name: 'colorAccent', label: 'Highlight color', type: 'color', default: '#c1633d', hint: 'Links, text selection, and other small highlights.' },
      { name: 'colorDesign', label: 'Design color', type: 'color', default: '#c1633d' },
      { name: 'colorMotion', label: 'Motion color', type: 'color', default: '#5c7285' },
      { name: 'colorFineArt', label: 'Fine Art color', type: 'color', default: '#d3a13b' },
      { name: 'colorPaper', label: 'Background color', type: 'color', default: '#f7f5f0' },
      { name: 'colorInk', label: 'Text color', type: 'color', default: '#201c18' },
      { name: 'autoplayVideos', label: 'Play videos automatically (muted, on a loop)', type: 'checkbox', default: true },
      { name: 'animateHero', label: 'Moving color glow behind the homepage headline', type: 'checkbox', default: true },
      { name: 'showMarquee', label: 'Scrolling text strip on the homepage', type: 'checkbox', default: true },
    ],
  },
  {
    heading: 'Menu',
    fields: [
      { name: 'navWork', label: 'Homepage link', type: 'text', default: 'Work' },
      { name: 'navDesign', label: 'Design link', type: 'text', default: 'Design & Branding' },
      { name: 'navMotion', label: 'Motion link', type: 'text', default: 'Motion & Video' },
      { name: 'navFineArt', label: 'Fine Art link', type: 'text', default: 'Fine Art' },
      { name: 'navAbout', label: 'About link', type: 'text', default: 'About' },
      { name: 'navContact', label: 'Contact link', type: 'text', default: 'Contact' },
    ],
  },
  {
    heading: 'Homepage — hero',
    fields: [
      { name: 'heroEyebrow', label: 'Small label above the headline', type: 'text', required: true },
      { name: 'heroHeading', label: 'Headline', type: 'textarea', rows: 2, required: true },
      { name: 'heroSubheading', label: 'Subheading', type: 'textarea', rows: 2, required: true },
    ],
  },
  {
    heading: 'Homepage — work',
    fields: [
      {
        name: 'marqueeText',
        label: 'Scrolling strip',
        type: 'text',
        default: 'Brand Identity · Editorial · Motion · Video Editing · Painting · Illustration',
        hint: 'Separate the words with · (a middle dot).',
      },
      { name: 'homeWorkHeading', label: 'Heading above the projects', type: 'text', default: 'Selected Work' },
      { name: 'homeWorkLink', label: '"See all" link text', type: 'text', default: 'View everything' },
      {
        name: 'homeFeaturedCount',
        label: 'How many featured projects to show',
        type: 'number',
        default: 6,
        min: 1,
        max: 30,
        hint: 'Tick "Feature on homepage" on a project to include it.',
      },
    ],
  },
  {
    heading: 'Design page',
    fields: [
      { name: 'designEyebrow', label: 'Small label', type: 'text', default: 'Design & Branding' },
      { name: 'designHeading', label: 'Headline', type: 'textarea', rows: 2, default: 'Identity systems built to survive contact with reality.' },
      { name: 'designDescription', label: 'Description for Google / link previews', type: 'text', default: 'Brand identity, packaging, and editorial design case studies.' },
    ],
  },
  {
    heading: 'Motion page',
    fields: [
      { name: 'motionEyebrow', label: 'Small label', type: 'text', default: 'Motion & Video' },
      { name: 'motionHeading', label: 'Headline', type: 'textarea', rows: 2, default: 'Cut for rhythm, not just coverage.' },
      { name: 'motionDescription', label: 'Description for Google / link previews', type: 'text', default: 'Short-form edits, teasers, and social cuts.' },
    ],
  },
  {
    heading: 'Fine Art page',
    fields: [
      { name: 'fineartEyebrow', label: 'Small label', type: 'text', default: 'Fine Art' },
      { name: 'fineartHeading', label: 'Headline', type: 'textarea', rows: 2, default: 'Paintings, mostly made before sunrise.' },
      { name: 'fineartDescription', label: 'Description for Google / link previews', type: 'text', default: 'Paintings and studies.' },
    ],
  },
  {
    heading: 'About page',
    fields: [
      { name: 'aboutEyebrow', label: 'Small label above the headline', type: 'text', required: true },
      { name: 'aboutHeading', label: 'Headline', type: 'text', required: true },
      {
        name: 'aboutBio',
        label: 'Bio',
        type: 'textarea',
        rows: 8,
        required: true,
        hint: 'Leave a blank line between paragraphs.',
      },
      {
        name: 'aboutAvailability',
        label: 'Availability line',
        type: 'text',
        hint: 'Shown as a sentence right before a link to the Contact page.',
      },
      { name: 'skills', label: 'Tools & skills', type: 'tags', placeholder: 'comma, separated, list' },
    ],
  },
  {
    heading: 'Contact page',
    fields: [
      { name: 'contactEyebrow', label: 'Small label above the email', type: 'text', required: true },
      { name: 'contactBlurb', label: 'Blurb under the email', type: 'textarea', rows: 2 },
    ],
  },
  {
    heading: 'Footer',
    fields: [{ name: 'footerTagline', label: 'Tagline', type: 'text', required: true }],
  },
];

export function getCollection(key) {
  const c = COLLECTIONS[key];
  if (!c) throw new Error(`Unknown collection "${key}"`);
  return c;
}
