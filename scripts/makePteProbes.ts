/**
 * Generate probe `.lbx` files to round-trip through P-touch Editor.
 *
 * Every geometry claim this app makes about `.lbx` was measured in one
 * direction only — reading files P-touch wrote. The write direction is
 * inferred by inverting that measurement, and inference is not evidence:
 * `lbxExport.ts` says so out loud about the barcode brush ("P-touch may or may
 * not honor a brush on a barcode — unverified"), and the same gap sits under
 * the 2D box conversion, the per-symbology module-size attributes, and the
 * PDF417 row/column pin.
 *
 * Each probe isolates one such claim in its own file, so a file P-touch
 * refuses to open takes only its own question down with it. Symbols are sized
 * so one module is a round number of points, and a hairline frame is drawn a
 * fixed 5pt outside the pose we believe the ink occupies — P-touch draws a
 * rect from its own box with no convention in between, which makes it the
 * ruler the barcode is read against. Everything is placed inside the 24mm
 * tape's printable band, so a symbol that overhangs after the round-trip means
 * P-touch moved it.
 *
 * Run: npx vite-node scripts/makePteProbes.ts
 * Files land in `pte-probes/` alongside a README of expected values.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { buildLbx } from 'bil-lbx';
import { sceneToLbxConfig } from '../src/lbxExport';
import { importLbx } from '../src/lbxImport';
import { encodeBarcode, barcodeRequest } from '../src/barcode';
import type { LabelBarcodeData, LabelNodeData, LabelPose, TapeSize } from '../src/label';

interface Node {
  id: string;
  data: LabelNodeData;
  pose: LabelPose;
}

const OUT = new URL('../pte-probes/', import.meta.url);

/** The 24mm tape, in the units the scene uses. `y` runs across the tape. */
const TAPE: TapeSize = '24mm';
const TAPE_PT = 68;
/** The centered printable band on a 24mm tape — 128 dots at 180dpi. */
const BAND_PT = 51.2;
const BAND_TOP = (TAPE_PT - BAND_PT) / 2;
const BAND_MID = TAPE_PT / 2;

let seq = 0;
const id = () => `probe-${++seq}`;

/** Round to a thousandth of a point. Coordinates are accumulated by adding
 *  module sizes, and binary floats turn 179.4 into 179.39999999999998 — a
 *  number P-touch has no reason to like and a reader has no reason to trust. */
const round = (n: number) => Math.round(n * 1000) / 1000;

const roundPose = (p: LabelPose): LabelPose => ({
  x: round(p.x),
  y: round(p.y),
  width: round(p.width),
  height: round(p.height),
});

type BarcodeSpec = Partial<LabelBarcodeData> & {
  protocol: LabelBarcodeData['protocol'];
  data: string;
};

function barcodeData(spec: BarcodeSpec): LabelBarcodeData {
  return {
    kind: 'barcode',
    barWidth: 1.2,
    barRatio: '1:3',
    humanReadable: false,
    humanReadableAlignment: 'CENTER',
    checkDigit: false,
    zeroFill: false,
    opaqueBackground: true,
    ...spec,
  };
}

const barcode = (pose: LabelPose, spec: BarcodeSpec): Node => ({
  id: id(),
  pose: roundPose(pose),
  data: barcodeData(spec),
});

/**
 * How far outside the symbol the ruler frame sits.
 *
 * Drawn *at* the symbol's own edge the frame is unreadable: a correct symbol
 * hides it under its outermost modules, which is the same picture as a frame
 * that was never drawn. Held off by a gap, correctness becomes something with
 * a shape — an even border all the way round — and any error in the drawn size
 * eats into one side of it before it eats into the other.
 *
 * 5pt clears the 2-module object box at every module size these probes use, so
 * the frame can never be mistaken for the box P-touch draws around a selection.
 */
const RULER_GAP_PT = 5;

/**
 * A hairline frame held `RULER_GAP_PT` outside `pose` — the ruler a symbol is
 * read against. P-touch draws a rect straight from its own box with no
 * convention in between, which is what makes it a ruler and not another
 * reading of the same guess.
 *
 * The barcode beside it turns its opaque background **off**, which is not a
 * question these probes ask but is the only way the ruler survives to be read.
 * An opaque background covers the symbol and its quiet zone, which for a QR is
 * 4 modules and reaches past this gap; whichever of the two a renderer draws
 * second then hides the other, and the two renderers disagree about which that
 * is. P-touch follows document order, where the ruler is written last, while
 * bil-lbx's parser returns objects grouped by type and lands the rects
 * underneath. With no fill there is nothing to hide behind.
 */
