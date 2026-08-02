/**
 * Symbol → rectangles in pt.
 *
 * The pose is authoritative: 1D modules scale to fill its width, so resizing a
 * barcode behaves like resizing anything else and the relative bar widths — all
 * a scanner actually needs — stay exact. Export re-derives the file's `barWidth`
 * from the same relationship so P-touch redraws the symbol at the size we drew.
 */
import type { BarcodeSymbol, QuietZone } from './types';

/** Height reserved below a 1D symbol for its human-readable text, in pt. */
export const HUMAN_READABLE_HEIGHT_PT = 8;

/**
 * The quiet zone for `symbol` drawn at `pose`, in pt, per side.
 *
 * The margin is the encoder's, in modules — only it knows its symbology.
 * It lives outside the pose: no encoder bakes one into its `totalModules`
 * (pinned across all of them in `encode.test.ts`). The pose is the bars, which
 * is what P-touch's object box means under the `margin="false"` we always
 * export; measured against a P-touch-authored file in
 * docs/superpowers/specs/2026-07-28-barcode-backgrounds-design.md.
 */
export function quietZonePt(
  symbol: BarcodeSymbol,
  pose: { width: number; height: number },
): QuietZone {
  const module = barcodeModulePt(symbol, pose);
  return {
    left: symbol.quiet.left * module,
    right: symbol.quiet.right * module,
    top: symbol.quiet.top * module,
    bottom: symbol.quiet.bottom * module,
  };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The pt size of one module for `symbol` drawn at `pose`: the narrow-bar width
 * for 1D, the cell width for 2D.
 *
 * Export restates the pose in these terms, because P-touch redraws a barcode
 * from `barWidth` / `cellSize` / `pdf417Style.width` rather than from its
 * bounding box. Sharing this with the drawing below is what keeps a symbol
 * resized here the same size when P-touch reopens it.
 */
export function barcodeModulePt(
  symbol: BarcodeSymbol,
  pose: { width: number; height: number },
): number {
  if (symbol.kind === '1d') return pose.width / symbol.totalModules;
  return Math.min(
    pose.width / symbol.cols,
    pose.height / (symbol.rows * symbol.rowHeightModules),
  );
}

export function barcodeRects(
  symbol: BarcodeSymbol,
  pose: { x: number; y: number; width: number; height: number },
  humanReadable: boolean,
): Rect[] {
  const module = barcodeModulePt(symbol, pose);

  if (symbol.kind === '2d') {
    // A 2D symbol's cells must keep their proportions to scan, so the grid takes
    // whichever axis binds and centres in the pose rather than stretching to it.
    const cellH = module * symbol.rowHeightModules;
    const gridW = symbol.cols * module;
    const gridH = symbol.rows * cellH;
    const originX = pose.x + (pose.width - gridW) / 2;
    const originY = pose.y + (pose.height - gridH) / 2;
    const rects: Rect[] = [];
    for (let r = 0; r < symbol.rows; r++) {
      for (let c = 0; c < symbol.cols; c++) {
        if (symbol.modules[r]![c]) {
          rects.push({
            x: originX + c * module,
            y: originY + r * cellH,
            width: module,
            height: cellH,
          });
        }
      }
    }
    return rects;
  }

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

/**
 * The region a barcode masks: its pose plus the quiet zone, per side.
 *
 * Shared by the drawn background and `ditherProtect.protectedRegions`, so the
 * area we blank and the area we exempt from dithering are the same rectangle
 * by construction rather than by two copies agreeing.
 */
export function barcodeBackgroundRect(
  symbol: BarcodeSymbol,
  pose: { x: number; y: number; width: number; height: number },
): Rect {
  const q = quietZonePt(symbol, pose);
  return {
    x: pose.x - q.left,
    y: pose.y - q.top,
    width: pose.width + q.left + q.right,
    height: pose.height + q.top + q.bottom,
  };
}
