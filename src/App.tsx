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
  type DrawCommand,
  type View,
  type RenderLayer,
  type NodeId,
  useImageTool,
  useHandTool,
  useLineTool,
  useRectTool,
  useTextTool,
  subscribeImageReady,
  type ToolsApi,
  type InsertNodeFactory,
  type CanvasHelpers,
  type BoundsConstraint,
  defineTool,
} from '@weasel-js/core';
// Subpath imports (not the `@weasel-js/ui` barrel) so tsc/vite only pull in
// the modules we use, not sibling components like DataGrid that trip a
// duplicate-@types/react mismatch under this app's slightly newer React types.
import { ToolPalette } from '@weasel-js/ui/components/ToolPalette';
import { PrefsDialog } from '@weasel-js/ui/components/Prefs';
import { ToastRegion, toast } from '@weasel-js/ui/components/Toast';
import {
  TAPE_SIZES,
  tapeWidthMm,
  type LabelNodeData,
  type LabelLayer,
  type LabelPose,
  type LabelNode,
} from './label';
import { useLabelConfig } from './useLabelConfig';
import { useAutosave } from './useAutosave';
import { genNodeId } from './nodeIds';
import { useCanvasView } from './useCanvasView';
import { useCanvasLayers } from './useCanvasLayers';
import { PALETTE_GROUP_ORDER, TOOL_GROUPS, inGroup } from './toolGroups';
import { drawLabelNode, printDrawOne } from './drawLabelNode';
import {
  encodeBarcode,
  barcodeRequest,
  barcodeModuleDots,
  moduleFitness,
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
import { printsAsInk, remapNodeInk } from './tapeColors';
import { labelRenderPlan, printableBandPt, renderLabelToRgba } from './labelRender';
import { maskToRgba } from './printPreview';
import { protectedRegions } from './ditherProtect';
import { sliceRasterAtCuts } from './cutMarks';
import { PREFS_SCHEMA } from './prefs';
import { useDocumentChecks } from './useDocumentChecks';
import { DiagnosticCallout } from './DiagnosticCallout';
import { LabShell } from '@weasel-js/labkit';
import { Toolbar } from './Toolbar';
import { Inspector } from './Inspector';
import { EditorStatusBar } from './EditorStatusBar';
import { createCursorStore } from './cursorStore';
import { useEditorPrefs } from './useEditorPrefs';
import { usePrinterSession } from './usePrinterSession';
import { useCassetteColors } from './useCassetteColors';
import { usePrintPreview } from './usePrintPreview';
import { usePrintJob } from './usePrintJob';
import './app.css';
import { cutGuides, printableMarginGuides } from './guides';
import { snapNodePose } from './dotSnap';
import { PRINT_DPI } from './printDpi';
import { fileToBase64, guessMimeType, getImageDimensions } from './imageUtils';
import { buildImageInsert, type PendingImage } from './imageInsert';
import { icon } from './icons';
import {
  tapeMismatchMessage,
  unrenderableBarcodeMessage,
  undersizedBarcodeMessage,
} from './printPreflight';
import { registerFonts, canvasFontsInUse } from './fonts';

export function App() {
  // Declared up here because the label length derives from the scene contents
  // under auto-length, and everything below reads that length.
  const scene = useScene<LabelNodeData, LabelLayer, LabelPose>({
    systemLayers: [{ id: 'objects' as LabelLayer }],
  });

  const sceneVersion = useSyncExternalStore(
    useCallback((cb: () => void) => scene.subscribe(cb), [scene]),
    () => scene.getVersion(),
  );

  const config = useLabelConfig(scene, sceneVersion);
  const {
    tapeSize, setTapeSize, autoLength, setAutoLength, handleAutoLengthChange,
    setManualLength, cutMarks, setCutMarks, handleLabelsCountChange, labelLength,
  } = config;
  const tape = TAPE_SIZES[tapeSize];

  // The "paper" is the printable area of the tape.
  // P-touch labels are landscape: tape width is the short dimension (height visually).
  const paperWidth = labelLength;
  const paperHeight = tape.width;

  const {
    canvasContainerRef, helpersRef, canvasSize, canvasMounted, displayLength, view, setView, viewRef,
    zoom, handleZoomIn, handleZoomOut, handleZoomSet, handleZoomFit, handleZoomReset,
  } = useCanvasView({ scene, autoLength, paperWidth, paperHeight });

  const selection = useSelection({ mode: 'multi' });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useAutosave(scene, sceneVersion, config);

  const prefs = useEditorPrefs();
  const {
    autoCut, cassetteColorsEnabled, documentWarnings, marginGuides,
    preflightChecks, printPreview, ditherAlgorithm,
  } = prefs;
  const { printerRef, printerLastSeen, printerReachable, handlePrinterRefresh } = usePrinterSession();
  const liveStatus = printerReachable ? (printerLastSeen?.status ?? null) : null;
  const cassette = useCassetteColors(cassetteColorsEnabled, liveStatus);
  const { tapeCss, tapeClear, inkCss } = cassette;

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

  const checks = useDocumentChecks({
    enabled: documentWarnings, scene, sceneVersion, tapeSize, labelLength, printableBand,
    view, canvasSize, canvasContainerRef,
  });

  const previewBitmap = usePrintPreview({
    enabled: printPreview, scene, sceneVersion, tapeSize, labelLength, paperHeight, inkCss, ditherAlgorithm,
  });

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
  // `insertNodeFactories.barcode` entry below mints the node. The kit
  // explicitly supports factories for kinds it doesn't ship.
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
    barcode: (b) => {
      const data = {
        kind: 'barcode',
        protocol: 'CODE128',
        data: '12345678',
        barWidth: 1.2,
        barRatio: '1:3',
        humanReadable: true,
        humanReadableAlignment: 'CENTER',
        checkDigit: false,
        zeroFill: false,
        opaqueBackground: true,
      } satisfies LabelNodeData;
      const pose = { x: b.x, y: b.y, width: Math.max(b.width, 40), height: Math.max(b.height, 16) };
      return { pose: snapNodePose(data, pose, PRINT_DPI), data };
    },
  }), []);

  // Barcodes resize in whole printer dots per module, live during the drag.
  const resizeBehaviors = useMemo<BoundsConstraint<LabelPose>[]>(() => [{
    onMove: (ctx, proposed) => {
      if (ctx.draggedIds.length !== 1) return;
      const node = scene.get(asNodeId(ctx.draggedIds[0]!));
      if (node?.data.kind !== 'barcode') return;
      return { pose: snapNodePose(node.data, proposed.pose, PRINT_DPI, proposed.anchor) };
    },
  }], [scene]);

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

      scene.batch(`Open ${file.name}`, () => {
        for (const [id] of scene.nodes) {
          scene.remove(id);
        }
        for (const node of result.nodes) {
          scene.add({
            kind: 'leaf',
            id: asNodeId(node.id),
            layer: 'objects' as LabelLayer,
            pose: snapNodePose(node.data, node.pose, PRINT_DPI),
            data: node.data,
          });
        }
      });
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
    // `roots` is stacking order, back to front; `nodes` is insertion order,
    // which a restack leaves untouched.
    const nodes = scene.roots.flatMap((id) => {
      const node = scene.get(id);
      return node ? [{ id: node.id, data: node.data, pose: node.pose }] : [];
    });
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

  const { printing, handlePrint } = usePrintJob({
    printerRef, scene, tapeSize, labelLength, paperHeight, autoCut, ditherAlgorithm, cutMarks,
    preflightChecks,
    // Re-raise every dismissed callout: the job is being refused over a
    // problem the user may have waved away, so put it back on the object.
    onBlocked: checks.reraiseAll,
  });

  const [prefsOpen, setPrefsOpen] = useState(false);

  const layers = useCanvasLayers({
    displayLength, paperWidth, paperHeight, tapeCss, tapeClear, inkCss, previewBitmap, printableBand,
    cutMarks, marginGuides,
  });

  // Pointer position in label points, for the status bar. The view is a
  // camera: world = view origin + client offset / scale.
  const cursor = useMemo(createCursorStore, []);
  const handleCanvasPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const v = viewRef.current;
    cursor.set({ x: v.x + (e.clientX - r.left) / v.scale.x, y: v.y + (e.clientY - r.top) / v.scale.y });
  }, [cursor]);

  return (
    <DepRegistryProvider>
      <ActionsProvider>
        <SelectionContextProvider>
          <LabShell
            title="Label Editor"
            mode="auto"
            header={
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
                zoom={zoom}
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
            }
            footer={
              <EditorStatusBar
                activeTool={tools?.active ?? null}
                selectedCount={selection.current.length}
                cursor={cursor}
                printerLastSeen={printerLastSeen}
                printerReachable={printerReachable}
                printing={printing}
                zoomPercent={Math.round(zoom * 100)}
              />
            }
          >
            <PrefsDialog
              isOpen={prefsOpen}
              onOpenChange={setPrefsOpen}
              schema={PREFS_SCHEMA}
              values={prefs.prefValues}
              onChange={prefs.handlePrefChange}
            />
            {/* Results of things the user just did — a print that failed, a
                file that wouldn't parse. Document problems get an anchored
                callout instead, since those have an object to point at. */}
            <ToastRegion />
            <input ref={fileInputRef} type="file" accept=".lbx" hidden onChange={handleImport} />
            <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={handleImagePick} />
            <div className="editor-body">
              {tools && (
                <div className="editor-tools">
                  <ToolPalette tools={tools} orientation="vertical" groupOrder={PALETTE_GROUP_ORDER} />
                </div>
              )}
              <div
                ref={canvasContainerRef}
                className="editor-canvas"
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onPointerMove={handleCanvasPointerMove}
                onPointerLeave={() => cursor.set(null)}
              >
                {canvasMounted && (
                  <SceneCanvas<LabelNodeData, LabelLayer, LabelPose>
                    width={canvasSize.width}
                    height={canvasSize.height}
                    scene={scene}
                    selection={selection}
                    // `pick` mounts the select tool. Every other palette tool
                    // is registered by `tools` below, where this app controls
                    // both their order and their grouping. Notably hand,
                    // whose patch entry replaces the one `view` brings.
                    features={['view', 'pick', 'move', 'resize', 'edit', 'arrange']}
                    tools={toolsPatch}
                    insertNodeFactories={insertNodeFactories}
                    onToolsCreated={setTools}
                    selectTool={{ rotate: false, resize: { behaviors: resizeBehaviors } }}
                    // `recenter` routes Cmd-0 through the same center-the-label
                    // view as the toolbar Reset button.
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
                {checks.active && checks.anchor && (
                  <DiagnosticCallout
                    diagnostic={checks.active}
                    anchorRect={checks.anchor}
                    total={checks.diagnostics.length}
                    onDismiss={checks.dismiss}
                  />
                )}
              </div>
              <Inspector
                scene={scene}
                selection={selection}
                labelRect={{ x: 0, y: printableBand.y, width: labelLength, height: printableBand.height }}
                printer={{
                  lastSeen: printerLastSeen,
                  reachable: printerReachable,
                  printing,
                  onRefresh: handlePrinterRefresh,
                  autoCut,
                  onAutoCutChange: prefs.handleAutoCutChange,
                  printPreview,
                  onPrintPreviewChange: prefs.handlePrintPreviewChange,
                  marginGuides,
                  onMarginGuidesChange: prefs.handleMarginGuidesChange,
                  ditherAlgorithm,
                  onDitherAlgorithmChange: prefs.handleDitherAlgorithmChange,
                }}
                debug={{
                  cassetteColorsEnabled,
                  onCassetteColorsEnabledChange: prefs.handleCassetteColorsChange,
                  tapeColorOverride: cassette.tapeColorOverride,
                  onTapeColorOverrideChange: cassette.setTapeColorOverride,
                  textColorOverride: cassette.textColorOverride,
                  onTextColorOverrideChange: cassette.setTextColorOverride,
                  liveStatus,
                }}
              />
            </div>
          </LabShell>
        </SelectionContextProvider>
      </ActionsProvider>
    </DepRegistryProvider>
  );
}
