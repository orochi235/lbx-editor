import { useCallback, useSyncExternalStore } from 'react';
import {
  getImageBitmap,
  subscribeImageReady,
  type Scene,
  type NodeId,
  type SelectionApi,
} from '@weasel-js/core';
import type { LabelNodeData, LabelLayer, LabelPose } from './label';
import { imageDataUri } from './imageUtils';
import './propertyPanel.css';

interface PropertyPanelProps {
  scene: Scene<LabelNodeData, LabelLayer, LabelPose>;
  /** The same selection instance the canvas mutates — reading `.current`
   *  (not a fresh `useSelection()`) keeps the panel in sync with clicks and
   *  tool-created objects. */
  selection: SelectionApi;
}

const KIND_NAMES: Record<LabelNodeData['kind'], string> = {
  text: 'Text',
  rect: 'Rectangle',
  line: 'Line',
  image: 'Image',
};

export function PropertyPanel({ scene, selection }: PropertyPanelProps) {
  const selectedIds = selection.current;

  if (selectedIds.length !== 1) {
    return (
      <div className="property-panel">
        <p className="prop-empty">
          {selectedIds.length === 0 ? 'Select an object' : `${selectedIds.length} objects selected`}
        </p>
      </div>
    );
  }

  const nodeId = selectedIds[0]! as NodeId;
  const node = scene.get(nodeId);
  if (!node) return null;

  return (
    <div className="property-panel">
      <h3>
        Properties
        <span className="prop-type">{KIND_NAMES[node.data.kind]}</span>
      </h3>
      <PoseFields scene={scene} nodeId={nodeId} pose={node.pose} />
      {node.data.kind === 'text' && (
        <TextFields scene={scene} nodeId={nodeId} data={node.data} />
      )}
      {node.data.kind === 'rect' && (
        <RectFields scene={scene} nodeId={nodeId} data={node.data} />
      )}
      {node.data.kind === 'line' && (
        <LineFields scene={scene} nodeId={nodeId} data={node.data} />
      )}
      {node.data.kind === 'image' && <ImageInfo data={node.data} />}
    </div>
  );
}

function PoseFields({ scene, nodeId, pose }: {
  scene: Scene<LabelNodeData, LabelLayer, LabelPose>;
  nodeId: NodeId;
  pose: LabelPose;
}) {
  const update = useCallback((partial: Partial<LabelPose>) => {
    scene.setPose(nodeId, { ...pose, ...partial });
  }, [scene, nodeId, pose]);

  return (
    <div className="prop-group">
      <FieldRow label="X" value={pose.x} onChange={(v) => update({ x: v })} />
      <FieldRow label="Y" value={pose.y} onChange={(v) => update({ y: v })} />
      <FieldRow label="W" value={pose.width} onChange={(v) => update({ width: v })} />
      <FieldRow label="H" value={pose.height} onChange={(v) => update({ height: v })} />
    </div>
  );
}

function TextFields({ scene, nodeId, data }: {
  scene: Scene<LabelNodeData, LabelLayer, LabelPose>;
  nodeId: NodeId;
  data: Extract<LabelNodeData, { kind: 'text' }>;
}) {
  const update = useCallback((partial: Partial<typeof data>) => {
    scene.update(nodeId, { data: { ...data, ...partial } });
  }, [scene, nodeId, data]);

  return (
    <div>
      <label className="prop-field">
        Text
        <textarea
          value={data.text}
          onChange={(e) => update({ text: e.target.value })}
        />
      </label>
      <label className="prop-field">
        Font
        <input
          type="text"
          value={data.fontFamily}
          onChange={(e) => update({ fontFamily: e.target.value })}
        />
      </label>
      <FieldRow label="Size" value={data.fontSize} onChange={(v) => update({ fontSize: v })} />
      <FieldRow label="Weight" value={data.fontWeight} onChange={(v) => update({ fontWeight: v })} />
      <label className="prop-check">
        <input type="checkbox" checked={data.italic} onChange={(e) => update({ italic: e.target.checked })} />
        Italic
      </label>
      <label className="prop-field">
        Align
        <select
          value={data.horizontalAlignment}
          onChange={(e) => update({ horizontalAlignment: e.target.value as typeof data.horizontalAlignment })}
        >
          <option value="LEFT">Left</option>
          <option value="CENTER">Center</option>
          <option value="RIGHT">Right</option>
          <option value="JUSTIFY">Justify</option>
        </select>
      </label>
    </div>
  );
}

function RectFields({ scene, nodeId, data }: {
  scene: Scene<LabelNodeData, LabelLayer, LabelPose>;
  nodeId: NodeId;
  data: Extract<LabelNodeData, { kind: 'rect' }>;
}) {
  const update = useCallback((partial: Partial<typeof data>) => {
    scene.update(nodeId, { data: { ...data, ...partial } });
  }, [scene, nodeId, data]);

  return (
    <div>
      <label className="prop-check">
        <input type="checkbox" checked={data.rounded} onChange={(e) => update({ rounded: e.target.checked })} />
        Rounded
      </label>
      {data.rounded && (
        <FieldRow label="Radius" value={data.roundness} onChange={(v) => update({ roundness: v })} />
      )}
      <FieldRow label="Stroke" value={data.strokeWidth} onChange={(v) => update({ strokeWidth: v })} />
    </div>
  );
}

function LineFields({ scene, nodeId, data }: {
  scene: Scene<LabelNodeData, LabelLayer, LabelPose>;
  nodeId: NodeId;
  data: Extract<LabelNodeData, { kind: 'line' }>;
}) {
  const update = useCallback((partial: Partial<typeof data>) => {
    scene.update(nodeId, { data: { ...data, ...partial } });
  }, [scene, nodeId, data]);

  return (
    <div>
      <FieldRow label="Stroke" value={data.strokeWidth} onChange={(v) => update({ strokeWidth: v })} />
      <label className="prop-field">
        Direction
        <select
          value={data.descending ? 'descending' : 'ascending'}
          onChange={(e) => update({ descending: e.target.value === 'descending' })}
        >
          <option value="descending">Top-left to bottom-right</option>
          <option value="ascending">Bottom-left to top-right</option>
        </select>
      </label>
    </div>
  );
}

/** Read-only facts about an image node: source file, format, embedded size,
 *  and (once the cache has decoded it) natural pixel dimensions. */
function ImageInfo({ data }: { data: Extract<LabelNodeData, { kind: 'image' }> }) {
  // Re-render when the async decode lands so the dimensions row fills in.
  const bitmap = useSyncExternalStore(
    subscribeImageReady,
    () => getImageBitmap(imageDataUri(data)),
  );

  // base64 length → byte count, minus padding
  const bytes = Math.floor(data.src.length * 3 / 4) - (data.src.endsWith('==') ? 2 : data.src.endsWith('=') ? 1 : 0);
  const format = (data.mimeType.split('/')[1] ?? data.mimeType).toUpperCase();

  return (
    <div className="prop-info">
      <dl>
        <dt>File</dt>
        <dd>{data.originalName}</dd>
        <dt>Format</dt>
        <dd>{format}</dd>
        <dt>Pixels</dt>
        <dd>{bitmap ? `${bitmap.width} × ${bitmap.height}` : '…'}</dd>
        <dt>Size</dt>
        <dd>{bytes < 10240 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`}</dd>
      </dl>
    </div>
  );
}

function FieldRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="prop-row">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        step="0.1"
      />
    </label>
  );
}
