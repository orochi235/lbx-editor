import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerFont } from '@weasel-js/core';
import {
  validateMetricsJson,
  familyFromFace,
  inferWeight,
  inferStyle,
  inferFontMeta,
  validateFilePair,
  customFontKey,
  addCustomFont,
  listCustomFonts,
  removeCustomFont,
} from './customFonts';

vi.mock('@weasel-js/core', () => ({
  registerFont: vi.fn(),
}));

const GOOD_METRICS = JSON.stringify({
  pages: ['Inter-400.png'],
  chars: [{ id: 65, char: 'A', width: 1, height: 1, xoffset: 0, yoffset: 0, xadvance: 1, x: 0, y: 0, page: 0 }],
  info: { face: 'Inter-Regular', size: 42 },
  common: { lineHeight: 51, base: 41, scaleW: 512, scaleH: 512, pages: 1 },
});

describe('customFontKey', () => {
  it('joins family/weight/style with pipes', () => {
    expect(customFontKey('Inter', 400, 'normal')).toBe('Inter|400|normal');
  });
});

describe('validateMetricsJson', () => {
  it('accepts valid BMFont-style metrics', () => {
    const result = validateMetricsJson(GOOD_METRICS);
    expect(result.ok).toBe(true);
  });

  it('rejects invalid JSON', () => {
    const result = validateMetricsJson('{not json');
    expect(result).toEqual({ ok: false, error: 'Not valid JSON' });
  });

  it('rejects non-object JSON', () => {
    const result = validateMetricsJson('42');
    expect(result.ok).toBe(false);
  });

  it('rejects missing chars', () => {
    const result = validateMetricsJson(JSON.stringify({ info: {}, common: {} }));
    expect(result).toEqual({ ok: false, error: 'Metrics JSON missing "chars" array' });
  });

  it('rejects missing common', () => {
    const result = validateMetricsJson(JSON.stringify({ chars: [], info: {} }));
    expect(result).toEqual({ ok: false, error: 'Metrics JSON missing "common" object' });
  });

  it('rejects missing info', () => {
    const result = validateMetricsJson(JSON.stringify({ chars: [], common: {} }));
    expect(result).toEqual({ ok: false, error: 'Metrics JSON missing "info" object' });
  });
});

describe('familyFromFace', () => {
  it('strips a trailing -Regular/-Bold/-Italic suffix', () => {
    expect(familyFromFace('Inter-Regular')).toBe('Inter');
    expect(familyFromFace('Inter-Bold')).toBe('Inter');
    expect(familyFromFace('Barlow Condensed-BoldItalic')).toBe('Barlow Condensed');
  });

  it('leaves names without a known suffix untouched', () => {
    expect(familyFromFace('MyCustomFont')).toBe('MyCustomFont');
  });
});

describe('inferWeight', () => {
  it('detects Bold in the face name', () => {
    expect(inferWeight('Inter-Bold', 'Inter-Bold.json')).toBe(700);
  });
  it('detects Bold in the file name when face does not mention it', () => {
    expect(inferWeight('Inter', 'Inter-Bold.json')).toBe(700);
  });
  it('defaults to 400', () => {
    expect(inferWeight('Inter-Regular', 'Inter-400.json')).toBe(400);
  });
});

describe('inferStyle', () => {
  it('detects Italic in the face or file name', () => {
    expect(inferStyle('Inter-Italic', 'Inter-Italic.json')).toBe('italic');
    expect(inferStyle('Inter', 'Inter-Italic.json')).toBe('italic');
  });
  it('defaults to normal', () => {
    expect(inferStyle('Inter-Regular', 'Inter-400.json')).toBe('normal');
  });
});

describe('inferFontMeta', () => {
  it('combines family/weight/style inference from info.face', () => {
    expect(inferFontMeta({ info: { face: 'Inter-Bold' } }, 'Inter-Bold.json')).toEqual({
      family: 'Inter',
      weight: 700,
      style: 'normal',
    });
  });

  it('falls back to the file name when info.face is absent', () => {
    expect(inferFontMeta({}, 'MyFont.json')).toEqual({
      family: 'MyFont',
      weight: 400,
      style: 'normal',
    });
  });
});