const ruler = (pose: LabelPose): Node => ({
  id: id(),
  pose: roundPose({
    x: pose.x - RULER_GAP_PT,
    y: pose.y - RULER_GAP_PT,
    width: pose.width + 2 * RULER_GAP_PT,
    height: pose.height + 2 * RULER_GAP_PT,
  }),
  data: { kind: 'rect', rounded: false, roundness: 0, strokeStyle: '#000000', strokeWidth: 0.25, fillColor: null },
});

const caption = (pose: LabelPose, text: string): Node => ({
  id: id(),
  pose: roundPose(pose),
  data: {
    kind: 'text',
    text,
    fontFamily: 'Arial',
    fontSize: 6,
    fontWeight: 400,
    italic: false,
    horizontalAlignment: 'LEFT',
    verticalAlignment: 'TOP',
    color: '#000000',
  },
});

/**
 * A solid black band, built from a zero-height line with a fat pen.
 *
 * A rect would be an outline: this app's rect carries no fill, and export
 * writes no brush for one. A line's pen width is its thickness, so this is the
 * only ink a probe can lay down without embedding a bitmap.
 */
const inkBand = (x: number, width: number, y: number, thickness: number): Node => ({
  id: id(),
  pose: roundPose({ x, y, width, height: 0 }),
  data: { kind: 'line', strokeStyle: '#000000', strokeWidth: thickness, descending: true },
});

interface Placed {
  node: Node;
  ruler: Node;
  pose: LabelPose;
  cols: number;
  rows: number;
}

/**
 * A 2D barcode sized so one module is exactly `modulePt`, centered across the
 * tape.
 *
 * `barcodeModulePt` is `min(width / cols, height / (rows * rowHeight))`, so a
 * pose of exactly that shape makes the module size we export a round number
 * instead of whatever a hand-picked box happens to divide into.
 */
function place2d(x: number, modulePt: number, spec: BarcodeSpec): Placed {
  const encoded = encodeBarcode(barcodeRequest(barcodeData(spec)));
  if (!encoded.ok || encoded.kind !== '2d') {
    throw new Error(`${spec.protocol} "${spec.data}": ${encoded.ok ? `encoded as ${encoded.kind}` : encoded.detail}`);
  }
  const width = encoded.cols * modulePt;
  const height = encoded.rows * encoded.rowHeightModules * modulePt;
  const pose = roundPose({ x, y: BAND_MID - height / 2, width, height });
  const measured = { opaqueBackground: false, ...spec };
  return { node: barcode(pose, measured), ruler: ruler(pose), pose, cols: encoded.cols, rows: encoded.rows };
}

/** A 1D barcode sized so one narrow module is exactly `modulePt`. */
function place1d(x: number, heightPt: number, modulePt: number, spec: BarcodeSpec): Placed & { modules: number } {
  const encoded = encodeBarcode(barcodeRequest(barcodeData(spec)));
  if (!encoded.ok || encoded.kind !== '1d') {
    throw new Error(`${spec.protocol} "${spec.data}": ${encoded.ok ? `encoded as ${encoded.kind}` : encoded.detail}`);
  }
  const pose = roundPose({
    x,
    y: BAND_MID - heightPt / 2,
    width: encoded.totalModules * modulePt,
    height: heightPt,
  });
  // Same reason as `place2d`: the ruler has to outlive the symbol's fill. A
  // probe that means to ask about the brush states it and wins the spread.
  const measured = { opaqueBackground: false, ...spec };
  return {
    node: barcode(pose, measured),
    ruler: ruler(pose),
    pose,
    cols: encoded.totalModules,
    rows: 1,
    modules: encoded.totalModules,
  };
}

/** The object box a 2D pose exports to — the symbol plus 2 modules per side. */
const boxOf = (pose: LabelPose, modulePt: number) => ({
  x: round(pose.x - 2 * modulePt),
  y: round(pose.y - 2 * modulePt),
  width: round(pose.width + 4 * modulePt),
  height: round(pose.height + 4 * modulePt),
});

/** Where the next symbol starts: clear of whichever of the ruler frame and the
 *  object box reaches further right, plus a gap wide enough that two frames
 *  never read as one. */
const advance = (pose: LabelPose, box: { x: number; width: number }) =>
  round(Math.max(box.x + box.width, pose.x + pose.width + RULER_GAP_PT) + 14);

