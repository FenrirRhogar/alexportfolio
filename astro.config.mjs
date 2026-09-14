import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// `base` only applies to `astro build`/`astro preview` (matching the GitHub
// Pages project-page URL) — `astro dev` stays at the plain root for local work.
// (Note: this must stay a plain object, not a `defineConfig(() => ({...}))`
// function — that form silently breaks the Tailwind Vite plugin wiring.)
const isDev = process.argv.includes('dev');

export default defineConfig({
  site: 'https://fenrirrhogar.github.io',
  base: isDev ? '/' : '/alexportfolio',
  vite: {
    plugins: [tailwindcss()],
  },
});
