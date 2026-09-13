import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// `base` only applies to `astro build`/`astro preview` (matching the GitHub
// Pages project-page URL) — `astro dev` stays at the plain root so local
// URLs like http://localhost:4321/admin/ keep working without the prefix.
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
