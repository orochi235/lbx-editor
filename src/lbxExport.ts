/**
 * Convert the editor's scene graph into a bil-lbx LabelConfig and build
 * the .lbx file.
 */
import {
  buildLbx,
  backgroundFor,
  AUTO_LENGTH_MAX_PT,
  TAPE,
  type LabelConfig,
  type LabelObject as LbxObject,
} from 'bil-lbx';
import { ensureBmp32Bytes } from './imageUtils';
import { encodeBarcode, barcodeRequest, barcodeModulePt } from './barcode';
import { DEFAULT_LABEL_LENGTH, lineEndpoints, type LabelNodeData, type LabelPose, type TapeSize } from './label';

interface SceneNode {
  id: string;
  data: LabelNodeData;
  pose: LabelPose;
}

const TAPE_FORMAT_MAP: Record<TapeSize, { width: number; format: number }> = {
  '6mm': TAPE['6mm'],
  '9mm': TAPE['9mm'],
  '12mm': TAPE['12mm'],
  '18mm': TAPE['18mm'],
  '24mm': TAPE['24mm'],
  '36mm': TAPE['36mm'],
};

export function sceneToLbxConfig(
  nodes: SceneNode[],
  tapeSize: TapeSize,
  autoLength: boolean,
  labelLength?: number,
  cutMarks: number[] = [],
): LabelConfig {
  const tape = TAPE_FORMAT_MAP[tapeSize];
  const objects: LbxObject[] = [];

  for (const node of nodes) {
    const { data, pose } = node;
    switch (data.kind) {
      case 'text':
        objects.push({
          type: 'text',
          position: { x: pose.x, y: pose.y, width: pose.width, height: pose.height },
          font: {
            name: data.fontFamily,
            size: data.fontSize,
            weight: data.fontWeight,
            italic: data.italic,
          },
          data: data.text,
          horizontalAlignment: data.horizontalAlignment,
          verticalAlignment: data.verticalAlignment,
          textStyle: { color: data.color },
        });
        break;
      case 'rect':
        objects.push({
          type: 'rect',
          position: { x: pose.x, y: pose.y, width: pose.width, height: pose.height },
          shape: data.rounded ? 'ROUNDRECTANGLE' : 'RECTANGLE',
          roundnessX: data.roundness,
          roundnessY: data.roundness,
          pen: { style: 'INSIDEFRAME', widthX: data.strokeWidth, widthY: data.strokeWidth, color: data.strokeStyle },
        });
        break;
      case 'line':
        objects.push({
          type: 'line',
          position: { x: pose.x, y: pose.y, width: pose.width, height: pose.height },
          points: lineEndpoints(pose, data.descending).map((p) => ({ x: p.x, y: p.y })),
          pen: { style: 'SOLID', widthX: data.strokeWidth, widthY: data.strokeWidth, color: data.strokeStyle },
        });
        break;
      case 'barcode': {
        // The pose is authoritative for us; P-touch sizes from barWidth (1D)
        // and qrCode.cellSize (2D). Restate the pose in whichever term applies
        // so the two agree on the drawn size. Falls back to the imported values
        // when the payload doesn't encode — nothing better to say.
        const encoded = encodeBarcode(barcodeRequest(data));
        const modulePt = encoded.ok ? barcodeModulePt(encoded, pose) : undefined;
        const barWidth = encoded.ok && encoded.kind === '1d' ? modulePt! : data.barWidth;
        const qrCode = encoded.ok && encoded.kind === '2d'
          ? { ...data.qrCode, cellSize: modulePt! }
          : data.qrCode;
        objects.push({
          type: 'barcode',
          position: { x: pose.x, y: pose.y, width: pose.width, height: pose.height },
          protocol: data.protocol,
          data: data.data,
          barWidth,
          barRatio: data.barRatio,
          humanReadable: data.humanReadable,
          humanReadableAlignment: data.humanReadableAlignment,
          checkDigit: data.checkDigit,
          zeroFill: data.zeroFill,
          ...(qrCode ? { qrCode } : {}),
        });
        break;
      }
      case 'image': {
        // Decode base64 to Uint8Array
        const binary = atob(data.src);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        objects.push({
          type: 'image',
          position: { x: pose.x, y: pose.y, width: pose.width, height: pose.height },
          imageData: bytes,
          originalName: data.originalName,
        });
        break;
      }
    }
  }

  // An auto-length label's paper height is P-touch's placeholder, so the length
  // has nowhere to live but the background band — write it there explicitly or
  // the file reimports at the placeholder's 1000mm.
  const paper = {
    width: tape.width,
    format: tape.format,
    autoLength,
    height: autoLength ? AUTO_LENGTH_MAX_PT : labelLength,
  };

  return {
    paper,
    background: backgroundFor(paper, labelLength ?? DEFAULT_LABEL_LENGTH),
    objects,
    ...(cutMarks.length > 0 ? { cut: { freeCut: [...cutMarks].sort((a, b) => a - b) } } : {}),
  };
}

export async function exportLbx(
  nodes: SceneNode[],
  tapeSize: TapeSize,
  autoLength: boolean,
  labelLength?: number,
  cutMarks: number[] = [],
): Promise<Uint8Array> {
  const config = sceneToLbxConfig(nodes, tapeSize, autoLength, labelLength, cutMarks);
  // .lbx embeds only BMP: transcode user-inserted PNG/JPEG bytes here, at
  // the file boundary, so the in-editor node keeps its original (smaller,
  // lossless-round-tripping) source bytes.
  for (const obj of config.objects) {
    if (obj.type === 'image') obj.imageData = await ensureBmp32Bytes(obj.imageData, obj.position);
  }
  return await buildLbx(config);
}
