/**
 * The barcode's two colors are renderer-picked, not document-stored: the bars
 * are ink, the background is paper, and neither is a field the user sets. They
 * arrive through drawLabelNode's `colors` parameter, whose defaults are the
 * print values — so a call site that forgets the argument prints correctly
 * rather than printing a black box over the label.
 */
import { describe, it, expect } from 'vitest';
import { asNodeId, type DrawCommand, type View } from '@weasel-js/core';
import { drawLabelNode } from './drawLabelNode';
import { encodeBarcode, barcodeRequest, barcodeBackgroundRect } from './barcode';
import type { LabelBarcodeData, LabelNode, LabelPose } from './label';

const pose: LabelPose = { x: 20, y: 12, width: 60, height: 24 };

const barcodeData: LabelBarcodeData = {
  kind: 'barcode',
  protocol: 'CODE128',
  data: 'SHELF-42',
  barWidth: 0.3,
  barRatio: '1:3',
  humanReadable: false,
  humanReadableAlignment: 'CENTER',
  checkDigit: false,
  zeroFill: false,
  opaqueBackground: true,
};

const node = (over: Partial<LabelBarcodeData> = {}): LabelNode => ({
  kind: 'leaf',
  id: asNodeId('n1'),
  layer: 'objects',
  parent: null,
  pose,
  data: { ...barcodeData, ...over },
});

/** Solid-fill colors, in paint order. `'color' in fill` is the narrowing that
 *  works: FillStyle's solid variant leaves `fill` optional. */
function fills(commands: DrawCommand[]): string[] {
  return commands.flatMap((c) =>
    c.kind === 'path' && c.fill && 'color' in c.fill ? [c.fill.color] : [],
  );
}

// drawLabelNode ignores its view argument (`_view`).
const view = {} as View;

describe('drawLabelNode, barcode colors', () => {
  it('defaults to black bars on a white background', () => {
    const painted = fills(drawLabelNode(node(), pose, view));

    // The background is first, so it paints under the bars.
    expect(painted[0]).toBe('#ffffff');
    expect(new Set(painted.slice(1))).toEqual(new Set(['#000000']));
  });

  it('uses the cassette ink and tape colors when given them', () => {
    const painted = fills(
      drawLabelNode(node(), pose, view, { ink: '#2149c0', paper: '#f7d117' }),
    );

    expect(painted[0]).toBe('#f7d117');
    expect(new Set(painted.slice(1))).toEqual(new Set(['#2149c0']));
  });

  it('draws no background when the flag is off', () => {
    const painted = fills(drawLabelNode(node({ opaqueBackground: false }), pose, view));

    expect(new Set(painted)).toEqual(new Set(['#000000']));
  });

  it('covers exactly the pose plus its quiet zone', () => {
    const symbol = encodeBarcode(barcodeRequest(barcodeData));
    if (!symbol.ok) throw new Error('fixture should encode');
    const expected = barcodeBackgroundRect(symbol, pose);

    const [background] = drawLabelNode(node(), pose, view);
    // rectPath returns the RectPath fast-path subtype, which carries
    // x/y/width/height directly rather than a point list.
    if (background?.kind !== 'path' || background.path.kind !== 'rect') {
      throw new Error('expected a rect path');
    }
    const { x, y, width, height } = background.path;
    expect({ x, y, width, height }).toEqual(expected);

    // And that really is bigger than the pose, on every side.
    expect(x).toBeLessThan(pose.x);
    expect(y).toBeLessThan(pose.y);
    expect(x + width).toBeGreaterThan(pose.x + pose.width);
    expect(y + height).toBeGreaterThan(pose.y + pose.height);
  });

  it('inks the human-readable band too, not just the bars', () => {
    // A text command keeps its color on each run, not in a path fill, so
    // `fills` above can't see this one — and without its own assertion the
    // band could go back to hardcoded black with every other test still green.
    const commands = drawLabelNode(
      node({ humanReadable: true }), pose, view, { ink: '#2149c0', paper: '#f7d117' },
    );
    const text = commands.find((c) => c.kind === 'text');
    if (text?.kind !== 'text') throw new Error('expected a text command');

    expect(text.runs.map((r) => r.fill)).toEqual(
      text.runs.map(() => ({ fill: 'solid', color: '#2149c0' })),
    );
  });

  it('gives an unencodable barcode a placeholder, never a background', () => {
    // No symbol means no quiet zone to compute, and printPreflight blocks the
    // job anyway. A paper-colored rect here would mask artwork for a barcode
    // that is never going to print.
    const painted = fills(
      drawLabelNode(
        node({ protocol: 'EAN13', data: 'nope' }), pose, view, { ink: '#2149c0', paper: '#f7d117' },
      ),
    );

    expect(painted).toEqual(['#f6f6f6']);
  });

  it('backs a 2d symbol as well as a 1d one', () => {
    const qr = node({ protocol: 'QRCODE', data: 'https://example.com', humanReadable: false });
    const painted = fills(drawLabelNode(qr, pose, view, { ink: '#2149c0', paper: '#f7d117' }));

    expect(painted[0]).toBe('#f7d117');
    expect(new Set(painted.slice(1))).toEqual(new Set(['#2149c0']));
  });
});
