# Portfolio admin

A small private dashboard so Alexandra can add, edit, remove, and reorder
portfolio entries herself — no code, no terminal, no git. It runs as a single
container on your home server: it serves the public site at `/` and the
dashboard at `/admin`, and every save rebuilds the site in a few seconds.

Every field is editable here, including the flipbook/trifold pieces (the
Mobiak/Sense/SFHMMY-style flip-through booklets and folded print pieces) —
add a new one, add/remove/reorder its page images by dragging them, swap
out a trifold's outside/inside image, or delete the whole thing. The only
thing this *can't* do is turn a raw PDF into page images for you — Alexandra
uploads the page images themselves (already exported as JPGs/PNGs from
whatever she designed them in), and can optionally attach the source PDF
too, just as a downloadable link alongside the pages.

## How it works

- The container mounts the site folder (this repo) at `/site`. The
  dashboard reads and writes `src/content/**/*.md` and `public/media/**`
  there directly.
- After every save (and once at startup) it runs `astro build` into
  `.dist-next/` and swaps that in as `dist/` only once the build succeeds,
  so a failed build leaves the last good site live. The **Republish**
  button in the dashboard header shows a failed build and retries it.
- The same Express app serves `dist/` at `/` and the dashboard at `/admin`.
- No git, no GitHub, no deploy pipeline: back up the site folder like any
  other container's data.

## Setup

```sh
cd admin-server
cp .env.example .env
```

Edit `.env`:

- `SITE_REPO_HOST_PATH` — absolute path to this repo on the host.
- `SITE_URL` / `SITE_BASE` — the public URL and base path the site is
  built for (`/` when it has its own domain).
- `ADMIN_PASSWORD_HASH` — generate with:
  ```sh
  node -e "import('bcryptjs').then(b=>b.hash(process.argv[1],10)).then(console.log)" "choose-a-real-password"
  ```
- `SESSION_SECRET` — generate with `openssl rand -hex 32`.
- `COOKIE_SECURE` — `true` once it's served over HTTPS; leave `false` for
  a first local test over plain HTTP, otherwise the login cookie won't be
  sent and you'll be bounced back to `/login` in a loop.

Then:

```sh
docker compose up -d --build
docker compose logs -f
```

The container joins the `nginx_pm_default` network and listens on port
3000 — point your reverse proxy at `alexportfolio:3000` and terminate HTTPS
there. The dashboard login (below) is designed to stand on its own; put `/admin`
behind the proxy's own auth or an IP allowlist too if you want a second
layer.

## Security

A rundown of what's actually protecting this, for your own peace of mind:

- **Login**: a single bcrypt-hashed password — pick a long random one, it's
  the only thing standing between the internet and write access to the
  whole site. Wrong passwords are limited to 5 per 15 minutes per visitor
  and 50 an hour in total, so guessing from many addresses at once is
  capped too. Behind Cloudflare the real visitor address comes from
  `CF-Connecting-IP`, trusted only on requests that actually arrive from
  Cloudflare's ranges (`lib/auth.mjs`). Each login gets a fresh session id.
- **Cloudflare Access** (optional, set `CF_ACCESS_TEAM_DOMAIN` and
  `CF_ACCESS_AUD`): an email one-time code in front of `/admin`, managed in
  Cloudflare Zero Trust. The app also verifies Access's signed token on
  every `/admin` request, so going around Cloudflare to the server's IP
  address directly gets a 403.
- **Sessions**: the cookie is `HttpOnly` (invisible to any JavaScript,
  including an attacker's), `SameSite=Strict` (never sent on a request
  originating from another site — the standard, modern defense against
  CSRF), scoped to the `/admin` path only, and named something other than
  Express's default so it doesn't advertise what's running. Only set
  `secure` (`COOKIE_SECURE=true`) once you're actually on HTTPS, or the
  cookie won't be sent at all and you'll get stuck in a login loop.
- **Uploads**: only JPG/PNG/WEBP/GIF/AVIF images, MP4/WEBM video, and (for
  a flipbook's optional source file) PDF are accepted — checked by the
  file's actual declared type, not its name. SVG is deliberately excluded
  even though it's "an image": it can contain a `<script>` that runs if
  the file is ever opened directly. Whatever extension lands on disk is
  derived from that verified type too, never from the filename you upload
  — so there's no way to upload something named `photo.jpg` that's
  secretly HTML and get it served back as HTML.
- **Headers**: a strict Content-Security-Policy (no inline scripts
  anywhere in the dashboard, nothing loads from a third party except
  Google Fonts), clickjacking protection (this dashboard refuses to be
  iframed), and `X-Content-Type-Options: nosniff` so browsers never guess
  a file's type from its content. Scoped to `/admin` only.
- **Errors**: never shown as a raw stack trace (which would leak internal
  file paths) — logged to the server's own console for you to debug, with
  a plain, safe message on screen.

What this deliberately doesn't do: a full CSRF-token system on top of
`SameSite=Strict` (redundant for a single-admin tool on modern browsers,
and would mean threading a token through every upload route), or
magic-byte content sniffing on top of the declared-type check (the
type-locked extension plus `nosniff` already closes the realistic attack
this would catch). If you ever expose this past your home network, put it
behind your reverse proxy's own auth/IP allowlist too, same as any other
internal tool.

## Day-to-day use

Give Alexandra the URL and the password. From the dashboard she can:

- **Projects** (Design, Motion, Fine Art): add, edit, delete, drag to
  reorder, and star/unstar which ones appear on the homepage straight from
  the list. Each project has "View on site" and "Edit raw file" for
  anything the form doesn't cover.
- **Site content**: every piece of text around the projects — the menu,
  the homepage, each section page's headline, About, Contact, footer — plus
  the site's colors and switches for autoplaying videos, the homepage color
  glow, and the scrolling text strip.
- **Media library**: every image, video, and PDF, with where each is used;
  upload into any folder, copy a file's path, and delete files nothing uses
  any more.
- **Backup**: one download with every content and media file.

Every change goes live within a few seconds. If a change ever breaks the
build, the site keeps showing the previous version and the dashboard shows
the error.
