import { PrinterStatusChip, type PrinterStatusChipProps } from './PrinterStatusChip';
import './printerPanel.css';

interface PrinterPanelProps {
  lastSeen: PrinterStatusChipProps['lastSeen'];
  reachable: boolean;
  printing: boolean;
  onRefresh: () => void;
  autoCut: boolean;
  onAutoCutChange: (on: boolean) => void;
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
    </div>
  );
}
