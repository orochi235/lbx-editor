import { describe, it, expect } from 'vitest';
import { checkDocument, type CheckedNode, type DocumentGeometry } from './diagnostics';
import type { LabelNodeData } from './label';

// 24mm tape at 180dpi: the head reaches a 128-dot band, centred in 68pt.
const GEOMETRY: DocumentGeometry = {
  labelLengthPt: 200,
  band: { y: 8.4, height: 51.2 },
  dpi: 180,
};

const BARCODE: LabelNodeData = {
  kind: 'barcode',
  protocol: 'CODE128',
  data: '12345678',
  barWidth: 1.2,
  barRatio: '1:3',
  humanReadable: false,
  humanReadableAlignment: 'CENTER',
  checkDigit: false,
  zeroFill: false,
  opaqueBackground: true,
};

const RECT: LabelNodeData = {
  kind: 'rect',
  rounded: false,
  roundness: 0,
  strokeWidth: 1,
  strokeStyle: '#000000',
  fillColor: '#ffffff',
};

function node(id: string, pose: CheckedNode['pose'], data: LabelNodeData): CheckedNode {
  return { id, pose, data };
}

/** Inside the band, well clear of both edges. */
const SAFE = { x: 20, y: 12, width: 120, height: 40 };

describe('barcode size checks', () => {
  it('says nothing about a comfortably sized barcode', () => {
    expect(checkDocument([node('a', SAFE, BARCODE)], GEOMETRY)).toEqual([]);
  });

  it('errors when a module falls under one printer dot', () => {
    const found = checkDocument([node('a', { ...SAFE, width: 20 }, BARCODE)], GEOMETRY);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      nodeId: 'a',
      severity: 'error',
      code: 'barcode-unprintable',
    });
  });

  it('warns when a module renders but is under the scanner minimum', () => {
    // Sized to land between 1 and 2 dots per module.
    const found = checkDocument([node('a', { ...SAFE, width: 55 }, BARCODE)], GEOMETRY);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: 'warning', code: 'barcode-marginal' });
  });

  it('ignores a barcode whose payload does not encode', () => {
    // Reported by the property panel and blocked at print; not a size finding.
    const broken = { ...BARCODE, protocol: 'EAN13', data: 'nope' } as LabelNodeData;
    expect(checkDocument([node('a', SAFE, broken)], GEOMETRY)).toEqual([]);
  });
});

describe('clipping checks', () => {
  it('says nothing about an object inside the printable area', () => {
    expect(checkDocument([node('a', SAFE, RECT)], GEOMETRY)).toEqual([]);
  });

  it('flags an object above the printable band', () => {
    const found = checkDocument([node('a', { ...SAFE, y: 0 }, RECT)], GEOMETRY);
    expect(found[0]).toMatchObject({ code: 'clipped', severity: 'warning' });
    expect(found[0]!.detail).toContain('top');
  });

  it('flags an object past the end of the label', () => {
    const found = checkDocument([node('a', { ...SAFE, x: 150 }, RECT)], GEOMETRY);
    expect(found[0]!.detail).toContain('right');
  });

  it('names every side an object overhangs', () => {
    const big = { x: -5, y: 0, width: 300, height: 90 };
    const detail = checkDocument([node('a', big, RECT)], GEOMETRY)[0]!.detail;
    for (const side of ['top', 'bottom', 'left', 'right']) {
      expect(detail).toContain(side);
    }
  });

  it('tolerates a hairline overhang from float error', () => {
    const flush = { x: 0, y: GEOMETRY.band.y - 0.005, width: 200, height: 51.2 };
    expect(checkDocument([node('a', flush, RECT)], GEOMETRY)).toEqual([]);
  });
});

describe('checkDocument', () => {
  it('reports size and clipping separately for one node', () => {
    const tinyAndOutside = { x: 190, y: 12, width: 20, height: 40 };
    const codes = checkDocument([node('a', tinyAndOutside, BARCODE)], GEOMETRY).map((d) => d.code);
    expect(codes).toContain('barcode-unprintable');
    expect(codes).toContain('clipped');
  });

  it('covers every node', () => {
    const found = checkDocument(
      [node('a', { ...SAFE, y: 0 }, RECT), node('b', { ...SAFE, x: 150 }, RECT)],
      GEOMETRY,
    );
    expect(found.map((d) => d.nodeId)).toEqual(['a', 'b']);
  });
});
