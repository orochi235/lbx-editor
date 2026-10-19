import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  zoomAt,
  fitViewToBounds,
  meanScale,
  type View,
  type CanvasHelpers,
  type Scene,
} from '@weasel-js/core';
import type { LabelLayer, LabelNodeData, LabelPose } from './label';
import { useLiveLength } from './useLiveLength';
import { paperBounds, paperShadowDepth } from './paperLayer';

const FIT_PADDING = 16;

export interface CanvasSize {
  width: number;
  height: number;
}

// View that centers the drawn tape (shadow included) at 100% (scale 1) in a
// canvas of the given size.
function centeredView(paperWidth: number, paperHeight: number, canvas: CanvasSize): View {
  const depth = paperShadowDepth(paperHeight);
  return {
    x: (paperWidth + depth) / 2 - canvas.width / 2,
    y: (paperHeight + depth) / 2 - canvas.height / 2,
    scale: { x: 1, y: 1 },
  };
}

interface CanvasViewArgs {
  scene: Scene<LabelNodeData, LabelLayer, LabelPose>;
  autoLength: boolean;
  paperWidth: number;
  paperHeight: number;
}

/**
 * The canvas's size, camera and zoom controls, and the label length it draws.
 * The canvas fills its container; this measures it and feeds the size to
 * SceneCanvas (weasel handles device-pixel-ratio internally). All zoom/fit
 * math uses the live size.
 */
