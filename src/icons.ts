import { scopedIcon, type IconTable } from '@weasel-js/icons';
import { kitIcons } from '@weasel-js/ui/kit-icons';
import { encodeCode128 } from './barcode/code128';

/** The barcode glyph: a genuine Code 128 encoding of 1337, drawn by the same
 *  encoder the tool inserts, scaled onto the registry's 20-unit box. */
function barcodeBody(): string {
  const symbol = encodeCode128('1337', { gs1: false });
  if (!symbol.ok || symbol.kind !== '1d') return '';
  const n = symbol.totalModules;
  const bars = symbol.bars
    .map((bar) => `<rect x="${bar.x}" y="${n * 0.1}" width="${bar.width}" height="${n * 0.8}"/>`)
    .join('');
  return `<g transform="scale(${20 / n})" fill="currentColor" stroke="none" shape-rendering="crispEdges">${bars}</g>`;
}

const appIcons: IconTable = {
  namespace: 'lbx',
  owner: 'lbx-editor',
  icons: {
    barcode: { body: barcodeBody(), group: 'tools', tags: ['barcode'] },
  },
};

/** Every table the app's registry holds: the kit's glyphs and the app's own. */
export const iconTables: readonly IconTable[] = [...kitIcons, appIcons];

/** Names a glyph in the app's `lbx` table, or a qualified kit glyph (`'ui:zoomIn'`). */
export const icon = scopedIcon<'barcode'>('lbx');
