import { useEffect, useState } from 'react';
import type { PrinterStatus } from 'obwat';
import './printerStatusChip.css';

export interface PrinterStatusChipProps {
  lastSeen: { status: PrinterStatus; at: number } | null;
  reachable: boolean;
  printing: boolean;
}

const MODEL = 'PT-P710BT';

function relativeTime(at: number, now: number): string {
  const mins = Math.floor((now - at) / 60_000);
  return mins < 1 ? 'just now' : `${mins}m ago`;
}

/** Toolbar chip: printer reachability, tape width, error state, last-seen. */
export function PrinterStatusChip({ lastSeen, reachable, printing }: PrinterStatusChipProps) {
  // Re-render on a coarse timer so the relative time stays honest.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(handle);
  }, []);

  let variant: 'ready' | 'error' | 'unknown' | 'printing';
  let text: string;
  let tooltip: string;

  if (printing) {
    variant = 'printing';
    text = `${MODEL} · printing…`;
    tooltip = 'Sending job to the printer';
  } else if (!reachable || !lastSeen) {
    variant = 'unknown';
    text = `${MODEL} · —`;
    tooltip = 'Printer not detected — it may be asleep (press its power button)';
  } else {
    const { status, at } = lastSeen;
    variant = status.hasError ? 'error' : 'ready';
    const width = status.mediaWidthMm !== null ? `${status.mediaWidthMm}mm` : '—';
    text = `${MODEL} · ${width} · ${relativeTime(at, now)}`;
    tooltip = status.hasError
      ? `Printer reports an error — check tape/cover (last seen ${new Date(at).toLocaleTimeString()})`
      : `Ready (last seen ${new Date(at).toLocaleTimeString()})`;
  }

  return (
    <div className={`printer-chip printer-chip--${variant}`} title={tooltip}>
      <span className="printer-chip__dot" />
      {text}
    </div>
  );
}
