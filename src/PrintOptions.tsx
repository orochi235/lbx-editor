import type { NodeId, Scene } from '@weasel-js/core';
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
    <div className="prop-group">
      <label
        className="prop-check"
        title="Print this object at plain threshold, so dithering never breaks up its edges"
      >
        <input
          type="checkbox"
          checked={isDitherProtected(data)}
          onChange={(e) => update({ ...data, noDither: e.target.checked })}
        />
        Don't dither
      </label>
      {(data.kind === 'rect' || data.kind === 'line') && (
        <label
          className="prop-check"
          title="Round the stroke to a whole number of printer dots, so it prints the same width everywhere"
        >
          <input
            type="checkbox"
            checked={data.snapStroke ?? false}
            onChange={(e) => {
              const snapStroke = e.target.checked;
              const next = { ...data, snapStroke };
              update({ ...next, strokeWidth: storedStrokeWidth(next, data.strokeWidth) });
            }}
          />
          Snap stroke to dots
        </label>
      )}
    </div>
  );
}
