# nomorebanks

A small website whose pages are built from ordered content modules, managed through a hidden,
password-protected admin console. It runs on Cloudflare Workers, with D1 (SQLite) for content
and R2 for uploaded images.

**First-time setup:** see [SETUP.md](SETUP.md). It's all done in the Cloudflare and GitHub web dashboards.

## What it does

**Public site**
- A top navbar links every page by its *navbar title*, in the order set in the admin console.
- The first page in that order is the home page (`/`); the others live at `/<slug>`.
- Each page shows its *page title*, then its modules from top to bottom.

**Modules**

| Module | Shown as |
|---|---|
| Main header | large section heading (`<h2>`) |
| Subsection header | smaller heading (`<h3>`) |
| Text | paragraphs with bold, italic, links and bulleted/numbered lists |
| Image | uploaded JPEG/PNG/GIF/WebP/AVIF (up to 10 MB) with alt text and optional caption |

**Admin console** at `/admin` (not linked anywhere; login required)
- Pages list: create, edit, delete, and drag (or use the arrows) to set the navbar order.
- Page editor: page title, navbar title, web address, and a stack of module cards that can be
  added, edited, removed, and dragged into order. **Save page** (or Ctrl/⌘+S) saves everything.
- Leaving with unsaved changes asks for confirmation.

## How it works

```
src/
  index.tsx          Hono app: security headers, schema setup, routing, error pages
  schema.ts          Creates/upgrades database tables automatically (no migration step)
  auth.ts            Password check, login throttling, sessions, same-origin checks
  db.ts              D1 queries (pages, modules, navbar order)
  validate.ts        Validates page saves from the admin console
  richtext.ts        Renders text modules (stored as Quill Deltas) to safe HTML
  images.ts          Image upload checks, R2 storage, cleanup of unused images
  routes/public.tsx  Public pages and /media/<image>
  routes/admin.tsx   /admin login/logout and the console shell
  routes/api.ts      JSON API used by the console (/api/pages, /api/uploads)
  views/             Server-rendered HTML (Hono JSX)
public/assets/       CSS, the admin console script, and vendored Quill + SortableJS
```

- **Security:** the admin password is a Worker secret, compared in constant time. Sessions
  are random tokens (only their hashes are stored) in HttpOnly cookies. Five failed logins
  from one IP lock it out for 15 minutes. Admin writes require a same-origin request and a
  custom header, and responses carry a strict Content Security Policy. Text is rendered from
  a structured format with all content escaped and links limited to http(s)/mailto/tel.
  Uploads are checked by their file contents, so only real raster images are stored.
- **Images** are stored in R2 under random names and cached by browsers indefinitely. Images
  no longer used by any page are deleted after a 24-hour grace period.
- **Schema changes:** add a new entry to the end of `MIGRATIONS` in `src/schema.ts`. The
  Worker applies it on its next request. Never edit an entry that has already been deployed.

## Local development

Requires Node.js 20+.

```sh
npm install
cp .dev.vars.example .dev.vars   # then set ADMIN_PASSWORD
npm run dev                      # http://localhost:8787, admin at /admin
```

Local data lives in `.wrangler/` and never touches the live site.

```sh
npm test            # unit + API tests, run inside the Workers runtime
npm run test:e2e    # browser test of the admin console (needs `npx playwright install chromium` once)
npm run typecheck
```

To upgrade Quill or SortableJS: update the package, run `npm run vendor`, and commit the
files it copies into `public/assets/admin/vendor/`.

## Deploying

Merging into `main` deploys automatically through Cloudflare's GitHub integration (see
[SETUP.md](SETUP.md)). `npm run deploy` also works from a machine logged in with `wrangler login`.
