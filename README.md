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

1. Visit `/admin` on the deployed site (or locally, see below).
2. Decap CMS reads/writes the same Markdown files in `src/content/`, and uploads
   media straight into the right `public/media/<category>/` folder.

### Local CMS editing

GitHub Pages can't host the OAuth handshake Decap's `github` backend needs, so for
local editing use the bundled proxy instead:

```bash
npm run cms:proxy   # starts decap-server on :8081
npm run dev          # in a second terminal
# open http://localhost:4321/admin/
```

`local_backend: true` in `public/admin/config.yml` is what enables this.

### Production CMS editing (GitHub Pages)

`backend: github` in `public/admin/config.yml` needs an OAuth provider — GitHub
Pages only serves static files, so this can't live on the same host as the site.
The standard zero-cost fix:

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
