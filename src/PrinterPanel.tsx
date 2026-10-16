import type { DitherAlgorithm } from 'obwat';
import { PropertyField, PropertyGroup, PropertyList, PropertySpan } from '@weasel-js/ui/components/Properties';
import { PrinterStatusChip, type PrinterStatusChipProps } from './PrinterStatusChip';
import { DITHER_LABELS } from './prefs';
import './printerPanel.css';

const DITHER_OPTIONS = (Object.keys(DITHER_LABELS) as DitherAlgorithm[]).map((a) => ({
  value: a,
  label: DITHER_LABELS[a],
}));

interface PrinterPanelProps {
  lastSeen: PrinterStatusChipProps['lastSeen'];
  reachable: boolean;
  printing: boolean;
  onRefresh: () => void;
  autoCut: boolean;
  onAutoCutChange: (on: boolean) => void;
  printPreview: boolean;
  onPrintPreviewChange: (on: boolean) => void;
  marginGuides: boolean;
  onMarginGuidesChange: (on: boolean) => void;
  /** Drives both the on-canvas preview and the print job's quantization. */
  ditherAlgorithm: DitherAlgorithm;
  onDitherAlgorithmChange: (algorithm: DitherAlgorithm) => void;
}

/** Printer state and job settings. */
export function PrinterPanel(props: PrinterPanelProps) {
  return (
    <PropertyList>
      <PropertySpan className="printer-panel__chip">
        <PrinterStatusChip
          lastSeen={props.lastSeen}
          reachable={props.reachable}
          printing={props.printing}
          onRefresh={props.onRefresh}
        />
      </PropertySpan>
      <PropertyGroup title="Output">
        <PropertyField
          kind="boolean"
          label="Auto cut"
          description="Cut the tape automatically after printing"
          value={props.autoCut}
          onChange={props.onAutoCutChange}
        />
        <PropertyField
          kind="boolean"
          label="Print preview"
          description="Show the label as the printer will render it: dithered black-and-white dots at print resolution"
          value={props.printPreview}
          onChange={props.onPrintPreviewChange}
        />
        <PropertyField
          kind="boolean"
          label="Printable margins"
          description="Draw dashed lines at the top and bottom of the band the printhead can reach"
          value={props.marginGuides}
          onChange={props.onMarginGuidesChange}
        />
      </PropertyGroup>
      <PropertyField<DitherAlgorithm>
        kind="enum"
        label="Dithering"
        description="How colors and grays quantize to the printer's black dots — applies to the preview and the printed label alike"
        value={props.ditherAlgorithm}
        options={DITHER_OPTIONS}
        onChange={props.onDitherAlgorithmChange}
      />
    </PropertyList>
  );
}
