import type { Context } from "hono";
import type { HtmlEscapedString } from "hono/utils/html";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Sends a JSX page as a full HTML document. */
export async function renderHtml(
  c: Context,
  node: HtmlEscapedString | Promise<HtmlEscapedString>,
  status: ContentfulStatusCode = 200,
) {
  return c.html(`<!doctype html>${await node}`, status);
}
