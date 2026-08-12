import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// Preview grids mount dozens of <img> tags at once. Pointing them at the
// original file's blob URL forces the browser to decode full-resolution
// photos (often several MB each) simultaneously — Safari's decode memory
// budget is far tighter than Chrome's, so a big batch silently kills the
// tab instead of erroring. Downscaling to a small canvas thumbnail first
// keeps decoded memory bounded regardless of browser.
const THUMBNAIL_MAX_DIMENSION = 320;
// Caps the decoder's own intermediate buffer for very large single photos
// (e.g. 48MP phone sensors) — createImageBitmap is allowed to decode
// straight to this size instead of full-res-then-downscale, so peak memory
// per decode stays bounded no matter how big the source is. Only one of
// resizeWidth/resizeHeight is set so the browser preserves aspect ratio.
const DECODE_RESIZE_CAP = 1024;

function scaledDimensions(width: number, height: number, maxDimension: number) {
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function bitmapToThumbnailUrl(source: CanvasImageSource, sourceWidth: number, sourceHeight: number): Promise<string> {
  const { width, height } = scaledDimensions(sourceWidth, sourceHeight, THUMBNAIL_MAX_DIMENSION);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  ctx.drawImage(source, 0, 0, width, height);
  return new Promise<string>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      0.7
    )
  );
}

// <img>-based decode, used only when createImageBitmap can't handle the
// file. Still goes through the same small-canvas downscale, so a format
// createImageBitmap rejects but <img> can still decode (browser-dependent)
// doesn't fall back to the original crash-prone full-res blob URL.
async function createThumbnailViaImgElement(file: File): Promise<string> {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image decode failed"));
      el.src = sourceUrl;
    });
    return await bitmapToThumbnailUrl(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export async function createThumbnail(file: File): Promise<string> {
  try {
    const bitmap = await createImageBitmap(file, { resizeWidth: DECODE_RESIZE_CAP, resizeQuality: "medium" });
    try {
      return await bitmapToThumbnailUrl(bitmap, bitmap.width, bitmap.height);
    } finally {
      bitmap.close();
    }
  } catch {
    try {
      return await createThumbnailViaImgElement(file);
    } catch {
      // Format neither API can decode (rare RAW variants, corrupt files) —
      // no preview rather than falling back to the original full-res blob
      // URL, which is exactly the crash-prone path this function exists to
      // avoid.
      return "";
    }
  }
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
