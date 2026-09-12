import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://fenrirrhogar.github.io',
  base: '/alexportfolio',
  vite: {
    plugins: [tailwindcss()],
  },
});
