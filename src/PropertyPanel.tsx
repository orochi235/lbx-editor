import { useSyncExternalStore } from 'react';
import {
  getImageBitmap,
  subscribeImageReady,
  type Scene,
  type NodeId,
  type SelectionApi,
} from '@weasel-js/core';
import { PropertyField, PropertyList, PropertyNote, PropertySpan } from '@weasel-js/ui/components/Properties';
import { Icon } from '@weasel-js/ui';
import { icon } from './icons';
import type { LabelNodeData, LabelLayer, LabelPose } from './label';
import { imageDataUri } from './imageUtils';
import { registeredFamilies, installedFamilies, substituteFontFamily } from './fonts';
import { KIND_NAMES } from './nodeSummary';
import { PoseFields } from './PoseFields';
import { PrintOptions, storedStrokeWidth } from './PrintOptions';
import { BarcodeFields } from './BarcodeFields';
import { PT_DISPLAY, fixedDecimals } from './numberDisplay';
import './propertyPanel.css';

type LabelScene = Scene<LabelNodeData, LabelLayer, LabelPose>;
type DataOf<K extends LabelNodeData['kind']> = Extract<LabelNodeData, { kind: K }>;

const STROKE_DISPLAY = fixedDecimals(2);
const WEIGHT_DISPLAY = fixedDecimals(0);

const TEXT_ALIGN_OPTIONS = [
  { value: 'LEFT', label: 'Left', glyph: <Icon name={icon('core:textAlignLeft')} size={16} /> },
  { value: 'CENTER', label: 'Center', glyph: <Icon name={icon('core:textAlignCenter')} size={16} /> },
  { value: 'RIGHT', label: 'Right', glyph: <Icon name={icon('core:textAlignRight')} size={16} /> },
  { value: 'JUSTIFY', label: 'Justify', glyph: <Icon name={icon('core:textAlignJustify')} size={16} /> },
] as const;

const DIRECTION_OPTIONS = [
  { value: 'descending', label: 'Top-left to bottom-right' },
  { value: 'ascending', label: 'Bottom-left to top-right' },
];

interface PropertyPanelProps {
  scene: LabelScene;
  /** The same selection instance the canvas mutates — reading `.current`
   *  (not a fresh `useSelection()`) keeps the panel in sync with clicks and
   *  tool-created objects. */
  selection: SelectionApi;
}

export function PropertyPanel({ scene, selection }: PropertyPanelProps) {
  const selectedIds = selection.current as readonly NodeId[];

  if (selectedIds.length === 0) {
    return (
      <PropertyList>
        <PropertyNote>Select an object</PropertyNote>
      </PropertyList>
    );
  }

  if (selectedIds.length > 1) {
    return (
      <PropertyList pack="pairs">
        <PropertyNote>{selectedIds.length} objects</PropertyNote>
        <PoseFields scene={scene} ids={selectedIds} />
      </PropertyList>
    );
  }

  const nodeId = selectedIds[0]!;
  const node = scene.get(nodeId);
  if (!node) return null;
  const { data } = node;
  // Every field below edits one node by replacing its data whole.
  const update = <K extends LabelNodeData['kind']>(current: DataOf<K>, partial: Partial<DataOf<K>>) =>
    scene.update(nodeId, { data: { ...current, ...partial } });

  return (
    <PropertyList pack="pairs">
      <PropertyNote>{KIND_NAMES[data.kind]}</PropertyNote>
      <PoseFields scene={scene} ids={[nodeId]} />
      {data.kind === 'text' && <TextFields data={data} update={(p) => update(data, p)} />}
      {data.kind === 'rect' && <RectFields data={data} update={(p) => update(data, p)} />}
      {data.kind === 'line' && <LineFields data={data} update={(p) => update(data, p)} />}
      {data.kind === 'image' && <ImageInfo data={data} />}
      {data.kind === 'barcode' && (
        <BarcodeFields scene={scene} nodeId={nodeId} pose={node.pose} data={data} />
      )}
      <PrintOptions scene={scene} nodeId={nodeId} data={data} />
    </PropertyList>
  );
}

