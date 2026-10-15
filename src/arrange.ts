/**
 * Align and match-size over plain rect poses: document state in, new poses
 * out. The panel decides what the reference is; nothing here reads the scene.
 */
import type { LabelPose } from './label';

export type AlignEdge = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom';
export type MatchDims = 'width' | 'height' | 'both';

export interface Posed {
  id: string;
  pose: LabelPose;
}

export function unionRect(poses: readonly LabelPose[]): LabelPose | null {
  if (poses.length === 0) return null;
  const x = Math.min(...poses.map((p) => p.x));
  const y = Math.min(...poses.map((p) => p.y));
  const right = Math.max(...poses.map((p) => p.x + p.width));
  const bottom = Math.max(...poses.map((p) => p.y + p.height));
  return { x, y, width: right - x, height: bottom - y };
}

/** Moves each item so `edge` lines up with the same edge of `ref`. */
export function alignTo(items: readonly Posed[], ref: LabelPose, edge: AlignEdge): Posed[] {
  return items.map(({ id, pose }) => {
    switch (edge) {
      case 'left': return { id, pose: { ...pose, x: ref.x } };
      case 'right': return { id, pose: { ...pose, x: ref.x + ref.width - pose.width } };
      case 'center-x': return { id, pose: { ...pose, x: ref.x + (ref.width - pose.width) / 2 } };
      case 'top': return { id, pose: { ...pose, y: ref.y } };
      case 'bottom': return { id, pose: { ...pose, y: ref.y + ref.height - pose.height } };
      case 'center-y': return { id, pose: { ...pose, y: ref.y + (ref.height - pose.height) / 2 } };
    }
  });
}

/** Resizes each item to `ref`'s width, height or both, keeping its top-left
 *  corner where it was — the same anchor typing into W or H uses. */
export function matchSize(items: readonly Posed[], ref: LabelPose, dims: MatchDims): Posed[] {
  return items.map(({ id, pose }) => ({
    id,
    pose: {
      ...pose,
      width: dims === 'height' ? pose.width : ref.width,
      height: dims === 'width' ? pose.height : ref.height,
    },
  }));
}
