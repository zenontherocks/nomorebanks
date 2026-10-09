import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { cleanupOrphanImages } from "../src/images";
import { ORIGIN, PNG_BYTES, api, fetchWorker, freshIp, login, postLogin, textDelta } from "./helpers";

async function createPage(cookie: string, body: Record<string, unknown>) {
  const res = await api(cookie, "/pages", { method: "POST", json: body });
  expect(res.status).toBe(201);
  return (await res.json()) as { page: { id: number; slug: string } };
}

async function uploadPng(cookie: string): Promise<string> {
  const form = new FormData();
  form.append("file", new File([PNG_BYTES], "pixel.png", { type: "image/png" }));
  const res = await api(cookie, "/uploads", { method: "POST", body: form });
  expect(res.status).toBe(201);
  return ((await res.json()) as { key: string }).key;
}

async function resetSite() {
  await env.DB.batch([env.DB.prepare("DELETE FROM modules"), env.DB.prepare("DELETE FROM pages")]);
  const listing = await env.IMAGES.list();
  if (listing.objects.length) await env.IMAGES.delete(listing.objects.map((o) => o.key));
}

describe("public site", () => {
  it("shows a placeholder before any pages exist", async () => {
    await fetchWorker("/"); // runs the schema setup
    await resetSite();
    const res = await fetchWorker("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Coming soon");
  });

  it("returns a 404 page for unknown addresses", async () => {
    const res = await fetchWorker("/no-such-page");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Page not found");
  });

  it("sends security headers", async () => {
    const res = await fetchWorker("/");
    expect(res.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("admin login", () => {
  it("shows a login form and never the editor without a session", async () => {
    const res = await fetchWorker("/admin");
    const html = await res.text();
    expect(html).toContain('action="/admin/login"');
    expect(html).not.toContain("admin.js");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("rejects a wrong password", async () => {
    const res = await postLogin("wrong");
    expect(res.status).toBe(401);
    expect(await res.text()).toContain("Incorrect password.");
  });

  it("logs in with the right password and loads the editor", async () => {
    const cookie = await login();
    expect(cookie).toMatch(/^nmb_session=/);
    const res = await fetchWorker("/admin", { headers: { cookie } });
    expect(await res.text()).toContain("/assets/admin/admin.js");
  });

  it("locks an IP out after 5 failed attempts", async () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) expect((await postLogin("wrong", ip)).status).toBe(401);
    const locked = await postLogin("test-password", ip);
    expect(locked.status).toBe(429);
    // Other visitors are unaffected.
    expect((await postLogin("test-password")).status).toBe(303);
  });

  it("rejects cross-site login posts", async () => {
    const res = await fetchWorker("/admin/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" },
      body: new URLSearchParams({ password: "test-password" }),
    });
    expect(res.status).toBe(403);
  });

  it("logs out and invalidates the session", async () => {
    const cookie = await login();
    const res = await fetchWorker("/admin/logout", { method: "POST", headers: { cookie, origin: ORIGIN } });
    expect(res.status).toBe(303);
    expect((await api(cookie, "/pages")).status).toBe(401);
  });
});

describe("admin API", () => {
  it("requires a session and the admin header", async () => {
    expect((await api("nmb_session=forged", "/pages")).status).toBe(401);
    const cookie = await login();
    const res = await fetchWorker("/api/pages", { headers: { cookie } });
    expect(res.status).toBe(400);
  });

  it("creates pages with ordered modules and renders them publicly", async () => {
    await resetSite();
    const cookie = await login();
    const imageKey = await uploadPng(cookie);

    const { page: home } = await createPage(cookie, { page_title: "Welcome home", nav_title: "Home" });
    const { page } = await createPage(cookie, {
      page_title: "About this site",
      nav_title: "About",
      modules: [
        { type: "heading", data: { text: "Our story" } },
        { type: "text", data: { delta: textDelta("It began <b>long</b> ago.") } },
        { type: "subheading", data: { text: "Pictures" } },
        { type: "image", data: { key: imageKey, alt: "A pixel", caption: "Tiny" } },
      ],
    });
    expect(page.slug).toBe("about");

    const homeHtml = await (await fetchWorker("/")).text();
    expect(homeHtml).toContain("<title>Welcome home</title>");
    expect(homeHtml).toMatch(/<a href="\/"[^>]*>Home<\/a>.*<a href="\/about"[^>]*>About<\/a>/s);

    const html = await (await fetchWorker("/about")).text();
    const order = ["<h1", "<h2", "<p>", "<h3", "<figure"].map((tag) => html.indexOf(tag));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain("It began &lt;b&gt;long&lt;/b&gt; ago.");
    expect(html).toContain(`src="/media/${imageKey}"`);
    expect(html).toContain("<figcaption>Tiny</figcaption>");

    // The home page's own slug redirects to "/".
    const redirect = await fetchWorker(`/${home.slug}`);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("/");
  });

  it("updates a page and replaces its module order", async () => {
    await resetSite();
    const cookie = await login();
    const { page } = await createPage(cookie, {
      page_title: "Page",
      nav_title: "Page",
      modules: [
        { type: "heading", data: { text: "First" } },
        { type: "heading", data: { text: "Second" } },
      ],
    });

    const res = await api(cookie, `/pages/${page.id}`, {
      method: "PUT",
      json: {
        page_title: "Renamed",
        nav_title: "Renamed",
        slug: "renamed",
        modules: [
          { type: "heading", data: { text: "Second" } },
          { type: "heading", data: { text: "First" } },
        ],
      },
    });
    expect(res.status).toBe(200);

    const loaded = (await (await api(cookie, `/pages/${page.id}`)).json()) as {
      page: { slug: string };
      modules: { data: { text: string } }[];
    };
    expect(loaded.page.slug).toBe("renamed");
    expect(loaded.modules.map((m) => m.data.text)).toEqual(["Second", "First"]);
  });

  it("rejects duplicate and reserved slugs with a clear message", async () => {
    await resetSite();
    const cookie = await login();
    await createPage(cookie, { page_title: "A", nav_title: "Contact" });

    const dup = await api(cookie, "/pages", { method: "POST", json: { page_title: "B", nav_title: "Contact" } });
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { error: string }).error).toContain('"/contact"');

    const reserved = await api(cookie, "/pages", {
      method: "POST",
      json: { page_title: "B", nav_title: "B", slug: "api" },
    });
    expect(reserved.status).toBe(400);
  });

  it("reorders the navbar, which changes the home page", async () => {
    await resetSite();
    const cookie = await login();
    const { page: a } = await createPage(cookie, { page_title: "Page A", nav_title: "A" });
    const { page: b } = await createPage(cookie, { page_title: "Page B", nav_title: "B" });

    const res = await api(cookie, "/pages/order", { method: "PUT", json: { ids: [b.id, a.id] } });
    expect(res.status).toBe(200);
    expect(await (await fetchWorker("/")).text()).toContain("<title>Page B</title>");

    const stale = await api(cookie, "/pages/order", { method: "PUT", json: { ids: [a.id] } });
    expect(stale.status).toBe(409);
  });

  it("deletes a page and its modules", async () => {
    await resetSite();
    const cookie = await login();
    const { page } = await createPage(cookie, {
      page_title: "Gone",
      nav_title: "Gone",
      modules: [{ type: "heading", data: { text: "Bye" } }],
    });
    expect((await api(cookie, `/pages/${page.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await fetchWorker("/gone")).status).toBe(404);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM modules").first<{ n: number }>();
    expect(count?.n).toBe(0);
  });
});

describe("images", () => {
  it("serves uploaded images with long-lived caching", async () => {
    const cookie = await login();
    const key = await uploadPng(cookie);
    const res = await fetchWorker(`/media/${key}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_BYTES);

    const cached = await fetchWorker(`/media/${key}`, { headers: { "if-none-match": res.headers.get("etag")! } });
    expect(cached.status).toBe(304);
  });

  it("rejects files that aren't images", async () => {
    const cookie = await login();
    const form = new FormData();
    form.append("file", new File(["<svg onload=alert(1)>"], "x.svg", { type: "image/svg+xml" }));
    const res = await api(cookie, "/uploads", { method: "POST", body: form });
    expect(res.status).toBe(400);
  });

  it("refuses to save a page whose image file is missing", async () => {
    const cookie = await login();
    const res = await api(cookie, "/pages", {
      method: "POST",
      json: {
        page_title: "Pics",
        nav_title: "Pics",
        modules: [{ type: "image", data: { key: `${"a".repeat(32)}.png` } }],
      },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("please upload it again");
  });

  it("cleans up images no page uses once the grace period has passed", async () => {
    await resetSite();
    const cookie = await login();
    const used = await uploadPng(cookie);
    const unused = await uploadPng(cookie);
    await createPage(cookie, {
      page_title: "Gallery",
      nav_title: "Gallery",
      modules: [{ type: "image", data: { key: used } }],
    });

    await cleanupOrphanImages(env); // within the grace period: nothing removed
    expect(await env.IMAGES.head(unused)).not.toBeNull();

    await cleanupOrphanImages(env, Date.now() + 2 * 24 * 60 * 60 * 1000);
    expect(await env.IMAGES.head(unused)).toBeNull();
    expect(await env.IMAGES.head(used)).not.toBeNull();
  });
});
