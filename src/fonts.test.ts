import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerFont } from '@weasel-js/core';
import {
  substituteFontFamily,
  registeredFamilies,
  registerFonts,
  BUNDLED_FAMILIES,
  _resetFontsForTests,
} from './fonts';

vi.mock('@weasel-js/core', () => ({
  registerFont: vi.fn(),
}));

describe('substituteFontFamily', () => {
  it('passes through bundled families', () => {
    for (const f of BUNDLED_FAMILIES) expect(substituteFontFamily(f)).toBe(f);
  });
  it('maps known .lbx machine fonts', () => {
    expect(substituteFontFamily('Helvetica')).toBe('Inter');
    expect(substituteFontFamily('Arial')).toBe('Inter');
    expect(substituteFontFamily('Helvetica Neue Condensed Bold')).toBe('Barlow Condensed');
    expect(substituteFontFamily('Univers LT Std 57 Cn')).toBe('Barlow Condensed');
    expect(substituteFontFamily('Futura Condensed Medium')).toBe('Barlow Condensed');
  });
  it('heuristic: condensed-looking names go condensed, others default', () => {
    expect(substituteFontFamily('Roboto Condensed')).toBe('Barlow Condensed');
    expect(substituteFontFamily('SomeUnknownCn Font')).toBe('Barlow Condensed');
    expect(substituteFontFamily('Comic Sans MS')).toBe('Inter');
  });
});

describe('registeredFamilies', () => {
  it('returns the bundled families sorted', () => {
    _resetFontsForTests();
    expect(registeredFamilies()).toEqual(['Barlow Condensed', 'Inter', 'JetBrains Mono']);
  });
});

describe('registerFonts', () => {
  const mockRegisterFont = vi.mocked(registerFont);

  beforeEach(() => {
    _resetFontsForTests();
    mockRegisterFont.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves and registers only the local entries that succeed, skipping bad ones', async () => {
    const manifest = [
      { family: 'GoodLocal', weight: 400, metrics: 'good.json', atlas: 'good.png' },
      { family: 'BadLocal', weight: 400, metrics: 'bad.json', atlas: 'bad.png' },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => manifest })),
    );
    mockRegisterFont.mockImplementation(async (family: string) => {
      if (family === 'BadLocal') throw new Error('boom');
    });

    await expect(registerFonts()).resolves.toBeUndefined();

    expect(registeredFamilies()).toContain('GoodLocal');
    expect(registeredFamilies()).not.toContain('BadLocal');
  });

  it('still resolves even if a bundled font registration fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false })),
    );
    mockRegisterFont.mockImplementation(async (family: string) => {
      if (family === 'Inter') throw new Error('404');
    });

    await expect(registerFonts()).resolves.toBeUndefined();
  });
});
