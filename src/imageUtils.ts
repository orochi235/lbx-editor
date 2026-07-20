/**
 * Image utilities for the label editor.
 * Handles loading images from files and creating ImageBitmaps for canvas rendering.
 */

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
 *  cache the same string instance instead of re-concatenating the base64. */
export function imageDataUri(data: { src: string; mimeType: string }): string {
  let uri = dataUriMemo.get(data);
  if (!uri) {
    uri = `data:${data.mimeType};base64,${data.src}`;
    dataUriMemo.set(data, uri);
  }
  return uri;
}

/** Create an ImageBitmap from base64-encoded image data */
export async function base64ToImageBitmap(base64: string, mimeType = 'image/png'): Promise<ImageBitmap> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mimeType });
  return createImageBitmap(blob);
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
