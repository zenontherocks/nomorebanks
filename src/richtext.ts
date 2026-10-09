// Text modules are edited with Quill in the admin console and stored as a
// Quill "Delta" (a list of text runs with formatting). Rendering the Delta here
// — instead of storing editor HTML — means only the formats we support can
// ever reach the public page, and all text is escaped.

export type ListType = "bullet" | "ordered";

export interface DeltaAttributes {
  bold?: true;
  italic?: true;
  link?: string;
  list?: ListType;
}

export interface DeltaOp {
  insert: string;
  attributes?: DeltaAttributes;
}

export interface Delta {
  ops: DeltaOp[];
}

const MAX_OPS = 5000;
const MAX_TEXT_LENGTH = 100_000;

export class RichTextError extends Error {}

const ALLOWED_PROTOCOLS = ["http:", "https:", "mailto:", "tel:", "sms:"];
const BARE_EMAIL = /^[^\s@/:]+@[^\s@/:]+\.[^\s@/:]+$/;

/**
 * Allows web, email, phone and SMS links plus links to the site's own pages.
 * Links typed without a scheme are completed the way people mean them:
 * "hello@example.com" → mailto:, "example.com/x" → https://, "about" → /about.
 */
export function safeHref(href: string): string | null {
  const value = href.trim();
  if (!value || value.length > 2000) return null;
  if ((value.startsWith("/") && !value.startsWith("//")) || value.startsWith("#")) return value;
  if (BARE_EMAIL.test(value)) return `mailto:${value}`;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    const host = value.split(/[/?#]/)[0];
    try {
      if (host.includes(".")) {
        url = new URL(`https://${value}`);
      } else {
        // No scheme and no domain: treat it as one of this site's pages.
        const page = new URL(`/${value}`, "https://site.invalid");
        return page.pathname + page.search + page.hash;
      }
    } catch {
      return null;
    }
  }
  return ALLOWED_PROTOCOLS.includes(url.protocol) ? url.href : null;
}

/**
 * Validates untrusted Delta JSON from the admin console, keeping only plain
 * text runs and the formats the editor offers (bold, italic, link, lists).
 */
export function normalizeDelta(input: unknown): Delta {
  const rawOps = (input as { ops?: unknown } | null)?.ops;
  if (!Array.isArray(rawOps)) throw new RichTextError("Text content is not in the expected format.");
  if (rawOps.length > MAX_OPS) throw new RichTextError("Text is too long.");

  const ops: DeltaOp[] = [];
  let length = 0;
  for (const raw of rawOps) {
    const insert = (raw as { insert?: unknown } | null)?.insert;
    if (typeof insert !== "string" || insert === "") continue; // drop embeds
    length += insert.length;

    const source = ((raw as { attributes?: unknown }).attributes ?? {}) as Record<string, unknown>;
    const attributes: DeltaAttributes = {};
    if (source.bold === true) attributes.bold = true;
    if (source.italic === true) attributes.italic = true;
    if (typeof source.link === "string") {
      const href = safeHref(source.link);
      if (href) attributes.link = href;
    }
    if (source.list === "ordered") attributes.list = "ordered";
    else if (source.list === "bullet" || source.list === "checked" || source.list === "unchecked") {
      attributes.list = "bullet";
    }

    ops.push(Object.keys(attributes).length ? { insert, attributes } : { insert });
  }
  if (length > MAX_TEXT_LENGTH) throw new RichTextError("Text is too long.");
  return { ops };
}

export function deltaPlainText(delta: Delta): string {
  return delta.ops.map((op) => op.insert).join("");
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

interface Segment {
  text: string;
  attributes: DeltaAttributes;
}

interface Line {
  segments: Segment[];
  list?: ListType;
}

function renderSegment({ text, attributes }: Segment): string {
  let html = escapeHtml(text);
  if (attributes.bold) html = `<strong>${html}</strong>`;
  if (attributes.italic) html = `<em>${html}</em>`;
  if (attributes.link) {
    const external = /^(https?:)?\/\//.test(attributes.link);
    const rel = external ? ' rel="noopener noreferrer"' : "";
    html = `<a href="${escapeHtml(attributes.link)}"${rel}>${html}</a>`;
  }
  return html;
}

/** Renders a normalized Delta to HTML paragraphs and lists. */
export function renderDelta(delta: Delta): string {
  // In a Delta, each "\n" ends a line and carries that line's block format
  // (e.g. list type); text runs carry inline formats.
  const lines: Line[] = [];
  let current: Segment[] = [];
  for (const op of delta.ops) {
    op.insert.split("\n").forEach((part, index) => {
      if (index > 0) {
        lines.push({ segments: current, list: op.attributes?.list });
        current = [];
      }
      if (part) current.push({ text: part, attributes: op.attributes ?? {} });
    });
  }
  if (current.length) lines.push({ segments: current });

  const isBlank = (line: Line) => !line.list && line.segments.every((s) => !s.text.trim());
  while (lines.length && isBlank(lines[0])) lines.shift();
  while (lines.length && isBlank(lines[lines.length - 1])) lines.pop();

  let html = "";
  let openList: ListType | undefined;
  const listTag = (list: ListType) => (list === "ordered" ? "ol" : "ul");
  for (const line of lines) {
    if (line.list !== openList) {
      if (openList) html += `</${listTag(openList)}>`;
      if (line.list) html += `<${listTag(line.list)}>`;
      openList = line.list;
    }
    const inner = line.segments.map(renderSegment).join("") || "<br>";
    html += line.list ? `<li>${inner}</li>` : `<p>${inner}</p>`;
  }
  if (openList) html += `</${listTag(openList)}>`;
  return html;
}
