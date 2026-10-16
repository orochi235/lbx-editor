import { useCallback, useSyncExternalStore, type ReactNode } from 'react';
import type { Scene, SelectionApi } from '@weasel-js/core';
import { LayerList, useSceneLayerList } from '@weasel-js/ui/components/LayerList';
import { ImageIcon, LineIcon, RectIcon, TextIcon } from '@weasel-js/ui';
import type { LabelLayer, LabelNodeData, LabelPose } from './label';
import { nodeSummary } from './nodeSummary';
import { BarcodeIcon } from './BarcodeIcon';

const KIND_ICONS: Record<LabelNodeData['kind'], ReactNode> = {
  text: <TextIcon size={14} />,
  rect: <RectIcon size={14} />,
  line: <LineIcon size={14} />,
  image: <ImageIcon size={14} />,
  barcode: <BarcodeIcon size={14} />,
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
  return <LayerList label="Objects" empty="No objects yet." {...list} />;
}
