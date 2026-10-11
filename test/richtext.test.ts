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
        { insert: "hi", attributes: { bold: true, color: "red", link: "javascript:alert(1)" } },
        { insert: "\n", attributes: { list: "checked" } },
      ],
    });
    expect(delta).toEqual({
      ops: [{ insert: "hi", attributes: { bold: true } }, { insert: "\n", attributes: { list: "bullet" } }],
    });
  });

  it("keeps sizes, fonts and alignment only from the allowed lists", () => {
    const delta = normalizeDelta({
      ops: [
        { insert: "a", attributes: { size: "large", font: "georgia", underline: true, strike: true } },
        { insert: "b", attributes: { size: "72px", font: "comic-sans", background: "#ff0" } },
        { insert: "\n", attributes: { align: "center" } },
        { insert: "\n", attributes: { align: "sideways" } },
      ],
    });
    expect(delta.ops).toEqual([
      { insert: "a", attributes: { size: "large", font: "georgia", underline: true, strike: true } },
      { insert: "b" },
      { insert: "\n", attributes: { align: "center" } },
      { insert: "\n" },
    ]);
  });

  it("folds pasted heading levels into main heading and subheading", () => {
    const levels = [1, 2, 3, 4, 6, 7, "2"].map(
      (header) => normalizeDelta({ ops: [{ insert: "\n", attributes: { header } }] }).ops[0].attributes?.header,
    );
    expect(levels).toEqual([2, 2, 3, 3, 3, undefined, 2]);
    // A line can't be both a heading and a list item; the heading wins.
    expect(normalizeDelta({ ops: [{ insert: "\n", attributes: { header: 2, list: "bullet" } }] }).ops[0]).toEqual({
      insert: "\n",
      attributes: { header: 2 },
    });
  });
});

describe("renderDelta", () => {
  it("renders headings and normal text from one module", () => {
    expect(
      render([
        { insert: "Main" },
        { insert: "\n", attributes: { header: 2 } },
        { insert: "Body text\nSub" },
        { insert: "\n", attributes: { header: 3 } },
        { insert: "More\n" },
      ]),
    ).toBe("<h2>Main</h2><p>Body text</p><h3>Sub</h3><p>More</p>");
  });

  it("renders sizes and fonts as classes, and alignment on the line", () => {
    expect(
      render([
        { insert: "Big", attributes: { size: "huge", font: "courier-new", underline: true } },
        { insert: " and " },
        { insert: "gone", attributes: { strike: true, link: "/about" } },
        { insert: "\n", attributes: { align: "right" } },
        { insert: "Item" },
        { insert: "\n", attributes: { list: "bullet", align: "center" } },
        { insert: "Title" },
        { insert: "\n", attributes: { header: 2, align: "justify" } },
      ]),
    ).toBe(
      '<p class="rt-align-right"><span class="rt-size-huge rt-font-courier-new"><u>Big</u></span> and ' +
        '<a href="/about"><s>gone</s></a></p>' +
        '<ul><li class="rt-align-center">Item</li></ul><h2 class="rt-align-justify">Title</h2>',
    );
  });

  it("continues numbering across bullet items, like the editor", () => {
    const item = (text: string, list: string) => [{ insert: text }, { insert: "\n", attributes: { list } }];
    expect(
      render([
        ...item("One", "ordered"),
        ...item("Two", "ordered"),
        ...item("Note", "bullet"),
        ...item("Three", "ordered"),
        { insert: "Break\n" },
        ...item("Again one", "ordered"),
      ]),
    ).toBe(
      "<ol><li>One</li><li>Two</li></ol><ul><li>Note</li></ul><ol start=\"3\"><li>Three</li></ol>" +
        "<p>Break</p><ol><li>Again one</li></ol>",
    );
  });

  it("renders an empty heading line as a blank line", () => {
    expect(render([{ insert: "A\n" }, { insert: "\n", attributes: { header: 2 } }, { insert: "B\n" }])).toBe(
      "<p>A</p><p><br></p><p>B</p>",
    );
  });


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
