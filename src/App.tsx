import { useCallback, useMemo, useRef, useState } from 'react';
import {
  SceneCanvas,
  useScene,
  useSelection,
  ActionsProvider,
  DepRegistryProvider,
  SelectionContextProvider,
  asNodeId,
  rectPath,
  type Node,
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

type LabelNode = Node<LabelNodeData, LabelLayer, LabelPose>;

let nextNodeId = 1;
function genNodeId(): NodeId {
  return asNodeId(`node-${nextNodeId++}`);
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
      // For now just a stroked rect; proper line rendering would use a Path
      return [{
        kind: 'path',
        path: rectPath(x, y, width, Math.max(height, 0.5)),
        stroke: { paint: { color: data.strokeStyle }, width: data.strokeWidth },
      }];
    case 'image':
      return [{
        kind: 'path',
        path: rectPath(x, y, width, height),
        fill: { fill: 'solid', color: '#e8e8e8' },
        stroke: { paint: { color: '#bbbbbb' }, width: 0.5 },
      }];
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

  // --- Export ---
  const handleExport = useCallback(async () => {
    const nodes: { id: string; data: LabelNodeData; pose: LabelPose }[] = [];
    for (const [, node] of scene.nodes) {
      nodes.push({ id: node.id, data: node.data, pose: node.pose });
    }
    const buf = await exportLbx(nodes, tapeSize, autoLength, labelLength);
    const blob = new Blob([buf], { type: 'application/octet-stream' });
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
              labelLength={labelLength}
              onLabelLengthChange={setLabelLength}
              onExport={handleExport}
              onImport={() => fileInputRef.current?.click()}
              onAddText={addText}
              onAddRect={addRect}
              onAddLine={addLine}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".lbx"
              style={{ display: 'none' }}
              onChange={handleImport}
            />
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              <div style={{ flex: 1, position: 'relative', background: '#e0e0e0' }}>
                <SceneCanvas<LabelNodeData, LabelLayer, LabelPose>
                  width={800}
                  height={600}
                  scene={scene}
                  selection={selection}
                  selectionMode="multi"
                  toolBundle="standard"
                  selectTool={{ rotate: false }}
                  layers={layers}
                />
              </div>
              <PropertyPanel scene={scene} />
            </div>
          </div>
        </SelectionContextProvider>
      </ActionsProvider>
    </DepRegistryProvider>
  );
}
