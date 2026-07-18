import type { LabelTextData } from './label';

export interface TextBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Split label text into render lines (single-line boxes just yield one). */
export function textLines(text: string): string[] {
  return text.split('\n');
}

const LINE_HEIGHT_FACTOR = 1.2;
const ASCENT_FACTOR = 0.8;

/**
 * Layout for a block of `lineCount` lines in `box`: the anchor x for the given
 * horizontal alignment (JUSTIFY renders as LEFT), the y of the first baseline
 * for the given vertical alignment, and the line advance. Y values are
 * relative to box.y = 0; callers add box.y.
 */
export function lineLayout(
  box: TextBox,
  lineCount: number,
  fontSize: number,
  horizontal: LabelTextData['horizontalAlignment'],
  vertical: LabelTextData['verticalAlignment'],
): { x: number; firstBaseline: number; lineHeight: number; align: CanvasTextAlign } {
  const lineHeight = fontSize * LINE_HEIGHT_FACTOR;
  const ascent = fontSize * ASCENT_FACTOR;
  const blockHeight = lineCount * lineHeight;

  let x: number;
  let align: CanvasTextAlign;
  if (horizontal === 'CENTER') {
    x = box.x + box.width / 2;
    align = 'center';
  } else if (horizontal === 'RIGHT') {
    x = box.x + box.width;
    align = 'right';
  } else {
    x = box.x;
    align = 'left';
  }

  let firstBaseline: number;
  if (vertical === 'CENTER') {
    firstBaseline = (box.height - blockHeight) / 2 + ascent;
  } else if (vertical === 'BOTTOM') {
    firstBaseline = box.height - blockHeight + ascent;
  } else {
    firstBaseline = ascent;
  }

  return { x, firstBaseline, lineHeight, align };
}

/** CSS font string for a text node at the given size (already scaled by caller). */
export function cssFont(data: LabelTextData, fontSize: number): string {
  const style = data.italic ? 'italic ' : '';
  return `${style}${data.fontWeight} ${fontSize}px ${data.fontFamily}`;
}

/**
 * Draw a text node's glyphs into a 2D context, in the same coordinate space as
 * `box`. The context's transform handles any device scaling. Shared by the
 * print rasterizer and the on-screen bitmap cache so screen matches print.
 */
export function drawLabelText(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  data: LabelTextData,
  box: TextBox,
): void {
  const lines = textLines(data.text);
  const { x, firstBaseline, lineHeight, align } = lineLayout(
    box, lines.length, data.fontSize, data.horizontalAlignment, data.verticalAlignment,
  );
  ctx.font = cssFont(data, data.fontSize);
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = data.color;
  lines.forEach((line, i) => {
    ctx.fillText(line, x, box.y + firstBaseline + i * lineHeight);
  });
}