interface Probe {
  file: string;
  question: string;
  look: string[];
  expect: string[];
  nodes: Node[];
  autoLength?: boolean;
  length: number;
}

const probes: Probe[] = [];

// ---------------------------------------------------------------- 01 QR ----
{
  const nodes: Node[] = [caption({ x: 4, y: 10, width: 78, height: 34 }, '01 QR cell size\n1.0 / 1.2 / 1.6pt\nframe = symbol + 5pt')];
  const expect: string[] = [];
  let x = 88;
  for (const m of [1.0, 1.2, 1.6]) {
    const p = place2d(x, m, { protocol: 'QRCODE', data: 'PROBE-QR-GEOMETRY', qrCode: { eccLevel: '15%', version: 'auto' } });
    const box = boxOf(p.pose, m);
    nodes.push(p.node, p.ruler);
    expect.push(
      `cellSize=${m}: ${p.cols}x${p.cols} modules — symbol ${round(p.pose.width)}pt square, ` +
        `object box ${box.width}pt square at x=${box.x}, y=${box.y}`,
    );
    x = advance(p.pose, box);
  }
  probes.push({
    file: '01-qr-geometry.lbx',
    question:
      'Does P-touch redraw a QR at the qrcodeStyle cellSize we export, and is its object box the symbol plus a flat 2 modules per side?',
    look: [
      'each QR should sit centered in its hairline frame with an even 5pt border all the way round',
      'a border thicker on one side than the other means the symbol is not the size we asked for',
      'the three should step 1.0 : 1.2 : 1.6 in size',
      'after Save As, compare objectStyle width against the box figures below',
    ],
    expect,
    nodes,
    length: x + 8,
  });
}

// -------------------------------------------------------- 02 DataMatrix ----
{
  const nodes: Node[] = [caption({ x: 4, y: 10, width: 78, height: 34 }, '02 DataMatrix\ncell 1.4 / 2.0 / 2.4pt\nframe = symbol + 5pt')];
  const expect: string[] = [];
  let x = 88;
  for (const m of [1.4, 2.0, 2.4]) {
    const p = place2d(x, m, { protocol: 'DATAMATRIX', data: 'PROBE-DM', dataMatrix: { model: 'square' } });
    const box = boxOf(p.pose, m);
    nodes.push(p.node, p.ruler);
    expect.push(
      `cellSize=${m}: ${p.cols}x${p.cols} modules — symbol ${round(p.pose.width)}pt square, ` +
        `object box ${box.width}pt square at x=${box.x}, y=${box.y}`,
    );
    x = advance(p.pose, box);
  }
  probes.push({
    file: '02-datamatrix-geometry.lbx',
    question:
      'The same question for DataMatrix, whose cell size lives in barcode:datamatrixStyle — an element bil-lbx only learned to write in 0.3.0, so nothing has ever read one back from P-touch after we wrote it.',
    look: [
      'each symbol should sit centered in its hairline frame with an even 5pt border all the way round',
      'a symbol drawn 33% larger — the frame gone or overrun on a 12-module symbol — would mean P-touch reads the box as symbol-plus-quiet-zone where we wrote symbol-only',
    ],
    expect,
    nodes,
    length: x + 8,
  });
}

// ------------------------------------------------------------ 03 PDF417 ----
{
  // Same payload, two column counts we pinned ourselves. If P-touch honors the
  // pin the two symbols are visibly different shapes; if it re-runs its own
  // automatic layout they come back identical, and every PDF417 we export
  // reopens at a size we did not choose.
  const nodes: Node[] = [caption({ x: 4, y: 10, width: 78, height: 34 }, '03 PDF417\ncolumn=2 then 4\nframe = symbol + 5pt')];
  const expect: string[] = [];
  let x = 88;
  for (const columns of [2, 4]) {
    const p = place2d(x, 1.0, {
      protocol: 'PDF417',
      data: 'PROBE-PDF417-SHAPE',
      pdf417: { column: String(columns), aspect: 3 },
    });
    const box = boxOf(p.pose, 1.0);
    nodes.push(p.node, p.ruler);
    expect.push(
      `column=${columns}: ${p.cols} modules wide x ${p.rows} rows — symbol ${round(p.pose.width)} x ${round(p.pose.height)}pt, ` +
        `object box ${box.width} x ${box.height}pt at x=${box.x}`,
    );
    x = advance(p.pose, box);
  }
  probes.push({
    file: '03-pdf417-shape.lbx',
    question:
      'Does P-touch honor an explicit pdf417Style row/column, or re-run its own automatic layout? Two identical payloads, pinned to 2 and 4 data columns.',
    look: [
      'the two symbols must be different shapes — 13 rows then 7, so taller-and-narrower then shorter-and-wider — each centered in its frame with an even 5pt border',
      'if they come back identical, P-touch ignored the pin and picks its own layout, so exporting row/column buys nothing and the reopened size is not ours',
      'after Save As, read pdf417Style row/column/width/aspect back out',
    ],
    expect,
    nodes,
    length: x + 8,
  });
}

