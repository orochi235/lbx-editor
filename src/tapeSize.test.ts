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
import { TAPE_SIZES, tapeWidthMm, type TapeSize } from './label';
import { importLbx } from './lbxImport';
import { exportLbx } from './lbxExport';

const SIZES = Object.keys(TAPE_SIZES) as TapeSize[];

describe('tape width tables', () => {
  it.each(SIZES)('%s matches the width bil-lbx writes into the file', (size) => {
    expect(TAPE_SIZES[size].width).toBe(TAPE[size].width);
  });

  it.each(SIZES)('%s declares the millimetres its name promises', (size) => {
    // `tapeWidthMm` is what reaches obwat's media lookup. It's a declared
    // field rather than a parse of the key, so this only has to hold the two
    // in agreement — no key format is load-bearing, and a fractional tape
    // ("3.5mm", which bil-lbx carries) states its own width honestly.
    expect(tapeWidthMm(size)).toBe(Number(size.replace('mm', '')));
  });

  it.each(SIZES)('%s states the same tape in pt and mm', (size) => {
    // The two widths describe one cassette: pt sizes the render, mm picks the
    // media obwat encodes the job against. If they ever disagree by a tape
    // size, the label renders for one cassette and prints for another.
    expect((tapeWidthMm(size) / 25.4) * 72).toBeCloseTo(TAPE_SIZES[size].width, 0);
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
