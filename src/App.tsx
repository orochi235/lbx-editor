import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  SceneCanvas,
  useScene,
  useSelection,
  ActionsProvider,
  DepRegistryProvider,
  SelectionContextProvider,
  asNodeId,
  rectPath,
  polygonFromPoints,
  zoomAt,
  fitViewToBounds,
  meanScale,
  type SceneNode,
  type DrawCommand,
  type View,
  type RenderLayer,
  type NodeId,
  useImageTool,
  getImageBitmap,
  subscribeImageReady,
  textCommand,
  type ToolsApi,
  type InsertNodeFactory,
  type CanvasHelpers,
  defineTool,
} from '@weasel-js/core';
// Subpath imports (not the `@weasel-js/ui` barrel) so tsc/vite only pull in
// the modules we use, not sibling components like DataGrid that trip a
// duplicate-@types/react mismatch under this app's slightly newer React types.
import { ToolPalette } from '@weasel-js/ui/components/ToolPalette';
import { PrefsDialog } from '@weasel-js/ui/components/Prefs';
import { Callout } from '@weasel-js/ui/components/Callout';
import { ToastRegion, toast } from '@weasel-js/ui/components/Toast';
import {
  TAPE_SIZES,
  DEFAULT_TAPE,
  DEFAULT_LABEL_LENGTH,
  tapeWidthMm,
  lineEndpoints,
  type LabelNodeData,
  type LabelLayer,
  type LabelPose,
  type TapeSize,
} from './label';
import { fitLengthToContent } from './autoLength';
import { useLiveLength } from './useLiveLength';
import {
  encodeBarcode,
  barcodeRects,
  barcodeRequest,
  barcodeModuleDots,
  moduleFitness,
  HUMAN_READABLE_HEIGHT_PT,
} from './barcode';
import { exportLbx } from './lbxExport';
import { importLbx } from './lbxImport';
import {
  rgbaToRaster,
  ditherToMask,
  Printers,
  createBrotherPrinter,
  NoGrantedDeviceError,
  type BrotherPrinter,
  type DitherAlgorithm,
  type PrinterStatus,
  type TapeColor,
  type TextColor,
} from 'obwat';
import { printsAsInk, remapNodeInk, tapeColorCss, tapeIsClear, textColorCss } from './tapeColors';
import { DebugPanel } from './DebugPanel';
import { PrinterPanel } from './PrinterPanel';
import { CustomFontsPanel } from './CustomFontsPanel';
import { labelRenderPlan, printableBandPt, renderLabelToRgba } from './labelRender';
import { maskToRgba } from './printPreview';
import { protectedRegions } from './ditherProtect';
import { equalCutMarks, sliceRasterAtCuts } from './cutMarks';
import { PREFS_SCHEMA, type EditorPrefValues } from './prefs';
import { checkDocument, type CheckedNode, type Diagnostic } from './diagnostics';
import { Toolbar } from './Toolbar';
import { PropertyPanel } from './PropertyPanel';
import { fileToBase64, guessMimeType, getImageDimensions, imageDataUri } from './imageUtils';
import { buildImageInsert, type PendingImage } from './imageInsert';
import { BarcodeIcon } from './BarcodeIcon';
import {
  tapeMismatchMessage,
  unrenderableBarcodeMessage,
  undersizedBarcodeMessage,
} from './printPreflight';
import { registerFonts, substituteFontFamily, canvasFontsInUse, toWeaselAlign, toWeaselVerticalAlign } from './fonts';

type LabelNode = SceneNode<LabelNodeData, LabelLayer, LabelPose>;

let nextNodeId = 1;
function genNodeId(): NodeId {
  return asNodeId(`node-${nextNodeId++}`);
}

/** After restoring a persisted scene, advance the id counter past every
 *  restored `node-N` id so new nodes can't collide with them. */
function bumpNodeIdCounter(ids: Iterable<string>): void {
  for (const id of ids) {
    const m = /^node-(\d+)$/.exec(id);
    if (m) nextNodeId = Math.max(nextNodeId, Number(m[1]) + 1);
  }
}

const FIT_PADDING = 16;

/** Set once a USB device grant exists; lets us distinguish "printer asleep" from "never granted". */
const USB_GRANT_FLAG = 'lbx-editor.hasUsbGrant';
const AUTOCUT_KEY = 'lbx-editor.autoCut';
const CASSETTE_COLORS_KEY = 'lbx-editor.cassetteColors';
const DOCUMENT_WARNINGS_KEY = 'lbx-editor.documentWarnings';
const PREFLIGHT_CHECKS_KEY = 'lbx-editor.preflightChecks';
const PRINT_PREVIEW_KEY = 'lbx-editor.printPreview';
const DITHER_KEY = 'lbx-editor.dither';
/** Autosaved document (scene + tape config) — restored on load so a refresh
 *  doesn't lose the label being edited. */
const DOC_KEY = 'lbx-editor.doc';

const DITHER_ALGORITHMS: readonly DitherAlgorithm[] = [
  'threshold', 'floyd-steinberg', 'atkinson', 'bayer',
];

function savedDitherAlgorithm(): DitherAlgorithm {
  const v = localStorage.getItem(DITHER_KEY) as DitherAlgorithm | null;
  return v && DITHER_ALGORITHMS.includes(v) ? v : 'threshold';
}

interface CanvasSize {
  width: number;
  height: number;
}

/** The paper layer extrudes its black brick shadow this far down-right of
 *  the tape rect (see `paperLayer`). Fit/center math counts it as content. */
function paperShadowDepth(paperHeight: number): number {
  return paperHeight * 0.08;
}

