import { rectPath, polygonFromPoints, type RenderLayer } from '@weasel-js/core';
import { printsAsInk } from './tapeColors';
import { cutGuides, printableMarginGuides } from './guides';

/** The paper layer extrudes its black brick shadow this far down-right of
 *  the tape rect (see `paperLayer`). Fit/center math counts it as content. */
export function paperShadowDepth(paperHeight: number): number {
  return paperHeight * 0.08;
}

// The full drawn footprint of the tape: paper rect + brick shadow.
export function paperBounds(paperWidth: number, paperHeight: number) {
  const depth = paperShadowDepth(paperHeight);
  return { x: 0, y: 0, width: paperWidth + depth, height: paperHeight + depth };
}

interface PaperLayerArgs {
  /** The drawn length, which follows a drag in flight. */
  displayLength: number;
  /** The committed length. */
  paperWidth: number;
  paperHeight: number;
  tapeCss: string;
  tapeClear: boolean;
  previewBitmap: ImageBitmap | null;
  printableBand: { y: number; height: number };
  cutMarks: number[];
  marginGuides: boolean;
}

/**
 * The tape, drawn as a black "raised brick": the shadow is the tape's
 * rectangle extruded down-right by `depth`, connected to the tape by diagonal
 * side edges instead of floating behind it. Only the visible L-shaped shadow
 * region is filled (not the front face), so a translucent face — clear tape —
 * shows the canvas background through the strip. The tape face (with a black
 * border) sits on top. Everything is in world units so it scales and pans with
 * the paper; `depth` is keyed to the tape width to stay proportional across
 * tape sizes.
 */
export function paperLayer({
  displayLength, paperWidth, paperHeight, tapeCss, tapeClear, previewBitmap, printableBand,
  cutMarks, marginGuides,
}: PaperLayerArgs): RenderLayer<unknown> {
  const depth = paperShadowDepth(paperHeight);
  // The brick silhouette minus the front face, sprung from the face
  // stroke's OUTER boundary (the rect expanded by half the stroke width):
  // attaching at the rect edge instead would leave the stroke's outer half
  // poking past the top-right diagonal as a barb. From the outline's
  // top-right, out to the back face's top-right, around its right +
  // bottom, back to the outline's bottom-left, then along the outline's
  // bottom and right edges.
  const strokeW = 0.5;
  const s = strokeW / 2;
  const x0 = -s;
  const y0 = -s;
  const x1 = displayLength + s;
  const y1 = paperHeight + s;
  const shadow = polygonFromPoints([
    { x: x1, y: y0 },
    { x: x1 + depth, y: y0 + depth },
    { x: x1 + depth, y: y1 + depth },
    { x: x0 + depth, y: y1 + depth },
    { x: x0, y: y1 },
    { x: x1, y: y1 },
  ]);
  return {
    id: 'paper',
    label: 'Label tape',
    draw: () => [
      {
        kind: 'path',
        path: shadow,
        fill: { paint: { color: '#000000' } },
      },
      {
        kind: 'path',
        path: rectPath(0, 0, displayLength, paperHeight),
        fill: { paint: { color: tapeCss, opacity: tapeClear ? 0.45 : 1 } },
        // A dark tape face would vanish against its black brick — lighten
        // the border so the tape edge stays readable.
        stroke: { paint: { color: printsAsInk(tapeCss) ? '#888888' : '#000000' }, width: strokeW },
      },
      // Dithered print preview: the print pipeline's ink dots over the
      // printable band (scene content is suppressed while this is up).
      // Pinned to committed geometry, not the display pair — it's a render
      // of the committed scene, so it goes briefly stale during a gesture
      // and refreshes on commit.
      ...(previewBitmap
        ? [{
            kind: 'image' as const,
            image: previewBitmap,
            x: 0,
            y: printableBand.y,
            w: paperWidth,
            h: printableBand.height,
          }]
        : []),
      // Guides last, so they stay visible over the print preview.
      ...(marginGuides ? printableMarginGuides(printableBand, displayLength) : []),
      ...cutGuides(cutMarks, paperHeight),
    ],
  };
}
