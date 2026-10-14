// Plain-JS mirror of src/content.config.ts, used to drive the generic
// list/add/edit forms. Keep in sync by hand if the real schema changes —
// this app is plain Node and can't import the Astro/Zod config directly.
export const COLLECTIONS = {
  design: {
    key: 'design',
    label: 'Design & Branding',
    singular: 'Project',
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
  },
};

export function getCollection(key) {
  const c = COLLECTIONS[key];
  if (!c) throw new Error(`Unknown collection "${key}"`);
  return c;
}
