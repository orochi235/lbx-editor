/**
 * Document checks: conditions that make a label print wrong, found as the user
 * edits rather than at print time.
 *
 * Every check here is about something the canvas draws *correctly* — a crisp
 * barcode too fine for the printhead, an object sitting where the head can't
 * reach. The screen can't show these failures, so they need saying out loud.
 *
 * Pure: geometry in, findings out. The presentation (anchored callouts) and the
 * preference gating it live in App.tsx.
 */
import { encodeBarcode, barcodeRequest, barcodeModuleDots, moduleFitness } from './barcode';
import type { LabelNodeData, LabelPose } from './label';

export type DiagnosticSeverity = 'error' | 'warning';

export interface Diagnostic {
  /** The node the finding is about — what a callout anchors to. */
  nodeId: string;
  severity: DiagnosticSeverity;
  /** Stable per node+check, so a finding can be tracked across re-checks. */
  code: 'barcode-unprintable' | 'barcode-marginal' | 'clipped' | 'qr-model-substituted';
  title: string;
  detail: string;
}

export interface CheckedNode {
  id: string;
  pose: LabelPose;
  data: LabelNodeData;
}

export interface DocumentGeometry {
  /** Label length in pt — the horizontal extent that prints. */
  labelLengthPt: number;
  /** Printhead-reachable band in pt, from labelRender's printableBandPt. */
  band: { y: number; height: number };
  dpi: number;
}

/** Rounds for display without implying more precision than we have. */
function dots(n: number): string {
  return n.toFixed(2);
}

function checkBarcode(node: CheckedNode, geometry: DocumentGeometry): Diagnostic | null {
  if (node.data.kind !== 'barcode') return null;
  const symbol = encodeBarcode(barcodeRequest(node.data));
  // An unencodable payload is already reported in the property panel and
  // blocks printing; this check is only about size.
  if (!symbol.ok) return null;

  const moduleDots = barcodeModuleDots(symbol, node.pose, geometry.dpi);
  const fitness = moduleFitness(moduleDots);
  if (fitness === 'ok') return null;

  const grow = symbol.kind === '2d' ? 'width and height' : 'width';
  return fitness === 'unrenderable'
    ? {
        nodeId: node.id,
        severity: 'error',
        code: 'barcode-unprintable',
        title: 'Barcode too small to print',
        detail:
          `Each module is ${dots(moduleDots)} printer dots — under the 1 dot it needs to ` +
          `appear at all. The bars would merge into a smear. Increase its ${grow}.`,
      }
    : {
        nodeId: node.id,
        severity: 'warning',
        code: 'barcode-marginal',
        title: 'Barcode may not scan',
        detail:
          `Each module is ${dots(moduleDots)} printer dots. Two dots (0.28mm) is the ` +
          `usual minimum scanners expect. Increase its ${grow} to be safe.`,
      };
}

/**
 * A QR the file asks for in a model we don't encode.
 *
 * `qrcode-generator` builds Model 2 only — `moduleCount = version * 4 + 17`
 * with alignment patterns, the ISO 18004 construction. A file that names
 * Model 1 (P-touch offers it; the 1994 original) therefore draws and prints
 * here as Model 2: a valid QR, but not the symbol the file specified.
 *
 * Same family as the checks above — the canvas draws it correctly, so nothing
 * on screen can show that a substitution happened. The alternative, a `model`
 * control in the property panel, would be worse: it would change the exported
 * file while the screen and the print raster stayed Model 2, breaking the
 * WYSIWYG the rest of the barcode work rests on.
 *
 * `model` still round-trips untouched, so the file keeps saying what it said
 * and P-touch will draw its own Model 1 from it.
 */
function checkQrModel(node: CheckedNode): Diagnostic | null {
  if (node.data.kind !== 'barcode' || node.data.protocol !== 'QRCODE') return null;
  const model = node.data.qrCode?.model;
  if (model === undefined || model === 2) return null;

  return {
    nodeId: node.id,
    severity: 'warning',
    code: 'qr-model-substituted',
    title: `QR Model ${model} prints as Model 2`,
    detail:
      `This file asks for QR Model ${model}, which this editor doesn't generate. ` +
      `What you see and what prints is Model 2 — the modern standard, and what ` +
      `scanners expect — so it will scan, but it isn't the symbol the file names. ` +
      `The file keeps its Model ${model} setting for P-touch Editor.`,
  };
}

/**
 * Anything sticking outside the printable area. The printhead can't reach the
 * tape's outer edges and nothing exists past the label's length, so whatever
 * lands there is cropped — the canvas dims those regions, but a large object
 * can still be mostly inside and lose an edge without it being obvious.
 */
function checkClipping(node: CheckedNode, geometry: DocumentGeometry): Diagnostic | null {
  const { pose } = node;
  const { band, labelLengthPt } = geometry;
  const over = {
    top: band.y - pose.y,
    bottom: pose.y + pose.height - (band.y + band.height),
    left: -pose.x,
    right: pose.x + pose.width - labelLengthPt,
  };

  const sides = (Object.entries(over) as [keyof typeof over, number][])
    .filter(([, amount]) => amount > 0.01)
    .map(([side]) => side);
  if (sides.length === 0) return null;

  const list = sides.length === 1
    ? `the ${sides[0]}`
    : `${sides.slice(0, -1).map((s) => `the ${s}`).join(', ')} and ${sides.at(-1)}`;
  return {
    nodeId: node.id,
    severity: 'warning',
    code: 'clipped',
    title: 'Object will be clipped',
    detail:
      `This extends past ${list} of the printable area, so that part won't print. ` +
      `Move or resize it to fit.`,
  };
}

/** Every finding for the document, in scene order. */
export function checkDocument(
  nodes: Iterable<CheckedNode>,
  geometry: DocumentGeometry,
): Diagnostic[] {
  const found: Diagnostic[] = [];
  for (const node of nodes) {
    const barcode = checkBarcode(node, geometry);
    if (barcode) found.push(barcode);
    const qrModel = checkQrModel(node);
    if (qrModel) found.push(qrModel);
    const clipped = checkClipping(node, geometry);
    if (clipped) found.push(clipped);
  }
  return found;
}
