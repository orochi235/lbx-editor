import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { buildLbx, type LabelConfig } from 'bil-lbx';
import { importLbx } from './lbxImport';
import { exportLbx } from './lbxExport';
import { MIN_LABEL_LENGTH_PT } from './autoLength';
import type { LabelNodeData, LabelPose } from './label';

/**
 * A 12mm label shaped the way P-touch Editor writes them: one text object whose
 * right edge lands at `rightEdge`, a background band recording the printable
 * extent, and — under autoLength — the 1000mm placeholder as the paper height.
 */
function label(opts: {
  autoLength: boolean;
  paperHeight: number;
  rightEdge: number;
  bandRight?: number;
}): LabelConfig {
  const bandRight = opts.bandRight ?? opts.rightEdge;
  return {
    paper: {
      width: 33.6,
      height: opts.paperHeight,
      marginLeft: 2.8,
      marginTop: 5.6,
      marginRight: 2.8,
      marginBottom: 5.6,
      orientation: 'landscape',
      autoLength: opts.autoLength,
    },
    background: { x: 5.6, y: 2.8, width: bandRight - 5.6, height: 28 },
    objects: [
      {
        type: 'text',
        position: { x: 5.5, y: 6.3, width: opts.rightEdge - 5.5, height: 23.4 },
        data: 'hello',
        font: { name: 'Arial', size: 8 },
      },
    ],
  };
}

/** The same file with its style:backGround element removed. */
async function stripBackground(lbx: Uint8Array): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(lbx);
  const xml = await zip.file('label.xml')!.async('string');
  zip.file('label.xml', xml.replace(/<style:backGround[^>]*><\/style:backGround>/, ''));
  const out = await zip.generateAsync({ type: 'uint8array' });
  return toArrayBuffer(out);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('importLbx label length', () => {
  it('reads the recorded band, not the placeholder, for an auto-length file', async () => {
    // The failure this guards: P-touch stores height="2834.4pt" (1000mm, the
    // auto-length ceiling) as a placeholder, and taking it literally loaded a
    // 1-meter label — ~20x too long.
    const buf = await buildLbx(label({ autoLength: true, paperHeight: 2834.4, rightEdge: 139.8 }));
    const result = await importLbx(toArrayBuffer(buf));

    expect(result.autoLength).toBe(true);
    expect(result.labelLength).toBeCloseTo(145.4, 6);
  });

  it('trusts the band over our own content extent', async () => {
    // Real files disagree: "Lego icon labels - Food" records a band ending
    // 2.4pt past its rightmost object. Fitting our content would print short.
    const buf = await buildLbx(
      label({ autoLength: true, paperHeight: 2834.4, rightEdge: 154.7, bandRight: 157.1 }),
    );
    const result = await importLbx(toArrayBuffer(buf));

    expect(result.labelLength).toBeCloseTo(162.7, 6);
  });

  it('keeps the recorded length for a fixed-length file', async () => {
    const buf = await buildLbx(label({ autoLength: false, paperHeight: 200, rightEdge: 139.8 }));
    const result = await importLbx(toArrayBuffer(buf));

    expect(result.autoLength).toBe(false);
    expect(result.labelLength).toBeCloseTo(200, 6);
  });

  it('fits to content when the file records no band', async () => {
    const buf = await buildLbx(label({ autoLength: true, paperHeight: 2834.4, rightEdge: 139.8 }));
    const result = await importLbx(await stripBackground(buf));

    expect(result.labelLength).toBeCloseTo(145.4, 6);
  });

  it('falls back to the minimum for an empty, band-less auto-length file', async () => {
    const config = label({ autoLength: true, paperHeight: 2834.4, rightEdge: 139.8 });
    config.objects = [];
    const result = await importLbx(await stripBackground(await buildLbx(config)));

    expect(result.labelLength).toBe(MIN_LABEL_LENGTH_PT);
  });
});

describe('export → import round trip', () => {
  const node = (pose: LabelPose): { id: string; data: LabelNodeData; pose: LabelPose } => ({
    id: 'n1',
    pose,
    data: {
      kind: 'rect',
      rounded: false,
      roundness: 0,
      strokeStyle: '#000000',
      strokeWidth: 0.5,
      fillColor: null,
    },
  });

  async function roundTrip(autoLength: boolean, labelLength: number) {
    const buf = await exportLbx([node({ x: 5.6, y: 2.8, width: 100, height: 28 })], '12mm', autoLength, labelLength, []);
    return importLbx(toArrayBuffer(buf));
  }

  it('preserves an auto-length label’s length', async () => {
    // The length has nowhere to live but the background band under auto —
    // dropping it made our own exports reimport at the 1000mm placeholder.
    const result = await roundTrip(true, 145.4);

    expect(result.autoLength).toBe(true);
    expect(result.labelLength).toBeCloseTo(145.4, 6);
  });

  it('preserves a fixed-length label’s length', async () => {
    const result = await roundTrip(false, 200);

    expect(result.autoLength).toBe(false);
    expect(result.labelLength).toBeCloseTo(200, 6);
  });
});
