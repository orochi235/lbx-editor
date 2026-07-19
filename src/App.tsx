import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  type ToolsApi,
  type InsertNodeFactory,
} from '@weasel-js/core';
// Subpath import (not the `@weasel-js/ui` barrel) so tsc/vite only pull in the
// ToolPalette module, not sibling components like DataGrid that trip a
// duplicate-@types/react mismatch under this app's slightly newer React types.
import { ToolPalette } from '@weasel-js/ui/components/ToolPalette';
import {
  TAPE_SIZES,
  DEFAULT_TAPE,
  DEFAULT_LABEL_LENGTH,
  lineEndpoints,
  type LabelNodeData,
  type LabelLayer,
  type LabelPose,
  type TapeSize,
} from './label';
import { exportLbx } from './lbxExport';
import { importLbx } from './lbxImport';
import {
  rgbaToRaster,
  Printers,
  createBrotherPrinter,
  NoGrantedDeviceError,
  type BrotherPrinter,
  type PrinterStatus,
} from 'obwat';
import { renderLabelToRgba } from './labelRender';
import { Toolbar } from './Toolbar';
import { PropertyPanel } from './PropertyPanel';
import { fileToBase64, guessMimeType, getImageDimensions } from './imageUtils';
import { buildImageInsert, type PendingImage } from './imageInsert';
import { getImageBitmap } from './imageBitmapCache';
import { getTextBitmap } from './textBitmapCache';

type LabelNode = SceneNode<LabelNodeData, LabelLayer, LabelPose>;

let nextNodeId = 1;
function genNodeId(): NodeId {
  return asNodeId(`node-${nextNodeId++}`);
}

const FIT_PADDING = 16;

/** Set once a USB device grant exists; lets us distinguish "printer asleep" from "never granted". */
const USB_GRANT_FLAG = 'lbx-editor.hasUsbGrant';
const AUTOCUT_KEY = 'lbx-editor.autoCut';

interface CanvasSize {
  width: number;
  height: number;
}

function paperBounds(paperWidth: number, paperHeight: number) {
  return { x: 0, y: 0, width: paperWidth, height: paperHeight };
}

// View that centers the paper at 100% (scale 1) in a canvas of the given size.
function centeredView(paperWidth: number, paperHeight: number, canvas: CanvasSize): View {
  return {
    x: paperWidth / 2 - canvas.width / 2,
    y: paperHeight / 2 - canvas.height / 2,
    scale: { x: 1, y: 1 },
  };
}

