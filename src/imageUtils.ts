/**
 * Image utilities for the label editor.
 * Handles loading images from files and creating ImageBitmaps for canvas rendering.
 */

import { decodeBmp32, encodeBmp32 } from 'bil-lbx';

/** Read a File into a base64 data string (without the data: prefix) */
export async function fileToBase64(file: File): Promise<string> {
  // FileReader encodes natively — the byte-loop + btoa alternative takes
  // seconds on photo-sized files, and the pick flow awaits this.
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('file read failed'));
    reader.readAsDataURL(file);
  });
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

const dataUriMemo = new WeakMap<object, string>();

/** `data:` URI for an image node's embedded bytes — the cache key weasel's
 *  imageCache loads from. Memoized per data object so repeated draws hand the
 *  cache the same string instance instead of re-concatenating the base64.
 *
 *  32bpp BMPs (P-touch Editor macOS embeds) are re-encoded as PNG here: their
 *  artwork lives in the alpha channel, which browser BMP decoders discard as
 *  a reserved byte, rendering a solid black rectangle. The node keeps the
 *  original BMP bytes so .lbx export round-trips untouched. */
export function imageDataUri(data: { src: string; mimeType: string }): string {
  let uri = dataUriMemo.get(data);
  if (!uri) {
    uri = (data.mimeType === 'image/bmp' ? bmp32ToPngDataUri(data.src) : null)
      ?? `data:${data.mimeType};base64,${data.src}`;
    dataUriMemo.set(data, uri);
  }
  return uri;
}

/** PNG data URI for a base64 32bpp BMP, or null when the bytes are any other
 *  format (the browser decodes those correctly itself). */
function bmp32ToPngDataUri(base64: string): string | null {
  if (typeof document === 'undefined') return null;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const decoded = decodeBmp32(bytes);
  if (!decoded) return null;
  const canvas = document.createElement('canvas');
  canvas.width = decoded.width;
  canvas.height = decoded.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.putImageData(new ImageData(decoded.rgba, decoded.width, decoded.height), 0, 0);
  return canvas.toDataURL('image/png');
}

/** Create an ImageBitmap from base64-encoded image data */
export async function base64ToImageBitmap(base64: string, mimeType = 'image/png'): Promise<ImageBitmap> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mimeType });
  return createImageBitmap(blob);
}

/** Embedded-bitmap resolution: ~2× the printhead's 360 dpi (5 px/pt),
 *  matching what native P-touch Editor stores (e.g. a 6.8pt object saved
 *  as 73px ≈ 10.7 px/pt). Editing headroom without photo-sized files —
 *  the .lbx zip is STOREd, so an uncapped 12MP source would embed as a
 *  ~48MB BMP. */
const EXPORT_PX_PER_PT = 10;

/** Ensure image bytes are a BMP for .lbx embedding: BMPs pass through
 *  byte-for-byte (imported labels round-trip untouched); anything else
 *  (user-inserted PNG/JPEG/…) decodes in the browser, downsamples to the
 *  object's on-label size at EXPORT_PX_PER_PT (never upscales), and
 *  re-encodes as a 32bpp RGB+alpha BMP via bil-lbx — the only raster
 *  encoding the format embeds, so entries named ObjectN.bmp actually
 *  contain BMP. */
export async function ensureBmp32Bytes(
  bytes: Uint8Array,
  poseSizePt: { width: number; height: number },
): Promise<Uint8Array> {
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return bytes;
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
  const scale = Math.min(
    (poseSizePt.width * EXPORT_PX_PER_PT) / bitmap.width,
    (poseSizePt.height * EXPORT_PX_PER_PT) / bitmap.height,
    1,
  );
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const bmp = encodeBmp32(data, w, h);
  bitmap.close();
  return bmp;
}

/** Guess MIME type from filename */
export function guessMimeType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'bmp': return 'image/bmp';
    case 'svg': return 'image/svg+xml';
    case 'webp': return 'image/webp';
    default: return 'image/png';
  }
}

/** Get natural dimensions of an image from base64 data, scaled to fit within maxPt */
export async function getImageDimensions(
  base64: string,
  mimeType: string,
  maxWidth: number,
  maxHeight: number,
): Promise<{ width: number; height: number }> {
  const bitmap = await base64ToImageBitmap(base64, mimeType);
  const { width: natW, height: natH } = bitmap;
  bitmap.close();

  // Scale to fit within bounds, maintaining aspect ratio
  const scaleX = maxWidth / natW;
  const scaleY = maxHeight / natH;
  const scale = Math.min(scaleX, scaleY, 1); // Don't upscale

  return {
    width: Math.round(natW * scale * 10) / 10,
    height: Math.round(natH * scale * 10) / 10,
  };
}
