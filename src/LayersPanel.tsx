import { useCallback, useSyncExternalStore, type ReactNode } from 'react';
import type { Scene, SelectionApi } from '@weasel-js/core';
import { LayerList, useSceneLayerList } from '@weasel-js/ui/components/LayerList';
import { Icon } from '@weasel-js/ui';
import type { LabelLayer, LabelNodeData, LabelPose } from './label';
import { nodeSummary } from './nodeSummary';
import { icon } from './icons';

const KIND_ICONS: Record<LabelNodeData['kind'], ReactNode> = {
  text: <Icon name={icon('core:text')} size={14} />,
  rect: <Icon name={icon('core:rect')} size={14} />,
  line: <Icon name={icon('core:line')} size={14} />,
  image: <Icon name={icon('core:image')} size={14} />,
  barcode: <Icon name={icon('barcode')} size={14} />,
};

interface LayersPanelProps {
  scene: Scene<LabelNodeData, LabelLayer, LabelPose>;
  selection: SelectionApi;
}

/** The label's objects, frontmost first. Dragging a row restacks it as one
 *  undo step; node order is what the canvas draws and what export writes. */
export function LayersPanel({ scene, selection }: LayersPanelProps) {
  // The list is rebuilt from the scene each render, so render on each commit.
  useSyncExternalStore(
    useCallback((cb: () => void) => scene.subscribe(cb), [scene]),
    () => scene.getVersion(),
  );
  const list = useSceneLayerList({
    scene,
    selection,
    label: 'Restack',
    itemFor: (node) => ({ label: nodeSummary(node.data), leading: KIND_ICONS[node.data.kind] }),
  });
  // No visibility toggle: neither print nor .lbx could honor a hidden object.
  const { onVisibilityChange: _, ...rest } = list;
  return <LayerList label="Objects" empty="No objects yet." {...rest} />;
}