// --------------------------------------------------------------- 04 1D ----
{
  const nodes: Node[] = [caption({ x: 4, y: 14, width: 78, height: 28 }, '04 1D object box\nframe = bars + 5pt')];
  const expect: string[] = [];
  let x = 88;

  const c128 = place1d(x, 30, 1.0, { protocol: 'CODE128', data: 'PROBE128' });
  nodes.push(c128.node, c128.ruler);
  expect.push(`CODE128 "PROBE128": ${c128.modules} modules at barWidth=1.0 — box ${round(c128.pose.width)}pt wide`);
  x = advance(c128.pose, boxOf(c128.pose, 1.0));

  // EAN13 asks for an asymmetric quiet zone (11 left, 7 right) and used to bake
  // 9 modules into its own width, drawing ~19% narrow. This is the one
  // direction the unit tests cannot see.
  const ean = place1d(x, 30, 1.0, { protocol: 'EAN13', data: '400638133393' });
  nodes.push(ean.node, ean.ruler);
  expect.push(`EAN13 "400638133393": ${ean.modules} modules at barWidth=1.0 — box ${round(ean.pose.width)}pt wide`);
  x = advance(ean.pose, boxOf(ean.pose, 1.0));

  probes.push({
    file: '04-1d-geometry.lbx',
    question:
      'Under the margin="false" we always write, is P-touch\'s object box the bars alone — no quiet zone — and does it redraw at the barWidth we export?',
    look: [
      'the bars should sit centered in the hairline frame with an even 5pt border on all four sides',
      'a wider border than 5pt means the box includes a quiet zone and every 1D barcode we write is drawn narrow',
      'EAN13 is the one to watch: its quiet zone is asymmetric (11 modules left, 7 right), so a box that includes it is off-center as well as narrow — unequal left and right borders',
    ],
    expect,
    nodes,
    length: x + 8,
  });
}

// ------------------------------------------------------------ 05 brush ----
{
  // The one thing lbxExport.ts admits it is guessing about. Both barcodes sit
  // on solid ink: if the brush means anything, one survives and one is
  // swallowed.
  const left = place1d(100, 24, 1.0, { protocol: 'CODE128', data: 'BRUSH-ON', opaqueBackground: true });
  const right = place1d(100 + left.pose.width + 26, 24, 1.0, {
    protocol: 'CODE128',
    data: 'BRUSHOFF',
    opaqueBackground: false,
  });
  const bandEnd = right.pose.x + right.pose.width + 12;
  const nodes: Node[] = [
    caption({ x: 4, y: 14, width: 82, height: 28 }, '05 barcode brush\nleft SOLID, right NULL'),
    inkBand(90, bandEnd - 90, BAND_MID, 40),
    left.node,
    right.node,
  ];
  probes.push({
    file: '05-barcode-brush.lbx',
    question:
      'Does P-touch honor pt:brush on a barcode? Both sit on a 40pt band of solid ink; the left exports brush style="SOLID" white, the right style="NULL".',
    look: [
      'if the brush is honored: the left barcode sits in a white field and is readable, the right is invisible against the black',
      'if it is ignored one way: both are readable — P-touch draws barcodes opaque regardless, which is what we assumed of its own files',
      'if it is ignored the other way: both are invisible, and the opaque-background feature does not survive export at all',
      'after Save As, check whether the two barcodes still carry different brush styles',
    ],
    expect: [
      'left "BRUSH-ON" exports brush style="SOLID" color="#FFFFFF"',
      'right "BRUSHOFF" exports brush style="NULL"',
      'note: this does round-trip through our own import — a file stamped generator="bil-lbx" has its brush trusted, so the right barcode reopens here transparent. (The comment in lbxExport.ts claiming import always yields opaque is stale.) The open question is only what P-touch does.',
    ],
    nodes,
    length: bandEnd + 8,
  });
}

