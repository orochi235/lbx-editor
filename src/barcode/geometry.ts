/**
 * Symbol → rectangles in pt.
 *
 * The pose is authoritative: 1D modules scale to fill its width, so resizing a
 * barcode behaves like resizing anything else and the relative bar widths — all
 * a scanner actually needs — stay exact. Export re-derives the file's `barWidth`
 * from the same relationship so P-touch redraws the symbol at the size we drew.
 */
import type { BarcodeSymbol } from './types';

/** Height reserved below a 1D symbol for its human-readable text, in pt. */
export const HUMAN_READABLE_HEIGHT_PT = 8;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function barcodeRects(
  symbol: BarcodeSymbol,
  pose: { x: number; y: number; width: number; height: number },
  humanReadable: boolean,
): Rect[] {
  if (symbol.kind === '2d') {
    // 2D symbols must stay square to scan, so they take the smaller dimension
    // and centre in the pose rather than stretching to fill it.
    const side = Math.min(pose.width, pose.height);
    const module = side / symbol.size;
    const originX = pose.x + (pose.width - side) / 2;
    const originY = pose.y + (pose.height - side) / 2;
    const rects: Rect[] = [];
    for (let r = 0; r < symbol.size; r++) {
      for (let c = 0; c < symbol.size; c++) {
        if (symbol.modules[r]![c]) {
          rects.push({
            x: originX + c * module,
            y: originY + r * module,
            width: module,
            height: module,
          });
        }
      }
    }
    return rects;
  }

  const module = pose.width / symbol.totalModules;
  const barsHeight = humanReadable
    ? Math.max(0, pose.height - HUMAN_READABLE_HEIGHT_PT)
    : pose.height;
  return symbol.bars.map((bar) => ({
    x: pose.x + bar.x * module,
    y: pose.y,
    width: bar.width * module,
    height: barsHeight,
  }));
}
