/**
 * Tape width is the one dimension the editor can't get wrong quietly: it picks
 * the printable band, the render height, and the media spec the print job is
 * encoded against. Getting it wrong doesn't throw — it prints a label sized for
 * the wrong cassette.
 *
 * The pt widths live in three places (bil-lbx's TAPE, our TAPE_SIZES, and
 * lbxImport's detectTapeSize table) because each side owns its own vocabulary.
 * These tests pin them to each other so the copies can't drift apart in silence.
 */
import { describe, it, expect } from 'vitest';
import { TAPE } from 'bil-lbx';
import { TAPE_SIZES, type TapeSize } from './label';
import { importLbx } from './lbxImport';
import { exportLbx } from './lbxExport';

const SIZES = Object.keys(TAPE_SIZES) as TapeSize[];

describe('tape width tables', () => {
  it.each(SIZES)('%s matches the width bil-lbx writes into the file', (size) => {
    expect(TAPE_SIZES[size].width).toBe(TAPE[size].width);
  });

  it('names every size so parseInt yields the millimetres obwat asks for', () => {
    // App.tsx reaches the printer profile via `parseInt(tapeSize, 10)`. That
    // holds only while every key is "<integer>mm" — a "3.5mm" key would parse
    // to 3 and silently select the wrong media.
    for (const size of SIZES) {
      expect(size).toMatch(/^\d+mm$/);
      expect(String(parseInt(size, 10))).toBe(size.replace('mm', ''));
    }
  });
});

describe('tape width round-trip', () => {
  it.each(SIZES)('survives export → import as %s', async (size) => {
    const bytes = await exportLbx([], size, false, 200, []);
    const buf = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const result = await importLbx(buf);
    expect(result.tapeSize).toBe(size);
  });
});
