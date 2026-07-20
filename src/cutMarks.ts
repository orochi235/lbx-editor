/**
 * Cut-mark math: positions along the label (pt) where the printer should cut,
 * turning one document into a strip of labels. Marks come from the Labels
 * control (equal splits) or an imported .lbx cutLine; printing slices the
 * raster into pages at the marks and the cutter fires between pages.
 */
import type { Raster1bpp } from 'obwat';

/** Positions for `labels` equal segments of a label (empty for 0/1). */
export function equalCutMarks(labelLengthPt: number, labels: number): number[] {
  if (labels <= 1 || labelLengthPt <= 0) return [];
  const seg = labelLengthPt / labels;
  return Array.from({ length: labels - 1 }, (_, i) => (i + 1) * seg);
}

/** Slice a print raster into page rasters at the marks (pt → dots at `dpi`).
 *  Marks outside (0, length) and duplicates are dropped; no cuts → [raster]. */
export function sliceRasterAtCuts(
  raster: Raster1bpp,
  marksPt: number[],
  dpi: number,
): Raster1bpp[] {
  const cutDots = [...new Set(marksPt.map((x) => Math.round(x * (dpi / 72))))]
    .filter((d) => d > 0 && d < raster.lineCount)
    .sort((a, b) => a - b);
  if (cutDots.length === 0) return [raster];
  const bounds = [0, ...cutDots, raster.lineCount];
  const pages: Raster1bpp[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const rows = raster.rows.slice(bounds[i]!, bounds[i + 1]!);
    pages.push({ lineBytes: raster.lineBytes, lineCount: rows.length, rows });
  }
  return pages;
}
