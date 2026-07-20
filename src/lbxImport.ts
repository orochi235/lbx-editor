/**
 * Import .lbx files using the bil-lbx parser, then map to editor scene nodes.
 */
import { parseLbx, type LabelConfig, type LabelObject } from 'bil-lbx';
import type { LabelNodeData, LabelPose, TapeSize } from './label';

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
  const labelLength = config.paper.height ?? 200;

  const nodes: ImportedNode[] = [];
  for (const obj of config.objects) {
    const node = lbxObjectToNode(obj);
    if (node) nodes.push(node);
  }

  return { nodes, tapeSize, autoLength, labelLength };
}
