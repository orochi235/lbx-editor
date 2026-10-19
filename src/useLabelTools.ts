import { useMemo, type RefObject } from 'react';
import {
  asNodeId,
  defineTool,
  useHandTool,
  useImageTool,
  useLineTool,
  useRectTool,
  useTextTool,
  type BoundsConstraint,
  type Scene,
} from '@weasel-js/core';
import type { LabelLayer, LabelNodeData, LabelPose } from './label';
import { TOOL_GROUPS, inGroup } from './toolGroups';
import { labelInsertFactories } from './insertFactories';
import type { PendingImage } from './imageInsert';
import { snapNodePose } from './dotSnap';
import { PRINT_DPI } from './printDpi';
import { icon } from './icons';

/**
 * Object creation via weasel tools: the `tools` patch that lays out the
 * palette, the insert factories their drag gestures mint nodes through, and
 * the resize behavior that keeps barcodes on whole printer dots.
 */
export function useLabelTools(
  scene: Scene<LabelNodeData, LabelLayer, LabelPose>,
  pendingImageRef: RefObject<PendingImage | null>,
) {
  // Drag-to-place image tool. `src` is unused: the `image` insertNodeFactory
  // reads pendingImageRef instead of the binding's params. The tool exists for
  // its palette button, crosshair, and drag-rect insert gesture; the picked
  // file is staged by useImagePicker.
  const imageTool = useImageTool({ src: '', label: 'Image' });

  // The palette clusters by each tool's `presentation.group` and separates the
  // clusters; `groupOrder` on ToolPalette permutes them but can't move a tool
  // between them. The kit's own taxonomy splits what this app wants together
  // (hand is 'view' apart from select; text is 'type' apart from the shapes)
  // and joins what it wants apart (image sits with rect and line in 'shape'),
  // and no permutation of those sets yields the three clusters below. So the
  // app builds these tools from the kit's public factories and restates the
  // grouping — `group` is a documented free-form string, and the `tools` patch
  // documents `AnyTool` entries as replacing a built-in by id.
  //
  // Rect and line are rebuilt too, though their group is already right. Within
  // a cluster the palette renders in registration order, and a built-in's slot
  // is the kit's own canonical one — `defaultTools` order does not move it. So
  // ids registered *by the patch* are the only ones whose order this app can
  // choose, which is why this app passes no `defaultTools` at all.
  const handTool = useHandTool();
  const lineTool = useLineTool();
  const rectTool = useRectTool();
  const textTool = useTextTool();

  // Drag-to-insert barcode, mirroring the kit's image tool: a declarative drag
  // binding routes through the dispatcher's insert action, and the
  // `barcode` insert factory mints the node. The kit explicitly supports
  // factories for kinds it doesn't ship.
  const barcodeTool = useMemo(
    () => defineTool({
      id: 'barcode',
      capabilities: ['creates-shapes'],
      cursor: 'crosshair',
      presentation: { label: 'Barcode', group: TOOL_GROUPS.barcode, icon: icon('barcode') },
      bindings: [
        { spec: { kind: 'drag' }, actionId: 'insert', opts: { params: { kind: 'barcode' } } },
      ],
    }),
    [],
  );

  // Key order is registration order for ids the kit isn't already registering,
  // and registration order is render order within a cluster — so this literal
  // is the palette's top-to-bottom layout. `hand` replaces the built-in `view`
  // brings, in its slot; it must stay out of `defaultTools`, or weasel warns.
  const toolsPatch = useMemo(
    () => ({
      hand: inGroup(handTool, TOOL_GROUPS.hand),
      line: inGroup(lineTool, TOOL_GROUPS.line),
      rect: inGroup(rectTool, TOOL_GROUPS.rect),
      text: inGroup(textTool, TOOL_GROUPS.text),
      image: inGroup(imageTool, TOOL_GROUPS.image),
      barcode: barcodeTool,
    }),
    [handTool, lineTool, rectTool, textTool, imageTool, barcodeTool],
  );

  const insertNodeFactories = useMemo(() => labelInsertFactories(pendingImageRef), [pendingImageRef]);

  // Barcodes resize in whole printer dots per module, live during the drag.
  const resizeBehaviors = useMemo<BoundsConstraint<LabelPose>[]>(() => [{
    onMove: (ctx, proposed) => {
      if (ctx.draggedIds.length !== 1) return;
      const node = scene.get(asNodeId(ctx.draggedIds[0]!));
      if (node?.data.kind !== 'barcode') return;
      return { pose: snapNodePose(node.data, proposed.pose, PRINT_DPI, proposed.anchor) };
    },
  }], [scene]);

  return { toolsPatch, insertNodeFactories, resizeBehaviors };
}
