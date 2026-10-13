import { type Context, Hono } from "hono";
import { type PageRow, getModules, listPages } from "../db";
import type { AppEnv } from "../env";
import { renderHtml } from "../render";
import { isThemeId, rememberTheme } from "../themes";
import { IMAGE_KEY_PATTERN } from "../validate";
import { MessageView, PageView, SiteLayout, siteContext } from "../views/site";

export const publicRoutes = new Hono<AppEnv>();

publicRoutes.get("/media/:key", async (c) => {
  const key = c.req.param("key");
  if (!IMAGE_KEY_PATTERN.test(key)) return notFoundPage(c);

  const object = await c.env.IMAGES.get(key, { onlyIf: c.req.raw.headers });
  if (!object) return notFoundPage(c);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  // Keys are random and never reused, so images can be cached forever.
  headers.set("cache-control", "public, max-age=31536000, immutable");
  if (!("body" in object)) return new Response(null, { status: 304, headers });
  return new Response(object.body, { headers });
});

/** Only same-site paths, so the theme form can't be used to redirect visitors elsewhere. */
function safeReturnPath(value: unknown): string {
  return typeof value === "string" && /^\/(?![/\\])[^\s\\]*$/.test(value) ? value : "/";
}

// The theme picker's form posts here when JavaScript is off (site.js handles it otherwise).
publicRoutes.post("/theme", async (c) => {
  const form = await c.req.parseBody();
  if (isThemeId(form.theme)) rememberTheme(c, form.theme);
  return c.redirect(safeReturnPath(form.return), 303);
});

publicRoutes.get("/", async (c) => {
  const pages = await listPages(c.env.DB);
  if (pages.length === 0) {
    return renderHtml(
      c,
      <SiteLayout title="Coming soon" nav={[]} {...siteContext(c)}>
        <MessageView title="Coming soon" message="This site doesn't have any pages yet." />
      </SiteLayout>,
    );
  }
  return renderPage(c, pages, pages[0]);
});

publicRoutes.get("/:slug", async (c) => {
  const pages = await listPages(c.env.DB);
  const page = pages.find((p) => p.slug === c.req.param("slug"));
  if (!page) return notFoundPage(c, pages);
  // The first page in the navbar is the home page and lives at "/".
  if (page.id === pages[0].id) return c.redirect("/", 302);
  return renderPage(c, pages, page);
});

async function renderPage(c: Context<AppEnv>, pages: PageRow[], page: PageRow) {
  const modules = await getModules(c.env.DB, page.id);
  return renderHtml(
    c,
    <SiteLayout title={page.page_title} nav={pages} currentId={page.id} {...siteContext(c)}>
      <PageView page={page} modules={modules} />
    </SiteLayout>,
  );
}

export async function notFoundPage(c: Context<AppEnv>, pages?: PageRow[]) {
  const nav = pages ?? (await listPages(c.env.DB));
  return renderHtml(
    c,
    <SiteLayout title="Page not found" nav={nav} {...siteContext(c)}>
      <MessageView title="Page not found" message="Sorry, there's no page at this address." />
    </SiteLayout>,
    404,
  );
}
