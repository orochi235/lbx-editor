import { useState } from 'react';
import { ActionBar } from '@weasel-js/ui/components/ActionBar';
import type { NodeId, Scene, SelectionApi } from '@weasel-js/core';
import type { LabelLayer, LabelNodeData, LabelPose } from './label';
import {
  alignTo,
  matchSize,
  unionRect,
  type AlignEdge,
  type MatchDims,
  type Posed,
} from './arrange';
import { AlignIcon, MatchIcon } from './arrangeIcons';
import { nodeSummary } from './nodeSummary';
import { snapNodePose } from './dotSnap';
import { PRINT_DPI } from './printDpi';
import './arrangePanel.css';

type Reference = 'key' | 'selection' | 'label';

const EDGES: { edge: AlignEdge; title: string }[] = [
  { edge: 'left', title: 'Align left edges' },
  { edge: 'center-x', title: 'Align horizontal centers' },
  { edge: 'right', title: 'Align right edges' },
  { edge: 'top', title: 'Align top edges' },
  { edge: 'center-y', title: 'Align vertical centers' },
  { edge: 'bottom', title: 'Align bottom edges' },
];

const MATCHES: { dims: MatchDims; title: string }[] = [
  { dims: 'width', title: 'Match width' },
  { dims: 'height', title: 'Match height' },
  { dims: 'both', title: 'Match width and height' },
];

interface ArrangePanelProps {
  scene: Scene<LabelNodeData, LabelLayer, LabelPose>;
  selection: SelectionApi;
  /** The label's printable area: its length by the printable band. */
  labelRect: LabelPose;
}

/**
 * Align and match against one of three references. The key object is the
 * last one added to the selection — shift-click it last — and it stays put
 * while the others move to it.
 */
export function ArrangePanel({ scene, selection, labelRect }: ArrangePanelProps) {
  const [choice, setChoice] = useState<Reference>('key');
  const ids = selection.current as readonly NodeId[];
  if (ids.length === 0) return null;

  const multi = ids.length > 1;
  const reference: Reference = multi ? choice : 'label';
  const keyId = ids[ids.length - 1]!;
  const posed: Posed[] = ids.flatMap((id) => {
    const node = scene.get(id);
    return node ? [{ id, pose: node.pose }] : [];
  });

  const refRect =
    reference === 'label' ? labelRect
    : reference === 'key' ? scene.get(keyId)?.pose ?? null
    : unionRect(posed.map((p) => p.pose));
  const movers = reference === 'key' ? posed.filter((p) => p.id !== keyId) : posed;

  const apply = (label: string, next: Posed[]) => {
    scene.batch(label, () => {
      for (const { id, pose } of next) {
        const node = scene.get(id as NodeId);
        if (node) scene.setPose(id as NodeId, snapNodePose(node.data, pose, PRINT_DPI));
      }
    });
  };

  const keyNode = scene.get(keyId);

  return (
    <div className="arrange-panel">
      <h3>Arrange</h3>
      <div className="arrange-panel__order">
        <span>Order</span>
        <ActionBar group="reorder" />
      </div>
      <label className="arrange-panel__field">
        Align to
        <select
          value={reference}
          disabled={!multi}
          onChange={(e) => setChoice(e.target.value as Reference)}
        >
          {multi && <option value="key">Key object</option>}
          {multi && <option value="selection">Selection</option>}
          <option value="label">Label</option>
        </select>
      </label>
      {reference === 'key' && keyNode && (
        <p className="arrange-panel__key">
          Key: {nodeSummary(keyNode.data)}
        </p>
      )}
      <div className="arrange-panel__buttons" role="group" aria-label="Align">
        {EDGES.map(({ edge, title }) => (
          <button
            key={edge}
            type="button"
            title={title}
            aria-label={title}
            disabled={!refRect || movers.length === 0}
            onClick={() => refRect && apply(title, alignTo(movers, refRect, edge))}
          >
            <AlignIcon edge={edge} />
          </button>
        ))}
      </div>
      <div className="arrange-panel__buttons" role="group" aria-label="Match size">
        {MATCHES.map(({ dims, title }) => (
          <button
            key={dims}
            type="button"
            title={title}
            aria-label={title}
            disabled={!refRect || movers.length === 0 || reference === 'selection'}
            onClick={() => refRect && apply(title, matchSize(movers, refRect, dims))}
          >
            <MatchIcon dims={dims} />
          </button>
        ))}
      </div>
    </div>
  );
}
