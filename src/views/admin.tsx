import type { Child } from "hono/jsx";

function AdminLayout({ title, children, head }: { title: string; children: Child; head?: Child }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>{title}</title>
        {head}
        <link rel="stylesheet" href="/assets/admin/admin.css" />
      </head>
      <body class="admin">{children}</body>
    </html>
  );
}

export function LoginView({ error, configured }: { error?: string; configured: boolean }) {
  return (
    <AdminLayout title="Admin login">
      <main class="login">
        <h1>Admin login</h1>
        {configured ? (
          <form method="post" action="/admin/login" class="login-form">
            {/* Lets password managers remember the login. */}
            <input type="text" name="username" value="admin" autocomplete="username" hidden />
            <label for="password">Password</label>
            <input id="password" name="password" type="password" autocomplete="current-password" required autofocus />
            {error ? (
              <p class="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" class="button button-primary">
              Log in
            </button>
          </form>
        ) : (
          <p class="form-error" role="alert">
            The admin password hasn't been set up yet. Add a secret named ADMIN_PASSWORD to this Worker in the
            Cloudflare dashboard (Settings → Variables and Secrets), then reload this page.
          </p>
        )}
      </main>
    </AdminLayout>
  );
}

export function AdminAppView() {
  return (
    <AdminLayout
      title="Site admin"
      head={<link rel="stylesheet" href="/assets/admin/vendor/quill.snow.css" />}
    >
      <header class="admin-bar">
        <a href="/admin" class="admin-brand">
          Site admin
        </a>
        <div class="admin-bar-actions">
          <a href="/" target="_blank" rel="noopener">
            View site
          </a>
          <form method="post" action="/admin/logout">
            <button type="submit" class="button button-link">
              Log out
            </button>
          </form>
        </div>
      </header>
      <main id="app" class="admin-main" aria-live="polite">
        <p>Loading…</p>
      </main>
      <div id="toast" class="toast" role="status" hidden></div>
      <script src="/assets/admin/vendor/Sortable.min.js"></script>
      <script src="/assets/admin/vendor/quill.js"></script>
      <script type="module" src="/assets/admin/admin.js"></script>
    </AdminLayout>
  );
}
