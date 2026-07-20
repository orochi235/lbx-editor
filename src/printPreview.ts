/**
 * Print-preview pixel math: turn the print pipeline's 1-bit ink mask into
 * canvas-drawable RGBA. The mask comes from the same `renderLabelToRgba` +
 * `ditherToMask` steps the real print path runs (default threshold dither),
 * so the preview is the print's quantization by construction.
 */

/** Ink mask → RGBA pixels: dots in `inkCss` (hex #rrggbb; non-hex → black),
 *  everything else transparent so the tape face shows through on canvas. */
export function maskToRgba(
  mask: Uint8Array,
  width: number,
  height: number,
  inkCss: string,
): Uint8ClampedArray<ArrayBuffer> {
  const m = /^#([0-9a-f]{6})$/i.exec(inkCss);
  const v = m ? parseInt(m[1]!, 16) : 0;
  const r = v >> 16;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      const o = i * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  return data;
}