describe('validateFilePair', () => {
  it('accepts exactly one .json and one .png', () => {
    const result = validateFilePair([{ name: 'a.json' }, { name: 'a.png' }]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pair.jsonFile.name).toBe('a.json');
      expect(result.pair.pngFile.name).toBe('a.png');
    }
  });

  it('rejects zero files', () => {
    expect(validateFilePair([]).ok).toBe(false);
  });

  it('rejects two jsons and no png', () => {
    const result = validateFilePair([{ name: 'a.json' }, { name: 'b.json' }]);
    expect(result.ok).toBe(false);
  });

  it('rejects extra files beyond a pair', () => {
    const result = validateFilePair([{ name: 'a.json' }, { name: 'a.png' }, { name: 'b.png' }]);
    expect(result.ok).toBe(false);
  });
});

describe('IndexedDB-less environments (no indexedDB global)', () => {
  const originalIndexedDb = (globalThis as any).indexedDB;

  beforeEach(() => {
    delete (globalThis as any).indexedDB;
    vi.mocked(registerFont).mockReset();
  });

  afterEach(() => {
    if (originalIndexedDb !== undefined) (globalThis as any).indexedDB = originalIndexedDb;
  });

  it('listCustomFonts no-ops to an empty array', async () => {
    await expect(listCustomFonts()).resolves.toEqual([]);
  });

  it('removeCustomFont no-ops without throwing', async () => {
    await expect(removeCustomFont('x')).resolves.toBeUndefined();
  });

  it('addCustomFont still registers the font via registerFont even without persistence', async () => {
    vi.mocked(registerFont).mockResolvedValue(undefined);
    await expect(
      addCustomFont({
        family: 'Test',
        weight: 400,
        style: 'normal',
        metricsJson: GOOD_METRICS,
        atlasBlob: new Blob(['fake-png']),
      }),
    ).resolves.toBeUndefined();
    expect(registerFont).toHaveBeenCalledWith(
      'Test',
      { weight: 400, style: 'normal' },
      expect.any(String),
      expect.any(String),
    );
  });

  it('addCustomFont rejects invalid metrics JSON before touching registerFont', async () => {
    await expect(
      addCustomFont({
        family: 'Test',
        weight: 400,
        style: 'normal',
        metricsJson: '{bad json',
        atlasBlob: new Blob(['fake-png']),
      }),
    ).rejects.toThrow('Not valid JSON');
    expect(registerFont).not.toHaveBeenCalled();
  });
});

/** Minimal hand-rolled indexedDB stand-in (no fake-indexeddb dependency in
 *  this repo) — just enough of the open/transaction/objectStore/getAll/put
 *  surface to assert ordering: does `addCustomFont` call `put` only after
 *  `registerFont` has resolved? */
function makeFakeIndexedDb(putSpy: (record: unknown) => void) {
  return {
    open: () => {
      const req: any = {};
      const store = {
        put: (record: unknown) => putSpy(record),
        delete: () => {},
        getAll: () => {
          const getReq: any = { result: [] };
          queueMicrotask(() => getReq.onsuccess?.());
          return getReq;
        },
      };
      const tx: any = { objectStore: () => store };
      const db = {
        objectStoreNames: { contains: () => true },
        transaction: () => {
          queueMicrotask(() => tx.oncomplete?.());
          return tx;
        },
        close: () => {},
      };
      queueMicrotask(() => {
        req.result = db;
        req.onsuccess?.();
      });
      return req;
    },
  };
}

describe('addCustomFont: register-before-persist ordering', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(registerFont).mockReset();
  });

  it('does not persist a record when registerFont rejects', async () => {
    const putSpy = vi.fn();
    vi.stubGlobal('indexedDB', makeFakeIndexedDb(putSpy));
    vi.mocked(registerFont).mockRejectedValue(new Error('malformed atlas'));

    await expect(
      addCustomFont({
        family: 'Broken',
        weight: 400,
        style: 'normal',
        metricsJson: GOOD_METRICS,
        atlasBlob: new Blob(['fake-png']),
      }),
    ).rejects.toThrow('malformed atlas');

    expect(putSpy).not.toHaveBeenCalled();
  });

  it('persists only after registerFont resolves', async () => {
    const putSpy = vi.fn();
    vi.stubGlobal('indexedDB', makeFakeIndexedDb(putSpy));
    vi.mocked(registerFont).mockResolvedValue(undefined);

    await addCustomFont({
      family: 'Good',
      weight: 400,
      style: 'normal',
      metricsJson: GOOD_METRICS,
      atlasBlob: new Blob(['fake-png']),
    });

    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy.mock.calls[0][0]).toMatchObject({ family: 'Good', weight: 400, style: 'normal' });
  });
});
