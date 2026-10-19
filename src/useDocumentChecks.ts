import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import { Printers } from 'obwat';
import type { NodeId, Scene, View } from '@weasel-js/core';
import { tapeWidthMm, type LabelLayer, type LabelNodeData, type LabelPose, type TapeSize } from './label';
import { checkDocument, type CheckedNode, type Diagnostic } from './diagnostics';

interface DocumentChecksArgs {
  enabled: boolean;
  scene: Scene<LabelNodeData, LabelLayer, LabelPose>;
  sceneVersion: number;
  tapeSize: TapeSize;
  labelLength: number;
  printableBand: { y: number; height: number };
  view: View;
  canvasSize: { width: number; height: number };
  canvasContainerRef: RefObject<HTMLDivElement | null>;
}

const diagnosticKey = (d: Diagnostic) => `${d.nodeId}:${d.code}`;

/**
 * Live document checks: conditions the canvas draws faithfully but the
 * printer can't honor — a barcode too fine for the printhead, an object past
 * the printable area. Recomputed on every committed scene change; the callout
 * anchors to the offending node so the problem is attached to the thing that
 * has it.
 */
export function useDocumentChecks({
  enabled, scene, sceneVersion, tapeSize, labelLength, printableBand, view, canvasSize, canvasContainerRef,
}: DocumentChecksArgs) {
  const diagnostics = useMemo(() => {
    if (!enabled) return [];
    const media = Printers.ptP710bt.media(tapeWidthMm(tapeSize));
    const nodes: CheckedNode[] = [];
    for (const [id, node] of scene.nodes) {
      nodes.push({ id: String(id), pose: node.pose, data: node.data });
    }
    return checkDocument(nodes, {
      labelLengthPt: labelLength,
      band: printableBand,
      dpi: media.dpi,
    });
    // sceneVersion is the commit signal — scene mutates in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, scene, sceneVersion, tapeSize, labelLength, printableBand]);

  // Dismissed findings, keyed by node and check. Dismissal is per *problem*,
  // not per callout: fixing an object and breaking it again re-raises it,
  // because the key stops matching a live finding and gets pruned below.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    const live = new Set(diagnostics.map(diagnosticKey));
    setDismissed((prev) => {
      const kept = [...prev].filter((k) => live.has(k));
      return kept.length === prev.size ? prev : new Set(kept);
    });
  }, [diagnostics]);

  // One callout at a time: a stack of popovers over the canvas would obscure
  // the very objects they're about. Errors first — those block printing —
  // then document order, so the remaining findings surface as each is fixed.
  const active = useMemo(() => {
    const showing = diagnostics.filter((d) => !dismissed.has(diagnosticKey(d)));
    return showing.find((d) => d.severity === 'error') ?? showing[0] ?? null;
  }, [diagnostics, dismissed]);

  // Client-space rect of the flagged node: the view is a camera, so world
  // point minus view origin, scaled, offset by the canvas's own position.
  const anchor = useMemo(() => {
    if (!active) return undefined;
    const node = scene.get(active.nodeId as NodeId);
    const container = canvasContainerRef.current;
    if (!node || !container) return undefined;
    const r = container.getBoundingClientRect();
    return {
      x: r.left + (node.pose.x - view.x) * view.scale.x,
      y: r.top + (node.pose.y - view.y) * view.scale.y,
      width: node.pose.width * view.scale.x,
      height: node.pose.height * view.scale.y,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, scene, sceneVersion, view, canvasSize]);

  const dismiss = useCallback(
    (d: Diagnostic) => setDismissed((prev) => new Set(prev).add(diagnosticKey(d))),
    [],
  );
  const reraiseAll = useCallback(() => setDismissed(new Set()), []);

  return { diagnostics, active, anchor, dismiss, reraiseAll };
}