export function useCanvasView({ scene, autoLength, paperWidth, paperHeight }: CanvasViewArgs) {
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  // Weasel writes its overlay-aware pose/bounds lookups and its gesture
  // subscription here each render. `getEffectiveBounds` reports the in-flight
  // gesture's proposed box for a node under drag/resize/rotate, and the
  // committed box otherwise — the one reading that lets the label follow a
  // drag weasel hasn't committed yet.
  const helpersRef = useRef<CanvasHelpers<LabelPose> | null>(null);

  const [canvasSize, setCanvasSize] = useState<CanvasSize>({ width: 0, height: 0 });
  const canvasMounted = canvasSize.width > 0 && canvasSize.height > 0;

  // While a drag is in flight the label follows the gesture instead of the
  // committed scene. `displayLength` is for DRAWING ONLY — the committed
  // length the caller passes as `paperWidth` stays what export, print,
  // autosave, cut-mark pruning and diagnostics see. That separation is
  // load-bearing: a mid-drag shrink reaching the cut-mark pruning would
  // destroy marks on a drag the user then abandoned.
  const getNodeIds = useCallback(() => [...scene.nodes.keys()].map(String), [scene]);
  const liveLength = useLiveLength({
    enabled: autoLength,
    // The hook subscribes to weasel's gesture layer, which only exists once
    // the canvas has rendered — the same condition that gates it.
    ready: canvasMounted,
    getNodeIds,
    helpersRef,
  });
  const displayLength = liveLength ?? paperWidth;

  const [view, setView] = useState<View>({ x: 0, y: 0, scale: { x: 1, y: 1 } });
  // Live mirror for callbacks that fire outside the render cycle (ResizeObserver).
  const viewRef = useRef(view);
  viewRef.current = view;

  const prevPaperSize = useRef({ w: paperWidth, h: paperHeight });
  const viewInitialized = useRef(false);
  // The last view our own centering or fitting produced, and how to redo it.
  // While the live view still equals it (the user hasn't panned/zoomed),
  // container resizes redo the framing instead of leaving the label drifting
  // off-center or running off the canvas.
  const autoFrame = useRef<{ view: View; frame: (canvas: CanvasSize) => View } | null>(null);

  const applyFrame = useCallback((frame: (canvas: CanvasSize) => View, canvas: CanvasSize) => {
    const v = frame(canvas);
    autoFrame.current = { view: v, frame };
    setView(v);
  }, []);

  const applyCenteredView = useCallback((canvas: CanvasSize) => {
    const { w, h } = prevPaperSize.current;
    applyFrame((c) => centeredView(w, h, c), canvas);
  }, [applyFrame]);

  const applyFitView = useCallback((length: number, height: number, canvas: CanvasSize) => {
    applyFrame(
      (c) => fitViewToBounds(paperBounds(length, height), c, viewRef.current, { padding: FIT_PADDING }),
      canvas,
    );
  }, [applyFrame]);

  // Measure the container before paint and on resize. On the first valid
  // measurement, center the paper at 100%. Later resizes keep the label
  // centered as long as the view is still the centered one — the palette and
  // side panels mount a beat after the first measurement and shrink the
  // container, which otherwise strands the label off-center. Once the user
  // moves the view, resizes just change the drawing surface.
  useLayoutEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      setCanvasSize({ width, height });
      if (width <= 0 || height <= 0) return;
      if (!viewInitialized.current) {
        viewInitialized.current = true;
        applyCenteredView({ width, height });
      } else {
        // Compared OUTSIDE the state updater: mutating the ref inside a
        // setView callback breaks under StrictMode's double-invocation.
        const auto = autoFrame.current;
        const c = auto?.view;
        const v = viewRef.current;
        if (c && v.x === c.x && v.y === c.y && v.scale.x === c.scale.x && v.scale.y === c.scale.y) {
          applyFrame(auto.frame, { width, height });
        }
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [applyCenteredView, applyFrame]);

  // Fit the paper to the canvas whenever the paper size changes (tape/length
  // edits and imports both flow through here). The ref guard makes this a no-op
  // on the initial centered view and on canvas-only resizes.
  //
  // Reading the display pair rather than the committed one is what makes the
  // canvas zoom out to follow a label growing under the cursor — the effect
  // then re-runs each frame the extent actually changes.
  //
  // Mid-gesture the view only zooms out, never in: zooming in under a
  // shrinking label maps the still pointer further left, which shrinks the
  // label again — a drag on the rightmost object ran away to its minimum. The
  // committed length refits once the gesture ends.
  useEffect(() => {
    if (canvasSize.width === 0 || canvasSize.height === 0) return;
    if (prevPaperSize.current.w === displayLength && prevPaperSize.current.h === paperHeight) return;
    if (liveLength !== null && displayLength < prevPaperSize.current.w) return;
    prevPaperSize.current = { w: displayLength, h: paperHeight };
    applyFitView(displayLength, paperHeight, canvasSize);
  }, [displayLength, liveLength, paperHeight, canvasSize, applyFitView]);

  const zoom = meanScale(view.scale);
  const handleZoomIn = useCallback(
    () => setView((v) => zoomAt(v, { x: canvasSize.width / 2, y: canvasSize.height / 2 }, 1.25)),
    [canvasSize],
  );
  const handleZoomOut = useCallback(
    () => setView((v) => zoomAt(v, { x: canvasSize.width / 2, y: canvasSize.height / 2 }, 0.8)),
    [canvasSize],
  );
  const handleZoomSet = useCallback(
    (scale: number) => {
      setView((v) =>
        zoomAt(v, { x: canvasSize.width / 2, y: canvasSize.height / 2 }, scale / meanScale(v.scale)),
      );
    },
    [canvasSize],
  );
  // Reads `displayLength` so a Fit pressed mid-drag frames what's on screen.
  const handleZoomFit = useCallback(
    () => applyFitView(displayLength, paperHeight, canvasSize),
    [applyFitView, displayLength, paperHeight, canvasSize],
  );
  // One centering path for toolbar Reset, Cmd-0 (via viewport.recenter),
  // and initial load.
  const handleZoomReset = useCallback(
    () => applyCenteredView(canvasSize),
    [applyCenteredView, canvasSize],
  );

  return {
    canvasContainerRef, helpersRef,
    canvasSize, canvasMounted,
    displayLength,
    view, setView, viewRef,
    zoom, handleZoomIn, handleZoomOut, handleZoomSet, handleZoomFit, handleZoomReset,
  };
}
