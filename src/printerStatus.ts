import { useEffect, useState } from 'react';
import type { PrinterStatus } from 'obwat';

export interface PrinterSeen {
  status: PrinterStatus;
  at: number;
}

export type PrinterStatusVariant = 'ready' | 'error' | 'unknown' | 'printing';

export interface PrinterStatusSummary {
  variant: PrinterStatusVariant;
  text: string;
  tooltip: string;
}

const MODEL = 'PT-P710BT';

function relativeTime(at: number, now: number): string {
  const mins = Math.floor((now - at) / 60_000);
  return mins < 1 ? 'just now' : `${mins}m ago`;
}

/** How the printer's state reads wherever it's shown: the toolbar chip, the
 *  Printer panel, the status bar. */
export function summarizePrinter(
  lastSeen: PrinterSeen | null,
  reachable: boolean,
  printing: boolean,
  now: number,
): PrinterStatusSummary {
  if (printing) {
    return { variant: 'printing', text: `${MODEL} · printing…`, tooltip: 'Sending job to the printer' };
  }
  if (!reachable || !lastSeen) {
    return {
      variant: 'unknown',
      text: `${MODEL} · —`,
      tooltip: 'Printer not detected — it may be asleep (press its power button)',
    };
  }
  const { status, at } = lastSeen;
  const width = status.mediaWidthMm !== null ? `${status.mediaWidthMm}mm` : '—';
  const time = new Date(at).toLocaleTimeString();
  return {
    variant: status.hasError ? 'error' : 'ready',
    text: `${MODEL} · ${width} · ${relativeTime(at, now)}`,
    tooltip: status.hasError
      ? `Printer reports an error — check tape/cover (last seen ${time})`
      : `Ready (last seen ${time})`,
  };
}

/** `summarizePrinter`, re-rendered on a coarse timer so "5m ago" stays honest. */
export function usePrinterSummary(
  lastSeen: PrinterSeen | null,
  reachable: boolean,
  printing: boolean,
): PrinterStatusSummary {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(handle);
  }, []);
  return summarizePrinter(lastSeen, reachable, printing, now);
}