// ------------------------------------------------------- 06 auto-length ----
{
  // Under autoLength, style:paper carries P-touch's 1000mm ceiling and the real
  // extent lives in style:backGround. Export writes both; nothing has checked
  // which one P-touch reads.
  const c = place1d(20, 28, 1.0, { protocol: 'CODE128', data: 'AUTOLEN' });
  const nodes: Node[] = [
    c.node,
    caption({ x: 20, y: BAND_MID + 15, width: 128, height: 8 }, 'auto-length: expect ~160pt / 56mm'),
  ];
  probes.push({
    file: '06-autolength.lbx',
    question:
      'Does P-touch open an auto-length file at the length we recorded in style:backGround, rather than at the 1000mm placeholder we are obliged to put in style:paper?',
    look: [
      'the label should open about 56mm long',
      'a label that opens 1000mm long means style:backGround is not where P-touch reads an auto-length extent, and every auto-length file we write is wrong',
    ],
    expect: ['paper height 2834.4pt (the 1000mm placeholder), background band 160pt'],
    nodes,
    length: 160,
    autoLength: true,
  });
}

// -------------------------------------------------------------- 07 RSS ----
{
  // We cannot encode GS1 DataBar and have never had a sample to measure it
  // against. This asks the question the cheap way: bil-lbx writes no
  // barcode:rssStyle, so if P-touch opens the file anyway and saves it back,
  // its own rssStyle comes back and becomes the oracle we lack. If it refuses,
  // only this file is lost.
  const nodes: Node[] = [
    caption({ x: 4, y: 10, width: 170, height: 24 }, '07 GS1 DataBar (RSS) — no rssStyle written'),
    barcode({ x: 20, y: BAND_MID - 15, width: 96, height: 30 }, { protocol: 'RSS', data: '0112345678901231' }),
  ];
  probes.push({
    file: '07-rss-databar.lbx',
    question:
      'Will P-touch open a barcode:barcodeStyle with protocol="RSS" and no barcode:rssStyle beside it — and if so, what does it write back?',
    look: [
      'this one may simply fail to open, which is itself an answer',
      'if it opens, Save As and the resulting barcode:rssStyle tells us the variant names and attributes bil-lbx does not model yet',
    ],
    expect: ['no barcode:rssStyle in the file we wrote; P-touch supplies its own defaults or refuses'],
    nodes,
    length: 200,
  });
}

// --------------------------------------------------------- 08 MaxiCode ----
{
  const nodes: Node[] = [
    caption({ x: 4, y: 8, width: 96, height: 40 }, '08 MaxiCode on 24mm tape\n26.9mm into an 18.1mm band'),
    // Flush to the top edge rather than centered: centering would put the box
    // at a negative y, and a coordinate outside the sheet is a second reason
    // for P-touch to reject the object, which would confound the first.
    barcode({ x: 110, y: 0, width: 76.3, height: 76.3 }, { protocol: 'MAXICODE', data: '[)>01960840' }),
  ];
  probes.push({
    file: '08-maxicode.lbx',
    question:
      'MaxiCode is refused here as a fixed 26.9mm symbol against an 18.1mm printable band. Does P-touch agree, or does it clamp, scale, or refuse the object?',
    look: [
      '76.3pt is 26.9mm; the tape is 68pt wide and its band 51.2pt, so the symbol cannot fit however it is placed',
      'if P-touch scales it down, the refusal in encode.ts is too strong and there is a size to draw after all',
    ],
    expect: ['object box 76.3pt square at x=110, deliberately larger than the tape'],
    nodes,
    length: 200,
  });
}

// --------------------------------------------------------------- write ----

await mkdir(OUT, { recursive: true });

