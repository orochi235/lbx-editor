/**
 * Import .lbx files using the bil-lbx parser, then map to editor scene nodes.
 */
import { parseLbx, labelLengthPt, type LabelConfig, type LabelObject } from 'bil-lbx';
import { DEFAULT_LABEL_LENGTH, type LabelNodeData, type LabelPose, type TapeSize } from './label';
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

function detectTapeSize(widthPt: number): TapeSize {
  const sizes: [TapeSize, number][] = [
    ['6mm', 17], ['9mm', 25.5], ['12mm', 33.6],
    ['18mm', 51], ['24mm', 68], ['36mm', 102],
  ];
  let best: TapeSize = '12mm';
  let bestDist = Infinity;
  for (const [name, w] of sizes) {
    const d = Math.abs(w - widthPt);
    if (d < bestDist) { bestDist = d; best = name; }
  }
  return best;
}

let nextId = 1;
function genId(): string {
  return `imported-${nextId++}`;
}

function lbxObjectToNode(obj: LabelObject): ImportedNode | null {
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

  const nodes: ImportedNode[] = [];
  for (const obj of config.objects) {
    const node = lbxObjectToNode(obj);
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
