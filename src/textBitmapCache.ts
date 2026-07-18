/**
 * Cache of rasterized text ImageBitmaps keyed by text data + box size.
 * Sync (OffscreenCanvas.transferToImageBitmap), so the first paint already
 * has glyphs — no async round trip like imageBitmapCache's decode path.
 */
import type { LabelTextData } from './label';
import { drawLabelText } from './textRender';

/** Supersampling factor for crispness under canvas zoom. */
const SCALE = 4;

const cache = new Map<string, ImageBitmap>();

/**
 * Editing churns keys (every keystroke / resize frame mints a new one), and a
 * changed key adds an entry — the old one stays. Flush wholesale at a cap;
 * worst case is one re-rasterization per live node after a flush.
 */
const MAX_CACHE_ENTRIES = 128;

/**
 * Rasterize a text node to a cached ImageBitmap at SCALE× the pose size.
 * Cache is keyed by the text data + rounded box size.
 */
export function getTextBitmap(data: LabelTextData, width: number, height: number): ImageBitmap | null {
  const w = Math.max(1, Math.round(width * SCALE));
  const h = Math.max(1, Math.round(height * SCALE));
  const key = JSON.stringify([data, w, h]);
  const hit = cache.get(key);
  if (hit) return hit;
  if (typeof OffscreenCanvas === 'undefined') return null;
  if (cache.size >= MAX_CACHE_ENTRIES) {
    for (const bitmap of cache.values()) bitmap.close();
    cache.clear();
  }
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(SCALE, SCALE);
  drawLabelText(ctx, data, { x: 0, y: 0, width, height });
  const bitmap = canvas.transferToImageBitmap();
  cache.set(key, bitmap);
  return bitmap;
}
