/**
 * MSDF font registration + .lbx font-name substitution.
 *
 * Bundled atlases live in public/fonts/ (baked with weasel's gen:font).
 * Personal machine-font atlases go in public/fonts/local/ (gitignored) with
 * a manifest.json: [{ "family", "weight", "style"?, "metrics", "atlas" }]
 * (metrics/atlas are file names relative to /fonts/local/). Locally
 * registered families win over the substitution heuristic.
 */
import { registerFont } from '@weasel-js/core';

export const BUNDLED_FAMILIES = ['Inter', 'Barlow Condensed', 'JetBrains Mono'] as const;

const BUNDLED: { family: string; weight: number; file: string }[] = [
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

const registered = new Set<string>(BUNDLED_FAMILIES);

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

/** Families for the Property panel dropdown (bundled + local, sorted). */
export function registeredFamilies(): string[] {
  return [...registered].sort();
}

interface LocalFontEntry {
  family: string;
  weight: number;
  style?: 'normal' | 'italic';
  metrics: string;
  atlas: string;
}

let fontsPromise: Promise<void> | null = null;

/** Idempotent: kick off at startup; await before print/preview rasterizes. */
export function registerFonts(): Promise<void> {
  fontsPromise ??= (async () => {
    const bundled = BUNDLED.map((f) =>
      registerFont(f.family, { weight: f.weight }, `/fonts/${f.file}.json`, `/fonts/${f.file}.png`),
    );
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
          await registerFont(
            e.family,
            { weight: e.weight, style: e.style },
            `/fonts/local/${e.metrics}`,
            `/fonts/local/${e.atlas}`,
          );
          registered.add(e.family);
        }),
      );
    })();
    await Promise.all([...bundled, local]);
  })();
  return fontsPromise;
}
