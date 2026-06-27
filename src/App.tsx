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
  zoomAt,
  fitViewToBounds,
  meanScale,
  type SceneNode,
  type DrawCommand,
  type View,
  type RenderLayer,
  type NodeId,
} from '@weasel-js/core';
import {
  TAPE_SIZES,
  DEFAULT_TAPE,
  DEFAULT_LABEL_LENGTH,
  type LabelNodeData,
  type LabelLayer,
  type LabelPose,
  type TapeSize,
} from './label';
import { exportLbx } from './lbxExport';
import { importLbx } from './lbxImport';
import { Toolbar } from './Toolbar';
import { PropertyPanel } from './PropertyPanel';
import { fileToBase64, guessMimeType, getImageDimensions } from './imageUtils';
import { getImageBitmap } from './imageBitmapCache';

type LabelNode = SceneNode<LabelNodeData, LabelLayer, LabelPose>;

let nextNodeId = 1;
function genNodeId(): NodeId {
  return asNodeId(`node-${nextNodeId++}`);
}

const FIT_PADDING = 16;

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
    case 'text':
      // Light bounding box to show the text frame
      return [{
        kind: 'path',
        path: rectPath(x, y, width, height),
        stroke: { paint: { color: '#999999' }, width: 0.3 },
      }];
    case 'rect':
      return [{
        kind: 'path',
        path: rectPath(x, y, width, height),
        stroke: { paint: { color: data.strokeStyle }, width: data.strokeWidth },
        ...(data.fillColor ? { fill: { fill: 'solid', color: data.fillColor } } : {}),
      }];
    case 'line':
      return [{
        kind: 'path',
        path: rectPath(x, y, width, Math.max(height, 0.5)),
        stroke: { paint: { color: data.strokeStyle }, width: data.strokeWidth },
      }];
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
  const paperLayer = useMemo<RenderLayer<unknown>>(() => ({
    id: 'paper',
    label: 'Label tape',
    draw: () => [{
      kind: 'path',
      path: rectPath(0, 0, paperWidth, paperHeight),
      fill: { fill: 'solid', color: '#ffffff' },
      stroke: { paint: { color: '#cccccc' }, width: 0.5 },
    }],
  }), [paperWidth, paperHeight]);

  // --- Object creation ---
  const addText = useCallback(() => {
    const id = genNodeId();
    scene.add({
      kind: 'leaf',
      id,
      layer: 'objects' as LabelLayer,
      pose: { x: 10, y: 5, width: 60, height: 20 },
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
      },
    });
    selection.set([id]);
  }, [scene, selection]);

  const addRect = useCallback(() => {
    const id = genNodeId();
    scene.add({
      kind: 'leaf',
      id,
      layer: 'objects' as LabelLayer,
      pose: { x: 10, y: 5, width: 30, height: paperHeight - 10 },
      data: {
        kind: 'rect',
        rounded: false,
        roundness: 0,
        strokeStyle: '#000000',
        strokeWidth: 0.8,
        fillColor: null,
      },
    });
    selection.set([id]);
  }, [scene, selection, paperHeight]);

  const addLine = useCallback(() => {
    const id = genNodeId();
    scene.add({
      kind: 'leaf',
      id,
      layer: 'objects' as LabelLayer,
      pose: { x: 10, y: paperHeight / 2, width: 80, height: 0.5 },
      data: {
        kind: 'line',
        strokeStyle: '#000000',
        strokeWidth: 0.5,
      },
    });
    selection.set([id]);
  }, [scene, selection, paperHeight]);

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

  const handleImagePick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) addImageFromFile(file);
    if (imageInputRef.current) imageInputRef.current.value = '';
  }, [addImageFromFile]);

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
              onAddImage={() => imageInputRef.current?.click()}
              labelLength={labelLength}
              onLabelLengthChange={setLabelLength}
              onExport={handleExport}
              onImport={() => fileInputRef.current?.click()}
              onAddText={addText}
              onAddRect={addRect}
              onAddLine={addLine}
              zoomPercent={zoomPercent}
              onZoomIn={handleZoomIn}
              onZoomOut={handleZoomOut}
              onZoomSet={handleZoomSet}
              onZoomFit={handleZoomFit}
              onZoomReset={handleZoomReset}
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
                    toolBundle="standard"
                    selectTool={{ rotate: false }}
                    view={view}
                    onViewChange={setView}
                    layers={layers}
                  />
                )}
              </div>
              <PropertyPanel scene={scene} />
            </div>
          </div>
        </SelectionContextProvider>
      </ActionsProvider>
    </DepRegistryProvider>
  );
}
