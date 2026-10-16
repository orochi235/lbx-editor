import { usePrinterSummary, type PrinterSeen } from './printerStatus';
import './printerStatusChip.css';

export interface PrinterStatusChipProps {
  lastSeen: PrinterSeen | null;
  reachable: boolean;
  printing: boolean;
  /** Click handler: fire an immediate status query (result arrives via the
   *  same onStatus stream that feeds this chip). */
  onRefresh?: () => void;
}

/** Printer reachability, tape width, error state, last-seen. Clicking
 *  re-queries the printer. */
export function PrinterStatusChip({ lastSeen, reachable, printing, onRefresh }: PrinterStatusChipProps) {
  const { variant, text, tooltip } = usePrinterSummary(lastSeen, reachable, printing);
  return (
    <button
      type="button"
      className={`printer-chip printer-chip--${variant}`}
      title={`${tooltip}. Click to re-query.`}
      onClick={onRefresh}
    >
      <span className="printer-chip__dot" />
      {text}
    </button>
  );
}
