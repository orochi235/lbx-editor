/**
 * Convert the editor's scene graph into a bil-lbx LabelConfig and build
 * the .lbx file.
 */
import { buildLbx, TAPE, type LabelConfig, type LabelObject as LbxObject } from 'bil-lbx';
import type { LabelNodeData, LabelPose, TapeSize } from './label';

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
          points: [
            { x: pose.x, y: pose.y },
            { x: pose.x + pose.width, y: pose.y + pose.height },
          ],
          pen: { style: 'SOLID', widthX: data.strokeWidth, widthY: data.strokeWidth, color: data.strokeStyle },
        });
        break;
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

  return {
    paper: {
      width: tape.width,
      format: tape.format,
      autoLength,
      height: autoLength ? undefined : labelLength,
    },
    objects,
  };
}

export async function exportLbx(
  nodes: SceneNode[],
  tapeSize: TapeSize,
  autoLength: boolean,
  labelLength?: number,
): Promise<Uint8Array> {
  const config = sceneToLbxConfig(nodes, tapeSize, autoLength, labelLength);
  return await buildLbx(config);
}
