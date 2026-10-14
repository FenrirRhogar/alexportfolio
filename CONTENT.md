# Editing content

Two ways to add or change a project: the scaffold script (for new entries)
or editing the Markdown files directly (for everything else). Either way,
finish by committing and pushing — the site rebuilds automatically.

## Adding a new project

```bash
npm run new:design    # a client/branding project
npm run new:motion    # a video edit
npm run new:fineart   # a painting/drawing
```

Each asks a few questions, then creates:

- `src/content/<collection>/<slug>.md` — pre-filled frontmatter
- `public/media/<collection>/<slug>/` (or the matching filename pattern) —
  drop your image/video in here with the exact filename it tells you

Open the new `.md` file afterward for anything left as a `#`-commented
line (gallery images, mostly) — uncomment and fill in, or leave as-is.

## Editing an existing project

Just open its file in `src/content/<collection>/` and edit the frontmatter
or the body text below the `---` fence. No script needed.

## Removing a project

Delete its `.md` file (and its `public/media/...` folder, if you want).

## Field reference

Every field below `summary`/`cover`/etc. that's missing from a file just
uses its default — nothing is required beyond what's listed as required.

### Design (`src/content/design/*.md`)

| Field | Required | Notes |
|---|---|---|
| `title` | ✓ | |
| `client` | | |
| `year` | | |
| `category` | ✓ | e.g. "Brand Identity", "Poster Design" |
| `summary` | ✓ | one or two sentences, used on the index card too |
| `cover` | ✓ | path under `/media/design/...` |
| `gallery` | | list of extra image paths |
| `tags` | | list of short strings |
| `featured` | | `true` to show on the homepage |
| `order` | | lower sorts first |

**Extra images beyond the cover** go in `gallery`:

```yaml
gallery:
  - "/media/design/my-project/gallery-1.jpg"
  - "/media/design/my-project/gallery-2.jpg"
```

**A real multi-page booklet or brochure** (something meant to be flipped
through page by page) goes in `booklets` — each image becomes one page of
an interactive page-turn viewer. `width`/`height` should match one page's
actual pixel aspect ratio (check with any image viewer):

```yaml
booklets:
  - title: "Brochure Name"
    pdf: "/media/design/my-project/brochure.pdf"   # optional, just kept for reference
    width: 1000
    height: 1400
    pages:
      - "/media/design/my-project/booklet/page-01.jpg"
      - "/media/design/my-project/booklet/page-02.jpg"
```

**A trifold** (one sheet, printed both sides, folded in three — not a
sequence of pages) goes in `trifolds` instead, which shows both flat
printed sides plainly rather than faking a page-flip:

```yaml
trifolds:
  - title: "Trifold Name"
    outside: "/media/design/my-project/trifold/outside.jpg"
    inside: "/media/design/my-project/trifold/inside.jpg"
```

### Motion (`src/content/motion/*.md`)

| Field | Required | Notes |
|---|---|---|
| `title` | ✓ | |
| `role` | | e.g. "Editor", "3D Animation" |
| `year` | | |
| `summary` | ✓ | |
| `poster` | ✓ | still image shown before the video plays |
| `video` | ✓ | `.mp4` path |
| `videoWebm` | | optional smaller alternate format |
| `vertical` | | `true` (default) for 9:16 clips, `false` for landscape |
| `featured` | | |
| `order` | | |

### Fine Art (`src/content/fineart/*.md`)

| Field | Required | Notes |
|---|---|---|
| `title` | | defaults to "Untitled" if left out |
| `medium` | ✓ | e.g. "Oil on canvas" |
| `dimensions` | | |
| `year` | | |
| `status` | | e.g. "Available", "Sold", "Private Collection" |
| `summary` | | |
| `image` | ✓ | |
| `gallery` | | extra images, same as design |
| `featured` | | |
| `order` | | |

## Images

Keep images reasonably web-sized before dropping them in — the rest of
the site's media is compressed to roughly 1200–1800px on the long edge.
If you're not sure how, ask and a resize step can be scripted too.
