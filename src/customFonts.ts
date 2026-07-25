/**
 * User-supplied MSDF fonts: upload a baked atlas pair (.json metrics +
 * .png atlas, as produced by weasel's `npm run gen:font`), persist it in
 * IndexedDB, and register it with weasel for immediate use.
 *
 * Dependency-free of fonts.ts by design: fonts.ts owns the module-level
 * `registered` set of family names used by the Property panel dropdown, and
 * importing it here would create fonts.ts → customFonts.ts → fonts.ts. So
 * `registerCustomFonts` takes a `markRegistered` callback instead; fonts.ts
 * passes in a function that adds to its own set.
 */
import { registerFont } from '@weasel-js/core';

const DB_NAME = 'lbx-editor.fonts';
const DB_VERSION = 1;
const STORE_NAME = 'fonts';

export interface CustomFontInput {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  metricsJson: string;
  atlasBlob: Blob;
}

export interface CustomFontRecord extends CustomFontInput {
  key: string;
  addedAt: number;
}

export interface CustomFontSummary {
  key: string;
  family: string;
  weight: number;
  style: 'normal' | 'italic';
}

export function customFontKey(family: string, weight: number, style: 'normal' | 'italic'): string {
  return `${family}|${weight}|${style}`;
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    // Fires if a version bump (a future DB_VERSION increase) can't proceed
    // because another tab holds an older-version connection open. DB_VERSION
    // is 1 today so this can't happen yet — no retry/timeout machinery, just
    // a warning so a future bump doesn't hang silently if it's ever added.
    req.onblocked = () => {
      console.warn('lbx-editor: IndexedDB open blocked by another open connection (old tab?)');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Cheap structural check for a BMFont-style MSDF metrics JSON. Does not
 *  validate every field, just enough to catch "wrong file picked". */
export function validateMetricsJson(text: string): { ok: true; parsed: any } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Not valid JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, error: 'Metrics JSON must be an object' };
  }
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.chars)) return { ok: false, error: 'Metrics JSON missing "chars" array' };
  if (typeof obj.common !== 'object' || obj.common === null) {
    return { ok: false, error: 'Metrics JSON missing "common" object' };
  }
  if (typeof obj.info !== 'object' || obj.info === null) {
    return { ok: false, error: 'Metrics JSON missing "info" object' };
  }
  return { ok: true, parsed: obj };
}

/** Strips a trailing "-Regular"/"-Bold"/"-Italic"/"-BoldItalic" style suffix
 *  from a BMFont `info.face` name, e.g. "Inter-Bold" → "Inter". */
export function familyFromFace(face: string): string {
  return face.replace(/-(Regular|Bold|Italic|BoldItalic|Light|Medium|SemiBold|Black)+$/i, '').trim() || face;
}

/** 700 if the face name or file name reads as bold, else 400. */
export function inferWeight(face: string, fileName: string): number {
  return /bold/i.test(face) || /bold/i.test(fileName) ? 700 : 400;
}

/** italic if the face name or file name reads as italic. */
export function inferStyle(face: string, fileName: string): 'normal' | 'italic' {
  return /italic/i.test(face) || /italic/i.test(fileName) ? 'italic' : 'normal';
}

export interface InferredFontMeta {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
}

/** Derives the prefill (family/weight/style) shown in the Add-font form
 *  from a parsed metrics JSON's `info.face` plus the original file name. */
export function inferFontMeta(metricsParsed: { info?: { face?: string } }, fileName: string): InferredFontMeta {
  const face = metricsParsed.info?.face ?? fileName.replace(/\.json$/i, '');
  return {
    family: familyFromFace(face),
    weight: inferWeight(face, fileName),
    style: inferStyle(face, fileName),
  };
}

export interface PickedFilePair<T> {
  jsonFile: T;
  pngFile: T;
}

/** Validates a FileList-like selection is exactly one .json + one .png.
 *  Generic over the file-like type so it's testable without real Files and
 *  returns the actual input objects (not just names) to callers. */
export function validateFilePair<T extends { name: string }>(
  files: ReadonlyArray<T>,
): { ok: true; pair: PickedFilePair<T> } | { ok: false; error: string } {
  const jsonFiles = files.filter((f) => /\.json$/i.test(f.name));
  const pngFiles = files.filter((f) => /\.png$/i.test(f.name));
  if (files.length !== 2 || jsonFiles.length !== 1 || pngFiles.length !== 1) {
    return { ok: false, error: 'Select exactly one .json metrics file and one .png atlas file' };
  }
  return { ok: true, pair: { jsonFile: jsonFiles[0], pngFile: pngFiles[0] } };
}

/** Registers one stored record with weasel via blob: object URLs (registerFont
 *  fetches URLs; blob: URLs are fetchable). Revokes the URLs afterward. */
async function registerRecord(record: CustomFontRecord): Promise<void> {
  const metricsBlob = new Blob([record.metricsJson], { type: 'application/json' });
  const metricsUrl = URL.createObjectURL(metricsBlob);
  const atlasUrl = URL.createObjectURL(record.atlasBlob);
  try {
    await registerFont(record.family, { weight: record.weight, style: record.style }, metricsUrl, atlasUrl);
  } finally {
    URL.revokeObjectURL(metricsUrl);
    URL.revokeObjectURL(atlasUrl);
  }
}

/**
 * Validates, registers, and persists a custom font — in that order.
 * Registration runs first: if the atlas is malformed and weasel rejects it,
 * nothing gets stored, so a bad upload doesn't leave a record that would
 * warn-fail on every subsequent startup.
 */
export async function addCustomFont(input: CustomFontInput): Promise<void> {
  const check = validateMetricsJson(input.metricsJson);
  if (!check.ok) throw new Error(check.error);

  const record: CustomFontRecord = {
    ...input,
    key: customFontKey(input.family, input.weight, input.style),
    addedAt: Date.now(),
  };

  await registerRecord(record);

  if (hasIndexedDb()) {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }
}

/** Lists stored custom fonts (metadata only, no blobs). No-ops to [] without
 *  IndexedDB (SSR/tests). */
export async function listCustomFonts(): Promise<CustomFontSummary[]> {
  if (!hasIndexedDb()) return [];
  const db = await openDb();
  try {
    return await new Promise<CustomFontSummary[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => {
        const records = req.result as CustomFontRecord[];
        resolve(records.map((r) => ({ key: r.key, family: r.family, weight: r.weight, style: r.style })));
      };
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Deletes a stored custom font record. weasel has no unregister API, so a
 *  font already registered this session keeps rendering until reload — the
 *  UI should say so rather than imply an instant removal. */
export async function removeCustomFont(key: string): Promise<void> {
  if (!hasIndexedDb()) return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Best-effort registration of every stored custom font, mirroring fonts.ts's
 * warn-and-skip semantics: one broken record shouldn't wedge the others.
 * `markRegistered` lets the caller (fonts.ts) add successes to its own
 * registered-families set without customFonts.ts importing fonts.ts.
 */
export async function registerCustomFonts(markRegistered: (family: string) => void): Promise<void> {
  if (!hasIndexedDb()) return;
  let records: CustomFontRecord[];
  const db = await openDb();
  try {
    records = await new Promise<CustomFontRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result as CustomFontRecord[]);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }

  await Promise.all(
    records.map(async (record) => {
      try {
        await registerRecord(record);
        markRegistered(record.family);
      } catch (err) {
        console.warn('lbx-editor: failed to register custom font', record.family, err);
      }
    }),
  );
}