function drawLabelNode(node: LabelNode, pose: LabelPose, _view: View): DrawCommand[] {
  const { data } = node;
  const { x, y, width, height } = pose;

  switch (data.kind) {
    case 'text': {
      const bitmap = getTextBitmap(data, width, height);
      if (bitmap) {
        return [{ kind: 'image', image: bitmap, x, y, w: width, h: height }];
      }
      // Fallback: the old light frame so the node stays visible/selectable
      return [{
        kind: 'path',
        path: rectPath(x, y, width, height),
        stroke: { paint: { color: '#999999' }, width: 0.3 },
      }];
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
      const bmp = getImageBitmap(data.src, data.mimeType);
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
    default:
      return [];
  }
}

export function App() {
  const [tapeSize, setTapeSize] = useState<TapeSize>(DEFAULT_TAPE);
  const [autoLength, setAutoLength] = useState(true);
  const [labelLength, setLabelLength] = useState(DEFAULT_LABEL_LENGTH);

  const tape = TAPE_SIZES[tapeSize];

  // The "paper" is the printable area of the tape.
  // P-touch labels are landscape: tape width is the short dimension (height visually).
  const paperWidth = autoLength ? labelLength : labelLength;
  const paperHeight = tape.width;

  // --- Viewport / zoom ---
  // The canvas fills its container; we measure it and feed the size to
  // SceneCanvas (weasel handles device-pixel-ratio internally). All zoom/fit
  // math uses the live size.
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState<CanvasSize>({ width: 0, height: 0 });
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: { x: 1, y: 1 } });

  const prevPaperSize = useRef({ w: paperWidth, h: paperHeight });
  const viewInitialized = useRef(false);

  // Measure the container before paint and on resize. On the first valid
  // measurement, center the paper at 100%. Resizing the container afterwards
  // just changes the drawing surface — the view is left untouched.
  useLayoutEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      setCanvasSize({ width, height });
      if (!viewInitialized.current && width > 0 && height > 0) {
        viewInitialized.current = true;
        prevPaperSize.current = { w: paperWidth, h: paperHeight };
        setView(centeredView(paperWidth, paperHeight, { width, height }));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // Intentionally one-time: initial centering uses the mount-time paper size;
    // later paper changes are handled by the fit effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fit the paper to the canvas whenever the paper size changes (tape/length
  // edits and imports both flow through here). The ref guard makes this a no-op
  // on the initial centered view and on canvas-only resizes.
  useEffect(() => {
    if (canvasSize.width === 0 || canvasSize.height === 0) return;
    if (prevPaperSize.current.w === paperWidth && prevPaperSize.current.h === paperHeight) return;
    prevPaperSize.current = { w: paperWidth, h: paperHeight };
    setView((v) =>
      fitViewToBounds(paperBounds(paperWidth, paperHeight), canvasSize, v, { padding: FIT_PADDING }),
    );
  }, [paperWidth, paperHeight, canvasSize]);

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
  const handleZoomFit = useCallback(() => {
    setView((v) =>
      fitViewToBounds(paperBounds(paperWidth, paperHeight), canvasSize, v, { padding: FIT_PADDING }),
    );
  }, [paperWidth, paperHeight, canvasSize]);
  const handleZoomReset = useCallback(
    () => setView(centeredView(paperWidth, paperHeight, canvasSize)),
    [paperWidth, paperHeight, canvasSize],
  );

  const scene = useScene<LabelNodeData, LabelLayer, LabelPose>({
    systemLayers: [{ id: 'objects' as LabelLayer }],
  });

  const selection = useSelection();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Paper background layer ---
  // The tape is drawn as a solid black "raised brick": its rectangle extruded
  // down-right by `depth` into a single filled silhouette, so the offset shadow
  // is connected to the tape by diagonal side edges instead of floating behind
  // it. The white tape face (with a black border) sits on top. Everything is in
  // world units so it scales and pans with the paper; `depth` is keyed to the
  // tape width to stay proportional across tape sizes.
  const paperLayer = useMemo<RenderLayer<unknown>>(() => {
    const depth = paperHeight * 0.08;
    // Outer silhouette of the extruded block (front face top + right, then the
    // two diagonals to the back face, around its bottom + left, back up).
    const brick = polygonFromPoints([
      { x: 0, y: 0 },
      { x: paperWidth, y: 0 },
      { x: paperWidth + depth, y: depth },
      { x: paperWidth + depth, y: paperHeight + depth },
      { x: depth, y: paperHeight + depth },
      { x: 0, y: paperHeight },
    ]);
    return {
      id: 'paper',
      label: 'Label tape',
      draw: () => [
        {
          kind: 'path',
          path: brick,
          fill: { fill: 'solid', color: '#000000' },
        },
        {
          kind: 'path',
          path: rectPath(0, 0, paperWidth, paperHeight),
          fill: { fill: 'solid', color: '#ffffff' },
          stroke: { paint: { color: '#000000' }, width: 0.5 },
        },
      ],
    };
  }, [paperWidth, paperHeight]);

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
  const toolsPatch = useMemo(() => ({ image: imageTool }), [imageTool]);

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
  }), []);

  const addImageFromFile = useCallback(async (file: File) => {
    const mimeType = guessMimeType(file.name);
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
  }, [scene, selection, paperWidth, paperHeight]);

  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleImagePick = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (imageInputRef.current) imageInputRef.current.value = '';
    if (!file) return;
    const mimeType = guessMimeType(file.name);
    const src = await fileToBase64(file);
    const dims = await getImageDimensions(src, mimeType, paperWidth - 20, paperHeight - 10);
    pendingImageRef.current = {
      src,
      originalName: file.name,
      mimeType,
      defaultWidth: dims.width,
      defaultHeight: dims.height,
    };
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
  const toolsRef = useRef(tools);
  toolsRef.current = tools;
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

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      addImageFromFile(file);
    }
  }, [addImageFromFile]);

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
    const buf = await exportLbx(nodes, tapeSize, autoLength, labelLength);
    const blob = new Blob([buf as BlobPart], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'label.lbx';
    a.click();
    URL.revokeObjectURL(url);
  }, [scene, tapeSize, autoLength, labelLength]);

  // --- Import ---
  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const result = await importLbx(file);
    setTapeSize(result.tapeSize);
    setAutoLength(result.autoLength);
    setLabelLength(result.labelLength);

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

    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [scene]);

  // --- Print ---
  const [printing, setPrinting] = useState(false);
  const [autoCut, setAutoCut] = useState(() => localStorage.getItem(AUTOCUT_KEY) !== '0');
  const handleAutoCutChange = useCallback((on: boolean) => {
    setAutoCut(on);
    localStorage.setItem(AUTOCUT_KEY, on ? '1' : '0');
  }, []);
  const printingRef = useRef(false);
  const [printerLastSeen, setPrinterLastSeen] = useState<{ status: PrinterStatus; at: number } | null>(null);
  const [printerReachable, setPrinterReachable] = useState(false);

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

  const handlePrint = useCallback(async () => {
    if (printingRef.current) return;
    const printer = printerRef.current;
    if (!printer) return;
    const tapeWidthMm = parseInt(tapeSize, 10);
    if (!('usb' in navigator) && !('serial' in navigator)) {
      alert('Neither WebUSB nor Web Serial is supported in this browser. Use Chrome or Edge.');
      return;
    }
    setPrinting(true);
    printingRef.current = true;
    try {
      const media = Printers.ptP710bt.media(tapeWidthMm);
      // Same drawOne as the screen path, through weasel's headless renderer —
      // print is the screen's rendering at printer resolution.
      const rgba = renderLabelToRgba({
        scene,
        drawOne: drawLabelNode,
        labelLengthPt: labelLength,
        tapeWidthPt: paperHeight,
        printableDots: media.printableDots,
        dpi: media.dpi,
      });
      const raster = rgbaToRaster(rgba, media);
      const jobOpts = { tapeWidthMm, autoCut, marginDots: 0 };

      let status: PrinterStatus;
      try {
        // Zero-click path: an already-granted device. The facade's mutex waits
        // out any in-flight keepalive tick (≤2 s; Chrome's user-activation
        // window comfortably outlives it if we fall through to the picker).
        status = await printer.print(raster, jobOpts);
      } catch (err) {
        if (!(err instanceof NoGrantedDeviceError)) throw err;
        if (localStorage.getItem(USB_GRANT_FLAG)) {
          // One-shot hint: clearing the flag means a repeat click falls through to
          // the picker, so a revoked permission can't dead-end the Print button.
          localStorage.removeItem(USB_GRANT_FLAG);
          alert(
            'Printer not found — it may have auto-powered off. Press its power button, then print again.',
          );
          return;
        }
        await printer.requestDevice();
        status = await printer.print(raster, jobOpts);
      }
      // A grant exists (the print went through) — remember for the
      // asleep-vs-never-granted hint. Serial grants don't persist, so
      // the flag stays USB-only.
      if ('usb' in navigator) localStorage.setItem(USB_GRANT_FLAG, '1');
      if (status.hasError) {
        alert('Printer reported an error (check tape/cover).');
      } else if (status.incomplete) {
        alert('Print sent, but the printer status reply was incomplete — check the printer.');
      }
    } catch (err) {
      // Dismissing the device/port picker is a normal cancel, not a failure.
      if (err instanceof DOMException && err.name === 'NotFoundError') return;
      alert(`Print failed: ${(err as Error).message}`);
    } finally {
      printingRef.current = false;
      setPrinting(false);
    }
  }, [printing, tapeSize, scene, labelLength, paperHeight, autoCut]);

  const layers = useMemo(() => ({
    paper: { layer: paperLayer, before: 'scene' as const },
    scene: { drawOne: drawLabelNode },
    selectionOverlay: { handles: { size: 5 } },
  }), [paperLayer]);

  return (
    <DepRegistryProvider>
      <ActionsProvider>
        <SelectionContextProvider>
          <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
            <Toolbar
              tapeSize={tapeSize}
              onTapeSizeChange={setTapeSize}
              autoLength={autoLength}
              onAutoLengthChange={setAutoLength}
              labelLength={labelLength}
              onLabelLengthChange={setLabelLength}
              onExport={handleExport}
              onImport={() => fileInputRef.current?.click()}
              onPrint={handlePrint}
              printDisabled={printing}
              autoCut={autoCut}
              onAutoCutChange={handleAutoCutChange}
              zoomPercent={zoomPercent}
              onZoomIn={handleZoomIn}
              onZoomOut={handleZoomOut}
              onZoomSet={handleZoomSet}
              onZoomFit={handleZoomFit}
              onZoomReset={handleZoomReset}
              printerLastSeen={printerLastSeen}
              printerReachable={printerReachable}
            />
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
              {tools && (
                <ToolPalette tools={tools} orientation="vertical" />
              )}
              <div
                ref={canvasContainerRef}
                style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#e0e0e0', lineHeight: 0 }}
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
                    // regardless; this doesn't change them.
                    viewport={{}}
                    view={view}
                    onViewChange={setView}
                    layers={layers}
                  />
                )}
              </div>
              <PropertyPanel scene={scene} selection={selection} />
            </div>
          </div>
        </SelectionContextProvider>
      </ActionsProvider>
    </DepRegistryProvider>
  );
}
