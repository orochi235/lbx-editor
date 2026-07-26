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
