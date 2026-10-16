import type { NodeId, Scene } from '@weasel-js/core';
import { PropertyField } from '@weasel-js/ui/components/Properties';
import type { LabelLayer, LabelNodeData, LabelPose } from './label';
import { isDitherProtected, snapToDots } from './dotSnap';
import { PRINT_DPI } from './printDpi';

type LabelScene = Scene<LabelNodeData, LabelLayer, LabelPose>;

/** A stroke width as the node should store it: whole dots when it asks to
 *  snap, as given otherwise. */
export function storedStrokeWidth(data: LabelNodeData, widthPt: number): number {
  const snaps = (data.kind === 'rect' || data.kind === 'line') && data.snapStroke;
  return snaps ? snapToDots(widthPt, PRINT_DPI) : widthPt;
}

/** How an object meets the printhead: whether the dither touches it, and for
 *  strokes, whether their width lands on whole dots. Barcodes have neither
 *  choice — they are always protected and always snapped. */
export function PrintOptions({ scene, nodeId, data }: {
  scene: LabelScene;
  nodeId: NodeId;
  data: LabelNodeData;
}) {
  if (data.kind === 'barcode') return null;
  const update = (next: LabelNodeData) => scene.update(nodeId, { data: next });

  return (
    <>
      <PropertyField
        kind="boolean"
        label="Don't dither"
        description="Print this object at plain threshold, so dithering never breaks up its edges"
        value={isDitherProtected(data)}
        onChange={(noDither) => update({ ...data, noDither })}
      />
      {(data.kind === 'rect' || data.kind === 'line') && (
        <PropertyField
          kind="boolean"
          label="Snap stroke"
          description="Round the stroke to a whole number of printer dots, so it prints the same width everywhere"
          value={data.snapStroke ?? false}
          onChange={(snapStroke) => {
            const next = { ...data, snapStroke };
            update({ ...next, strokeWidth: storedStrokeWidth(next, data.strokeWidth) });
          }}
        />
      )}
    </>
  );
}
