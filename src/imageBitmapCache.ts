/**
 * Cache of ImageBitmaps keyed by base64 data hash.
 * Prevents re-creating bitmaps on every render cycle.
 */
import { base64ToImageBitmap } from './imageUtils';

const cache = new Map<string, ImageBitmap>();
const pending = new Map<string, Promise<ImageBitmap>>();

/** Simple hash of first + last 100 chars + length for cache key */
function cacheKey(base64: string): string {
  return `${base64.length}:${base64.slice(0, 50)}:${base64.slice(-50)}`;
}

/**
 * Get or create an ImageBitmap for the given base64 image data.
 * Returns null synchronously if the bitmap hasn't been created yet
 * (the caller should trigger a re-render when it resolves).
 */
export function getImageBitmap(
  base64: string,
  mimeType: string,
  onReady?: () => void,
): ImageBitmap | null {
  const key = cacheKey(base64);

  const cached = cache.get(key);
  if (cached) return cached;

  // Start loading if not already in progress
  if (!pending.has(key)) {
    const p = base64ToImageBitmap(base64, mimeType).then((bmp) => {
      cache.set(key, bmp);
      pending.delete(key);
      onReady?.();
      return bmp;
    });
    pending.set(key, p);
  }

  return null;
}

export function clearImageCache() {
  for (const bmp of cache.values()) bmp.close();
  cache.clear();
}