const readme: string[] = [
  '# P-touch Editor probe files',
  '',
  'Generated by `scripts/makePteProbes.ts` — regenerate with',
  '`npx vite-node scripts/makePteProbes.ts`.',
  '',
  'Each file asks one question this app currently answers by inference rather',
  'than by measurement. They are separate files so that one P-touch refuses to',
  'open takes only its own question down with it.',
  '',
  '## How to run them',
  '',
  '1. Open the file in P-touch Editor on the **24mm** tape it names.',
  '2. Look at it against the "what to look for" list — most of these are',
  '   answered by eye before anything is saved.',
  '3. **Save As** beside the original with a `-pte` suffix',
  '   (`01-qr-geometry-pte.lbx`), so both halves of the round-trip survive.',
  '4. A screenshot of anything surprising is worth as much as the file.',
  '',
  'Every symbol is drawn inside the 24mm tape\'s centered printable band, so a',
  'symbol that overhangs after the round-trip means P-touch moved or resized it.',
  '',
  'The hairline frame around each symbol is drawn exactly **5pt outside** the',
  'pose we believe the symbol occupies. A correctly drawn symbol sits centered',
  'in it with an even 5pt border on all four sides; any error in the drawn size',
  'or position shows up as an uneven border before anything else does. The',
  'frames are ordinary rectangles, which carry no convention P-touch and this',
  'app could disagree about — that is the whole reason they are the ruler.',
  '',
  '## Worth authoring in P-touch, if there is appetite',
  '',
  'Not round-trips — these are files only P-touch can produce, and the second',
  'one unblocks a feature rather than checking one.',
  '',
  '- **GS1 DataBar.** `encode.ts` refuses it for want of an oracle and of any',
  '  sample to measure. A P-touch-authored label with one DataBar per variant it',
  '  offers (Omnidirectional, Truncated, Limited, Expanded, and any stacked',
  '  forms) would supply both at once: `barcode:rssStyle` names the variants and',
  '  their attributes, which bil-lbx does not model, and the drawn symbol is the',
  '  reference to diff an encoder against. **Two module sizes per variant** is',
  '  what pins the box convention — one size cannot separate a per-module quiet',
  '  zone from a flat one in points, which is exactly the mistake the 2D box',
  '  conversion was built to undo.',
  '- **MaxiCode**, if P-touch will place one on a 24mm tape at all. Its object',
  '  box would settle whether the fixed 26.9mm in `encode.ts` is the whole story.',
  '',
];

let selfCheckFailures = 0;
const orderLost: string[] = [];

for (const probe of probes) {
  const config = sceneToLbxConfig(probe.nodes, TAPE, probe.autoLength ?? false, probe.length, []);
  const bytes = await buildLbx(config);
  const path = new URL(probe.file, OUT);
  await writeFile(path, bytes);

  readme.push(`## \`${probe.file}\``, '', probe.question, '', '**What to look for**', '');
  for (const l of probe.look) readme.push(`- ${l}`);
  readme.push('', '**What we wrote**', '');
  for (const e of probe.expect) readme.push(`- ${e}`);
  readme.push('');

  console.log(`${probe.file}  ${bytes.length} bytes, ${probe.nodes.length} objects, ${round(probe.length)}pt long`);
  for (const e of probe.expect) console.log(`    ${e}`);

  // Read each file back through the app's own importer before P-touch ever
  // sees it. A probe that does not survive our own round-trip would answer a
  // question about us while looking like an answer about P-touch, so the
  // failure has to surface here rather than after the measurement.
  //
  // Matched as a set rather than pairwise by index, because bil-lbx's parser
  // returns objects grouped by type rather than in document order — a real
  // problem for z-order, and a separate one from whether a probe is placed
  // where it says it is.
  const buf = await readFile(path);
  const reimported = await importLbx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const key = (n: { data: { kind: string }; pose: LabelPose }) =>
    `${n.data.kind} ${round(n.pose.x)},${round(n.pose.y)} ${round(n.pose.width)}x${round(n.pose.height)}`;
  const seen = new Set(reimported.nodes.map(key));
  for (const before of probe.nodes) {
    if (!seen.has(key(before))) {
      console.log(`    !! no object came back at ${key(before)}`);
      selfCheckFailures++;
    }
  }
  if (Math.abs(reimported.labelLength - probe.length) > 0.001) {
    console.log(`    !! label length ${round(probe.length)} -> ${round(reimported.labelLength)} on reimport`);
    selfCheckFailures++;
  }
  const orderKept = probe.nodes.every((n, i) => reimported.nodes[i] && key(reimported.nodes[i]!) === key(n));
  if (!orderKept) orderLost.push(probe.file);
}

await writeFile(new URL('README.md', OUT), readme.join('\n'));
console.log(`\nwrote ${probes.length} probes + README.md to pte-probes/`);
console.log(
  selfCheckFailures === 0
    ? 'self-check: every object round-trips through our own import unchanged'
    : `self-check: ${selfCheckFailures} discrepancies above — fix these before measuring against P-touch`,
);
if (orderLost.length > 0) {
  console.log(
    `note: document order was not preserved reimporting ${orderLost.join(', ')} — ` +
      "bil-lbx's parser returns objects grouped by type, so z-order is lost on import. " +
      'Does not affect the files themselves; the XML is written in the order given here.',
  );
}
