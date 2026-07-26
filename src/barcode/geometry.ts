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

/**
 * Blank margin a scanner needs on each side to find where the symbol starts:
 * 10 modules is the GS1 minimum shared by the 1D symbologies here, and the QR
 * spec asks for 4 cells.
 */
export const QUIET_ZONE_MODULES_1D = 10;
export const QUIET_ZONE_MODULES_2D = 4;

/** The quiet zone for `symbol` drawn at `pose`, in pt. */
export function quietZonePt(
  symbol: BarcodeSymbol,
  pose: { width: number; height: number },
): number {
  const modules = symbol.kind === '2d' ? QUIET_ZONE_MODULES_2D : QUIET_ZONE_MODULES_1D;
  return modules * barcodeModulePt(symbol, pose);
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The pt size of one module for `symbol` drawn at `pose`: the narrow-bar width
 * for 1D, the cell size for 2D.
 *
 * Export restates the pose in these terms, because P-touch redraws a barcode
 * from `barWidth`/`cellSize` rather than from its bounding box. Sharing this
 * with the drawing below is what keeps a symbol resized here the same size
 * when P-touch reopens it.
 */
export function barcodeModulePt(
  symbol: BarcodeSymbol,
  pose: { width: number; height: number },
): number {
  return symbol.kind === '2d'
    ? Math.min(pose.width, pose.height) / symbol.size
    : pose.width / symbol.totalModules;
}

export function barcodeRects(
  symbol: BarcodeSymbol,
  pose: { x: number; y: number; width: number; height: number },
  humanReadable: boolean,
): Rect[] {
  const module = barcodeModulePt(symbol, pose);

  if (symbol.kind === '2d') {
    // 2D symbols must stay square to scan, so they take the smaller dimension
    // and centre in the pose rather than stretching to fill it.
    const side = Math.min(pose.width, pose.height);
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
