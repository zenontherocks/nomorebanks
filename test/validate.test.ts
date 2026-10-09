import { describe, expect, it } from "vitest";
import { sniffImageType } from "../src/images";
import { ValidationError, parsePageInput, slugify } from "../src/validate";
import { PNG_BYTES } from "./helpers";

const base = { page_title: "About us", nav_title: "About" };

describe("slugify", () => {
  it("makes URL-safe slugs", () => {
    expect(slugify("About Us!")).toBe("about-us");
    expect(slugify("  Café & Crème  ")).toBe("cafe-creme");
    expect(slugify("!!!")).toBe("");
  });
});

describe("parsePageInput", () => {
  it("fills the slug from the navbar title", () => {
    expect(parsePageInput(base)).toEqual({ ...base, slug: "about", modules: [] });
  });

  it("cleans up a typed slug", () => {
    expect(parsePageInput({ ...base, slug: "Our Story" }).slug).toBe("our-story");
  });

  it("requires titles", () => {
    expect(() => parsePageInput({ ...base, page_title: "  " })).toThrow("Page title is required.");
    expect(() => parsePageInput({ ...base, nav_title: "" })).toThrow("Navbar title is required.");
  });

  it("rejects reserved slugs", () => {
    expect(() => parsePageInput({ ...base, slug: "admin" })).toThrow(/reserved/);
    expect(() => parsePageInput({ ...base, slug: "media" })).toThrow(/reserved/);
  });

  it("names the module that has a problem", () => {
    const modules = [
      { type: "heading", data: { text: "Hi" } },
      { type: "text", data: { delta: { ops: [{ insert: "\n" }] } } },
    ];
    expect(() => parsePageInput({ ...base, modules })).toThrow("Text module #2 is empty.");
    expect(() => parsePageInput({ ...base, modules: [{ type: "video", data: {} }] })).toThrow(ValidationError);
    expect(() => parsePageInput({ ...base, modules: [{ type: "image", data: { key: "" } }] })).toThrow(
      "Image module #1 has no image uploaded yet.",
    );
    expect(() =>
      parsePageInput({ ...base, modules: [{ type: "image", data: { key: "../../secret.png" } }] }),
    ).toThrow(/invalid image reference/);
  });
});

describe("sniffImageType", () => {
  it("recognises real images and rejects everything else", () => {
    expect(sniffImageType(PNG_BYTES)?.ext).toBe("png");
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.ext).toBe("jpg");
    expect(sniffImageType(new TextEncoder().encode("GIF89a"))?.ext).toBe("gif");
    expect(sniffImageType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("<html>"))).toBeNull();
  });
});
