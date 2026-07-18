import { describe, it, expect } from 'vitest';
import { textLines, lineLayout } from './textRender';

describe('textLines', () => {
  it('splits on newlines, keeping empty lines', () => {
    expect(textLines('a\n\nb')).toEqual(['a', '', 'b']);
  });
});

describe('lineLayout', () => {
  const box = { x: 0, y: 0, width: 100, height: 60 };

  it('anchors left/center/right x', () => {
    expect(lineLayout(box, 1, 10, 'LEFT', 'TOP').x).toBe(0);
    expect(lineLayout(box, 1, 10, 'CENTER', 'TOP').x).toBe(50);
    expect(lineLayout(box, 1, 10, 'RIGHT', 'TOP').x).toBe(100);
    expect(lineLayout(box, 1, 10, 'JUSTIFY', 'TOP').x).toBe(0);
  });

  it('computes first baseline for TOP/CENTER/BOTTOM vertical alignment', () => {
    // lineHeight = fontSize * 1.2 = 12; ascent approximated at 0.8 * fontSize = 8
    expect(lineLayout(box, 2, 10, 'LEFT', 'TOP').firstBaseline).toBe(8);
    // block height = 2 * 12 = 24; centered: (60 - 24) / 2 + 8 = 26
    expect(lineLayout(box, 2, 10, 'LEFT', 'CENTER').firstBaseline).toBe(26);
    // bottom: 60 - 24 + 8 = 44
    expect(lineLayout(box, 2, 10, 'LEFT', 'BOTTOM').firstBaseline).toBe(44);
    expect(lineLayout(box, 2, 10, 'LEFT', 'TOP').lineHeight).toBe(12);
  });
});
