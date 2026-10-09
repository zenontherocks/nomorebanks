import { referencedImageKeys } from "./db";
import type { Env } from "./env";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** How long an uploaded image may sit unused (e.g. in an unsaved edit) before cleanup. */
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

interface ImageType {
  ext: "jpg" | "png" | "gif" | "webp" | "avif";
  mime: string;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/**
 * Identifies an image by its leading bytes rather than trusting the browser's
 * declared type, so only real raster images are stored (no SVG/HTML).
 */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (bytes[0] === 0x89 && ascii(bytes, 1, 4) === "PNG") return { ext: "png", mime: "image/png" };
  if (ascii(bytes, 0, 4) === "GIF8") return { ext: "gif", mime: "image/gif" };
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return { ext: "webp", mime: "image/webp" };
  if (ascii(bytes, 4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(bytes, 8, 12))) {
    return { ext: "avif", mime: "image/avif" };
  }
  return null;
}

export class UploadError extends Error {}

/** Stores an uploaded image in R2 and returns its key. */
export async function storeImage(bucket: R2Bucket, file: File): Promise<string> {
  if (file.size === 0) throw new UploadError("The file is empty.");
  if (file.size > MAX_IMAGE_BYTES) throw new UploadError("Images must be 10 MB or smaller.");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImageType(bytes);
  if (!type) throw new UploadError("Please upload a JPEG, PNG, GIF, WebP or AVIF image.");

  const key = `${crypto.randomUUID().replaceAll("-", "")}.${type.ext}`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: type.mime } });
  return key;
}

/**
 * Deletes stored images no page uses any more — removed from a page, on a
 * deleted page, or uploaded and never saved. Recent uploads are kept so an
 * edit in progress doesn't lose its images.
 */
export async function cleanupOrphanImages(env: Env, now = Date.now()): Promise<void> {
  const referenced = await referencedImageKeys(env.DB);
  const cutoff = now - ORPHAN_GRACE_MS;
  let cursor: string | undefined;
  do {
    const listing = await env.IMAGES.list({ cursor, limit: 1000 });
    const orphans = listing.objects
      .filter((obj) => !referenced.has(obj.key) && obj.uploaded.getTime() < cutoff)
      .map((obj) => obj.key);
    if (orphans.length) await env.IMAGES.delete(orphans);
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
}
