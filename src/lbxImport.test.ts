import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { buildLbx, TAPE, type BarcodeObject, type LabelConfig } from 'bil-lbx';
import { importLbx } from './lbxImport';
import { exportLbx } from './lbxExport';
import { MIN_LABEL_LENGTH_PT } from './autoLength';
import type { LabelNodeData, LabelPose } from './label';

/**
 * A label shaped the way P-touch Editor writes them: one text object whose
 * right edge lands at `rightEdge`, a background band recording the printable
 * extent, and — under autoLength — the 1000mm placeholder as the paper height.
 *
 * The tape comes from bil-lbx's `TAPE`, keyed by its real name ('12mm'), so a
 * mistyped key is a compile error. Spelling it `TAPE.W24` reads fine, is
 * `undefined`, and used to build a 12mm file regardless of what the test meant.
 */
function label(opts: {
  autoLength: boolean;
  paperHeight: number;
  rightEdge: number;
  bandRight?: number;
  tape?: keyof typeof TAPE;
}): LabelConfig {
  const bandRight = opts.bandRight ?? opts.rightEdge;
  const tape = TAPE[opts.tape ?? '12mm'];
  return {
    paper: {
      width: tape.width,
      format: tape.format,
      height: opts.paperHeight,
      marginLeft: 2.8,
      marginTop: 5.6,
      marginRight: 2.8,
      marginBottom: 5.6,
      orientation: 'landscape',
      autoLength: opts.autoLength,
    },
    // The band is the tape inset 2.8pt top and bottom, so it follows the tape
    // rather than sitting at 12mm's height whatever the fixture asked for.
    background: { x: 5.6, y: 2.8, width: bandRight - 5.6, height: tape.width - 5.6 },
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

  it('builds the tape the fixture asks for', async () => {
    // Guards the fixture itself: a tape that doesn't survive into the file
    // makes every test above quietly measure a 12mm label instead.
    const buf = await buildLbx(
      label({ autoLength: false, paperHeight: 200, rightEdge: 100, tape: '24mm' }),
    );
    const result = await importLbx(toArrayBuffer(buf));

    expect(result.tapeSize).toBe('24mm');
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

describe('barcode objects', () => {
  const barcode: BarcodeObject = {
    type: 'barcode',
    position: { x: 20, y: 4, width: 60, height: 24 },
    protocol: 'CODE128',
    data: 'ABC-123',
    barWidth: 1.2,
    barRatio: '1:3',
    humanReadable: true,
    humanReadableAlignment: 'CENTER',
    checkDigit: false,
    zeroFill: false,
  };

  it('imports a barcode as a node instead of dropping it', async () => {
    const config = label({ autoLength: false, paperHeight: 200, rightEdge: 100 });
    config.objects = [barcode];
    const result = await importLbx(toArrayBuffer(await buildLbx(config)));

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.data).toMatchObject({
      kind: 'barcode',
      protocol: 'CODE128',
      data: 'ABC-123',
      humanReadable: true,
    });
    expect(result.nodes[0]!.pose).toEqual({ x: 20, y: 4, width: 60, height: 24 });
  });

  it('round-trips a barcode back out to .lbx', async () => {
    const config = label({ autoLength: false, paperHeight: 200, rightEdge: 100 });
    config.objects = [barcode];
    const imported = await importLbx(toArrayBuffer(await buildLbx(config)));

    const out = await exportLbx(
      imported.nodes.map((n) => ({ id: n.id, data: n.data, pose: n.pose })),
      '12mm',
      false,
      200,
      [],
    );
    const reimported = await importLbx(toArrayBuffer(out));

    expect(reimported.nodes[0]!.data).toMatchObject({
      kind: 'barcode',
      protocol: 'CODE128',
      data: 'ABC-123',
    });
  });
});
