import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerFont, registerCanvasFont } from '@weasel-js/core';
import {
  substituteFontFamily,
  registeredFamilies,
  installedFamilies,
  isCanvasFamily,
  canvasFontsInUse,
  registerFonts,
  BUNDLED_FAMILIES,
  _resetFontsForTests,
  toWeaselAlign,
  toWeaselVerticalAlign,
} from './fonts';

vi.mock('@weasel-js/core', () => ({
  registerFont: vi.fn(),
  registerCanvasFont: vi.fn(),
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

describe('substituteFontFamily — installed (canvas) middle tier', () => {
  const stubFontsCheck = (result: boolean) => {
    const check = vi.fn().mockReturnValue(result);
    vi.stubGlobal('document', { fonts: { check } });
    return check;
  };

  beforeEach(() => _resetFontsForTests());
  afterEach(() => vi.unstubAllGlobals());

  it('registers and returns an installed family verbatim', () => {
    const check = stubFontsCheck(true);
    expect(substituteFontFamily('Futura')).toBe('Futura');
    expect(check).toHaveBeenCalledWith('12px "Futura"');
    expect(registerCanvasFont).toHaveBeenCalledWith('Futura');
    expect(isCanvasFamily('Futura')).toBe(true);
    expect(installedFamilies()).toContain('Futura');
  });

  it('installed check wins over the substitution table', () => {
    stubFontsCheck(true);
    expect(substituteFontFamily('Arial')).toBe('Arial'); // table would say Inter
  });

  it('falls through to the table/heuristic when not installed', () => {
    stubFontsCheck(false);
    expect(substituteFontFamily('Arial')).toBe('Inter');
    expect(substituteFontFamily('SomeUnknownCn Font')).toBe('Barlow Condensed');
    expect(substituteFontFamily('Mystery Sans')).toBe('Inter');
    expect(installedFamilies()).toEqual([]);
  });

  it('baked families never hit the installed check', () => {
    const check = stubFontsCheck(true);
    expect(substituteFontFamily('Inter')).toBe('Inter');
    expect(check).not.toHaveBeenCalled();
  });

  it('memoizes the check per family', () => {
    const check = stubFontsCheck(false);
    substituteFontFamily('Mystery Sans');
    substituteFontFamily('Mystery Sans');
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('is safe with no document (node/print env)', () => {
    // No stub: bare node environment.
    expect(substituteFontFamily('Futura')).toBe('Inter');
  });

  it('baked registration evicts a family promoted to canvas tier before fonts settled', async () => {
    // Race: the autosaved doc renders (promoting installed families to the
    // canvas tier) before the async local-manifest registration lands.
    stubFontsCheck(true);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => [
        { family: 'Futura', weight: 400, metrics: 'f.json', atlas: 'f.png' },
      ],
    })));
    expect(substituteFontFamily('Futura')).toBe('Futura'); // canvas tier, pre-manifest
    expect(isCanvasFamily('Futura')).toBe(true);

    await registerFonts(); // baked local registration settles

    expect(isCanvasFamily('Futura')).toBe(false);
    expect(installedFamilies()).not.toContain('Futura');
    expect(canvasFontsInUse(['Futura'])).toEqual([]);
    expect(substituteFontFamily('Futura')).toBe('Futura'); // still resolves, now baked
  });

  it('canvasFontsInUse reports only canvas-tier families', () => {
    stubFontsCheck(true);
    substituteFontFamily('Futura'); // becomes canvas-registered
    expect(canvasFontsInUse(['Futura', 'Inter', 'Futura'])).toEqual(['Futura']);
    expect(canvasFontsInUse(['Inter', 'JetBrains Mono'])).toEqual([]);
  });
});

describe('registeredFamilies', () => {
  it('returns the bundled families sorted', () => {
    _resetFontsForTests();
    expect(registeredFamilies()).toEqual(['Barlow Condensed', 'Inter', 'JetBrains Mono']);
  });
});

describe('toWeaselAlign', () => {
  it('maps each .lbx horizontal alignment, with JUSTIFY falling back to left', () => {
    expect(toWeaselAlign('LEFT')).toBe('left');
    expect(toWeaselAlign('CENTER')).toBe('center');
    expect(toWeaselAlign('RIGHT')).toBe('right');
    expect(toWeaselAlign('JUSTIFY')).toBe('left');
  });
});

describe('toWeaselVerticalAlign', () => {
  it('maps each .lbx vertical alignment', () => {
    expect(toWeaselVerticalAlign('TOP')).toBe('top');
    expect(toWeaselVerticalAlign('CENTER')).toBe('center');
    expect(toWeaselVerticalAlign('BOTTOM')).toBe('bottom');
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
