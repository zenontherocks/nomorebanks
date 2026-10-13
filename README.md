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
- A **Theme** button on the right of the navbar pops out a 3×3 grid of color themes (Classic,
  Ocean, Forest, Sand, Lavender, Rose, Midnight, Charcoal, Dusk). A visitor's choice is saved
  in a small cookie (`nmb_theme`, the theme name only) and works without JavaScript too. The
  default for new visitors is `DEFAULT_THEME` in `src/themes.ts`; the colors are in
  `public/assets/site.css` and all meet WCAG AA contrast.

**Modules**

| Module | Shown as |
|---|---|
| Text | any mix of main headings (`<h2>`), subheadings (`<h3>`) and normal paragraphs, with text size (small/normal/large/huge), font (default, Arial, Georgia, Times New Roman, Verdana, Courier New), bold, italic, underline, strikethrough, links, bulleted/numbered lists and alignment |
| Image | uploaded JPEG/PNG/GIF/WebP/AVIF (up to 10 MB) with alt text and optional caption |

Each toolbar control in the editor has a tooltip; the **T<sub>x</sub>** button clears formatting.
The formats are listed in four places that must agree: the editor toolbar
(`public/assets/admin/admin.js`), the server-side whitelist and renderer (`src/richtext.ts`),
the `rt-*` classes in `public/assets/site.css`, and the editor's `ql-*` classes and menu labels
in `public/assets/admin/admin.css`.

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
  themes.ts          Color theme list, default theme and the theme cookie
  routes/public.tsx  Public pages, /media/<image> and the no-JavaScript /theme form
  routes/admin.tsx   /admin login/logout and the console shell
  routes/api.ts      JSON API used by the console (/api/pages, /api/uploads)
  views/             Server-rendered HTML (Hono JSX)
public/assets/       CSS, the theme picker script, the admin console script, and vendored
                     Quill + SortableJS
```

- **Security:** the admin password is a Worker secret, compared in constant time. Sessions
  are random tokens in HttpOnly cookies; only hashes tied to the current password are stored,
  so changing the password logs everyone out. Logins are rate-limited per IP (per /56 for
  IPv6): five attempts, then a 15-minute lockout, counted atomically so parallel guesses
  can't get around it. Admin writes require a same-origin request and a custom header, and
  responses carry a strict Content Security Policy. Text is rendered from a structured format
  with all content escaped and links limited to http(s)/mailto/tel/sms or the site's own
  pages. Uploads are checked by their file contents, so only real raster images are stored.
- **Images** are stored in R2 under random names and cached by browsers indefinitely. Images
  no longer used by any page are deleted after a 24-hour grace period.
- **Schema changes:** add a new entry to the end of `MIGRATIONS` in `src/schema.ts`. The
  Worker applies it on its next request. Never edit an entry that has already been deployed.

## Local development

Requires Node.js 22 or newer.

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
