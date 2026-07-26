/**
 * Pre-print check: does the label's tape size match what the printer says is
 * loaded? Sending a mismatched job just makes the printer blink red and
 * reply with a generic error, so catch it before the job leaves the app.
 */

/**
 * Alert copy for a tape mismatch, or null when there's nothing to block on —
 * widths match, or the loaded width is unknown (printer asleep / status
 * carried no usable width), in which case the print proceeds and the printer
 * remains the authority.
 */
export function tapeMismatchMessage(labelMm: number, loadedMm: number | null): string | null {
  if (!loadedMm || loadedMm === labelMm) return null;
  return (
    `This label is set up for ${labelMm}mm tape, but the printer has ` +
    `${loadedMm}mm tape loaded. Switch the label's tape size to ${loadedMm}mm ` +
    `or swap the cassette, then print again.`
  );
}

/**
 * Alert copy when the label carries barcodes this editor can't encode — an
 * unsupported symbology, or a payload that doesn't fit the one chosen. They
 * draw as placeholder boxes, so printing would put a blank rectangle on the
 * tape where bars belong. Block the job instead.
 */
export function unrenderableBarcodeMessage(count: number): string | null {
  if (count <= 0) return null;
  const noun = count === 1 ? '1 barcode' : `${count} barcodes`;
  return (
    `This label has ${noun} the editor can't draw — either an unsupported ` +
    `symbology or a payload that doesn't encode. They'd print as empty boxes. ` +
    `Fix or remove them, then print again.`
  );
}

/**
 * Alert copy when a barcode is scaled below one printer dot per module. The
 * canvas draws it crisply at any size, so this failure is invisible until it's
 * on tape: the bars have no whole dot of their own and print as a smear.
 *
 * Only the physically impossible case blocks. Merely small barcodes — under
 * scanner minimums but still renderable — are flagged in the property panel
 * instead, where the size can actually be changed.
 */
export function undersizedBarcodeMessage(count: number): string | null {
  if (count <= 0) return null;
  const noun = count === 1 ? '1 barcode' : `${count} barcodes`;
  return (
    `This label has ${noun} scaled too small to print — the bars are narrower ` +
    `than a single printer dot, so they'd merge into a smear instead of a ` +
    `readable symbol. Make them wider, then print again.`
  );
}
