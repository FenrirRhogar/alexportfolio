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

Content lives as Markdown files with frontmatter in:

- `src/content/design/*.md`
- `src/content/motion/*.md`
- `src/content/fineart/*.md`

The schema for each is defined in `src/content.config.ts`. Images/video referenced
in frontmatter live in `public/media/<category>/`.

To add a project: copy an existing `.md` file in the relevant folder, edit its
frontmatter and body, and drop any new media into `public/media/<category>/`.
To remove one: delete its `.md` file (and its media, if unused elsewhere). Then
commit and push — the deploy workflow picks it up automatically.

Every image and video currently in the repo is **placeholder artwork** generated
for this template (organic SVG textures + an abstract muted gradient loop) — swap
them out for real photography, footage, and paintings before shipping.

## Deploying

`.github/workflows/deploy.yml` builds and deploys `dist/` to GitHub Pages on every
push to `main`. In the repo settings, set **Pages → Source** to "GitHub Actions".

Before your first deploy:

- Update `site` (and `base`, if this is a project page, not a user/org page) in
  `astro.config.mjs`.
- Update the `mailto:` addresses and social links in `src/components/Footer.astro`
  and `src/pages/contact.astro`.
- Replace the placeholder photo, showreel, and project media in `public/media/`.
