/**
 * Node → draw commands, shared by the on-screen canvas and the print raster:
 * `renderLabelToRgba` takes this as its `drawOne`, so print is the screen's
 * rendering at printer resolution and WYSIWYG holds by construction.
 *
 * Lives outside App.tsx so it can be tested. App.tsx imports obwat, whose dist
 * uses extensionless relative imports that vitest's node resolution can't
 * follow — importing the app from a test fails before any test runs. Nothing
 * here needs obwat.
 */
import {
  getImageBitmap,
  polygonFromPoints,
  rectPath,
  textCommand,
  type DrawCommand,
  type SceneViewDrawOne,
} from '@weasel-js/core';
import {
  encodeBarcode,
  barcodeRects,
  barcodeBackgroundRect,
  barcodeRequest,
  HUMAN_READABLE_HEIGHT_PT,
} from './barcode';
import { substituteFontFamily, toWeaselAlign, toWeaselVerticalAlign } from './fonts';
import { imageDataUri } from './imageUtils';
import { gridAligned, type DotGrid } from './dotSnap';
import { lineEndpoints, type LabelLayer, type LabelNode, type LabelNodeData, type LabelPose } from './label';

/**
 * `options` carries the two colors the *renderer* picks rather than the
 * document: a barcode's bars and its opaque background aren't fields the user
 * sets. Colors the document does carry go the other way, through
 * `remapNodeInk` before this is called. The defaults are the print values, so
 * a call site that forgets the argument prints correctly instead of laying a
 * black box over the label. `grid` is the printer's dot grid, which barcodes
 * are drawn onto (see `gridAligned`).
 */
export function drawLabelNode(
  node: LabelNode,
  pose: LabelPose,
  options: { ink?: string; paper?: string; grid?: DotGrid } = {},
): DrawCommand[] {
  const ink = options.ink ?? '#000000';
  const paper = options.paper ?? '#ffffff';
  const { data } = node;
  const { x, y, width, height } = pose;

  switch (data.kind) {
    case 'text': {
      return [textCommand(
        x,
        y,
        data.text,
        {
          fontFamily: substituteFontFamily(data.fontFamily),
          fontSize: data.fontSize,
          fontWeight: data.fontWeight,
          fontStyle: data.italic ? 'italic' : 'normal',
          align: toWeaselAlign(data.horizontalAlignment),
        },
        width,   // maxWidth: word-wrap at the box
        height,  // box height for verticalAlign
        toWeaselVerticalAlign(data.verticalAlignment),
        { fill: { paint: { color: data.color } } },
      )];
    }
    case 'rect':
      return [{
        kind: 'path',
        path: rectPath(x, y, width, height),
        stroke: { paint: { color: data.strokeStyle }, width: data.strokeWidth },
        ...(data.fillColor ? { fill: { paint: { color: data.fillColor } } } : {}),
      }];
    case 'line': {
      const [p, q] = lineEndpoints({ x, y, width, height }, data.descending);
      return [{
        kind: 'path',
        path: polygonFromPoints([p, q]),
        stroke: { paint: { color: data.strokeStyle }, width: data.strokeWidth },
      }];
    }
    case 'image': {
      // The kit imageCache decodes async; SceneCanvas subscribes to its
      // ready events and redraws, swapping the placeholder for the bitmap.
      const bmp = getImageBitmap(imageDataUri(data));
      if (bmp) {
        return [{ kind: 'image', image: bmp, x, y, w: width, h: height }];
      }
      // Placeholder while loading
      return [{
        kind: 'path',
        path: rectPath(x, y, width, height),
        fill: { paint: { color: '#f0f0f0' } },
        stroke: { paint: { color: '#cccccc' }, width: 0.5 },
      }];
    }
    case 'barcode': {
      const symbol = encodeBarcode(barcodeRequest(data));
      if (!symbol.ok) {
        // Can't encode it — draw a box so the node stays visible and
        // selectable. printPreflight blocks the job rather than printing this.
        return [{
          kind: 'path',
          path: rectPath(x, y, width, height),
          fill: { paint: { color: '#f6f6f6' } },
          stroke: { paint: { color: '#999999' }, width: 0.5 },
        }];
      }
      // Drawn on the dot grid, so every module edge lands between dots.
      const at = options.grid ? gridAligned(pose, options.grid) : pose;
      const commands: DrawCommand[] = [];
      if (data.opaqueBackground) {
        // Under the bars, so it masks whatever is below this node in the scene
        // and nothing above it. Covers the quiet zone as well as the symbol:
        // artwork in the blank margin is read as a bar. In the print raster
        // this is white, which the luminance threshold turns into no dots.
        const bg = barcodeBackgroundRect(symbol, at);
        commands.push({
          kind: 'path',
          path: rectPath(bg.x, bg.y, bg.width, bg.height),
          fill: { paint: { color: paper } },
        });
      }
      for (const r of barcodeRects(symbol, at, data.humanReadable)) {
        commands.push({
          kind: 'path',
          path: rectPath(r.x, r.y, r.width, r.height),
          fill: { paint: { color: ink } },
        });
      }
      if (data.humanReadable && symbol.kind === '1d') {
        commands.push(textCommand(
          at.x,
          at.y + height - HUMAN_READABLE_HEIGHT_PT,
          symbol.text,
          {
            fontFamily: substituteFontFamily('Helvetica'),
            fontSize: HUMAN_READABLE_HEIGHT_PT - 1,
            fontWeight: 400,
            fontStyle: 'normal',
            align: toWeaselAlign(data.humanReadableAlignment),
          },
          width,
          HUMAN_READABLE_HEIGHT_PT,
          toWeaselVerticalAlign('BOTTOM'),
          { fill: { paint: { color: ink } } },
        ));
      }
      return commands;
    }
    default:
      return [];
  }
}

/** The print path's painter: the document's own colors, the print defaults
 *  for the renderer-picked ones, and the raster's dot grid. */
export function printDrawOne(grid: DotGrid): SceneViewDrawOne<LabelNodeData, LabelLayer, LabelPose> {
  return (node, pose) => drawLabelNode(node, pose, { grid });
}
