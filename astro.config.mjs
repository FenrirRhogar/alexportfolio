import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// `base` only applies to `astro build`/`astro preview` (matching the GitHub
// Pages project-page URL) — `astro dev` stays at the plain root for local work.
// (Note: this must stay a plain object, not a `defineConfig(() => ({...}))`
// function — that form silently breaks the Tailwind Vite plugin wiring.)
const isDev = process.argv.includes('dev');

// SITE_URL / SITE_BASE override the GitHub Pages defaults — the self-hosted
// build on the home server (admin-server/lib/build.mjs) serves from "/".
export default defineConfig({
  site: process.env.SITE_URL || 'https://fenrirrhogar.github.io',
  base: isDev ? '/' : process.env.SITE_BASE || '/alexportfolio',
  vite: {
    plugins: [tailwindcss()],
  },
});
