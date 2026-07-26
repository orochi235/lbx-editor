import { useCallback, useSyncExternalStore } from 'react';
import {
  getImageBitmap,
  subscribeImageReady,
  type Scene,
  type NodeId,
  type SelectionApi,
} from '@weasel-js/core';
import type { BarcodeProtocol, QrEccLevel } from 'bil-lbx';
import type { LabelNodeData, LabelLayer, LabelPose } from './label';
import { Printers } from 'obwat';
import {
  encodeBarcode,
  barcodeRequest,
  barcodeModuleDots,
  moduleFitness,
  isSupportedProtocol,
  SUPPORTED_PROTOCOLS,
  type BarcodeSymbol,
} from './barcode';
import { imageDataUri } from './imageUtils';
import { registeredFamilies, installedFamilies, substituteFontFamily } from './fonts';
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
  barcode: 'Barcode',
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
      {node.data.kind === 'barcode' && (
        <BarcodeFields scene={scene} nodeId={nodeId} pose={node.pose} data={node.data} />
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

  const families = registeredFamilies();
  const installed = installedFamilies();

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
        <select
          value={data.fontFamily}
          onChange={(e) => update({ fontFamily: e.target.value })}
        >
          {!families.includes(data.fontFamily) && !installed.includes(data.fontFamily) && (
            <option value={data.fontFamily}>
              {data.fontFamily} → {substituteFontFamily(data.fontFamily)}
            </option>
          )}
          {families.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
          {installed.length > 0 && (
            <optgroup label="Installed (this machine)">
              {installed.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </optgroup>
          )}
        </select>
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

const PROTOCOL_LABELS: Partial<Record<BarcodeProtocol, string>> = {
  CODE128: 'Code 128',
  'GS1-128': 'GS1-128',
  CODE39: 'Code 39',
  ITF: 'ITF (Interleaved 2 of 5)',
  CODABAR: 'Codabar (NW-7)',
  EAN13: 'EAN-13',
  EAN8: 'EAN-8',
  UPCA: 'UPC-A',
  UPCE: 'UPC-E',
  QRCODE: 'QR Code',
};

/** Symbologies with a narrow:wide ratio. The others encode at a fixed one. */
const RATIO_PROTOCOLS: BarcodeProtocol[] = ['CODE39', 'ITF', 'CODABAR'];
/** Symbologies whose payload is a fixed-length number we can pad. */
const ZERO_FILL_PROTOCOLS: BarcodeProtocol[] = ['EAN13', 'EAN8', 'UPCA', 'UPCE'];

const ECC_LEVELS: QrEccLevel[] = ['7%', '15%', '25%', '30%'];

function BarcodeFields({ scene, nodeId, pose, data }: {
  scene: Scene<LabelNodeData, LabelLayer, LabelPose>;
  nodeId: NodeId;
  pose: LabelPose;
  data: Extract<LabelNodeData, { kind: 'barcode' }>;
}) {
  const update = useCallback((partial: Partial<typeof data>) => {
    scene.update(nodeId, { data: { ...data, ...partial } });
  }, [scene, nodeId, data]);

  const updateQr = useCallback((partial: NonNullable<typeof data.qrCode>) => {
    scene.update(nodeId, { data: { ...data, qrCode: { ...data.qrCode, ...partial } } });
  }, [scene, nodeId, data]);

  // The same encode the canvas runs, so what the panel reports is exactly what
  // got drawn — including the check digit the encoder appended.
  const result = encodeBarcode(barcodeRequest(data));
  const isQr = data.protocol === 'QRCODE';
  const known = isSupportedProtocol(data.protocol);

  return (
    <div>
      <label className="prop-field">
        Symbology
        <select
          value={data.protocol}
          onChange={(e) => update({ protocol: e.target.value as BarcodeProtocol })}
        >
          {/* An imported file can carry a symbology we don't draw. Offer it as
              the current value so opening the panel never silently re-encodes
              the node — but don't let it be chosen. */}
          {!known && <option value={data.protocol}>{data.protocol} (not supported)</option>}
          {SUPPORTED_PROTOCOLS.map((p) => (
            <option key={p} value={p}>{PROTOCOL_LABELS[p] ?? p}</option>
          ))}
        </select>
      </label>
      <label className="prop-field">
        Data
        <textarea
          value={data.data}
          onChange={(e) => update({ data: e.target.value })}
        />
      </label>

      {!result.ok && (
        <p className="prop-error">
          {result.reason === 'unsupported'
            ? `${data.protocol} isn't rendered yet — this prints as a blank box, so printing is blocked.`
            : result.detail}
        </p>
      )}
      {result.ok && result.text !== data.data && (
        <p className="prop-note">Encodes as {result.text}</p>
      )}
      {result.ok && <SizeWarning symbol={result} pose={pose} />}

      {RATIO_PROTOCOLS.includes(data.protocol) && (
        <label className="prop-field">
          Bar ratio
          <select value={data.barRatio} onChange={(e) => update({ barRatio: e.target.value })}>
            <option value="1:2">1:2</option>
            <option value="1:3">1:3</option>
          </select>
        </label>
      )}
      {data.protocol === 'ITF' && (
        <label className="prop-check">
          <input
            type="checkbox"
            checked={data.checkDigit}
            onChange={(e) => update({ checkDigit: e.target.checked })}
          />
          Check digit
        </label>
      )}
      {ZERO_FILL_PROTOCOLS.includes(data.protocol) && (
        <label className="prop-check">
          <input
            type="checkbox"
            checked={data.zeroFill}
            onChange={(e) => update({ zeroFill: e.target.checked })}
          />
          Zero-fill short data
        </label>
      )}

      {isQr ? (
        <>
          <label className="prop-field">
            Error correction
            <select
              value={data.qrCode?.eccLevel ?? '15%'}
              onChange={(e) => updateQr({ eccLevel: e.target.value as QrEccLevel })}
            >
              {ECC_LEVELS.map((level) => (
                <option key={level} value={level}>{level}</option>
              ))}
            </select>
          </label>
          <label className="prop-field">
            Version
            <select
              value={data.qrCode?.version ?? 'auto'}
              onChange={(e) => updateQr({ version: e.target.value })}
            >
              <option value="auto">Auto</option>
              {Array.from({ length: 40 }, (_, i) => String(i + 1)).map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <>
          <label className="prop-check">
            <input
              type="checkbox"
              checked={data.humanReadable}
              onChange={(e) => update({ humanReadable: e.target.checked })}
            />
            Human-readable text
          </label>
          {data.humanReadable && (
            <label className="prop-field">
              Text align
              <select
                value={data.humanReadableAlignment}
                onChange={(e) => update({
                  humanReadableAlignment: e.target.value as typeof data.humanReadableAlignment,
                })}
              >
                <option value="LEFT">Left</option>
                <option value="CENTER">Center</option>
                <option value="RIGHT">Right</option>
              </select>
            </label>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Flags a barcode scaled too small to scan. The canvas draws crisp bars at any
 * size, so nothing on screen shows that the modules have shrunk below what the
 * printhead resolves — the panel is where the size is set, so it's where the
 * limit belongs. Printing blocks separately on the impossible case.
 */
function SizeWarning({ symbol, pose }: { symbol: BarcodeSymbol; pose: LabelPose }) {
  const dots = barcodeModuleDots(symbol, pose, Printers.ptP710bt.dpi);
  const fitness = moduleFitness(dots);
  if (fitness === 'ok') return null;

  const dimension = symbol.kind === '2d' ? 'W and H' : 'W';
  return (
    <p className={fitness === 'unrenderable' ? 'prop-error' : 'prop-warn'}>
      {fitness === 'unrenderable'
        ? `Too small to print: each module is ${dots.toFixed(2)} printer dots, under the
           one dot it needs to appear at all. Printing is blocked until ${dimension} grows.`
        : `Small enough that scanners may struggle: each module is ${dots.toFixed(2)} printer
           dots, under the 2 that clear the usual minimums. Increase ${dimension} to be safe.`}
    </p>
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
