import type { NodeId, Scene } from '@weasel-js/core';
import type { LabelLayer, LabelNodeData, LabelPose } from './label';
import { FieldPair, NumberField } from './NumberField';
import { snapNodePose } from './dotSnap';
import { PRINT_DPI } from './printDpi';

type LabelScene = Scene<LabelNodeData, LabelLayer, LabelPose>;

/**
 * X/Y/W/H for one node or many. With several selected, each field shows the
 * value they share, or "mixed" where they differ, and typing into one sets
 * that field on all of them as a single undo step.
 */
export function PoseFields({ scene, ids }: { scene: LabelScene; ids: readonly NodeId[] }) {
  const poses = ids.flatMap((id) => {
    const node = scene.get(id);
    return node ? [{ id, pose: node.pose, data: node.data }] : [];
  });
  const shared = (key: keyof LabelPose): number | null => {
    const first = poses[0]?.pose[key];
    return first !== undefined && poses.every((p) => p.pose[key] === first) ? first : null;
  };
  const set = (key: keyof LabelPose) => (v: number) => {
    scene.batch(`Set ${key}`, () => {
      for (const { id, pose, data } of poses) {
        scene.setPose(id, snapNodePose(data, { ...pose, [key]: v }, PRINT_DPI));
      }
    });
  };

  return (
    <div className="prop-group">
      <FieldPair>
        <NumberField label="X" unit="pt" value={shared('x')} onChange={set('x')} />
        <NumberField label="Y" unit="pt" value={shared('y')} onChange={set('y')} />
      </FieldPair>
      <FieldPair>
        <NumberField label="W" unit="pt" value={shared('width')} onChange={set('width')} />
        <NumberField label="H" unit="pt" value={shared('height')} onChange={set('height')} />
      </FieldPair>
    </div>
  );
}
