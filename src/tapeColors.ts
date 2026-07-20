/**
 * Screen-preview colors for the cassette the printer reports
 * (PrinterStatus.tapeColor / textColor). Print output is untouched — the
 * printer lays down its one ink on its one tape; these maps only make the
 * canvas show that combination. CSS values approximate Brother TZe stock.
 */
import type { TapeColor, TextColor } from 'obwat';
import type { LabelNodeData } from './label';

/** Codes with no useful screen color (cleaning, stencil, incompatible,
 *  unknown, 'other') are deliberately absent → callers fall back to white. */
const TAPE_CSS: Partial<Record<TapeColor, string>> = {
  'white': '#ffffff',
  'clear': '#f2f2ef',
  'clear-white-text': '#f2f2ef',
  'red': '#e03131',
  'blue': '#2f5fc4',
  'yellow': '#f7d117',
  'green': '#169b4e',
  'black': '#1a1a1a',
  'matte-white': '#f5f4f0',
  'matte-clear': '#f2f2ef',
  'matte-silver': '#c9cbcc',
  'satin-gold': '#d5b06a',
  'satin-silver': '#c8c8c8',
  'blue-d': '#2f5fc4',
  'red-d': '#e03131',
  'fluorescent-orange': '#ff7a1a',
  'fluorescent-yellow': '#ebf20e',
  'berry-pink-s': '#e5578f',
  'light-gray-s': '#d4d4d4',
  'lime-green-s': '#b5d94c',
  'yellow-f': '#f7d117',
  'pink-f': '#f0a5c0',
  'blue-f': '#89aede',
  'white-heat-shrink': '#ffffff',
  'white-flex-id': '#ffffff',
  'yellow-flex-id': '#f7d117',
};

const TEXT_CSS: Partial<Record<TextColor, string>> = {
  'black': '#000000',
  'white': '#ffffff',
  'red': '#c22525',
  'blue': '#2149c0',
  'gold': '#b28f45',
  'blue-f': '#2149c0',
};

/** Cassettes whose tape is transparent film — the canvas draws these
 *  translucent so the page background shows through the strip. */
const CLEAR_TAPES: ReadonlySet<TapeColor> = new Set<TapeColor>([
  'clear', 'clear-white-text', 'matte-clear',
]);

export function tapeIsClear(color: TapeColor | null | undefined): boolean {
  return color != null && CLEAR_TAPES.has(color);
}

/** The representable values, for the debug override dropdowns. */
export const TAPE_COLOR_OPTIONS = Object.keys(TAPE_CSS) as TapeColor[];
export const TEXT_COLOR_OPTIONS = Object.keys(TEXT_CSS) as TextColor[];

export function tapeColorCss(color: TapeColor | null | undefined): string | null {
  return (color && TAPE_CSS[color]) || null;
}

export function textColorCss(color: TextColor | null | undefined): string | null {
  return (color && TEXT_CSS[color]) || null;
}

/**
 * Mirror of the print threshold (obwat dither.ts): would the printer lay this
 * solid #rrggbb down as ink (luminance < 128)? Non-hex strings → false.
 */
export function printsAsInk(css: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(css);
  if (!m) return false;
  const v = parseInt(m[1]!, 16);
  const lum = 0.299 * (v >> 16) + 0.587 * ((v >> 8) & 0xff) + 0.114 * (v & 0xff);
  return lum < 128;
}

/**
 * Recolor a node's ink-dark colors (the ones the printer would actually
 * print) to the cassette's ink color, for the screen preview. Returns `data`
 * unchanged (same reference) when nothing would change, so bitmap caches
 * keyed on data stay warm; black ink is a no-op by construction.
 */
export function remapNodeInk(data: LabelNodeData, ink: string): LabelNodeData {
  if (ink === '#000000') return data;
  const swap = (c: string) => (printsAsInk(c) ? ink : c);
  switch (data.kind) {
    case 'text': {
      const color = swap(data.color);
      return color === data.color ? data : { ...data, color };
    }
    case 'rect': {
      const strokeStyle = swap(data.strokeStyle);
      const fillColor = data.fillColor === null ? null : swap(data.fillColor);
      return strokeStyle === data.strokeStyle && fillColor === data.fillColor
        ? data
        : { ...data, strokeStyle, fillColor };
    }
    case 'line': {
      const strokeStyle = swap(data.strokeStyle);
      return strokeStyle === data.strokeStyle ? data : { ...data, strokeStyle };
    }
    default:
      return data;
  }
}
