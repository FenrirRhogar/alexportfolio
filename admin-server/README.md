# Portfolio admin

A small private dashboard so Alexandra can add, edit, remove, and reorder
portfolio entries herself — no code, no terminal, no git. It runs on your
home server, edits the same files as the main site, and commits + pushes
automatically. GitHub Pages picks up the push and rebuilds the public site
exactly like it always has.

Every field is editable here, including the flipbook/trifold pieces (the
Mobiak/Sense/SFHMMY-style flip-through booklets and folded print pieces) —
add a new one, add/remove/reorder its page images by dragging them, swap
out a trifold's outside/inside image, or delete the whole thing. The only
thing this *can't* do is turn a raw PDF into page images for you — Alexandra
uploads the page images themselves (already exported as JPGs/PNGs from
whatever she designed them in), and can optionally attach the source PDF
too, just as a downloadable link alongside the pages.

## How it works

- A second, separate git checkout of `alexportfolio` lives on the home
  server. This app reads and writes `src/content/**/*.md` and
  `public/media/**` directly inside that checkout.
- Every save runs `git add -A && git commit && git push` against that
  checkout. The push triggers the existing GitHub Actions workflow, which
  rebuilds and redeploys the public site to GitHub Pages — same as if you'd
  pushed from your laptop.
- If the server loses internet access, saves still commit locally; the push
  just fails and the next save (once connectivity's back) picks it up. The
  dashboard tells you when a push failed so nothing is silently lost.

## One-time setup

### 1. Clone the repo on the server

```sh
git clone git@github.com:FenrirRhogar/alexportfolio.git /srv/alexportfolio
cd /srv/alexportfolio
git config user.name "Alexandra Patsi"
git config user.email "johnfen26@proton.me"
```

(That `git config` is run once, directly in this checkout — it's stored in
`.git/config`, so it applies whether you later run the admin app in Docker
or plain Node, and whether or not that `.git` directory is bind-mounted
into a container.)

### 2. Give this checkout push access

Create a dedicated **deploy key** rather than reusing your personal SSH
key — it's scoped to just this one repo, so if the home server is ever
compromised the blast radius is limited to this one checkout.

```sh
ssh-keygen -t ed25519 -f ./admin-server/deploy_key -N "" -C "alexportfolio-admin"
```

Add the **public** half (`deploy_key.pub`) on GitHub: repo → Settings →
Deploy keys → Add deploy key → check **Allow write access**. Keep the
private half (`deploy_key`, no extension) off git — it's already covered by
the repo's `.gitignore` (`.env` / keys aren't tracked), but double check
before committing anything.

### 3. Generate the known_hosts entry

The container needs GitHub's host key on file or `git push` will hang
waiting for a prompt that never comes:

```sh
ssh-keyscan github.com > admin-server/known_hosts
```

### 4. Configure the app

```sh
cd admin-server
cp .env.example .env
```

Edit `.env`:

- `SITE_REPO_PATH` — leave as `/site` if you're using Docker (see below);
  set to the real absolute path (e.g. `/srv/alexportfolio`) if running
  plain Node instead.
- `ADMIN_PASSWORD_HASH` — generate with:
  ```sh
  node -e "import('bcryptjs').then(b=>b.hash(process.argv[1],10)).then(console.log)" "choose-a-real-password"
  ```
- `SESSION_SECRET` — generate with `openssl rand -hex 32`.
- `COOKIE_SECURE` — set to `true` once this is reachable over HTTPS (see
  reverse proxy section below); leave `false` for a first local test over
  plain HTTP, otherwise the login cookie won't be sent and you'll be
  bounced back to `/login` in a loop.

Also create a `.env` entries the compose file reads for the volume mounts
(these are plain host paths, not app config, so they're separate from the
app's own `.env` — add them to the same file, `docker-compose` reads from
it too):

```sh
echo "SITE_REPO_HOST_PATH=/srv/alexportfolio" >> .env
echo "SSH_KEY_HOST_PATH=$(pwd)/deploy_key" >> .env
```

## Running it

### Docker (recommended)

```sh
docker compose up -d --build
```

This builds the image, mounts the real checkout at `/site` inside the
container, mounts the deploy key and `known_hosts` read-only, and exposes
the app on port 3000.

Check it came up clean:

```sh
docker compose logs -f
```

### Plain Node (alternative)

```sh
npm ci --omit=dev
node server.mjs
```

Only use this if you're not running Docker on the server at all — you'll
need `git` and `openssh-client`-equivalent tooling installed natively, and
`SITE_REPO_PATH` in `.env` pointing at the real checkout path.

## Self-hosting the public site

The app always rebuilds the site into `dist/` in the checkout after every
save (and once at startup), and every 60 seconds it pulls whatever was
pushed to GitHub from elsewhere — e.g. edits pushed from a laptop — and
rebuilds when anything new arrives. GitHub stays the shared history; this
server is where the site actually lives.

To serve that build instead of GitHub Pages, set in `.env`:

```sh
PUBLIC_SITE_ORIGIN=http://site   # any static server whose root is <checkout>/dist
SITE_URL=https://alex.example.com
SITE_BASE=/
```

and run a static server (e.g. `nginx:alpine`) with the checkout mounted
read-only and its root at `dist/`. Builds land in `.dist-next/` and are
swapped in only once they succeed, so a failed build leaves the last good
site live; the dashboard's **Republish** button shows failures and retries.
The Pages workflow is manual-only (`workflow_dispatch`) while self-hosting.

## Putting it behind your reverse proxy

Point your existing reverse proxy at `http://<server>:3000` and terminate
HTTPS there, same as your other home-server services. Once it's served
over HTTPS, set `COOKIE_SECURE=true` in `.env` and restart
(`docker compose up -d` again — compose picks up the `.env` change).

This app is meant to live on your internal network / behind your proxy's
existing auth or network restrictions, not sit directly on the open
internet — the password login and rate limiting are there as a second
layer, not the only one.

## Security

A rundown of what's actually protecting this, for your own peace of mind:

- **Login**: a single bcrypt-hashed password, rate-limited to 10 attempts
  per 15 minutes per IP. Pick a real, unique password when you generate
  the hash above — it's the only thing standing between the internet and
  write access to the whole site if this ever ends up reachable from
  outside your network.
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
  a file's type from its content. Scoped to `/admin` only — the public
  site's own responses pass through this server untouched.
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

Give Alexandra the URL (whatever your reverse proxy maps to this) and the
password. From the dashboard she can:

- See all Design, Motion, and Fine Art entries with thumbnails.
- Add a new entry, filling in a plain form and uploading images/video.
- Edit any entry — change text, swap or add images, add/remove gallery
  photos.
- Drag to reorder entries within a category (drag handle on the left of
  each row) — this is what controls display order on the live site.
- Delete an entry, which also cleans up its media files.

Every one of those actions commits and pushes immediately; the live site
rebuilds within a minute or two via the existing GitHub Actions workflow.
