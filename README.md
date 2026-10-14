# Portfolio — Design, Motion & Fine Art

A bespoke static portfolio built with **Astro** and **Tailwind CSS v4**.

## Stack

- **Astro** — static site generation, content collections for Design / Motion / Fine Art
- **Tailwind CSS v4** — CSS-first theme (`src/styles/global.css`), warm editorial palette

## Getting started

```bash
npm install
npm run dev       # http://localhost:4321
```

## Editing content

```bash
npm run new:design    # scaffold a new project / motion edit / painting
npm run new:motion
npm run new:fineart
```

Each walks through a few prompts and creates the content file plus its
media folder in the right place. See **[CONTENT.md](./CONTENT.md)** for
the full field reference (galleries, booklets, trifolds) and how to edit
or remove an existing entry. Commit and push when done — the deploy
workflow picks it up automatically.

## Deploying

`.github/workflows/deploy.yml` builds and deploys `dist/` to GitHub Pages on every
push to `main`. In the repo settings, set **Pages → Source** to "GitHub Actions".

Before your first deploy:

- Update `site` (and `base`, if this is a project page, not a user/org page) in
  `astro.config.mjs`.
- Update the `mailto:` addresses and social links in `src/components/Footer.astro`
  and `src/pages/contact.astro`.
- Replace the placeholder photo, showreel, and project media in `public/media/`.
