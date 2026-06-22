/**
 * Image utilities for the label editor.
 * Handles loading images from files and creating ImageBitmaps for canvas rendering.
 */

/** Read a File into a base64 data string (without the data: prefix) */
export async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
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
