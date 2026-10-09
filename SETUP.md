# Setting up the site (web dashboards only)

Everything below is done in the Cloudflare and GitHub websites — no command line needed.
Do the steps in order; each takes a minute or two.

| You'll create | Where | Name to use |
|---|---|---|
| D1 database (pages and text) | Cloudflare | `nomorebanks-db` |
| R2 bucket (uploaded images) | Cloudflare | `nomorebanks-images` |
| Worker (the website itself) | Cloudflare | `nomorebanks` |
| `main` branch | GitHub | `main` |
| Admin password secret | Cloudflare | `ADMIN_PASSWORD` |

The names matter: they must match `wrangler.jsonc` in this repository.

---

## 1. Cloudflare: create the database

1. Sign in at <https://dash.cloudflare.com> (the free plan is fine).
2. In the left sidebar open **Storage & Databases → D1 SQL Database**.
3. Click **Create**, name it `nomorebanks-db`, leave the location on automatic, and click **Create**.
4. On the database's page, copy its **Database ID** (a long code like `1a2b3c4d-…`).
   It goes into `wrangler.jsonc` in step 4. It isn't a secret.

The site creates its own tables the first time it runs — there's nothing else to do here.

## 2. Cloudflare: create the image bucket

1. In the sidebar open **Storage & Databases → R2 Object Storage**.
2. If this is your first time, Cloudflare asks you to enable R2 and may ask for a payment
   method. The free tier includes 10 GB of storage, far more than a small site needs.
3. Click **Create bucket**, name it `nomorebanks-images`, keep the default settings, and
   click **Create bucket**.
4. Leave public access **off**. The website serves the images itself.

If you skip this step, the first deploy creates a bucket with this name for you. A bucket
with any other name is simply unused and can be deleted (bucket → **Settings** → **Delete bucket**).

## 3. GitHub: `main` is what gets published

Cloudflare publishes whatever is on the `main` branch.

- `main` is already the repository's default branch and holds the site's code, so there's
  nothing to do here. (To check: **Settings → General → Default branch** should say `main`.)
- When changes arrive on another branch (for example `claude/…`), GitHub shows a
  **Compare & pull request** button. Open the pull request into `main` and click
  **Merge pull request**: the site updates a minute or two later.

## 4. GitHub: check the database ID

**Already done** for the database `nomorebanks-db` with ID
`d3b9d805-5008-4fd7-85f4-387bc5f70077`. You only need this step if you ever recreate the
database:

1. On the `main` branch, open the file `wrangler.jsonc` and click the pencil icon (**Edit**).
2. Find the `"database_id": "…"` line and replace the value with the new Database ID
   (keep the quotes).
3. Click **Commit changes…** and commit directly to `main`.

## 5. Cloudflare: connect the repository

1. In the sidebar open **Workers & Pages** (or **Compute → Workers & Pages**), click
   **Create application**, then click **Get started** next to **Import a repository**.
   Don't use the **Pages** option or **Connect to Git** — those create a Pages project,
   which can't run this site.
2. Click **Connect GitHub**. GitHub opens and asks to install the **Cloudflare Workers and
   Pages** app: choose **Only select repositories**, pick `nomorebanks`, and click
   **Install & Authorize**.
3. Back in Cloudflare, select the `nomorebanks` repository and fill in:
   - **Project name:** `nomorebanks` (must match the `name` in `wrangler.jsonc`)
   - **Production branch:** `main`
   - **Build command:** leave empty
   - **Deploy command:** `npx wrangler deploy` (usually pre-filled)
   - **Root directory:** leave as `/`
4. Click **Save and Deploy**. The first build takes a minute or two.
5. Open the Worker's **Settings → Build → Branch control** and untick **Enable Preview
   Builds**. This site isn't set up for Cloudflare's preview builds, so builds of other
   branches would just fail and show a red ✗ on GitHub pull requests.

From now on, every change merged into `main` is published automatically.

## 6. Cloudflare: set the admin password

1. Open **Workers & Pages → nomorebanks → Settings → Variables and Secrets**.
2. Click **Add**, choose type **Secret**, name it `ADMIN_PASSWORD`, and enter a long password
   (a passphrase of four or more random words works well). Save/deploy.

To change the password later, edit this secret the same way. Changing it also logs out
every existing admin session, so it's the fix if you think someone else has logged in.

## 7. Try it

- **Public site:** your custom domain (see below), or
  `https://nomorebanks.<your-account-subdomain>.workers.dev` if the workers.dev address is
  enabled — the Worker's overview page lists its addresses. It says "Coming soon" until you
  add a page.
- **Admin console:** add `/admin` to the end of that address and log in with your password.
  It isn't linked from the site, so bookmark it.

Five wrong passwords in a row lock that network out of the login until 15 minutes after its
last attempt.

## Optional: use your own domain

If your domain is managed by Cloudflare, open **Workers & Pages → nomorebanks → Settings →
Domains & Routes → Add → Custom domain** and enter it (e.g. `www.example.com`).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Build fails with a D1/database error | The `database_id` in `wrangler.jsonc` must match the D1 database's ID (step 4). |
| Build fails mentioning the bucket | Check step 2: the bucket must be named exactly `nomorebanks-images`. |
| Admin page says the password isn't set up | Add the `ADMIN_PASSWORD` secret (step 6), then reload. |
| "Too many failed attempts" | Wait 15 minutes without trying, then log in again. |
| Logs and errors | **Workers & Pages → nomorebanks → Observability** (or **Logs**). |
