import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { buildLbx, TAPE, type BarcodeObject, type LabelConfig } from 'bil-lbx';
import { importLbx } from './lbxImport';
import { exportLbx } from './lbxExport';
import { MIN_LABEL_LENGTH_PT } from './autoLength';
import type { LabelBarcodeData, LabelNodeData, LabelPose } from './label';
import { encodeBarcode, barcodeRequest } from './barcode';
import { readFixture } from '../test/fixtures/readFixture';

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

/**
 * The same file, restamped as if another program wrote it. `buildLbx` always
 * writes `generator="bil-lbx"`, so this is how a fixture becomes a P-touch
 * file — or one of our own from before the generator string changed.
 * Pass `null` to drop the attribute entirely.
 */
async function withGenerator(lbx: Uint8Array, generator: string | null): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(lbx);
  const xml = await zip.file('label.xml')!.async('string');
  zip.file('label.xml', xml.replace(
    /\sgenerator="[^"]*"/,
    generator === null ? '' : ` generator="${generator}"`,
  ));
  return toArrayBuffer(await zip.generateAsync({ type: 'uint8array' }));
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

  // Against a file P-touch wrote, not one we built: the whole question is what
  // *its* box means, which a config we hand to buildLbx can't answer.
  it('reads a P-touch QR at the cell size the file states, not 19% larger', async () => {
    // barcodes.lbx's QR: 40pt box, cellSize 1.6pt, 21-module symbol.
    // Taking the box as the symbol gave 40/21 = 1.905pt per module.
    const result = await importLbx(await readFixture('barcodes.lbx'));
    const qr = result.nodes.find((n) => n.data.kind === 'barcode' && n.data.protocol === 'QRCODE');
    expect(qr).toBeDefined();
    expect(qr!.pose.width).toBeCloseTo(33.6, 3); // 21 * 1.6
  });

  /** A one-barcode file carrying `brush`, stamped with `generator`. */
  async function importedWith(
    brush: BarcodeObject['brush'],
    generator: string | null | undefined,
  ) {
    const config = label({ autoLength: false, paperHeight: 200, rightEdge: 100 });
    config.objects = [{ ...barcode, ...(brush ? { brush } : {}) }];
    const bytes = await buildLbx(config);
    // undefined = leave buildLbx's own stamp ("bil-lbx") alone.
    const file = generator === undefined
      ? toArrayBuffer(bytes)
      : await withGenerator(bytes, generator);
    return (await importLbx(file)).nodes[0]!.data;
  }

  describe('the opaque background', () => {
    // The brush encodes it, but only a file we wrote means anything by it:
    // P-touch stamps `style="NULL"` on every barcode it authors and draws them
    // opaque regardless, so reading NULL as "off" there would import every
    // P-touch barcode transparent.
    it('reads a solid brush as on, in a file we wrote', async () => {
      expect(await importedWith({ style: 'SOLID', color: '#FFFFFF' }, undefined))
        .toMatchObject({ opaqueBackground: true });
    });

    it('reads a null brush as off, in a file we wrote', async () => {
      expect(await importedWith({ style: 'NULL' }, undefined))
        .toMatchObject({ opaqueBackground: false });
    });

    it('treats an absent brush as off in our file, as the serializer makes it NULL', async () => {
      expect(await importedWith(undefined, undefined))
        .toMatchObject({ opaqueBackground: false });
    });

    it('keeps a P-touch barcode opaque despite its boilerplate null brush', async () => {
      expect(await importedWith({ style: 'NULL' }, 'com.brother.PtouchEditor'))
        .toMatchObject({ opaqueBackground: true });
    });

    it('keeps a barcode from an unknown program opaque', async () => {
      expect(await importedWith(undefined, null))
        .toMatchObject({ opaqueBackground: true });
    });

    // The one that isn't obvious. Files we wrote before this shipped are
    // stamped `brother-lbx` — bil-lbx's former name — and carry no brush at
    // all, because the exporter didn't write one yet. Counting that string as
    // ours would read every one of them as "off" and reopen a barcode
    // transparent over its artwork: the exact failure the background prevents.
    // Files written by the editor *with* a deliberate brush but an old bil-lbx
    // share that stamp and are indistinguishable, so they lose their "off" —
    // which is the direction that's safe to lose.
    it('keeps a barcode from our own older files opaque', async () => {
      expect(await importedWith({ style: 'NULL' }, 'brother-lbx'))
        .toMatchObject({ opaqueBackground: true });
    });

    it('survives an export and reimport in both directions', async () => {
      for (const opaqueBackground of [true, false]) {
        const imported = await importedWith({ style: 'SOLID', color: '#FFFFFF' }, undefined);
        if (imported.kind !== 'barcode') throw new Error('fixture should import as a barcode');
        const out = await exportLbx(
          [{ id: 'n1', data: { ...imported, opaqueBackground }, pose: { x: 20, y: 4, width: 60, height: 24 } }],
          '12mm',
          false,
          200,
          [],
        );
        const reimported = await importLbx(toArrayBuffer(out));
        expect(reimported.nodes[0]!.data).toMatchObject({ opaqueBackground });
      }
    });
  });
});

/**
 * The one test in the 2D work that checks our reading of a file we did not
 * write. `barcode2.lbx` was authored in P-touch Editor against a PT-P710BT, and
 * every measurement behind `poseBox.ts` came from it — so it is also the only
 * place those measurements can be wrong in a way our own construction wouldn't
 * hide.
 *
 * What the file actually contains, in object order: three DataMatrix (cellSize
 * 1.6, 2.4, 1.6 — boxes 25.6, 38.4, 25.6, i.e. 16 cells each for a 12-module
 * symbol), two PDF417 (pdf417Style width 0.8 and 1.2 — boxes 85.6 and 128.4,
 * i.e. 107 modules each for a 103-module symbol), and three GS1 DataBar stamped
 * as protocol `RSS`.
 */
