import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// Update `site` (and `base` if this deploys to a GitHub *project* page,
// e.g. base: '/portfolio-alex') before running `astro build` for production.
export default defineConfig({
  site: 'https://yourname.github.io',
  vite: {
    plugins: [tailwindcss()],
  },
});
