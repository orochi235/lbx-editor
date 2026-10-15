/**
 * Whole-printer-dot sizing. The head lays dots on a fixed grid, so a barcode
 * module 2.4 dots wide prints as a mix of 2- and 3-dot bars; a whole number
 * of dots per module prints every module the same width, at any position.
 *
 * Pure: node data and pose in, pose out. Every path that sets a barcode's
 * size — resize, typed W/H, match size, insert, import, a payload edit that
 * changes the module count — goes through `snapNodePose`.
 */
import { barcodeModulePt, barcodeRequest, encodeBarcode } from './barcode';
import type { LabelNodeData, LabelPose } from './label';

/** Which edge stays put when a size changes: `max` keeps the right (or
 *  bottom) edge, as dragging a left (or top) handle does. Anything else keeps
 *  the left (or top). The kit's resize anchor has the same shape. */
export interface SnapAnchor {
  x: 'min' | 'max' | 'free';
  y: 'min' | 'max' | 'free';
}

const TOP_LEFT: SnapAnchor = { x: 'min', y: 'min' };

export function dotPt(dpi: number): number {
  return 72 / dpi;
}

/** `value` rounded to a whole number of dots, never below one. */
export function snapToDots(valuePt: number, dpi: number): number {
  const dot = dotPt(dpi);
  return Math.max(1, Math.round(valuePt / dot)) * dot;
}

function resized(pose: LabelPose, width: number, height: number, anchor: SnapAnchor): LabelPose {
  return {
    x: anchor.x === 'max' ? pose.x + pose.width - width : pose.x,
    y: anchor.y === 'max' ? pose.y + pose.height - height : pose.y,
    width,
    height,
  };
}

/** A barcode's pose resized so each module is a whole number of dots; any
 *  other node, or a barcode that doesn't encode, comes back unchanged. */
export function snapNodePose(
  data: LabelNodeData,
  pose: LabelPose,
  dpi: number,
  anchor: SnapAnchor = TOP_LEFT,
): LabelPose {
  if (data.kind !== 'barcode') return pose;
  const symbol = encodeBarcode(barcodeRequest(data));
  if (!symbol.ok) return pose;

  const module = snapToDots(barcodeModulePt(symbol, pose), dpi);
  if (symbol.kind === '1d') {
    return resized(pose, symbol.totalModules * module, pose.height, anchor);
  }
  return resized(
    pose,
    symbol.cols * module,
    symbol.rows * symbol.rowHeightModules * module,
    anchor,
  );
}

/** The printer's dot grid in label points: columns from x = 0, rows from the
 *  top of the printable band, which is where the print raster starts. */
export interface DotGrid {
  dpi: number;
  originY: number;
}

/** `pose` moved to the nearest dot-grid corner, size untouched. A symbol whose
 *  edges fall half a dot off the grid prints those edges at the threshold's
 *  mercy, and they resolve differently bar to bar. */
export function gridAligned(pose: LabelPose, grid: DotGrid): LabelPose {
  const dot = dotPt(grid.dpi);
  return {
    ...pose,
    x: Math.round(pose.x / dot) * dot,
    y: grid.originY + Math.round((pose.y - grid.originY) / dot) * dot,
  };
}

/** Whether the dither leaves this node alone. Barcodes always; images never
 *  by default, since tone is what dithering is for; everything else unless
 *  turned off. */
export function isDitherProtected(data: LabelNodeData): boolean {
  if (data.kind === 'barcode') return true;
  return data.noDither ?? data.kind !== 'image';
}
