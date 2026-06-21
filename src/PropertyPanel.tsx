import { useCallback } from 'react';
import { useSelection, asNodeId, type Scene, type NodeId } from '@weasel-js/core';
import type { LabelNodeData, LabelLayer, LabelPose } from './label';

interface PropertyPanelProps {
  scene: Scene<LabelNodeData, LabelLayer, LabelPose>;
}

export function PropertyPanel({ scene }: PropertyPanelProps) {
  const selection = useSelection();
  const selectedIds = selection.get();

  if (selectedIds.length !== 1) {
    return (
      <div style={{ width: 240, borderLeft: '1px solid #ddd', padding: '12px', background: '#fafafa' }}>
        <p style={{ color: '#888', fontSize: '13px' }}>
          {selectedIds.length === 0 ? 'Select an object' : `${selectedIds.length} objects selected`}
        </p>
      </div>
    );
  }

  const nodeId = selectedIds[0]! as NodeId;
  const node = scene.get(nodeId);
  if (!node) return null;

  return (
    <div style={{ width: 240, borderLeft: '1px solid #ddd', padding: '12px', background: '#fafafa', overflowY: 'auto' }}>
      <h3 style={{ margin: '0 0 12px', fontSize: '14px' }}>Properties</h3>
      <PoseFields scene={scene} nodeId={nodeId} pose={node.pose} />
      {node.data.kind === 'text' && (
        <TextFields scene={scene} nodeId={nodeId} data={node.data} />
      )}
      {node.data.kind === 'rect' && (
        <RectFields scene={scene} nodeId={nodeId} data={node.data} />
      )}
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
    <div style={{ marginBottom: '12px' }}>
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
      <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px' }}>
        Text
        <textarea
          value={data.text}
          onChange={(e) => update({ text: e.target.value })}
          style={{ width: '100%', minHeight: '60px', marginTop: '4px' }}
        />
      </label>
      <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px' }}>
        Font
        <input
          type="text"
          value={data.fontFamily}
          onChange={(e) => update({ fontFamily: e.target.value })}
          style={{ width: '100%', marginTop: '4px' }}
        />
      </label>
      <FieldRow label="Size" value={data.fontSize} onChange={(v) => update({ fontSize: v })} />
      <FieldRow label="Weight" value={data.fontWeight} onChange={(v) => update({ fontWeight: v })} />
      <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', marginBottom: '8px' }}>
        <input type="checkbox" checked={data.italic} onChange={(e) => update({ italic: e.target.checked })} />
        Italic
      </label>
      <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px' }}>
        Align
        <select
          value={data.horizontalAlignment}
          onChange={(e) => update({ horizontalAlignment: e.target.value as typeof data.horizontalAlignment })}
          style={{ width: '100%', marginTop: '4px' }}
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
      <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', marginBottom: '8px' }}>
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

function FieldRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '6px', fontSize: '12px' }}>
      <span style={{ width: '40px' }}>{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        step="0.1"
        style={{ width: '70px' }}
      />
    </label>
  );
}