function fontOptions(current: string) {
  const families = registeredFamilies();
  const installed = installedFamilies();
  const known = families.includes(current) || installed.includes(current);
  return [
    ...(known ? [] : [{ value: current, label: `${current} → ${substituteFontFamily(current)}` }]),
    ...families.map((f) => ({ value: f, label: f })),
    ...installed.map((f) => ({ value: f, label: `${f} (this machine)` })),
  ];
}

function TextFields({ data, update }: {
  data: DataOf<'text'>;
  update: (partial: Partial<DataOf<'text'>>) => void;
}) {
  return (
    <>
      <PropertyField
        kind="string"
        control="textarea"
        span
        label="Text"
        value={data.text}
        onChange={(text) => update({ text })}
      />
      <PropertyField
        kind="enum"
        span
        label="Font"
        value={data.fontFamily}
        options={fontOptions(data.fontFamily)}
        onChange={(fontFamily) => update({ fontFamily })}
      />
      <PropertyField
        kind="number"
        label="Size"
        unit="pt"
        display={PT_DISPLAY}
        step={0.5}
        value={data.fontSize}
        onChange={(fontSize) => update({ fontSize })}
      />
      <PropertyField
        kind="number"
        label="Weight"
        display={WEIGHT_DISPLAY}
        step={100}
        value={data.fontWeight}
        onChange={(fontWeight) => update({ fontWeight })}
      />
      <PropertyField kind="boolean" label="Italic" value={data.italic} onChange={(italic) => update({ italic })} />
      <PropertyField<DataOf<'text'>['horizontalAlignment']>
        kind="enum"
        control="toggle"
        label="Align"
        value={data.horizontalAlignment}
        options={TEXT_ALIGN_OPTIONS}
        onChange={(horizontalAlignment) => update({ horizontalAlignment })}
      />
    </>
  );
}

function RectFields({ data, update }: {
  data: DataOf<'rect'>;
  update: (partial: Partial<DataOf<'rect'>>) => void;
}) {
  return (
    <>
      <PropertyField
        kind="number"
        label="Stroke"
        unit="pt"
        display={STROKE_DISPLAY}
        step={0.05}
        value={data.strokeWidth}
        onChange={(v) => update({ strokeWidth: storedStrokeWidth(data, v) })}
      />
      <PropertyField kind="boolean" label="Rounded" value={data.rounded} onChange={(rounded) => update({ rounded })} />
      {data.rounded && (
        <PropertyField
          kind="number"
          label="Radius"
          unit="pt"
          display={PT_DISPLAY}
          step={0.1}
          value={data.roundness}
          onChange={(roundness) => update({ roundness })}
        />
      )}
    </>
  );
}

function LineFields({ data, update }: {
  data: DataOf<'line'>;
  update: (partial: Partial<DataOf<'line'>>) => void;
}) {
  return (
    <>
      <PropertyField
        kind="number"
        label="Stroke"
        unit="pt"
        display={STROKE_DISPLAY}
        step={0.05}
        value={data.strokeWidth}
        onChange={(v) => update({ strokeWidth: storedStrokeWidth(data, v) })}
      />
      <PropertyField
        kind="enum"
        span
        label="Direction"
        value={data.descending ? 'descending' : 'ascending'}
        options={DIRECTION_OPTIONS}
        onChange={(v) => update({ descending: v === 'descending' })}
      />
    </>
  );
}

/** Read-only facts about an image node: source file, format, embedded size,
 *  and (once the cache has decoded it) natural pixel dimensions. */
function ImageInfo({ data }: { data: DataOf<'image'> }) {
  // Re-render when the async decode lands so the dimensions row fills in.
  const bitmap = useSyncExternalStore(
    subscribeImageReady,
    () => getImageBitmap(imageDataUri(data)),
  );

  // base64 length → byte count, minus padding
  const bytes = Math.floor(data.src.length * 3 / 4) - (data.src.endsWith('==') ? 2 : data.src.endsWith('=') ? 1 : 0);
  const format = (data.mimeType.split('/')[1] ?? data.mimeType).toUpperCase();

  return (
    <PropertySpan className="prop-info">
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
    </PropertySpan>
  );
}
