/**
 * MSDF font registration + .lbx font-name substitution.
 *
 * Bundled atlases live in public/fonts/ (baked with weasel's gen:font).
 * Personal machine-font atlases go in public/fonts/local/ (gitignored) with
 * a manifest.json: [{ "family", "weight", "style"?, "metrics", "atlas" }]
 * (metrics/atlas are file names relative to /fonts/local/). Locally
 * registered families win over the substitution heuristic.
 *
 * Also owns the .lbx→weasel alignment mappers (`toWeaselAlign`,
 * `toWeaselVerticalAlign`).
 */
import { registerFont } from '@weasel-js/core';
import type { LabelTextData } from './label';
import { registerCustomFonts } from './customFonts';

export const BUNDLED_FAMILIES = ['Inter', 'Barlow Condensed', 'JetBrains Mono'] as const;

interface BundledFontEntry {
  family: string;
  weight: number;
  file: string;
}

const BUNDLED: BundledFontEntry[] = [
  { family: 'Inter', weight: 400, file: 'Inter-400' },
  { family: 'Inter', weight: 700, file: 'Inter-700' },
  { family: 'Barlow Condensed', weight: 400, file: 'BarlowCondensed-400' },
  { family: 'Barlow Condensed', weight: 700, file: 'BarlowCondensed-700' },
  { family: 'JetBrains Mono', weight: 400, file: 'JetBrainsMono-400' },
  { family: 'JetBrains Mono', weight: 700, file: 'JetBrainsMono-700' },
];

/** Exact .lbx font-name matches, checked before the heuristic. */
const SUBSTITUTIONS: Record<string, string> = {
  Arial: 'Inter',
  Helvetica: 'Inter',
  'Helvetica Neue': 'Inter',
  Helsinki: 'Inter',
  'Helvetica Neue Condensed Bold': 'Barlow Condensed',
  'Univers LT Std 57 Cn': 'Barlow Condensed',
  'Futura Condensed Medium': 'Barlow Condensed',
  FuturaT: 'Inter',
  Courier: 'JetBrains Mono',
  'Courier New': 'JetBrains Mono',
};

let registered = new Set<string>(BUNDLED_FAMILIES);

/** True for names that read as a condensed cut: "Condensed", "... Cn", or camelCase "...Cn...". */
function looksCondensed(name: string): boolean {
  if (/cond/i.test(name)) return true;
  if (/\bcn\b/i.test(name)) return true;
  // camelCase "Cn" token (e.g. "SomeUnknownCn Font") isn't a regex \b boundary
  // since both neighboring letters are word chars — match the case transition instead.
  if (/(?<=[a-z])Cn(?=[^a-zA-Z]|$)/.test(name)) return true;
  return false;
}

/** Registered family for a node's fontFamily; never rewrites node data. */
export function substituteFontFamily(name: string): string {
  if (registered.has(name)) return name;
  const exact = SUBSTITUTIONS[name];
  if (exact) return exact;
  if (looksCondensed(name)) return 'Barlow Condensed';
  return 'Inter';
}

/** Families for the Property panel dropdown (bundled + local + custom, sorted). */
export function registeredFamilies(): string[] {
  return [...registered].sort();
}

/** Narrow hook for customFonts.ts to add a successfully-registered custom
 *  family to this module's private `registered` set, without customFonts.ts
 *  importing fonts.ts (that would cycle back through this file). */
export function markFamilyRegistered(family: string): void {
  registered.add(family);
}

/** .lbx horizontal alignment → weasel text align. LEFT and JUSTIFY both
 *  render left (unchanged contract — weasel has no justify). */
export function toWeaselAlign(h: LabelTextData['horizontalAlignment']): 'left' | 'center' | 'right' {
  switch (h) {
    case 'CENTER': return 'center';
    case 'RIGHT': return 'right';
    case 'LEFT': case 'JUSTIFY': return 'left';
  }
}

/** .lbx vertical alignment → weasel text verticalAlign. */
export function toWeaselVerticalAlign(v: LabelTextData['verticalAlignment']): 'top' | 'center' | 'bottom' {
  switch (v) {
    case 'CENTER': return 'center';
    case 'BOTTOM': return 'bottom';
    case 'TOP': return 'top';
  }
}

interface LocalFontEntry {
  family: string;
  weight: number;
  style?: 'normal' | 'italic';
  metrics: string;
  atlas: string;
}

let fontsPromise: Promise<void> | null = null;

/**
 * Idempotent: kick off at startup; await before print/preview rasterizes.
 *
 * Best-effort, never rejects: a missing/malformed local manifest, a bad
 * entry within it, or even a 404'd bundled asset is `console.warn`'d and
 * skipped rather than failing the whole call — one broken font shouldn't
 * wedge the print path (weasel already warns at draw time for a family
 * with no registered variant). The returned promise resolves once every
 * registration attempt has settled, success or failure; callers should
 * gate print/preview on that settlement, not on every font having
 * succeeded. There is no retry — a failed attempt stays failed until the
 * next page load (`_resetFontsForTests` aside).
 */
export function registerFonts(): Promise<void> {
  fontsPromise ??= (async () => {
    const bundled = BUNDLED.map(async (f) => {
      try {
        await registerFont(f.family, { weight: f.weight }, `/fonts/${f.file}.json`, `/fonts/${f.file}.png`);
      } catch (err) {
        console.warn('lbx-editor: failed to register bundled font', f.family, err);
      }
    });
    const local = (async () => {
      let entries: LocalFontEntry[];
      try {
        const res = await fetch('/fonts/local/manifest.json');
        if (!res.ok) return;
        entries = await res.json();
      } catch {
        return; // no local fonts — fine
      }
      await Promise.all(
        entries.map(async (e) => {
          try {
            await registerFont(
              e.family,
              { weight: e.weight, style: e.style },
              `/fonts/local/${e.metrics}`,
              `/fonts/local/${e.atlas}`,
            );
            registered.add(e.family);
          } catch (err) {
            console.warn('lbx-editor: failed to register local font', e.family, err);
          }
        }),
      );
    })();
    const custom = registerCustomFonts(markFamilyRegistered).catch((err) => {
      console.warn('lbx-editor: failed to register custom fonts', err);
    });
    await Promise.all([...bundled, local, custom]);
  })();
  return fontsPromise;
}

/** Test helper. Do not call from product code. */
export function _resetFontsForTests(): void {
  registered = new Set<string>(BUNDLED_FAMILIES);
  fontsPromise = null;
}
