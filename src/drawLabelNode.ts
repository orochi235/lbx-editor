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
  type View,
} from '@weasel-js/core';
import {
  encodeBarcode,
  barcodeRects,
  barcodeRequest,
  HUMAN_READABLE_HEIGHT_PT,
} from './barcode';
import { substituteFontFamily, toWeaselAlign, toWeaselVerticalAlign } from './fonts';
import { imageDataUri } from './imageUtils';
import { lineEndpoints, type LabelNode, type LabelPose } from './label';

export function drawLabelNode(node: LabelNode, pose: LabelPose, _view: View): DrawCommand[] {
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
          fill: { fill: 'solid', color: data.color },
        },
        width,   // maxWidth: word-wrap at the box
        height,  // box height for verticalAlign
        toWeaselVerticalAlign(data.verticalAlignment),
      )];
    }
    case 'rect':
      return [{
        kind: 'path',
        path: rectPath(x, y, width, height),
        stroke: { paint: { color: data.strokeStyle }, width: data.strokeWidth },
        ...(data.fillColor ? { fill: { fill: 'solid', color: data.fillColor } } : {}),
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
        fill: { fill: 'solid', color: '#f0f0f0' },
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
          fill: { fill: 'solid', color: '#f6f6f6' },
          stroke: { paint: { color: '#999999' }, width: 0.5 },
        }];
      }
      const commands: DrawCommand[] = barcodeRects(symbol, pose, data.humanReadable).map((r) => ({
        kind: 'path',
        path: rectPath(r.x, r.y, r.width, r.height),
        fill: { fill: 'solid', color: '#000000' },
      }));
      if (data.humanReadable && symbol.kind === '1d') {
        commands.push(textCommand(
          x,
          y + height - HUMAN_READABLE_HEIGHT_PT,
          symbol.text,
          {
            fontFamily: substituteFontFamily('Helvetica'),
            fontSize: HUMAN_READABLE_HEIGHT_PT - 1,
            fontWeight: 400,
            fontStyle: 'normal',
            align: toWeaselAlign(data.humanReadableAlignment),
            fill: { fill: 'solid', color: '#000000' },
          },
          width,
          HUMAN_READABLE_HEIGHT_PT,
          toWeaselVerticalAlign('BOTTOM'),
        ));
      }
      return commands;
    }
    default:
      return [];
  }
}
