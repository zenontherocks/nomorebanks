import { describe, expect, it } from "vitest";
import { RichTextError, normalizeDelta, renderDelta, safeHref } from "../src/richtext";

const render = (ops: unknown[]) => renderDelta(normalizeDelta({ ops }));

describe("safeHref", () => {
  it("allows web, email, phone and site-relative links", () => {
    expect(safeHref("https://example.com/a")).toBe("https://example.com/a");
    expect(safeHref("example.com")).toBe("https://example.com/");
    expect(safeHref("mailto:hi@example.com")).toBe("mailto:hi@example.com");
    expect(safeHref("tel:+15555550100")).toBe("tel:+15555550100");
    expect(safeHref("/about")).toBe("/about");
    expect(safeHref("#section")).toBe("#section");
  });

  it("completes links typed without a scheme", () => {
    expect(safeHref("hello@example.com")).toBe("mailto:hello@example.com");
    expect(safeHref("about")).toBe("/about");
    expect(safeHref("about/team#people")).toBe("/about/team#people");
    expect(safeHref("www.example.com/path")).toBe("https://www.example.com/path");
    expect(safeHref("sms:+15555550100")).toBe("sms:+15555550100");
  });

  it("rejects script and data URLs", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref(" JavaScript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeHref("javascript:alert(1)//@x.com")).toBeNull();
    expect(safeHref("")).toBeNull();
  });
});

describe("normalizeDelta", () => {
  it("rejects input that isn't a Delta", () => {
    expect(() => normalizeDelta(null)).toThrow(RichTextError);
    expect(() => normalizeDelta({ ops: "nope" })).toThrow(RichTextError);
  });

  it("drops embeds and unsupported formats", () => {
    const delta = normalizeDelta({
      ops: [
        { insert: { image: "https://evil.example/x.png" } },
        { insert: "hi", attributes: { bold: true, color: "red", header: 1, link: "javascript:alert(1)" } },
        { insert: "\n", attributes: { list: "checked" } },
      ],
    });
    expect(delta).toEqual({
      ops: [{ insert: "hi", attributes: { bold: true } }, { insert: "\n", attributes: { list: "bullet" } }],
    });
  });
});

describe("renderDelta", () => {
  it("renders paragraphs with inline formats", () => {
    expect(
      render([
        { insert: "Hello " },
        { insert: "bold", attributes: { bold: true } },
        { insert: " and " },
        { insert: "link", attributes: { italic: true, link: "https://example.com" } },
        { insert: "\nSecond line\n" },
      ]),
    ).toBe(
      '<p>Hello <strong>bold</strong> and <a href="https://example.com/" rel="noopener noreferrer"><em>link</em></a></p>' +
        "<p>Second line</p>",
    );
  });

  it("groups list lines into ul/ol", () => {
    expect(
      render([
        { insert: "Intro\nOne" },
        { insert: "\n", attributes: { list: "bullet" } },
        { insert: "Two" },
        { insert: "\n", attributes: { list: "bullet" } },
        { insert: "First" },
        { insert: "\n", attributes: { list: "ordered" } },
        { insert: "Outro\n" },
      ]),
    ).toBe("<p>Intro</p><ul><li>One</li><li>Two</li></ul><ol><li>First</li></ol><p>Outro</p>");
  });

  it("escapes HTML in text", () => {
    expect(render([{ insert: '<script>alert("x")</script>\n' }])).toBe(
      "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>",
    );
  });

  it("keeps blank lines between paragraphs but trims them at the ends", () => {
    expect(render([{ insert: "\n\nA\n\nB\n\n" }])).toBe("<p>A</p><p><br></p><p>B</p>");
  });
});
