import type { NodeId, Scene } from '@weasel-js/core';
import { PropertyField } from '@weasel-js/ui/components/Properties';
import type { LabelLayer, LabelNodeData, LabelPose } from './label';
import { snapNodePose } from './dotSnap';
import { PRINT_DPI } from './printDpi';
import { PT_DISPLAY } from './numberDisplay';

type LabelScene = Scene<LabelNodeData, LabelLayer, LabelPose>;

const FIELDS: { key: keyof LabelPose; label: string }[] = [
  { key: 'x', label: 'X' },
  { key: 'y', label: 'Y' },
  { key: 'width', label: 'W' },
  { key: 'height', label: 'H' },
];

/**
 * X/Y/W/H for one node or many, as four cells of a paired property list. With
 * several selected, each field shows the value they share, or "Mixed" where
 * they differ, and typing into one sets that field on all of them as a single
 * undo step.
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
    <>
      {FIELDS.map(({ key, label }) => {
        const value = shared(key);
        return (
          <PropertyField
            key={key}
            kind="number"
            label={label}
            unit="pt"
            display={PT_DISPLAY}
            step={0.1}
            value={value}
            mixed={value === null}
            onChange={set(key)}
          />
        );
      })}
    </>
  );
}
