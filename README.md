# Portfolio — Design, Motion & Fine Art

A bespoke static portfolio built with **Astro**, **Tailwind CSS v4**, and **Decap CMS**.

## Stack

- **Astro** — static site generation, content collections for Design / Motion / Fine Art
- **Tailwind CSS v4** — CSS-first theme (`src/styles/global.css`), warm editorial palette
- **Decap CMS** — Git-backed CMS at `/admin`, no database or server required

## Getting started

```bash
npm install
npm run dev       # http://localhost:4321
```

## Editing content without the CMS

Content lives as Markdown files with frontmatter in:

- `src/content/design/*.md`
- `src/content/motion/*.md`
- `src/content/fineart/*.md`

The schema for each is defined in `src/content.config.ts`. Images/video referenced
in frontmatter live in `public/media/<category>/`.

Every image and video currently in the repo is **placeholder artwork** generated
for this template (organic SVG textures + an abstract muted gradient loop) — swap
them out for real photography, footage, and paintings before shipping.

## Editing content with Decap CMS

**This is the supported path right now — always edit locally, then push.**
Do not try to log in at `/admin` on the deployed GitHub Pages site; that button
is wired to `backend: github`, which needs an OAuth relay server that **is not
set up** (see "Editing from the live site" below for why, and what it'd take).

```bash
npm run cms:proxy   # terminal 1 — starts decap-server on :8081
npm run dev          # terminal 2
# open http://localhost:4321/admin/
```

`local_backend: true` in `public/admin/config.yml` is what enables this — it
routes the CMS through the local proxy instead of GitHub, so there's no OAuth
step at all. Publishing in the CMS writes straight to the Markdown files in
`src/content/` and drops uploads into `public/media/<category>/`. Once you're
happy with the change, commit and push it like any other edit.

### Editing from the live site (optional, more setup)

If you want to add/edit projects from a browser without your laptop, the
`github` backend needs an OAuth relay — GitHub Pages only serves static files,
so that relay has to live somewhere else. The standard zero-cost fix:

1. Deploy a tiny OAuth-only site (a free Netlify site works well, or a small
   Cloudflare Worker) following the [Decap CMS GitHub backend guide](https://decapcms.org/docs/github-backend/).
2. Register a GitHub OAuth App pointing at that provider.
3. Update `config.yml`:
   - `repo`: `your-username/your-repo-name`
   - `base_url`: the OAuth provider's URL

Your main site keeps living on GitHub Pages the whole time — the OAuth provider
only ever handles the login redirect.

## Deploying

`.github/workflows/deploy.yml` builds and deploys `dist/` to GitHub Pages on every
push to `main`. In the repo settings, set **Pages → Source** to "GitHub Actions".

Before your first deploy:

- Update `site` (and `base`, if this is a project page, not a user/org page) in
  `astro.config.mjs`.
- Update the `mailto:` addresses and social links in `src/components/Footer.astro`,
  `src/pages/contact.astro`, and the CMS `repo`/`base_url` in
  `public/admin/config.yml`.
- Replace the placeholder photo, showreel, and project media in `public/media/`.
