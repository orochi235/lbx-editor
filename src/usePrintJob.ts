import { useCallback, useRef, useState, type RefObject } from 'react';
import type { Scene } from '@weasel-js/core';
import { toast } from '@weasel-js/ui/components/Toast';
import {
  rgbaToRaster,
  Printers,
  NoGrantedDeviceError,
  type BrotherPrinter,
  type DitherAlgorithm,
  type PrinterStatus,
} from 'obwat';
import { tapeWidthMm, type LabelLayer, type LabelNodeData, type LabelPose, type TapeSize } from './label';
import { encodeBarcode, barcodeRequest, barcodeModuleDots, moduleFitness } from './barcode';
import { sliceRasterAtCuts } from './cutMarks';
import { renderForPrint } from './printRender';
import { registerFonts, canvasFontsInUse } from './fonts';
import {
  tapeMismatchMessage,
  unrenderableBarcodeMessage,
  undersizedBarcodeMessage,
} from './printPreflight';

/** Set once a USB device grant exists; lets us distinguish "printer asleep" from "never granted". */
const USB_GRANT_FLAG = 'lbx-editor.hasUsbGrant';

interface PrintJobArgs {
  printerRef: RefObject<BrotherPrinter | null>;
  scene: Scene<LabelNodeData, LabelLayer, LabelPose>;
  tapeSize: TapeSize;
  labelLength: number;
  paperHeight: number;
  autoCut: boolean;
  ditherAlgorithm: DitherAlgorithm;
  cutMarks: number[];
  preflightChecks: boolean;
  /** A barcode preflight refused the job. */
  onBlocked: () => void;
}

/** The Print button: preflight, render, and send — and the UX policy around
 *  a printer that is asleep, never granted, or loaded with the wrong tape. */
export function usePrintJob({
  printerRef, scene, tapeSize, labelLength, paperHeight, autoCut, ditherAlgorithm, cutMarks,
  preflightChecks, onBlocked,
}: PrintJobArgs) {
  const [printing, setPrinting] = useState(false);
  const printingRef = useRef(false);

  const handlePrint = useCallback(async () => {
    if (printingRef.current) return;
    const printer = printerRef.current;
    if (!printer) return;
    const widthMm = tapeWidthMm(tapeSize);
    if (!('usb' in navigator) && !('serial' in navigator)) {
      toast.error('Printing not supported here', {
        description: 'This browser has neither WebUSB nor Web Serial. Use Chrome or Edge.',
      });
      return;
    }
    // Preflight before touching the printer: a barcode we can't encode draws
    // as a placeholder box, and one scaled under a dot per module prints as a
    // smear. Either way the tape is spent on a label whose barcode isn't one.
    // Skipped wholesale when pre-print checks are off — the user has said they
    // want the job sent regardless, and the printer remains the authority.
    let unrenderable = 0;
    let undersized = 0;
    for (const [, node] of (preflightChecks ? scene.nodes : [])) {
      if (node.data.kind !== 'barcode') continue;
      const symbol = encodeBarcode(barcodeRequest(node.data));
      if (!symbol.ok) {
        unrenderable++;
      } else if (
        moduleFitness(barcodeModuleDots(symbol, node.pose, Printers.ptP710bt.dpi)) === 'unrenderable'
      ) {
        undersized++;
      }
    }
    const barcodeProblem = unrenderableBarcodeMessage(unrenderable)
      ?? undersizedBarcodeMessage(undersized);
    if (barcodeProblem) {
      onBlocked();
      toast.error('Print blocked', { description: barcodeProblem });
      return;
    }

    setPrinting(true);
    printingRef.current = true;
    try {
      // Preflight: the printer tells us what tape it's holding, so a
      // mismatched job (printer blinks red, generic error reply) is caught
      // before it's sent. Unknown media (asleep printer, no usable width in
      // the reply) proceeds — the printer stays the authority.
      const loaded = await printer.queryMedia();
      const mismatch = preflightChecks
        ? tapeMismatchMessage(widthMm, loaded?.tapeWidthMm ?? null)
        : null;
      if (mismatch) {
        toast.error('Tape size mismatch', { description: mismatch });
        return;
      }
      // Text needs its MSDF atlases registered before renderLabelToRgba draws
      // it; registerFonts() is idempotent so this is a no-op once settled.
      await registerFonts();
      const machineFamilies: string[] = [];
      for (const [, node] of scene.nodes) {
        if (node.data.kind === 'text') machineFamilies.push(node.data.fontFamily);
      }
      const machineFonts = canvasFontsInUse(machineFamilies);
      if (preflightChecks && machineFonts.length > 0) {
        toast.info('Using fonts from this machine', {
          description:
            `${machineFonts.join(', ')} — this label prints correctly here, but machines ` +
            'without those fonts will substitute.',
        });
      }
      const { media, rgba, protect } = renderForPrint({
        scene, tapeSize, labelLengthPt: labelLength, tapeWidthPt: paperHeight,
      });
      const raster = rgbaToRaster(rgba, media, { algorithm: ditherAlgorithm, protect });
      // Cut marks slice the job into pages; the cutter fires between pages
      // (with auto-cut on), printing the document as a strip of labels.
      const job = sliceRasterAtCuts(raster, cutMarks, media.dpi);
      const jobOpts = { tapeWidthMm: widthMm, autoCut, marginDots: 0 };

      let status: PrinterStatus;
      try {
        // Zero-click path: an already-granted device. The facade's mutex waits
        // out any in-flight keepalive tick (≤2 s; Chrome's user-activation
        // window comfortably outlives it if we fall through to the picker).
        status = await printer.print(job, jobOpts);
      } catch (err) {
        if (!(err instanceof NoGrantedDeviceError)) throw err;
        if (localStorage.getItem(USB_GRANT_FLAG)) {
          // One-shot hint: clearing the flag means a repeat click falls through to
          // the picker, so a revoked permission can't dead-end the Print button.
          localStorage.removeItem(USB_GRANT_FLAG);
          toast.error('Printer not found', {
            description:
              'It may have auto-powered off. Press its power button, then print again.',
          });
          return;
        }
        await printer.requestDevice();
        status = await printer.print(job, jobOpts);
      }
      // A grant exists (the print went through) — remember for the
      // asleep-vs-never-granted hint. Serial grants don't persist, so
      // the flag stays USB-only.
      if ('usb' in navigator) localStorage.setItem(USB_GRANT_FLAG, '1');
      if (status.hasError) {
        toast.error('Printer reported an error', {
          description: 'Check the tape and that the cover is closed.',
        });
      } else if (status.incomplete) {
        toast.warning('Print sent, status unclear', {
          description: "The printer's status reply was incomplete — check the printer.",
        });
      }
    } catch (err) {
      // Dismissing the device/port picker is a normal cancel, not a failure.
      if (err instanceof DOMException && err.name === 'NotFoundError') return;
      toast.error('Print failed', { description: (err as Error).message });
    } finally {
      printingRef.current = false;
      setPrinting(false);
    }
  }, [printerRef, tapeSize, scene, labelLength, paperHeight, autoCut, ditherAlgorithm, cutMarks, preflightChecks, onBlocked]);

  return { printing, handlePrint };
}
