/**
 * Import .lbx files using the bil-lbx parser, then map to editor scene nodes.
 */
import { parseLbx, labelLengthPt, type LabelConfig, type LabelObject } from 'bil-lbx';
import {
  DEFAULT_LABEL_LENGTH,
  DEFAULT_TAPE,
  TAPE_SIZES,
  type LabelNodeData,
  type LabelPose,
  type TapeSize,
} from './label';
import { fitLengthToContent } from './autoLength';

interface ImportedNode {
  id: string;
  data: LabelNodeData;
  pose: LabelPose;
}

interface ImportResult {
  nodes: ImportedNode[];
  tapeSize: TapeSize;
  autoLength: boolean;
  labelLength: number;
  /** Cut positions in pt along the label (style:cutLine — freeCut verbatim,
   *  regularCut expanded into explicit positions). */
  cutMarks: number[];
}

/**
 * Nearest standard tape to the file's paper width. Deliberately unbounded:
 * P-touch and its clones write slightly different widths for the same cassette,
 * and a label that opens on the wrong tape is recoverable where a refused
 * import isn't. Widths come from TAPE_SIZES so this can't drift from the table
 * export and rendering use.
 */
function detectTapeSize(widthPt: number): TapeSize {
  let best: TapeSize = DEFAULT_TAPE;
  let bestDist = Infinity;
  for (const [name, { width }] of Object.entries(TAPE_SIZES) as [TapeSize, { width: number }][]) {
    const d = Math.abs(width - widthPt);
    if (d < bestDist) { bestDist = d; best = name; }
  }
  return best;
}

let nextId = 1;
function genId(): string {
  return `imported-${nextId++}`;
}

/**
 * Whether this file's `brush` means what it says on a barcode.
 *
 * P-touch writes boilerplate for attributes it doesn't use — every `pt:brush`
 * it authors is `style="NULL"`, on text and image objects too, where a fill
 * means nothing — and it draws its barcodes opaque anyway. So in a P-touch
 * file the field carries no information, and reading NULL as "off" there would
 * import every P-touch barcode transparent over whatever it sits on.
 *
 * Only `bil-lbx` counts, deliberately **not** its former name `brother-lbx`.
 * Files we wrote before the opaque background existed carry that older stamp
 * and no brush at all, so trusting it would read them as "off" and reopen a
 * barcode transparent — the failure the background exists to prevent. Files we
 * wrote with a deliberate brush but an older bil-lbx share the same stamp and
 * can't be told apart from those, so they lose their "off" instead. That is
 * the direction it's safe to lose: a barcode that comes back opaque scans.
 */
function fileMeansItsBrush(generator: string | undefined): boolean {
  return generator === 'bil-lbx';
}

function lbxObjectToNode(obj: LabelObject, brushIsMeaningful: boolean): ImportedNode | null {
  const pos = obj.position;
  const pose: LabelPose = { x: pos.x, y: pos.y, width: pos.width, height: pos.height };

  switch (obj.type) {
    case 'text':
      return {
        id: genId(),
        pose,
        data: {
          kind: 'text',
          text: obj.data,
          fontFamily: obj.font.name,
          fontSize: obj.font.size,
          fontWeight: obj.font.weight ?? 400,
          italic: obj.font.italic ?? false,
          horizontalAlignment: obj.horizontalAlignment ?? 'LEFT',
          verticalAlignment: obj.verticalAlignment ?? 'CENTER',
          color: obj.textStyle?.color ?? '#000000',
        },
      };
    case 'rect':
      return {
        id: genId(),
        pose,
        data: {
          kind: 'rect',
          rounded: obj.shape === 'ROUNDRECTANGLE',
          roundness: obj.roundnessX ?? 0,
          strokeStyle: obj.pen?.color ?? '#000000',
          strokeWidth: obj.pen?.widthX ?? 0.5,
          fillColor: null,
        },
      };
    case 'line': {
      const pts = obj.points;
      const descending =
        pts && pts.length >= 2 ? (pts[1]!.x - pts[0]!.x) * (pts[1]!.y - pts[0]!.y) >= 0 : true;
      return {
        id: genId(),
        pose,
        data: {
          kind: 'line',
          strokeStyle: obj.pen?.color ?? '#000000',
          strokeWidth: obj.pen?.widthX ?? 0.5,
          descending,
        },
      };
    }
    case 'barcode':
      return {
        id: genId(),
        pose,
        data: {
          kind: 'barcode',
          protocol: obj.protocol,
          data: obj.data,
          barWidth: obj.barWidth ?? 1.2,
          barRatio: obj.barRatio ?? '1:3',
          humanReadable: obj.humanReadable ?? false,
          humanReadableAlignment: obj.humanReadableAlignment ?? 'CENTER',
          checkDigit: obj.checkDigit ?? false,
          zeroFill: obj.zeroFill ?? false,
          // A solid brush is the background; NULL and absent are both "off",
          // since bil-lbx collapses them to the same thing. Only trustworthy
          // in a file we wrote — see `fileMeansItsBrush`.
          opaqueBackground: brushIsMeaningful ? obj.brush?.style === 'SOLID' : true,
          ...(obj.qrCode ? { qrCode: obj.qrCode } : {}),
        },
      };
    case 'image': {
      // Convert Uint8Array to base64
      const bytes = obj.imageData;
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
      const src = btoa(binary);
      return {
        id: genId(),
        pose,
        data: {
          kind: 'image',
          src,
          originalName: obj.originalName ?? 'image.bmp',
          mimeType: 'image/bmp',
        },
      };
    }
  }
  return null;
}

export async function importLbx(file: File | ArrayBuffer): Promise<ImportResult> {
  const data = file instanceof File ? await file.arrayBuffer() : file;
  const config: LabelConfig = await parseLbx(new Uint8Array(data));

  const tapeSize = detectTapeSize(config.paper.width);
  const autoLength = config.paper.autoLength ?? true;

  const brushIsMeaningful = fileMeansItsBrush(config.generator);
  const nodes: ImportedNode[] = [];
  for (const obj of config.objects) {
    const node = lbxObjectToNode(obj, brushIsMeaningful);
    if (node) nodes.push(node);
  }

  // Prefer the length the file recorded (bil-lbx knows which field holds it —
  // under autoLength it's the background band, not the 1000mm placeholder in
  // style:paper). Fitting our own content is the fallback: it can come up short
  // on files holding objects this editor doesn't map, such as barcodes.
  const labelLength =
    labelLengthPt(config) ?? fitLengthToContent(nodes.map((n) => n.pose)) ?? DEFAULT_LABEL_LENGTH;

  // Cut marks: freeCut positions verbatim; a regularCut interval expands to
  // explicit positions so the editor has one representation.
  const cutMarks: number[] = [...(config.cut?.freeCut ?? [])];
  const interval = config.cut?.regularCut ?? 0;
  if (interval > 0) {
    for (let x = interval; x < labelLength; x += interval) cutMarks.push(x);
  }
  cutMarks.sort((a, b) => a - b);

  return { nodes, tapeSize, autoLength, labelLength, cutMarks };
}
