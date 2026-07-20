import { describe, expect, it } from 'vitest';
import { printsAsInk, remapNodeInk, tapeColorCss, tapeIsClear, textColorCss } from './tapeColors';
import type { LabelLineData, LabelRectData, LabelTextData } from './label';

describe('tapeColorCss / textColorCss', () => {
  it('maps known cassette colors', () => {
    expect(tapeColorCss('white')).toBe('#ffffff');
    expect(tapeColorCss('black')).toBe('#1a1a1a');
    expect(textColorCss('white')).toBe('#ffffff');
  });

  it('falls back to null for unrepresentable or missing values', () => {
    expect(tapeColorCss('incompatible')).toBeNull();
    expect(tapeColorCss('unknown')).toBeNull();
    expect(tapeColorCss(null)).toBeNull();
    expect(tapeColorCss(undefined)).toBeNull();
    expect(textColorCss('other')).toBeNull();
  });
});

describe('tapeIsClear', () => {
  it('flags transparent-film cassettes only', () => {
    expect(tapeIsClear('clear')).toBe(true);
    expect(tapeIsClear('clear-white-text')).toBe(true);
    expect(tapeIsClear('matte-clear')).toBe(true);
    expect(tapeIsClear('white')).toBe(false);
    expect(tapeIsClear(null)).toBe(false);
    expect(tapeIsClear(undefined)).toBe(false);
  });
});

describe('printsAsInk', () => {
  it('matches the print threshold: dark prints, light does not', () => {
    expect(printsAsInk('#000000')).toBe(true);
    expect(printsAsInk('#333333')).toBe(true);
    expect(printsAsInk('#ffffff')).toBe(false);
    expect(printsAsInk('#f7d117')).toBe(false);
  });

  it('rejects non-6-digit-hex strings', () => {
    expect(printsAsInk('red')).toBe(false);
    expect(printsAsInk('#fff')).toBe(false);
  });
});

describe('remapNodeInk', () => {
  const text: LabelTextData = {
    kind: 'text', text: 'hi', fontFamily: 'Helvetica', fontSize: 12,
    fontWeight: 400, italic: false, horizontalAlignment: 'LEFT',
    verticalAlignment: 'TOP', color: '#000000',
  };
  const rect: LabelRectData = {
    kind: 'rect', rounded: false, roundness: 0,
    strokeStyle: '#000000', strokeWidth: 1, fillColor: null,
  };
  const line: LabelLineData = {
    kind: 'line', strokeStyle: '#000000', strokeWidth: 1, descending: true,
  };

  it('recolors ink-dark colors to the cassette ink', () => {
    expect(remapNodeInk(text, '#ffffff')).toMatchObject({ color: '#ffffff' });
    expect(remapNodeInk(rect, '#c22525')).toMatchObject({ strokeStyle: '#c22525', fillColor: null });
    expect(remapNodeInk(line, '#c22525')).toMatchObject({ strokeStyle: '#c22525' });
  });

  it('leaves light (non-printing) colors alone', () => {
    const lightText = { ...text, color: '#eeeeee' };
    expect(remapNodeInk(lightText, '#c22525')).toBe(lightText);
  });

  it('is identity (same reference) for black ink', () => {
    expect(remapNodeInk(text, '#000000')).toBe(text);
  });

  it('remaps a dark rect fill', () => {
    const filled = { ...rect, fillColor: '#222222' };
    expect(remapNodeInk(filled, '#ffffff')).toMatchObject({ strokeStyle: '#ffffff', fillColor: '#ffffff' });
  });
});
