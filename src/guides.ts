/** Dashed on-canvas guides. Screen-only: none of them reach print. */
import { polygonFromPoints, type DrawCommand } from '@weasel-js/core';

const DASH = [2, 2];
const WIDTH = 0.4;

function dashed(color: string, a: { x: number; y: number }, b: { x: number; y: number }): DrawCommand {
  return {
    kind: 'path',
    path: polygonFromPoints([a, b]),
    stroke: { paint: { color }, width: WIDTH, dash: DASH },
  };
}

/** Where the printer cuts the strip. */
export function cutGuides(cutMarks: readonly number[], tapeWidthPt: number): DrawCommand[] {
  return cutMarks.map((x) => dashed('#e03131', { x, y: 0 }, { x, y: tapeWidthPt }));
}

/** The top and bottom edges of the band the printhead can reach. */
export function printableMarginGuides(
  band: { y: number; height: number },
  lengthPt: number,
): DrawCommand[] {
  return [band.y, band.y + band.height].map((y) =>
    dashed('#1c7ed6', { x: 0, y }, { x: lengthPt, y }),
  );
}
