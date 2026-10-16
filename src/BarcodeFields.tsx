import { useCallback } from 'react';
import type { NodeId, Scene } from '@weasel-js/core';
import { PropertyField, PropertySpan } from '@weasel-js/ui/components/Properties';
import type { BarcodeProtocol, QrEccLevel } from 'bil-lbx';
import { Printers } from 'obwat';
import type { LabelNodeData, LabelLayer, LabelPose } from './label';
import {
  encodeBarcode,
  barcodeRequest,
  barcodeModuleDots,
  moduleFitness,
  isSupportedProtocol,
  SUPPORTED_PROTOCOLS,
  type BarcodeSymbol,
} from './barcode';
import { snapNodePose } from './dotSnap';
import { PRINT_DPI } from './printDpi';

type BarcodeData = Extract<LabelNodeData, { kind: 'barcode' }>;

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

const ECC_OPTIONS = (['7%', '15%', '25%', '30%'] as QrEccLevel[]).map((v) => ({ value: v, label: v }));
const VERSION_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  ...Array.from({ length: 40 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })),
];
const RATIO_OPTIONS = ['1:2', '1:3'].map((v) => ({ value: v, label: v }));
const ALIGN_OPTIONS = [
  { value: 'LEFT', label: 'Left' },
  { value: 'CENTER', label: 'Center' },
  { value: 'RIGHT', label: 'Right' },
] as const;

export function BarcodeFields({ scene, nodeId, pose, data }: {
  scene: Scene<LabelNodeData, LabelLayer, LabelPose>;
  nodeId: NodeId;
  pose: LabelPose;
  data: BarcodeData;
}) {
  // A payload or option change can change the module count, so the pose
  // re-snaps to whole dots per module alongside it, as one undo step.
  const commit = useCallback((next: BarcodeData) => {
    scene.batch('Edit barcode', () => {
      scene.update(nodeId, { data: next });
      scene.setPose(nodeId, snapNodePose(next, pose, PRINT_DPI));
    });
  }, [scene, nodeId, pose]);
  const update = (partial: Partial<BarcodeData>) => commit({ ...data, ...partial });
  const updateQr = (partial: NonNullable<BarcodeData['qrCode']>) =>
    commit({ ...data, qrCode: { ...data.qrCode, ...partial } });

  // The same encode the canvas runs, so what the panel reports is exactly what
  // got drawn — including the check digit the encoder appended.
  const result = encodeBarcode(barcodeRequest(data));
  const isQr = data.protocol === 'QRCODE';
  // An imported file can carry a symbology we don't draw. Offer it as the
  // current value so opening the panel never silently re-encodes the node —
  // but don't let it be chosen.
  const protocolOptions = [
    ...(isSupportedProtocol(data.protocol)
      ? []
      : [{ value: data.protocol, label: `${data.protocol} (not supported)`, disabled: true }]),
    ...SUPPORTED_PROTOCOLS.map((p) => ({ value: p, label: PROTOCOL_LABELS[p] ?? p })),
  ];

  return (
    <>
      <PropertyField<BarcodeProtocol>
        kind="enum"
        span
        label="Symbology"
        value={data.protocol}
        options={protocolOptions}
        onChange={(protocol) => update({ protocol })}
      />
      <PropertyField
        kind="string"
        control="textarea"
        span
        label="Data"
        value={data.data}
        onChange={(text) => update({ data: text })}
      />

      {!result.ok && (
        <PropertySpan className="prop-message prop-message--error">
          {result.reason === 'unsupported'
            ? `${result.detail} — this prints as a blank box, so printing is blocked.`
            : result.detail}
        </PropertySpan>
      )}
      {result.ok && result.text !== data.data && (
        <PropertySpan className="prop-message">Encodes as {result.text}</PropertySpan>
      )}
      {result.ok && <SizeWarning symbol={result} pose={pose} />}

      {RATIO_PROTOCOLS.includes(data.protocol) && (
        <PropertyField
          kind="enum"
          label="Bar ratio"
          value={data.barRatio}
          options={RATIO_OPTIONS}
          onChange={(barRatio) => update({ barRatio })}
        />
      )}
      {data.protocol === 'ITF' && (
        <PropertyField
          kind="boolean"
          label="Check digit"
          value={data.checkDigit}
          onChange={(checkDigit) => update({ checkDigit })}
        />
      )}
      {ZERO_FILL_PROTOCOLS.includes(data.protocol) && (
        <PropertyField
          kind="boolean"
          label="Zero-fill"
          description="Pad short data with leading zeros"
          value={data.zeroFill}
          onChange={(zeroFill) => update({ zeroFill })}
        />
      )}
      {/* Outside the isQr branch below: every symbology needs a blank margin
          to scan, so unlike the controls around it this one always applies. */}
      <PropertyField
        kind="boolean"
        label="Opaque background"
        value={data.opaqueBackground}
        onChange={(opaqueBackground) => update({ opaqueBackground })}
      />

      {isQr ? (
        <>
          <PropertyField<QrEccLevel>
            kind="enum"
            label="Error correction"
            value={data.qrCode?.eccLevel ?? '15%'}
            options={ECC_OPTIONS}
            onChange={(eccLevel) => updateQr({ eccLevel })}
          />
          <PropertyField
            kind="enum"
            label="Version"
            value={data.qrCode?.version ?? 'auto'}
            options={VERSION_OPTIONS}
            onChange={(version) => updateQr({ version })}
          />
        </>
      ) : (
        <>
          <PropertyField
            kind="boolean"
            label="Human-readable"
            description="Print the encoded text under the bars"
            value={data.humanReadable}
            onChange={(humanReadable) => update({ humanReadable })}
          />
          {data.humanReadable && (
            <PropertyField<BarcodeData['humanReadableAlignment']>
              kind="enum"
              label="Text align"
              value={data.humanReadableAlignment}
              options={ALIGN_OPTIONS}
              onChange={(humanReadableAlignment) => update({ humanReadableAlignment })}
            />
          )}
        </>
      )}
    </>
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
    <PropertySpan className={`prop-message prop-message--${fitness === 'unrenderable' ? 'error' : 'warn'}`}>
      {fitness === 'unrenderable'
        ? `Too small to print: each module is ${dots.toFixed(2)} printer dots, under the
           one dot it needs to appear at all. Printing is blocked until ${dimension} grows.`
        : `Small enough that scanners may struggle: each module is ${dots.toFixed(2)} printer
           dots, under the 2 that clear the usual minimums. Increase ${dimension} to be safe.`}
    </PropertySpan>
  );
}
