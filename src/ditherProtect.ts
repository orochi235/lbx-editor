/**
 * Which parts of the label the dither must leave alone.
 *
 * Dithering is for tone — a photograph has more shades than a thermal head has
 * dots, and trading them for a pattern is the whole point. A barcode has no
 * tone: its geometry *is* the payload, and every dithering algorithm damages
 * it. Error diffusion carries a bar edge's quantization error into the bar
 * beside it; an ordered matrix resolves the same edge black on one row and
 * white on the next, so the bars come out ragged and row-dependent.
 *
 * obwat takes plain rectangles and asks nothing about what's in them
 * (`DitherOptions.protect`). Deciding which objects can't survive a dither is
 * ours: today that's barcodes, and adding hairline rules or small type later
 * is a matter of what this collects.
 *
 * Pure: nodes and geometry in, dot-space rectangles out.
 */
import type { PixelRect } from 'obwat';
import { encodeBarcode, barcodeRequest, quietZonePt } from './barcode';
import type { LabelNodeData, LabelPose } from './label';

interface ProtectableNode {
  pose: LabelPose;
  data: LabelNodeData;
}

interface RenderGeometry {
  /** Printhead-reachable band in pt, from labelRender's `printableBandPt`. */
  band: { y: number };
  dpi: number;
}

/**
 * Regions the dither must render at plain threshold, in the dither's own pixel
 * space: dots along the tape, measured from the top of the printable band —
 * the same origin and scale `labelRenderPlan` renders with.
 *
 * Each barcode's whole pose is protected, plus its quiet zone. The pose
 * includes the human-readable text below the bars, which is small type that
 * gains nothing from a dither either, and the quiet zone keeps the diffuser
 * from dropping a speck into the blank margin a scanner reads as the symbol's
 * edge. Barcodes that don't encode draw as a placeholder box and are skipped —
 * there's no symbol whose geometry needs preserving.
 */
export function protectedRegions(
  nodes: Iterable<ProtectableNode>,
  geometry: RenderGeometry,
): PixelRect[] {
  const scale = geometry.dpi / 72;
  const regions: PixelRect[] = [];
  for (const node of nodes) {
    if (node.data.kind !== 'barcode') continue;
    const symbol = encodeBarcode(barcodeRequest(node.data));
    if (!symbol.ok) continue;

    const { pose } = node;
    const quiet = quietZonePt(symbol, pose);
    regions.push({
      x: (pose.x - quiet) * scale,
      y: (pose.y - geometry.band.y - quiet) * scale,
      width: (pose.width + quiet * 2) * scale,
      height: (pose.height + quiet * 2) * scale,
    });
  }
  return regions;
}
