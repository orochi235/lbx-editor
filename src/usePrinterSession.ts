import { useCallback, useEffect, useRef, useState } from 'react';
import { createBrotherPrinter, type BrotherPrinter, type PrinterStatus } from 'obwat';

/**
 * One connectionless printer session per mount. Its keepalive keeps the
 * PT-P710BT awake (it auto-powers off after ~10 min idle); its status events
 * — keepalive ticks and post-print statuses alike — feed the chip.
 */
export function usePrinterSession() {
  const [printerLastSeen, setPrinterLastSeen] = useState<{ status: PrinterStatus; at: number } | null>(null);
  const [printerReachable, setPrinterReachable] = useState(false);
  const printerRef = useRef<BrotherPrinter | null>(null);
  useEffect(() => {
    const printer = createBrotherPrinter();
    printerRef.current = printer;
    const off = printer.onStatus((status) => {
      setPrinterReachable(status !== null);
      if (status !== null) setPrinterLastSeen({ status, at: Date.now() });
    });
    return () => {
      off();
      printerRef.current = null;
      printer.dispose();
    };
  }, []);

  // Chip click: immediate status poll. The reply (or timeout) lands through
  // the same onStatus stream the keepalive feeds, so the chip just updates.
  const handlePrinterRefresh = useCallback(() => {
    void printerRef.current?.queryStatus();
  }, []);

  return { printerRef, printerLastSeen, printerReachable, handlePrinterRefresh };
}
