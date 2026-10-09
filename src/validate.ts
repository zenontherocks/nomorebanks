import { type Delta, RichTextError, deltaPlainText, normalizeDelta } from "./richtext";

export type Module =
  | { type: "heading"; data: { text: string } }
  | { type: "subheading"; data: { text: string } }
  | { type: "text"; data: { delta: Delta } }
  | { type: "image"; data: { key: string; alt: string; caption: string } };

export type ModuleType = Module["type"];

export interface PageInput {
  page_title: string;
  nav_title: string;
  slug: string;
  modules: Module[];
}

export const MODULE_LABELS: Record<ModuleType, string> = {
  heading: "Main header",
  subheading: "Subsection header",
  text: "Text",
  image: "Image",
};

/** Paths the site itself uses; pages can't take these URLs. */
export const RESERVED_SLUGS = new Set(["admin", "api", "media", "assets"]);
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const IMAGE_KEY_PATTERN = /^[0-9a-f]{32}\.(?:jpg|png|gif|webp|avif)$/;

const MAX_MODULES = 200;

export class ValidationError extends Error {}

export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 80)
    .replace(/^-+|-+$/g, "");
}

function requiredString(value: unknown, label: string, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new ValidationError(`${label} is required.`);
  if (text.length > max) throw new ValidationError(`${label} must be ${max} characters or fewer.`);
  return text;
}

function optionalString(value: unknown, label: string, max: number): string {
  if (value == null) return "";
  if (typeof value !== "string") throw new ValidationError(`${label} must be text.`);
  const text = value.trim();
  if (text.length > max) throw new ValidationError(`${label} must be ${max} characters or fewer.`);
  return text;
}

function parseModule(raw: unknown, index: number): Module {
  const type = (raw as { type?: unknown } | null)?.type;
  const data = ((raw as { data?: unknown } | null)?.data ?? {}) as Record<string, unknown>;
  if (typeof type !== "string" || !(type in MODULE_LABELS)) {
    throw new ValidationError(`Module #${index + 1} has an unknown type.`);
  }
  const label = `${MODULE_LABELS[type as ModuleType]} module #${index + 1}`;

  switch (type as ModuleType) {
    case "heading":
    case "subheading": {
      const text = optionalString(data.text, label, 300);
      if (!text) throw new ValidationError(`${label} is empty.`);
      return { type: type as "heading" | "subheading", data: { text } };
    }
    case "text": {
      let delta: Delta;
      try {
        delta = normalizeDelta(data.delta);
      } catch (err) {
        if (err instanceof RichTextError) throw new ValidationError(`${label}: ${err.message}`);
        throw err;
      }
      if (!deltaPlainText(delta).trim()) throw new ValidationError(`${label} is empty.`);
      return { type: "text", data: { delta } };
    }
    case "image": {
      const key = typeof data.key === "string" ? data.key : "";
      if (!key) throw new ValidationError(`${label} has no image uploaded yet.`);
      if (!IMAGE_KEY_PATTERN.test(key)) throw new ValidationError(`${label} has an invalid image reference.`);
      return {
        type: "image",
        data: {
          key,
          alt: optionalString(data.alt, `${label} alt text`, 300),
          caption: optionalString(data.caption, `${label} caption`, 500),
        },
      };
    }
  }
}

/** Validates a page save request from the admin console. */
export function parsePageInput(body: unknown): PageInput {
  if (!body || typeof body !== "object") throw new ValidationError("Invalid request.");
  const input = body as Record<string, unknown>;

  const page_title = requiredString(input.page_title, "Page title", 200);
  const nav_title = requiredString(input.nav_title, "Navbar title", 60);

  const requestedSlug = optionalString(input.slug, "URL slug", 80);
  const slug = slugify(requestedSlug || nav_title);
  if (!slug) throw new ValidationError("URL slug needs at least one letter or number.");
  if (!SLUG_PATTERN.test(slug)) {
    throw new ValidationError("URL slug can only use lowercase letters, numbers and single dashes.");
  }
  if (RESERVED_SLUGS.has(slug)) throw new ValidationError(`"${slug}" is reserved — please choose another URL slug.`);

  const rawModules = input.modules ?? [];
  if (!Array.isArray(rawModules)) throw new ValidationError("Invalid module list.");
  if (rawModules.length > MAX_MODULES) throw new ValidationError(`A page can have at most ${MAX_MODULES} modules.`);

  return { page_title, nav_title, slug, modules: rawModules.map(parseModule) };
}
