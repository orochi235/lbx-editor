import type { DitherAlgorithm } from 'obwat';
import { PrinterStatusChip, type PrinterStatusChipProps } from './PrinterStatusChip';
import { DITHER_LABELS } from './prefs';
import './printerPanel.css';

interface PrinterPanelProps {
  lastSeen: PrinterStatusChipProps['lastSeen'];
  reachable: boolean;
  printing: boolean;
  onRefresh: () => void;
  autoCut: boolean;
  onAutoCutChange: (on: boolean) => void;
  printPreview: boolean;
  onPrintPreviewChange: (on: boolean) => void;
  /** Drives both the on-canvas preview and the print job's quantization. */
  ditherAlgorithm: DitherAlgorithm;
  onDitherAlgorithmChange: (algorithm: DitherAlgorithm) => void;
}

/** Sidebar panel for printer state and job settings. Shows the same status
 *  chip as the toolbar; more printer controls will land here over time. */
export function PrinterPanel({
  lastSeen,
  reachable,
  printing,
  onRefresh,
  autoCut,
  onAutoCutChange,
  printPreview,
  onPrintPreviewChange,
  ditherAlgorithm,
  onDitherAlgorithmChange,
}: PrinterPanelProps) {
  return (
    <div className="printer-panel">
      <h3>Printer</h3>
      <div className="printer-panel__chip">
        <PrinterStatusChip
          lastSeen={lastSeen}
          reachable={reachable}
          printing={printing}
          onRefresh={onRefresh}
        />
      </div>
      <label className="printer-panel__check" title="Cut the tape automatically after printing">
        <input
          type="checkbox"
          checked={autoCut}
          onChange={(e) => onAutoCutChange(e.target.checked)}
        />
        Auto cut
      </label>
      <label
        className="printer-panel__check"
        title="Show the label as the printer will render it: dithered black-and-white dots at print resolution"
      >
        <input
          type="checkbox"
          checked={printPreview}
          onChange={(e) => onPrintPreviewChange(e.target.checked)}
        />
        Print preview
      </label>
      <label className="printer-panel__field" title="How colors and grays quantize to the printer's black dots — applies to the preview and the printed label alike">
        Dithering
        <select
          value={ditherAlgorithm}
          onChange={(e) => onDitherAlgorithmChange(e.target.value as DitherAlgorithm)}
        >
          {(Object.keys(DITHER_LABELS) as DitherAlgorithm[]).map((a) => (
            <option key={a} value={a}>{DITHER_LABELS[a]}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
