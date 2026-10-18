import { useState, type ReactNode } from 'react';
import { ActionBar } from '@weasel-js/ui/components/ActionBar';
import { ButtonBar } from '@weasel-js/ui/components/ButtonBar';
import { ToggleBar } from '@weasel-js/ui/components/ToggleBar';
import { PropertyList, PropertyNote, PropertyRow } from '@weasel-js/ui/components/Properties';
import { Icon } from '@weasel-js/ui';
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
import type { IconRef } from '@weasel-js/icons';
import { icon } from './icons';
import { nodeSummary } from './nodeSummary';
import { snapNodePose } from './dotSnap';
import { PRINT_DPI } from './printDpi';

type Reference = 'key' | 'selection' | 'label';

const EDGES: { edge: AlignEdge; title: string; icon: IconRef }[] = [
  { edge: 'left', title: 'Align left edges', icon: icon('core:alignLeft') },
  { edge: 'center-x', title: 'Align horizontal centers', icon: icon('core:alignCenterX') },
  { edge: 'right', title: 'Align right edges', icon: icon('core:alignRight') },
  { edge: 'top', title: 'Align top edges', icon: icon('core:alignTop') },
  { edge: 'center-y', title: 'Align vertical centers', icon: icon('core:alignCenterY') },
  { edge: 'bottom', title: 'Align bottom edges', icon: icon('core:alignBottom') },
];

const MATCHES: { dims: MatchDims; title: string; icon: ReactNode }[] = [
  { dims: 'width', title: 'Match width', icon: <Icon name={icon('ui:wider')} size={16} /> },
  { dims: 'height', title: 'Match height', icon: <Icon name={icon('ui:taller')} size={16} /> },
  { dims: 'both', title: 'Match width and height', icon: <Icon name={icon('ui:fitStretch')} size={16} /> },
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
  if (ids.length === 0) {
    return (
      <PropertyList>
        <PropertyNote>Select objects to arrange them.</PropertyNote>
      </PropertyList>
    );
  }

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
  const cannotMove = !refRect || movers.length === 0;

  return (
    <PropertyList>
      <PropertyRow label="Order" group>
        <ActionBar group="reorder" />
      </PropertyRow>
      <PropertyRow label="Align to" group>
        <ToggleBar<Reference>
          ariaLabel="Align to"
          size="sm"
          value={reference}
          onChange={(next) => next && setChoice(next)}
          items={[
            { value: 'key', label: 'Key object', disabled: !multi },
            { value: 'selection', label: 'Selection', disabled: !multi },
            { value: 'label', label: 'Label' },
          ]}
        />
      </PropertyRow>
      {reference === 'key' && keyNode && (
        <PropertyNote>Key: {nodeSummary(keyNode.data)}</PropertyNote>
      )}
      <PropertyRow label="Align" group>
        <ButtonBar
          ariaLabel="Align"
          size="sm"
          items={EDGES.map(({ edge, title, icon: glyph }) => ({
            value: edge,
            label: <Icon name={glyph} size={16} />,
            ariaLabel: title,
            tooltip: title,
            disabled: cannotMove,
            onAction: () => refRect && apply(title, alignTo(movers, refRect, edge)),
          }))}
        />
      </PropertyRow>
      <PropertyRow label="Match size" group>
        <ButtonBar
          ariaLabel="Match size"
          size="sm"
          items={MATCHES.map(({ dims, title, icon }) => ({
            value: dims,
            label: icon,
            ariaLabel: title,
            tooltip: title,
            disabled: cannotMove || reference === 'selection',
            onAction: () => refRect && apply(title, matchSize(movers, refRect, dims)),
          }))}
        />
      </PropertyRow>
    </PropertyList>
  );
}
