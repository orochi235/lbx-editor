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
 * Rasterize a text node to a cached ImageBitmap at SCALE× the pose size.
 * Cache is keyed by the text data + rounded box size; stale entries for a
 * node are overwritten naturally as the key changes (bounded: label
 * documents are small).
 */
export function getTextBitmap(data: LabelTextData, width: number, height: number): ImageBitmap | null {
  const w = Math.max(1, Math.round(width * SCALE));
  const h = Math.max(1, Math.round(height * SCALE));
  const key = JSON.stringify([data, w, h]);
  const hit = cache.get(key);
  if (hit) return hit;
  if (typeof OffscreenCanvas === 'undefined') return null;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(SCALE, SCALE);
  drawLabelText(ctx, data, { x: 0, y: 0, width, height });
  const bitmap = canvas.transferToImageBitmap();
  cache.set(key, bitmap);
  return bitmap;
}
