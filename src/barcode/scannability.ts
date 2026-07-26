/**
 * Whether a barcode is big enough to survive the trip to tape.
 *
 * The pose is authoritative for size, which means a barcode can be resized down
 * until its modules are narrower than the printhead can resolve. That failure
 * is invisible on screen — the canvas draws crisp sub-pixel bars — and only
 * shows up as a symbol no scanner will read.
 *
 * Both thresholds are in printer dots, since that's the unit the failure
 * actually happens in.
 */
import type { BarcodeSymbol } from './types';
import { barcodeModulePt } from './geometry';

/**
 * Under one dot, a module has no whole dot of its own: neighbouring bars merge
 * or drop out entirely and what prints isn't the symbol at all.
 */
export const MIN_RENDERABLE_MODULE_DOTS = 1;

/**
 * Two dots at 180 dpi is 0.28mm, which clears GS1's minimum X-dimension for
 * general distribution (~0.25mm) and for retail POS (0.264mm). Between one and
 * two dots the raster still has to round each module boundary to a whole dot,
 * so the relative bar widths a scanner measures come out distorted.
 */
export const MIN_RELIABLE_MODULE_DOTS = 2;

export type ModuleFitness = 'ok' | 'marginal' | 'unrenderable';

/** One module in printer dots — the narrow bar for 1D, the cell for 2D. */
export function barcodeModuleDots(
  symbol: BarcodeSymbol,
  pose: { width: number; height: number },
  dpi: number,
): number {
  return barcodeModulePt(symbol, pose) * (dpi / 72);
}

export function moduleFitness(dots: number): ModuleFitness {
  if (dots < MIN_RENDERABLE_MODULE_DOTS) return 'unrenderable';
  if (dots < MIN_RELIABLE_MODULE_DOTS) return 'marginal';
  return 'ok';
}
