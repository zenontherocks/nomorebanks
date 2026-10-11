// Text modules are edited with Quill in the admin console and stored as a
// Quill "Delta" (a list of text runs with formatting). Rendering the Delta here
// — instead of storing editor HTML — means only the formats we support can
// ever reach the public page, and all text is escaped.

export type ListType = "bullet" | "ordered";
/** 2 = main heading, 3 = subheading (the page title is the only h1). */
export type HeaderLevel = 2 | 3;
export type Align = "center" | "right" | "justify";

/** Font choices offered in the editor (keys of the font picker). */
export const FONTS = ["arial", "georgia", "times-new-roman", "verdana", "courier-new"] as const;
export type Font = (typeof FONTS)[number];

/** Text sizes besides normal. */
export const SIZES = ["small", "large", "huge"] as const;
export type Size = (typeof SIZES)[number];

export interface DeltaAttributes {
  // Inline formats, carried by text runs.
  bold?: true;
  italic?: true;
  underline?: true;
  strike?: true;
  link?: string;
  size?: Size;
  font?: Font;
  // Line formats, carried by the "\n" that ends each line.
  header?: HeaderLevel;
  list?: ListType;
  align?: Align;
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

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

/** Keeps only the formats the editor offers, with values from their allowed lists. */
function normalizeAttributes(source: Record<string, unknown>): DeltaAttributes {
  const attributes: DeltaAttributes = {};
  if (source.bold === true) attributes.bold = true;
  if (source.italic === true) attributes.italic = true;
  if (source.underline === true) attributes.underline = true;
  if (source.strike === true) attributes.strike = true;
  if (typeof source.link === "string") {
    const href = safeHref(source.link);
    if (href) attributes.link = href;
  }
  if (isOneOf(SIZES, source.size)) attributes.size = source.size;
  if (isOneOf(FONTS, source.font)) attributes.font = source.font;

  // Pasted content can carry any heading level; fold them into the two we offer.
  const header = Number(source.header);
  if (header >= 1 && header <= 2) attributes.header = 2;
  else if (header >= 3 && header <= 6) attributes.header = 3;
  else if (source.list === "ordered") attributes.list = "ordered";
  else if (source.list === "bullet" || source.list === "checked" || source.list === "unchecked") {
    attributes.list = "bullet";
  }
  if (isOneOf(["center", "right", "justify"] as const, source.align)) attributes.align = source.align;
  return attributes;
}

/** Validates untrusted Delta JSON from the admin console, keeping only plain text runs and supported formats. */
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

    const source = (raw as { attributes?: unknown }).attributes;
    const attributes = normalizeAttributes(source && typeof source === "object" ? (source as Record<string, unknown>) : {});
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
  header?: HeaderLevel;
  list?: ListType;
  align?: Align;
}

function renderSegment({ text, attributes }: Segment): string {
  let html = escapeHtml(text);
  if (attributes.bold) html = `<strong>${html}</strong>`;
  if (attributes.italic) html = `<em>${html}</em>`;
  if (attributes.underline) html = `<u>${html}</u>`;
  if (attributes.strike) html = `<s>${html}</s>`;
  const classes = [
    attributes.size && `rt-size-${attributes.size}`,
    attributes.font && `rt-font-${attributes.font}`,
  ].filter(Boolean);
  if (classes.length) html = `<span class="${classes.join(" ")}">${html}</span>`;
  if (attributes.link) {
    const external = /^(https?:)?\/\//.test(attributes.link);
    const rel = external ? ' rel="noopener noreferrer"' : "";
    html = `<a href="${escapeHtml(attributes.link)}"${rel}>${html}</a>`;
  }
  return html;
}

/** Renders a normalized Delta to HTML headings, paragraphs and lists. */
export function renderDelta(delta: Delta): string {
  // In a Delta, each "\n" ends a line and carries that line's format (heading
  // level, list type, alignment); text runs carry inline formats.
  const lines: Line[] = [];
  let current: Segment[] = [];
  for (const op of delta.ops) {
    op.insert.split("\n").forEach((part, index) => {
      if (index > 0) {
        const { header, list, align } = op.attributes ?? {};
        lines.push({ segments: current, header, list, align });
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
  // Like the editor, numbering continues across bullet items and restarts only after a non-list line.
  let numbered = 0;
  const listTag = (list: ListType) => (list === "ordered" ? "ol" : "ul");
  for (const line of lines) {
    if (line.list !== openList) {
      if (openList) html += `</${listTag(openList)}>`;
      if (line.list === "ordered" && numbered > 0) html += `<ol start="${numbered + 1}">`;
      else if (line.list) html += `<${listTag(line.list)}>`;
      openList = line.list;
    }
    if (!line.list) numbered = 0;
    else if (line.list === "ordered") numbered += 1;
    const attrs = line.align ? ` class="rt-align-${line.align}"` : "";
    const inner = line.segments.map(renderSegment).join("");
    if (line.list) html += `<li${attrs}>${inner || "<br>"}</li>`;
    else if (line.header && inner) html += `<h${line.header}${attrs}>${inner}</h${line.header}>`;
    else html += `<p${attrs}>${inner || "<br>"}</p>`;
  }
  if (openList) html += `</${listTag(openList)}>`;
  return html;
}
