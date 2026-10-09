import { type Context, Hono } from "hono";
import { requireAdmin } from "../auth";
import {
  createPage,
  deletePage,
  getModules,
  getPageById,
  listPages,
  reorderPages,
  slugTaken,
  updatePage,
} from "../db";
import type { AppEnv } from "../env";
import { MAX_IMAGE_BYTES, UploadError, cleanupOrphanImages, storeImage } from "../images";
import { type Module, type PageInput, MODULE_LABELS, ValidationError, parsePageInput } from "../validate";

export const apiRoutes = new Hono<AppEnv>();

apiRoutes.use("*", requireAdmin);

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ValidationError("Request body must be JSON.");
  }
}

/** Catches images that were cleaned up while an edit sat unsaved for a long time. */
async function assertImagesExist(bucket: R2Bucket, modules: Module[]): Promise<void> {
  await Promise.all(
    modules.map(async (module, index) => {
      if (module.type !== "image") return;
      if (!(await bucket.head(module.data.key))) {
        throw new ValidationError(
          `${MODULE_LABELS.image} module #${index + 1}: the image file is missing — please upload it again.`,
        );
      }
    }),
  );
}

function slugConflict(c: Context, slug: string) {
  return c.json({ error: `Another page already uses the URL "/${slug}".` }, 409);
}

function isSlugConstraintError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("UNIQUE constraint failed: pages.slug");
}

function scheduleImageCleanup(c: Context<AppEnv>) {
  c.executionCtx.waitUntil(
    cleanupOrphanImages(c.env).catch((err) => console.error("Image cleanup failed", err)),
  );
}

function parseId(c: Context): number {
  return Number(c.req.param("id"));
}

apiRoutes.get("/pages", async (c) => {
  return c.json({ pages: await listPages(c.env.DB) });
});

apiRoutes.post("/pages", async (c) => {
  const input: PageInput = parsePageInput(await readJson(c));
  if (await slugTaken(c.env.DB, input.slug)) return slugConflict(c, input.slug);
  await assertImagesExist(c.env.IMAGES, input.modules);

  try {
    const page = await createPage(c.env.DB, input);
    scheduleImageCleanup(c);
    return c.json({ page, modules: input.modules }, 201);
  } catch (err) {
    if (isSlugConstraintError(err)) return slugConflict(c, input.slug);
    throw err;
  }
});

apiRoutes.put("/pages/order", async (c) => {
  const body = (await readJson(c)) as { ids?: unknown };
  const ids = body?.ids;
  const pages = await listPages(c.env.DB);
  const existing = new Set(pages.map((p) => p.id));
  const valid =
    Array.isArray(ids) &&
    ids.length === existing.size &&
    new Set(ids).size === ids.length &&
    ids.every((id) => existing.has(id));
  if (!valid) {
    return c.json({ error: "The page list changed — please reload and try again." }, 409);
  }
  await reorderPages(c.env.DB, ids as number[]);
  return c.json({ pages: await listPages(c.env.DB) });
});

apiRoutes.get("/pages/:id{[0-9]+}", async (c) => {
  const page = await getPageById(c.env.DB, parseId(c));
  if (!page) return c.json({ error: "Page not found." }, 404);
  return c.json({ page, modules: await getModules(c.env.DB, page.id) });
});

apiRoutes.put("/pages/:id{[0-9]+}", async (c) => {
  const id = parseId(c);
  if (!(await getPageById(c.env.DB, id))) return c.json({ error: "Page not found." }, 404);

  const input = parsePageInput(await readJson(c));
  if (await slugTaken(c.env.DB, input.slug, id)) return slugConflict(c, input.slug);
  await assertImagesExist(c.env.IMAGES, input.modules);

  try {
    await updatePage(c.env.DB, id, input);
  } catch (err) {
    if (isSlugConstraintError(err)) return slugConflict(c, input.slug);
    throw err;
  }
  scheduleImageCleanup(c);
  return c.json({ page: await getPageById(c.env.DB, id), modules: input.modules });
});

apiRoutes.delete("/pages/:id{[0-9]+}", async (c) => {
  const id = parseId(c);
  if (!(await getPageById(c.env.DB, id))) return c.json({ error: "Page not found." }, 404);
  await deletePage(c.env.DB, id);
  scheduleImageCleanup(c);
  return c.json({ ok: true });
});

apiRoutes.post("/uploads", async (c) => {
  // Reject oversized uploads before reading them (multipart adds a little overhead).
  const declaredLength = Number(c.req.header("content-length") ?? 0);
  if (declaredLength > MAX_IMAGE_BYTES + 64 * 1024) {
    throw new UploadError("Images must be 10 MB or smaller.");
  }
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) throw new UploadError("No image file was received.");
  const key = await storeImage(c.env.IMAGES, file);
  return c.json({ key, url: `/media/${key}` }, 201);
});

apiRoutes.all("*", (c) => c.json({ error: "Not found." }, 404));