describe('barcode2.lbx, authored in P-touch Editor', () => {
  /** The file's barcodes, narrowed, in the order the file lists them. */
  async function barcodesOf(file: ArrayBuffer) {
    const result = await importLbx(file);
    return result.nodes.flatMap((n) =>
      n.data.kind === 'barcode' ? [{ ...n, data: n.data as LabelBarcodeData }] : [],
    );
  }

  it('reads each 2D barcode at the module size the file states', async () => {
    const barcodes = await barcodesOf(await readFixture('barcode2.lbx'));

    // Three DataMatrix at cellSize 1.6, 2.4, 1.6 — all 12-module symbols.
    const dm = barcodes.filter((n) => n.data.protocol === 'DATAMATRIX');
    expect(dm).toHaveLength(3);
    expect(dm.map((n) => Number((n.pose.width / 12).toFixed(4)))).toEqual([1.6, 2.4, 1.6]);
    // Square symbols: the height has to come out the same or the box's quiet
    // zone was stripped off one axis only.
    expect(dm.map((n) => Number((n.pose.height / 12).toFixed(4)))).toEqual([1.6, 2.4, 1.6]);

    // Two PDF417 at width 0.8 and 1.2 — both 103 modules across.
    const pdf = barcodes.filter((n) => n.data.protocol === 'PDF417');
    expect(pdf).toHaveLength(2);
    expect(pdf.map((n) => Number((n.pose.width / 103).toFixed(4)))).toEqual([0.8, 1.2]);
  });

  it('carries the row aspect P-touch recorded', async () => {
    const barcodes = await barcodesOf(await readFixture('barcode2.lbx'));
    const pdf = barcodes.find((n) => n.data.protocol === 'PDF417');

    expect(pdf?.data.pdf417?.aspect).toBe(3);
  });

  it('leaves the DataBar objects unsupported rather than mis-drawn', async () => {
    // P-touch stamps GS1 DataBar as `RSS`; we don't encode it, and the honest
    // answer is a refusal. A box left uninset would be the alternative failure:
    // drawing *something* at a size we invented.
    const barcodes = await barcodesOf(await readFixture('barcode2.lbx'));
    const rss = barcodes.filter((n) => n.data.protocol === 'RSS');

    expect(rss).toHaveLength(3);
    for (const node of rss) {
      expect(encodeBarcode(barcodeRequest(node.data))).toMatchObject({
        ok: false,
        reason: 'unsupported',
      });
    }
  });

  it('round-trips every barcode’s pose back through a real P-touch file', async () => {
    // Stronger than the synthetic round trip above: import → export → import on
    // a file we didn't author. Import strips 2 modules of quiet zone per side
    // and export puts them back, so a disagreement between the two shows up
    // here as a pose that drifts by four modules per pass.
    const before = await barcodesOf(await readFixture('barcode2.lbx'));
    const out = await exportLbx(
      before.map((n) => ({ id: n.id, data: n.data, pose: n.pose })),
      '24mm',
      true,
      640,
      [],
    );
    const after = await barcodesOf(toArrayBuffer(out));

    expect(after.map((n) => n.data.protocol)).toEqual(before.map((n) => n.data.protocol));
    for (const [i, node] of after.entries()) {
      const original = before[i]!;
      // Close rather than exact: the inset goes out and comes back through
      // floating-point, so a height lands at 16.800000000000004. The drift this
      // guards against is four modules — 3.2pt on the smallest symbol here.
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        expect(node.pose[key], `${node.data.protocol} ${key}`).toBeCloseTo(original.pose[key], 9);
      }
    }
  });
});

/**
 * Node order is stacking order — the canvas draws the array front to back and
 * `sceneToLbxConfig` writes it back out the same way — so an import that
 * reorders nodes restacks the label and then saves the restacking.
 *
 * This is the app's stake in bil-lbx returning `objects` in document order
 * (fixed in the parser, which used to group them by element name). The failure
 * it guards is the one the opaque background exists for: a barcode drawn over
 * an image, reopened underneath it, printing the artwork through the bars.
 */
describe('object stacking order', () => {
  const stacked: LabelConfig = {
    paper: { width: TAPE['24mm'].width, format: TAPE['24mm'].format, height: 200, autoLength: false },
    objects: [
      { type: 'rect', position: { x: 0, y: 4, width: 60, height: 40 } },
      {
        type: 'text',
        position: { x: 8, y: 8, width: 40, height: 12 },
        font: { name: 'Arial', size: 8 },
        data: 'over',
      },
      { type: 'barcode', position: { x: 70, y: 8, width: 60, height: 30 }, protocol: 'CODE128', data: 'TOP' },
    ],
  };

  it('imports nodes in the order the file stacks them', async () => {
    const result = await importLbx(toArrayBuffer(await buildLbx(stacked)));
    expect(result.nodes.map((n) => n.data.kind)).toEqual(['rect', 'text', 'barcode']);
  });

  it('keeps that order through an export', async () => {
    const imported = await importLbx(toArrayBuffer(await buildLbx(stacked)));
    const bytes = await exportLbx(imported.nodes, imported.tapeSize, imported.autoLength, imported.labelLength);
    const reimported = await importLbx(toArrayBuffer(bytes));
    expect(reimported.nodes.map((n) => n.data.kind)).toEqual(['rect', 'text', 'barcode']);
  });
});
