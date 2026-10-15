import type { LabelNodeData } from './label';

export const KIND_NAMES: Record<LabelNodeData['kind'], string> = {
  text: 'Text',
  rect: 'Rectangle',
  line: 'Line',
  image: 'Image',
  barcode: 'Barcode',
};

const QUOTE_MAX = 24;

/** A node named the way a person would point at it: its kind, plus what tells
 *  it apart from others of that kind. */
export function nodeSummary(data: LabelNodeData): string {
  const kind = KIND_NAMES[data.kind];
  switch (data.kind) {
    case 'text': {
      const line = data.text.split('\n')[0] ?? '';
      const quoted = line.length > QUOTE_MAX ? `${line.slice(0, QUOTE_MAX - 1)}…` : line;
      return `${kind} “${quoted}”`;
    }
    case 'image':
      return data.originalName ? `${kind} ${data.originalName}` : kind;
    case 'barcode':
      return `${kind} ${data.protocol}`;
    default:
      return kind;
  }
}