// The full drawn footprint of the tape: paper rect + brick shadow.
function paperBounds(paperWidth: number, paperHeight: number) {
  const depth = paperShadowDepth(paperHeight);
  return { x: 0, y: 0, width: paperWidth + depth, height: paperHeight + depth };
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

function drawLabelNode(node: LabelNode, pose: LabelPose, _view: View): DrawCommand[] {
  const { data } = node;
  const { x, y, width, height } = pose;

  switch (data.kind) {
    case 'text': {
      return [textCommand(
        x,
        y,
        data.text,
        {
          fontFamily: substituteFontFamily(data.fontFamily),
          fontSize: data.fontSize,
          fontWeight: data.fontWeight,
          fontStyle: data.italic ? 'italic' : 'normal',
          align: toWeaselAlign(data.horizontalAlignment),
          fill: { fill: 'solid', color: data.color },
        },
        width,   // maxWidth: word-wrap at the box
        height,  // box height for verticalAlign
        toWeaselVerticalAlign(data.verticalAlignment),
      )];
    }
    case 'rect':
      return [{
        kind: 'path',
        path: rectPath(x, y, width, height),
        stroke: { paint: { color: data.strokeStyle }, width: data.strokeWidth },
        ...(data.fillColor ? { fill: { fill: 'solid', color: data.fillColor } } : {}),
      }];
    case 'line': {
      const [p, q] = lineEndpoints({ x, y, width, height }, data.descending);
      return [{
        kind: 'path',
        path: polygonFromPoints([p, q]),
        stroke: { paint: { color: data.strokeStyle }, width: data.strokeWidth },
      }];
    }
    case 'image': {
      // The kit imageCache decodes async; SceneCanvas subscribes to its
      // ready events and redraws, swapping the placeholder for the bitmap.
      const bmp = getImageBitmap(imageDataUri(data));
      if (bmp) {
        return [{ kind: 'image', image: bmp, x, y, w: width, h: height }];
      }
      // Placeholder while loading
      return [{
        kind: 'path',
        path: rectPath(x, y, width, height),
        fill: { fill: 'solid', color: '#f0f0f0' },
        stroke: { paint: { color: '#cccccc' }, width: 0.5 },
      }];
    }
    case 'barcode': {
      const symbol = encodeBarcode(barcodeRequest(data));
      if (!symbol.ok) {
        // Can't encode it — draw a box so the node stays visible and
        // selectable. printPreflight blocks the job rather than printing this.
        return [{
          kind: 'path',
          path: rectPath(x, y, width, height),
          fill: { fill: 'solid', color: '#f6f6f6' },
          stroke: { paint: { color: '#999999' }, width: 0.5 },
        }];
      }
      const commands: DrawCommand[] = barcodeRects(symbol, pose, data.humanReadable).map((r) => ({
        kind: 'path',
        path: rectPath(r.x, r.y, r.width, r.height),
        fill: { fill: 'solid', color: '#000000' },
      }));
      if (data.humanReadable && symbol.kind === '1d') {
        commands.push(textCommand(
          x,
          y + height - HUMAN_READABLE_HEIGHT_PT,
          symbol.text,
          {
            fontFamily: substituteFontFamily('Helvetica'),
            fontSize: HUMAN_READABLE_HEIGHT_PT - 1,
            fontWeight: 400,
            fontStyle: 'normal',
            align: toWeaselAlign(data.humanReadableAlignment),
            fill: { fill: 'solid', color: '#000000' },
          },
          width,
          HUMAN_READABLE_HEIGHT_PT,
          toWeaselVerticalAlign('BOTTOM'),
        ));
      }
      return commands;
    }
    default:
      return [];
  }
}

export function App() {
  // MSDF fonts register asynchronously; text draws blank (no glyphs) until
  // this settles. Flipping this state forces the canvas layers to a new
  // identity (see the `layers` memo below) so text appears without the user
  // having to interact with the canvas.
  const [fontsLoaded, setFontsLoaded] = useState(false);
  useEffect(() => {
    // No cancellation guard on this async callback: App is the root
    // component and never unmounts, so there's nothing to race.
    registerFonts().then(() => setFontsLoaded(true));
  }, []);

  // Declared up here because the label length derives from the scene contents
  // under auto-length, and everything below reads that length.
  const scene = useScene<LabelNodeData, LabelLayer, LabelPose>({
    systemLayers: [{ id: 'objects' as LabelLayer }],
  });

  const [tapeSize, setTapeSize] = useState<TapeSize>(DEFAULT_TAPE);
  const [autoLength, setAutoLength] = useState(false);
  // The length the user typed. Under auto-length it's dormant — kept so that
  // switching auto off doesn't teleport the label back to a stale value.
  const [manualLength, setManualLength] = useState(DEFAULT_LABEL_LENGTH);
  // Cut positions (pt along the label): the printer cuts here, splitting the
  // document into a strip of labels. Round-trips .lbx via style:cutLine.
  const [cutMarks, setCutMarks] = useState<number[]>([]);

  const tape = TAPE_SIZES[tapeSize];

  const sceneVersion = useSyncExternalStore(
    useCallback((cb: () => void) => scene.subscribe(cb), [scene]),
    () => scene.getVersion(),
  );

  // Auto-length: the label ends a margin past the rightmost object, refitting
  // on every committed scene change. Everything downstream reads labelLength
  // and so follows the fit for free.
  const fittedLength = useMemo(
    () => fitLengthToContent([...scene.nodes.values()].map((n) => n.pose)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sceneVersion is the change signal; scene is mutable.
    [scene, sceneVersion],
  );
  const labelLength = autoLength ? fittedLength : manualLength;

  // Turning auto off pins the length where the fit left it, rather than
  // snapping back to whatever was last typed.
  const handleAutoLengthChange = useCallback((auto: boolean) => {
    if (!auto) setManualLength(fittedLength);
    setAutoLength(auto);
  }, [fittedLength]);

  // The Labels control: N equal segments ↔ N-1 evenly spaced cut marks.
  // Setting it replaces any custom (imported) marks with the equal split.
  const handleLabelsCountChange = useCallback((n: number) => {
    const labels = Math.max(1, Math.min(50, Math.round(n)));
    setCutMarks(equalCutMarks(labelLength, labels));
  }, [labelLength]);

  // Marks past the end of a shortened label are meaningless — drop them.
  useEffect(() => {
    setCutMarks((marks) =>
      marks.every((x) => x > 0 && x < labelLength)
        ? marks
        : marks.filter((x) => x > 0 && x < labelLength),
    );
  }, [labelLength]);

  // The "paper" is the printable area of the tape.
  // P-touch labels are landscape: tape width is the short dimension (height visually).
  const paperWidth = labelLength;
  const paperHeight = tape.width;

  // --- Viewport / zoom ---
  // The canvas fills its container; we measure it and feed the size to
  // SceneCanvas (weasel handles device-pixel-ratio internally). All zoom/fit
  // math uses the live size.
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  // Weasel writes its overlay-aware pose/bounds lookups here each render.
  // `getEffectiveBounds` reports the in-flight gesture's proposed box for a
  // node under drag/resize/rotate, and the committed box otherwise — the one
  // reading that lets the label follow a drag weasel hasn't committed yet.
  const helpersRef = useRef<CanvasHelpers<LabelPose> | null>(null);

  // While a drag is in flight the label follows the gesture instead of the
  // committed scene. `displayLength` is for DRAWING ONLY — `labelLength` and
  // `paperWidth` above stay committed, so export, print, autosave, cut-mark
  // pruning and diagnostics never see a transient value. That separation is
  // load-bearing: a mid-drag shrink reaching the cut-mark pruning above would
  // destroy marks on a drag the user then abandoned.
  const getNodeIds = useCallback(() => [...scene.nodes.keys()].map(String), [scene]);
  const { length: liveLength, handlePointerDown: handleCanvasPointerDown } = useLiveLength({
    enabled: autoLength,
    getNodeIds,
    helpersRef,
  });
  const displayLength = liveLength ?? paperWidth;

  const [canvasSize, setCanvasSize] = useState<CanvasSize>({ width: 0, height: 0 });
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: { x: 1, y: 1 } });
  // Live mirror for callbacks that fire outside the render cycle (ResizeObserver).
  const viewRef = useRef(view);
  viewRef.current = view;

  const prevPaperSize = useRef({ w: paperWidth, h: paperHeight });
  const viewInitialized = useRef(false);
  // The last view our own centering produced. While the live view still
  // equals it (the user hasn't panned/zoomed), container resizes re-center
  // instead of leaving the label drifting off-center.
  const lastCenteredView = useRef<View | null>(null);

  const applyCenteredView = useCallback((canvas: CanvasSize) => {
    const { w, h } = prevPaperSize.current;
    const v = centeredView(w, h, canvas);
    lastCenteredView.current = v;
    setView(v);
  }, []);

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
        const c = lastCenteredView.current;
        const v = viewRef.current;
        if (c && v.x === c.x && v.y === c.y && v.scale.x === c.scale.x && v.scale.y === c.scale.y) {
          applyCenteredView({ width, height });
        }
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [applyCenteredView]);

  // Fit the paper to the canvas whenever the paper size changes (tape/length
  // edits and imports both flow through here). The ref guard makes this a no-op
  // on the initial centered view and on canvas-only resizes.
  //
  // Reading the display pair rather than the committed one is what makes the
  // canvas zoom out to follow a label growing under the cursor — the effect
  // then re-runs each frame the extent actually changes.
  useEffect(() => {
    if (canvasSize.width === 0 || canvasSize.height === 0) return;
    if (prevPaperSize.current.w === displayLength && prevPaperSize.current.h === paperHeight) return;
    prevPaperSize.current = { w: displayLength, h: paperHeight };
    setView((v) =>
      fitViewToBounds(paperBounds(displayLength, paperHeight), canvasSize, v, {
        padding: FIT_PADDING,
      }),
    );
  }, [displayLength, paperHeight, canvasSize]);

  const zoomPercent = Math.round(meanScale(view.scale) * 100);
  const handleZoomIn = useCallback(
    () => setView((v) => zoomAt(v, { x: canvasSize.width / 2, y: canvasSize.height / 2 }, 1.25)),
    [canvasSize],
  );
  const handleZoomOut = useCallback(
    () => setView((v) => zoomAt(v, { x: canvasSize.width / 2, y: canvasSize.height / 2 }, 0.8)),
    [canvasSize],
  );
  const handleZoomSet = useCallback(
    (percent: number) => {
      setView((v) =>
        zoomAt(v, { x: canvasSize.width / 2, y: canvasSize.height / 2 }, percent / 100 / meanScale(v.scale)),
      );
    },
    [canvasSize],
  );
  // Reads `displayLength` so a Fit pressed mid-drag frames what's on screen.
  const handleZoomFit = useCallback(() => {
    setView((v) =>
      fitViewToBounds(paperBounds(displayLength, paperHeight), canvasSize, v, {
        padding: FIT_PADDING,
      }),
    );
  }, [displayLength, paperHeight, canvasSize]);
  // One centering path for toolbar Reset, Cmd-0 (via viewport.recenter),
  // and initial load.
  const handleZoomReset = useCallback(
    () => applyCenteredView(canvasSize),
    [applyCenteredView, canvasSize],
  );

  const selection = useSelection();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Session persistence ---
  // Restore the autosaved document once on mount (before the autosave effect
  // below ever writes), then debounce-save scene + tape config on every
  // committed change. Corrupt/stale snapshots are discarded, quota failures
  // skipped — persistence must never take the editor down.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const raw = localStorage.getItem(DOC_KEY);
    if (!raw) return;
    try {
      const doc = JSON.parse(raw) as {
        tapeSize?: TapeSize;
        autoLength?: boolean;
        labelLength?: number;
        cutMarks?: number[];
        scene?: Parameters<typeof scene.loadState>[0];
      };
      if (doc.tapeSize && doc.tapeSize in TAPE_SIZES) setTapeSize(doc.tapeSize);
      if (typeof doc.labelLength === 'number' && Number.isFinite(doc.labelLength) && doc.labelLength > 0) {
        setManualLength(doc.labelLength);
      }
      if (typeof doc.autoLength === 'boolean') setAutoLength(doc.autoLength);
      if (Array.isArray(doc.cutMarks) && doc.cutMarks.every((x) => typeof x === 'number' && Number.isFinite(x))) {
        setCutMarks(doc.cutMarks);
      }
      if (doc.scene) {
        scene.loadState(doc.scene);
        bumpNodeIdCounter(scene.nodes.keys());
      }
    } catch {
      localStorage.removeItem(DOC_KEY);
    }
  }, [scene]);

  useEffect(() => {
    const handle = setTimeout(() => {
      try {
        localStorage.setItem(
          DOC_KEY,
          // labelLength persists the manual value: under auto-length the
          // length is derived from the scene, so it restores itself.
          JSON.stringify({ tapeSize, autoLength, labelLength: manualLength, cutMarks, scene: scene.toJSON() }),
        );
      } catch {
        // Storage full (huge embedded images) or unavailable — skip this save.
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [scene, sceneVersion, tapeSize, autoLength, manualLength, cutMarks]);

  // --- Cassette-driven canvas colors ---
  // The printer's status replies (fed by keepalive ticks, see the printer
  // session effect below) report the loaded cassette's tape + ink colors; the
  // canvas previews that combination. Debug-panel overrides win over the live
  // cassette; the toggle kills the whole behavior. Print is untouched — the
  // printer lays down its one ink regardless of what the screen shows.
  const [printerLastSeen, setPrinterLastSeen] = useState<{ status: PrinterStatus; at: number } | null>(null);
  const [printerReachable, setPrinterReachable] = useState(false);
  const [cassetteColorsEnabled, setCassetteColorsEnabled] = useState(
    () => localStorage.getItem(CASSETTE_COLORS_KEY) !== '0',
  );
  const handleCassetteColorsChange = useCallback((on: boolean) => {
    setCassetteColorsEnabled(on);
    localStorage.setItem(CASSETTE_COLORS_KEY, on ? '1' : '0');
  }, []);
  const [documentWarnings, setDocumentWarnings] = useState(
    () => localStorage.getItem(DOCUMENT_WARNINGS_KEY) !== '0',
  );
  const handleDocumentWarningsChange = useCallback((on: boolean) => {
    setDocumentWarnings(on);
    localStorage.setItem(DOCUMENT_WARNINGS_KEY, on ? '1' : '0');
  }, []);
  const [preflightChecks, setPreflightChecks] = useState(
    () => localStorage.getItem(PREFLIGHT_CHECKS_KEY) !== '0',
  );
  const handlePreflightChecksChange = useCallback((on: boolean) => {
    setPreflightChecks(on);
    localStorage.setItem(PREFLIGHT_CHECKS_KEY, on ? '1' : '0');
  }, []);
  const [tapeColorOverride, setTapeColorOverride] = useState<TapeColor | null>(null);
  const [textColorOverride, setTextColorOverride] = useState<TextColor | null>(null);

  const liveStatus = printerReachable ? (printerLastSeen?.status ?? null) : null;
  const tapeCss =
    (cassetteColorsEnabled ? tapeColorCss(tapeColorOverride ?? liveStatus?.tapeColor) : null) ?? '#ffffff';
  const tapeClear =
    cassetteColorsEnabled && tapeIsClear(tapeColorOverride ?? liveStatus?.tapeColor);
  const inkCss =
    (cassetteColorsEnabled ? textColorCss(textColorOverride ?? liveStatus?.textColor) : null) ?? '#000000';

  // The printhead-reachable band of the current tape, in label points —
  // shared by the dim overlay, the print-preview bitmap, and its placement.
  const printableBand = useMemo(() => {
    const media = Printers.ptP710bt.media(tapeWidthMm(tapeSize));
    return printableBandPt({
      tapeWidthPt: paperHeight,
      printableDots: media.printableDots,
      dpi: media.dpi,
    });
  }, [tapeSize, paperHeight]);

  // --- Live document checks ---
  // Conditions the canvas draws faithfully but the printer can't honor: a
  // barcode too fine for the printhead, an object past the printable area.
  // Recomputed on every committed scene change; the callout anchors to the
  // offending node so the problem is attached to the thing that has it.
  const diagnostics = useMemo(() => {
    if (!documentWarnings) return [];
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
  }, [documentWarnings, scene, sceneVersion, tapeSize, labelLength, printableBand]);

  // Dismissed findings, keyed by node and check. Dismissal is per *problem*,
  // not per callout: fixing an object and breaking it again re-raises it,
  // because the key stops matching a live finding and gets pruned below.
  const [dismissedDiagnostics, setDismissedDiagnostics] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const diagnosticKey = (d: Diagnostic) => `${d.nodeId}:${d.code}`;

  useEffect(() => {
    const live = new Set(diagnostics.map(diagnosticKey));
    setDismissedDiagnostics((prev) => {
      const kept = [...prev].filter((k) => live.has(k));
      return kept.length === prev.size ? prev : new Set(kept);
    });
  }, [diagnostics]);

  // One callout at a time: a stack of popovers over the canvas would obscure
  // the very objects they're about. Errors first — those block printing —
  // then document order, so the remaining findings surface as each is fixed.
  const activeDiagnostic = useMemo(() => {
    const showing = diagnostics.filter((d) => !dismissedDiagnostics.has(diagnosticKey(d)));
    return showing.find((d) => d.severity === 'error') ?? showing[0] ?? null;
  }, [diagnostics, dismissedDiagnostics]);

  // Client-space rect of the flagged node: the view is a camera, so world
  // point minus view origin, scaled, offset by the canvas's own position.
  const diagnosticAnchor = useMemo(() => {
    if (!activeDiagnostic) return undefined;
    const node = scene.get(activeDiagnostic.nodeId as NodeId);
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
  }, [activeDiagnostic, scene, sceneVersion, view, canvasSize]);

  // --- Dithered print preview ---
  // Runs the real print pipeline (renderLabelToRgba → ditherToMask, default
  // threshold — exactly what rgbaToRaster quantizes with) on every committed
  // scene change and draws the resulting dots over the printable band; ink
  // dots take the cassette ink color, everything else is transparent so the
  // tape face shows through. One long-lived GL context is reused across
  // renders; the debounce absorbs bursts of scene mutations.
  const [printPreview, setPrintPreview] = useState(
    () => localStorage.getItem(PRINT_PREVIEW_KEY) === '1',
  );
  const handlePrintPreviewChange = useCallback((on: boolean) => {
    setPrintPreview(on);
    localStorage.setItem(PRINT_PREVIEW_KEY, on ? '1' : '0');
  }, []);
  // Dither algorithm — one setting drives both the preview and the real
  // print job (rgbaToRaster), so what you see is what the head lays down.
  const [ditherAlgorithm, setDitherAlgorithm] = useState<DitherAlgorithm>(savedDitherAlgorithm);
  const handleDitherAlgorithmChange = useCallback((algorithm: DitherAlgorithm) => {
    setDitherAlgorithm(algorithm);
    localStorage.setItem(DITHER_KEY, algorithm);
  }, []);
  const [previewBitmap, setPreviewBitmap] = useState<ImageBitmap | null>(null);
  const previewGlRef = useRef<{ canvas: OffscreenCanvas; gl: WebGL2RenderingContext } | null>(null);
  // While the preview is up the live scene draw is suppressed, so nothing
  // else pulls image nodes through the kit cache — the preview render itself
  // starts the decode and this epoch re-runs it when the bitmap lands.
  const [imageEpoch, setImageEpoch] = useState(0);
  useEffect(() => subscribeImageReady(() => setImageEpoch((n) => n + 1)), []);
  useEffect(() => {
    if (!printPreview) {
      setPreviewBitmap((prev) => {
        prev?.close();
        return null;
      });
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      // Text needs its MSDF atlases registered before renderLabelToRgba draws
      // it; registerFonts() is idempotent so this is a no-op once settled.
      await registerFonts();
      if (cancelled) return;
      if (!previewGlRef.current) {
        const canvas = new OffscreenCanvas(1, 1);
        const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, stencil: true });
        if (!gl) return;
        previewGlRef.current = { canvas, gl };
      }
      const { canvas, gl } = previewGlRef.current;
      const media = Printers.ptP710bt.media(tapeWidthMm(tapeSize));
      const geometry = {
        labelLengthPt: labelLength,
        tapeWidthPt: paperHeight,
        printableDots: media.printableDots,
        dpi: media.dpi,
      };
      // Size the context's drawing buffer to this render before weasel uses it.
      const plan = labelRenderPlan(geometry);
      canvas.width = Math.max(1, Math.round(plan.sourceRect.width * plan.scale.x));
      canvas.height = Math.max(1, Math.round(plan.sourceRect.height * plan.scale.y));
      const rgba = renderLabelToRgba({ scene, drawOne: drawLabelNode, gl, ...geometry });
      const mask = ditherToMask(rgba, {
        algorithm: ditherAlgorithm,
        protect: protectedRegions(scene.nodes.values(), {
          band: printableBandPt(geometry),
          dpi: geometry.dpi,
        }),
      });
      const pixels = maskToRgba(mask, rgba.width, rgba.height, inkCss);
      const out = new OffscreenCanvas(rgba.width, rgba.height);
      const ctx = out.getContext('2d')!;
      ctx.putImageData(new ImageData(pixels, rgba.width, rgba.height), 0, 0);
      const bmp = out.transferToImageBitmap();
      if (cancelled) {
        bmp.close();
        return;
      }
      setPreviewBitmap((prev) => {
        prev?.close();
        return bmp;
      });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [printPreview, sceneVersion, imageEpoch, scene, tapeSize, labelLength, paperHeight, inkCss, ditherAlgorithm]);

  // --- Paper background layer ---
  // The tape is drawn as a black "raised brick": the shadow is the tape's
  // rectangle extruded down-right by `depth`, connected to the tape by
  // diagonal side edges instead of floating behind it. Only the visible
  // L-shaped shadow region is filled (not the front face), so a translucent
  // face — clear tape — shows the canvas background through the strip. The
  // tape face (with a black border) sits on top. Everything is in world units
  // so it scales and pans with the paper; `depth` is keyed to the tape width
  // to stay proportional across tape sizes.
  const paperLayer = useMemo<RenderLayer<unknown>>(() => {
    const depth = paperShadowDepth(paperHeight);
    // The brick silhouette minus the front face, sprung from the face
    // stroke's OUTER boundary (the rect expanded by half the stroke width):
    // attaching at the rect edge instead would leave the stroke's outer half
    // poking past the top-right diagonal as a barb. From the outline's
    // top-right, out to the back face's top-right, around its right +
    // bottom, back to the outline's bottom-left, then along the outline's
    // bottom and right edges.
    const strokeW = 0.5;
    const s = strokeW / 2;
    const x0 = -s;
    const y0 = -s;
    const x1 = displayLength + s;
    const y1 = paperHeight + s;
    const shadow = polygonFromPoints([
      { x: x1, y: y0 },
      { x: x1 + depth, y: y0 + depth },
      { x: x1 + depth, y: y1 + depth },
      { x: x0 + depth, y: y1 + depth },
      { x: x0, y: y1 },
      { x: x1, y: y1 },
    ]);
    return {
      id: 'paper',
      label: 'Label tape',
      draw: () => [
        {
          kind: 'path',
          path: shadow,
          fill: { fill: 'solid', color: '#000000' },
        },
        {
          kind: 'path',
          path: rectPath(0, 0, displayLength, paperHeight),
          fill: { fill: 'solid', color: tapeCss, opacity: tapeClear ? 0.45 : 1 },
          // A dark tape face would vanish against its black brick — lighten
          // the border so the tape edge stays readable.
          stroke: { paint: { color: printsAsInk(tapeCss) ? '#888888' : '#000000' }, width: strokeW },
        },
        // Dithered print preview: the print pipeline's ink dots over the
        // printable band (scene content is suppressed while this is up).
        // Pinned to committed geometry, not the display pair — it's a render
        // of the committed scene, so it goes briefly stale during a gesture
        // and refreshes on commit.
        ...(previewBitmap
          ? [{
              kind: 'image' as const,
              image: previewBitmap,
              x: 0,
              y: printableBand.y,
              w: paperWidth,
              h: printableBand.height,
            }]
          : []),
        // Cut guides: dashed lines where the printer will cut the strip.
        // Drawn last so they stay visible over the print preview.
        ...cutMarks.map((x) => ({
          kind: 'path' as const,
          path: polygonFromPoints([{ x, y: 0 }, { x, y: paperHeight }]),
          stroke: { paint: { color: '#e03131' }, width: 0.4, dash: [2, 2] },
        })),
      ],
    };
  }, [displayLength, paperWidth, paperHeight, tapeCss, tapeClear, previewBitmap, printableBand, cutMarks]);

  // --- Object creation via weasel tools ---
  // The palette activates weasel's built-in rect/line/text tools; their drag
  // gestures route through the `insert` action, which materializes nodes via
  // these per-kind factories. Each returns a `LabelNode`'s data + pose in the
  // app's own shape (matching `drawLabelNode` / PropertyPanel / export) rather
  // than the kit's default `{ path, fill }` node. `tools` is the live ToolsApi
  // that drives the palette.
  const [tools, setTools] = useState<ToolsApi | null>(null);

  // Drag-to-place image tool. `src` is unused: the `image` insertNodeFactory
  // below reads pendingImageRef instead of the binding's params. The tool
  // exists for its palette button, crosshair, and drag-rect insert gesture;
  // the picked file is staged by handleImagePick.
  const pendingImageRef = useRef<PendingImage | null>(null);
  const imageTool = useImageTool({ src: '', label: 'Image' });

  // Drag-to-insert barcode, mirroring the kit's image tool: a declarative drag
  // binding routes through the dispatcher's insert action, and the
  // `insertNodeFactories.barcode` entry below mints the node. The kit
  // explicitly supports factories for kinds it doesn't ship.
  const barcodeTool = useMemo(
    () => defineTool<null>({
      id: 'barcode',
      capabilities: ['creates-shapes'],
      cursor: 'crosshair',
      presentation: { label: 'Barcode', group: 'shape', icon: <BarcodeIcon /> },
      bindings: [
        { spec: { kind: 'drag' }, actionId: 'insert', opts: { params: { kind: 'barcode' } } },
      ],
    }),
    [],
  );

  const toolsPatch = useMemo(
    () => ({ image: imageTool, barcode: barcodeTool }),
    [imageTool, barcodeTool],
  );

  const insertNodeFactories = useMemo<Record<string, InsertNodeFactory>>(() => ({
    rect: (b) => ({
      pose: { x: b.x, y: b.y, width: b.width, height: b.height },
      data: {
        kind: 'rect',
        rounded: false,
        roundness: 0,
        strokeStyle: '#000000',
        strokeWidth: 0.8,
        fillColor: null,
      } satisfies LabelNodeData,
    }),
    line: (b, extras) => {
      // The line tool passes its endpoints in `extras`; fall back to the AABB
      // diagonal. Height floors at the stroke width so the pose stays pickable.
      const e = extras as { a?: { x: number; y: number }; b?: { x: number; y: number } };
      const a = e.a ?? { x: b.x, y: b.y };
      const c = e.b ?? { x: b.x + b.width, y: b.y + b.height };
      return {
        pose: {
          x: Math.min(a.x, c.x),
          y: Math.min(a.y, c.y),
          width: Math.max(Math.abs(c.x - a.x), 1),
          height: Math.max(Math.abs(c.y - a.y), 0.5),
        },
        data: {
          kind: 'line',
          strokeStyle: '#000000',
          strokeWidth: 0.5,
          descending: (c.x - a.x) * (c.y - a.y) >= 0,
        } satisfies LabelNodeData,
      };
    },
    text: (b) => ({
      pose: { x: b.x, y: b.y, width: Math.max(b.width, 40), height: Math.max(b.height, 12) },
      data: {
        kind: 'text',
        text: 'Text',
        fontFamily: 'Helvetica',
        fontSize: 12,
        fontWeight: 700,
        italic: false,
        horizontalAlignment: 'LEFT',
        verticalAlignment: 'CENTER',
        color: '#000000',
      } satisfies LabelNodeData,
    }),
    image: (b) => buildImageInsert(pendingImageRef.current, b),
    barcode: (b) => ({
      pose: {
        x: b.x,
        y: b.y,
        width: Math.max(b.width, 40),
        height: Math.max(b.height, 16),
      },
      data: {
        kind: 'barcode',
        protocol: 'CODE128',
        data: '12345678',
        barWidth: 1.2,
        barRatio: '1:3',
        humanReadable: true,
        humanReadableAlignment: 'CENTER',
        checkDigit: false,
        zeroFill: false,
      } satisfies LabelNodeData,
    }),
  }), []);

  const toolsRef = useRef(tools);
  toolsRef.current = tools;

  const addImageFromFile = useCallback(async (file: File) => {
    try {
      const mimeType = file.type || guessMimeType(file.name);
      const base64 = await fileToBase64(file);
      const dims = await getImageDimensions(base64, mimeType, paperWidth - 20, paperHeight - 10);

      const id = genNodeId();
      scene.add({
        kind: 'leaf',
        id,
        layer: 'objects' as LabelLayer,
        pose: { x: 10, y: 5, width: dims.width, height: dims.height },
        data: {
          kind: 'image',
          src: base64,
          originalName: file.name,
          mimeType,
        },
      });
      selection.set([id]);
    } catch {
      toast.error('Image not readable', {
        description: `Chrome may not decode "${file.name}". Try a PNG or JPEG.`,
      });
    }
  }, [scene, selection, paperWidth, paperHeight]);

  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleImagePick = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (imageInputRef.current) imageInputRef.current.value = '';
    if (!file) return;
    try {
      const mimeType = file.type || guessMimeType(file.name);
      const src = await fileToBase64(file);
      const dims = await getImageDimensions(src, mimeType, paperWidth - 20, paperHeight - 10);
      pendingImageRef.current = {
        src,
        originalName: file.name,
        mimeType,
        defaultWidth: dims.width,
        defaultHeight: dims.height,
      };
    } catch {
      // Undecodable pick: without this, the crosshair stays armed and every
      // drag silently inserts nothing (the factory rejects on null pending).
      pendingImageRef.current = null;
      if (toolsRef.current?.active === 'image') toolsRef.current.setActive('select');
      toast.error('Image not readable', {
        description: `Chrome may not decode "${file.name}". Try a PNG or JPEG.`,
      });
    }
  }, [paperWidth, paperHeight]);

  // The palette's IMG button just does tools.setActive('image') (registry-
  // driven palette, no picker hook on the tool). Observe the activation
  // transition and open the hidden file input; a fresh pick happens on every
  // entry into the tool. Re-picking without switching tools first is not
  // supported (setActive on the active id is a no-op).
  const prevActiveToolRef = useRef<string | null>(null);
  useEffect(() => {
    const active = tools?.active ?? null;
    if (active === 'image' && prevActiveToolRef.current !== 'image') {
      imageInputRef.current?.click();
    }
    prevActiveToolRef.current = active;
  }, [tools]);

  // Dismissing the picker means "never mind": revert to select so an
  // imageless crosshair tool isn't left active. Native `cancel` event
  // (Chrome 113+); this app is Chrome-only (WebUSB).
  useEffect(() => {
    const input = imageInputRef.current;
    if (!input) return;
    const onCancel = () => {
      const t = toolsRef.current;
      if (t?.active === 'image') t.setActive('select');
    };
    input.addEventListener('cancel', onCancel);
    return () => input.removeEventListener('cancel', onCancel);
  }, []);

  // Shared by the Open .lbx button and canvas drag-and-drop: replace the
  // whole document with the file's contents.
  const loadLbxFile = useCallback(async (file: File) => {
    try {
      const result = await importLbx(file);
      setTapeSize(result.tapeSize);
      setAutoLength(result.autoLength);
      // Under auto-length the imported length is already the fitted one, so
      // this only decides where a later auto-off lands.
      setManualLength(result.labelLength);
      setCutMarks(result.cutMarks);

      // Clear existing scene
      for (const [id] of scene.nodes) {
        scene.remove(id);
      }
      // Insert imported nodes
      for (const node of result.nodes) {
        scene.add({
          kind: 'leaf',
          id: asNodeId(node.id),
          layer: 'objects' as LabelLayer,
          pose: node.pose,
          data: node.data,
        });
      }
    } catch {
      toast.error('Not a readable .lbx', {
        description: `"${file.name}" couldn't be parsed as a P-touch label file.`,
      });
    }
  }, [scene]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    // .lbx has no reliable MIME type (it's a zip) — go by extension.
    if (file.name.toLowerCase().endsWith('.lbx')) {
      void loadLbxFile(file);
    } else if (file.type.startsWith('image/')) {
      addImageFromFile(file);
    }
  }, [loadLbxFile, addImageFromFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  // --- Export ---
  const handleExport = useCallback(async () => {
    const nodes: { id: string; data: LabelNodeData; pose: LabelPose }[] = [];
    for (const [, node] of scene.nodes) {
      nodes.push({ id: node.id, data: node.data, pose: node.pose });
    }
    const buf = await exportLbx(nodes, tapeSize, autoLength, labelLength, cutMarks);
    const blob = new Blob([buf as BlobPart], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'label.lbx';
    a.click();
    URL.revokeObjectURL(url);
  }, [scene, tapeSize, autoLength, labelLength, cutMarks]);

  // --- Import ---
  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await loadLbxFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [loadLbxFile]);

  // --- Print ---
  const [printing, setPrinting] = useState(false);
  const [autoCut, setAutoCut] = useState(() => localStorage.getItem(AUTOCUT_KEY) !== '0');
  const handleAutoCutChange = useCallback((on: boolean) => {
    setAutoCut(on);
    localStorage.setItem(AUTOCUT_KEY, on ? '1' : '0');
  }, []);
  const printingRef = useRef(false);

  // --- Preferences modal ---
  // A second view over the settings the sidebar panels edit: each leaf path
  // dispatches to the same persisting setter, so both surfaces stay in sync.
  const [prefsOpen, setPrefsOpen] = useState(false);
  const prefValues: EditorPrefValues = useMemo(() => ({
    printing: { autoCut, printPreview, dithering: ditherAlgorithm, preflightChecks },
    canvas: { cassetteColors: cassetteColorsEnabled, documentWarnings },
  }), [autoCut, printPreview, ditherAlgorithm, preflightChecks, cassetteColorsEnabled, documentWarnings]);
  const handlePrefChange = useCallback((path: string, value: unknown) => {
    switch (path) {
      case 'printing.autoCut': handleAutoCutChange(value as boolean); break;
      case 'printing.printPreview': handlePrintPreviewChange(value as boolean); break;
      case 'printing.dithering': handleDitherAlgorithmChange(value as DitherAlgorithm); break;
      case 'canvas.cassetteColors': handleCassetteColorsChange(value as boolean); break;
      case 'canvas.documentWarnings': handleDocumentWarningsChange(value as boolean); break;
      case 'printing.preflightChecks': handlePreflightChecksChange(value as boolean); break;
    }
  }, [handleAutoCutChange, handlePrintPreviewChange, handleDitherAlgorithmChange, handleCassetteColorsChange, handleDocumentWarningsChange, handlePreflightChecksChange]);

  // One connectionless printer session per mount. Its keepalive keeps the
  // PT-P710BT awake (it auto-powers off after ~10 min idle); its status
  // events — keepalive ticks and post-print statuses alike — feed the chip.
  const printerRef = useRef<BrotherPrinter | null>(null);
  useEffect(() => {
    const printer = createBrotherPrinter();
    printerRef.current = printer;
    const off = printer.onStatus((status) => {
      setPrinterReachable(status !== null);
      if (status !== null) setPrinterLastSeen({ status, at: Date.now() });
    });
    return () => {
      off();
      printerRef.current = null;
      printer.dispose();
    };
  }, []);

  // Chip click: immediate status poll. The reply (or timeout) lands through
  // the same onStatus stream the keepalive feeds, so the chip just updates.
  const handlePrinterRefresh = useCallback(() => {
    void printerRef.current?.queryStatus();
  }, []);

  const handlePrint = useCallback(async () => {
    if (printingRef.current) return;
    const printer = printerRef.current;
    if (!printer) return;
    const widthMm = tapeWidthMm(tapeSize);
    if (!('usb' in navigator) && !('serial' in navigator)) {
      toast.error('Printing not supported here', {
        description: 'This browser has neither WebUSB nor Web Serial. Use Chrome or Edge.',
      });
      return;
    }
    // Preflight before touching the printer: a barcode we can't encode draws
    // as a placeholder box, and one scaled under a dot per module prints as a
    // smear. Either way the tape is spent on a label whose barcode isn't one.
    // Skipped wholesale when pre-print checks are off — the user has said they
    // want the job sent regardless, and the printer remains the authority.
    let unrenderable = 0;
    let undersized = 0;
    for (const [, node] of (preflightChecks ? scene.nodes : [])) {
      if (node.data.kind !== 'barcode') continue;
      const symbol = encodeBarcode(barcodeRequest(node.data));
      if (!symbol.ok) {
        unrenderable++;
      } else if (
        moduleFitness(barcodeModuleDots(symbol, node.pose, Printers.ptP710bt.dpi)) === 'unrenderable'
      ) {
        undersized++;
      }
    }
    const barcodeProblem = unrenderableBarcodeMessage(unrenderable)
      ?? undersizedBarcodeMessage(undersized);
    if (barcodeProblem) {
      // Re-raise every dismissed callout: the job is being refused over a
      // problem the user may have waved away, so put it back on the object.
      setDismissedDiagnostics(new Set());
      toast.error('Print blocked', { description: barcodeProblem });
      return;
    }

    setPrinting(true);
    printingRef.current = true;
    try {
      // Preflight: the printer tells us what tape it's holding, so a
      // mismatched job (printer blinks red, generic error reply) is caught
      // before it's sent. Unknown media (asleep printer, no usable width in
      // the reply) proceeds — the printer stays the authority.
      const loaded = await printer.queryMedia();
      const mismatch = preflightChecks
        ? tapeMismatchMessage(widthMm, loaded?.tapeWidthMm ?? null)
        : null;
      if (mismatch) {
        toast.error('Tape size mismatch', { description: mismatch });
        return;
      }
      const media = Printers.ptP710bt.media(widthMm);
      // Text needs its MSDF atlases registered before renderLabelToRgba draws
      // it; registerFonts() is idempotent so this is a no-op once settled.
      await registerFonts();
      const machineFamilies: string[] = [];
      for (const [, node] of scene.nodes) {
        if (node.data.kind === 'text') machineFamilies.push(node.data.fontFamily);
      }
      const machineFonts = canvasFontsInUse(machineFamilies);
      if (preflightChecks && machineFonts.length > 0) {
        toast.info('Using fonts from this machine', {
          description:
            `${machineFonts.join(', ')} — this label prints correctly here, but machines ` +
            'without those fonts will substitute.',
        });
      }
      // Same drawOne as the screen path, through weasel's headless renderer —
      // print is the screen's rendering at printer resolution.
      const geometry = {
        labelLengthPt: labelLength,
        tapeWidthPt: paperHeight,
        printableDots: media.printableDots,
        dpi: media.dpi,
      };
      const rgba = renderLabelToRgba({ scene, drawOne: drawLabelNode, ...geometry });
      const raster = rgbaToRaster(rgba, media, {
        algorithm: ditherAlgorithm,
        protect: protectedRegions(scene.nodes.values(), {
          band: printableBandPt(geometry),
          dpi: media.dpi,
        }),
      });
      // Cut marks slice the job into pages; the cutter fires between pages
      // (with auto-cut on), printing the document as a strip of labels.
      const job = sliceRasterAtCuts(raster, cutMarks, media.dpi);
      const jobOpts = { tapeWidthMm: widthMm, autoCut, marginDots: 0 };

      let status: PrinterStatus;
      try {
        // Zero-click path: an already-granted device. The facade's mutex waits
        // out any in-flight keepalive tick (≤2 s; Chrome's user-activation
        // window comfortably outlives it if we fall through to the picker).
        status = await printer.print(job, jobOpts);
      } catch (err) {
        if (!(err instanceof NoGrantedDeviceError)) throw err;
        if (localStorage.getItem(USB_GRANT_FLAG)) {
          // One-shot hint: clearing the flag means a repeat click falls through to
          // the picker, so a revoked permission can't dead-end the Print button.
          localStorage.removeItem(USB_GRANT_FLAG);
          toast.error('Printer not found', {
            description:
              'It may have auto-powered off. Press its power button, then print again.',
          });
          return;
        }
        await printer.requestDevice();
        status = await printer.print(job, jobOpts);
      }
      // A grant exists (the print went through) — remember for the
      // asleep-vs-never-granted hint. Serial grants don't persist, so
      // the flag stays USB-only.
      if ('usb' in navigator) localStorage.setItem(USB_GRANT_FLAG, '1');
      if (status.hasError) {
        toast.error('Printer reported an error', {
          description: 'Check the tape and that the cover is closed.',
        });
      } else if (status.incomplete) {
        toast.warning('Print sent, status unclear', {
          description: "The printer's status reply was incomplete — check the printer.",
        });
      }
    } catch (err) {
      // Dismissing the device/port picker is a normal cancel, not a failure.
      if (err instanceof DOMException && err.name === 'NotFoundError') return;
      toast.error('Print failed', { description: (err as Error).message });
    } finally {
      printingRef.current = false;
      setPrinting(false);
    }
  }, [printing, tapeSize, scene, labelLength, paperHeight, autoCut, ditherAlgorithm, cutMarks, preflightChecks]);

  // Screen draw: same drawLabelNode as print, but with ink-dark node colors
  // recolored to the cassette's ink first. Print keeps the raw node data (a
  // white-ink remap would erase the label under the <128 luminance threshold).
  const drawScreenNode = useCallback((node: LabelNode, pose: LabelPose, view: View) => {
    const data = remapNodeInk(node.data, inkCss);
    return drawLabelNode(data === node.data ? node : { ...node, data }, pose, view);
  }, [inkCss]);

  // --- Printable-bounds overlay ---
  // Content outside the printable area won't print: print crops at the label
  // length horizontally and at the printhead's reach vertically (the tape's
  // top/bottom margins — labelRender renders only the centered printable
  // band). Draw the scene twice: a faded full copy, then a crisp copy
  // clipped to that band — anything unprintable reads as semitransparent.
  // Commands and the clip path are world-space; weasel applies the view.
  // Follows the display pair: without that, a dragged object would read as
  // semitransparent — "outside the label" — while sitting inside the label
  // that just grew to hold it.
  const printablePath = useMemo(
    () => rectPath(0, printableBand.y, displayLength, printableBand.height),
    [printableBand, displayLength],
  );
  const dimOffLabel = useCallback(
    (cmds: DrawCommand[]): DrawCommand[] =>
      cmds.length === 0
        ? cmds
        : [
            { kind: 'group', alpha: 0.35, children: cmds },
            { kind: 'group', clip: printablePath, children: cmds },
          ],
    [printablePath],
  );

  // While the print preview bitmap is up, the live scene draw is suppressed —
  // the paper layer's dithered dots ARE the content. Selection handles stay.
  const drawNothing = useCallback(() => [], []);
  const layers = useMemo(() => ({
    paper: { layer: paperLayer, before: 'scene' as const },
    scene: previewBitmap
      ? { drawOne: drawNothing }
      : { drawOne: drawScreenNode, postProcess: dimOffLabel },
    selectionOverlay: { handles: { size: 5 } },
    // fontsLoaded isn't read here — it's a dependency only, so that the
    // fonts-ready transition changes this object's identity and SceneCanvas
    // redraws (mirroring how `previewBitmap` already does).
  }), [paperLayer, previewBitmap, drawNothing, drawScreenNode, dimOffLabel, fontsLoaded]);

  return (
    <DepRegistryProvider>
      <ActionsProvider>
        <SelectionContextProvider>
          <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
            <Toolbar
              tapeSize={tapeSize}
              onTapeSizeChange={setTapeSize}
              autoLength={autoLength}
              onAutoLengthChange={handleAutoLengthChange}
              // The display value, so the readout tracks a drag in progress.
              // Safe in both modes: the field is disabled under Auto (pure
              // readout), and with Auto off the live hook is disabled, so this
              // is exactly `labelLength`.
              labelLength={displayLength}
              onLabelLengthChange={setManualLength}
              labelsCount={cutMarks.length + 1}
              onLabelsCountChange={handleLabelsCountChange}
              onExport={handleExport}
              onImport={() => fileInputRef.current?.click()}
              onPrint={handlePrint}
              printDisabled={printing}
              zoomPercent={zoomPercent}
              onZoomIn={handleZoomIn}
              onZoomOut={handleZoomOut}
              onZoomSet={handleZoomSet}
              onZoomFit={handleZoomFit}
              onZoomReset={handleZoomReset}
              printerLastSeen={printerLastSeen}
              printerReachable={printerReachable}
              onPrinterRefresh={handlePrinterRefresh}
              onOpenPrefs={() => setPrefsOpen(true)}
            />
            <PrefsDialog
              isOpen={prefsOpen}
              onOpenChange={setPrefsOpen}
              schema={PREFS_SCHEMA}
              values={prefValues}
              onChange={handlePrefChange}
            />
            {/* Results of things the user just did — a print that failed, a
                file that wouldn't parse. Document problems get an anchored
                callout instead, since those have an object to point at. */}
            <ToastRegion />
            <input
              ref={fileInputRef}
              type="file"
              accept=".lbx"
              style={{ display: 'none' }}
              onChange={handleImport}
            />
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleImagePick}
            />
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              {/* `view` hoisted so the hand tool sits right below select. */}
              {tools && (
                <ToolPalette
                  tools={tools}
                  orientation="vertical"
                  groupOrder={['select', 'view', 'shape', 'draw', 'type']}
                />
              )}
              <div
                ref={canvasContainerRef}
                style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#e0e0e0', lineHeight: 0 }}
                onPointerDown={handleCanvasPointerDown}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
              >
                {canvasSize.width > 0 && canvasSize.height > 0 && (
                  <SceneCanvas<LabelNodeData, LabelLayer, LabelPose>
                    width={canvasSize.width}
                    height={canvasSize.height}
                    scene={scene}
                    selection={selection}
                    selectionMode="multi"
                    defaultTools={['select', 'hand', 'rect', 'line', 'text']}
                    tools={toolsPatch}
                    insertNodeFactories={insertNodeFactories}
                    onToolsCreated={setTools}
                    selectTool={{ rotate: false }}
                    // Truthy `viewport` registers the hand (pan) tool so it
                    // appears in the palette. Wheel pan + zoom are on by default
                    // regardless. `recenter` routes Cmd-0 through the same
                    // center-the-label view as the toolbar Reset button.
                    viewport={{ recenter: handleZoomReset }}
                    view={view}
                    onViewChange={setView}
                    helpersRef={helpersRef}
                    layers={layers}
                  />
                )}
                {/* Dismissable, but the dismissal only holds while the label
                    is being edited: a blocked print clears them all, so the
                    reason the job won't go is back in front of the user. */}
                {activeDiagnostic && diagnosticAnchor && (
                  <Callout
                    isOpen
                    anchorRect={diagnosticAnchor}
                    placement="top"
                    tone={activeDiagnostic.severity === 'error' ? 'danger' : 'warning'}
                    title={activeDiagnostic.title}
                    // Dismissal is ours: `isOpen` stays true while the finding
                    // stands, and `onDismiss` — the × or Escape, never the
                    // incidental close a non-modal popover does when a click
                    // lands on the artwork — is what retires it.
                    onDismiss={() => setDismissedDiagnostics((prev) =>
                      new Set(prev).add(`${activeDiagnostic.nodeId}:${activeDiagnostic.code}`),
                    )}
                    shouldCloseOnInteractOutside={() => false}
                    aria-label={activeDiagnostic.title}
                  >
                    <p>{activeDiagnostic.detail}</p>
                    {diagnostics.length > 1 && (
                      <p>
                        {diagnostics.length - 1} other{' '}
                        {diagnostics.length === 2 ? 'object needs' : 'objects need'} attention.
                      </p>
                    )}
                  </Callout>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <PropertyPanel scene={scene} selection={selection} />
                <PrinterPanel
                  lastSeen={printerLastSeen}
                  reachable={printerReachable}
                  printing={printing}
                  onRefresh={handlePrinterRefresh}
                  autoCut={autoCut}
                  onAutoCutChange={handleAutoCutChange}
                  printPreview={printPreview}
                  onPrintPreviewChange={handlePrintPreviewChange}
                  ditherAlgorithm={ditherAlgorithm}
                  onDitherAlgorithmChange={handleDitherAlgorithmChange}
                />
                <DebugPanel
                  cassetteColorsEnabled={cassetteColorsEnabled}
                  onCassetteColorsEnabledChange={handleCassetteColorsChange}
                  tapeColorOverride={tapeColorOverride}
                  onTapeColorOverrideChange={setTapeColorOverride}
                  textColorOverride={textColorOverride}
                  onTextColorOverrideChange={setTextColorOverride}
                  liveStatus={liveStatus}
                />
                <CustomFontsPanel />
              </div>
            </div>
          </div>
        </SelectionContextProvider>
      </ActionsProvider>
    </DepRegistryProvider>
  );
}
