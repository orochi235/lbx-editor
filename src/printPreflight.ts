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
