# MSDF Text Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace lbx-editor's canvas-rasterizer text path with weasel's MSDF text pipeline on screen and print, per `docs/superpowers/specs/2026-07-25-msdf-text-design.md`.

**Architecture:** Weasel's `TextDrawCommand` learns box vertical alignment (approach C); `measureTextBounds` learns wrapped measurement; the deleted `gen-font` atlas script is restored. lbx-editor bakes curated open-font atlases (Inter, Barlow Condensed, JetBrains Mono), adds a name-substitution map, and swaps `drawLabelNode`'s text case from an image command to a text command. Print shares `drawLabelNode`, so both paths convert at once.

**Tech Stack:** TypeScript, weasel WebGL2 renderer, `msdf-bmfont-xml`, Vite, vitest.

**Repos:** Tasks 1–3 in `~/src/weasel` (commit there). Tasks 4–8 in `~/src/lbx-editor`. Run each repo's own test suite (`npm run test:kit` in weasel, `npx vitest run` in lbx-editor).

---

### Task 1: Weasel — `verticalAlign`/`height` on the text command

**Files:**
- Create: `~/src/weasel/src/features/text/verticalAlign.ts`
- Create: `~/src/weasel/src/features/text/verticalAlign.test.ts`
- Modify: `~/src/weasel/src/renderer/DrawCommand.ts` (TextDrawCommand, ~line 83)
- Modify: `~/src/weasel/src/renderer/draw.ts` (`drawText`, ~line 792)
- Modify: `~/src/weasel/src/features/text/textCommand.ts`
- Modify: `~/src/weasel/src/features/text/textLayer.ts` (TextPose + command packing)
- Modify: `~/src/weasel/src/features/text/index.ts` (export barrel)

- [ ] **Step 1: Write the failing test**

`src/features/text/verticalAlign.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { verticalAlignOffset } from './verticalAlign';

describe('verticalAlignOffset', () => {
  it('returns 0 for top/undefined align or missing box height', () => {
    expect(verticalAlignOffset('top', 100, 40)).toBe(0);
    expect(verticalAlignOffset(undefined, 100, 40)).toBe(0);
    expect(verticalAlignOffset('center', undefined, 40)).toBe(0);
  });
  it('centers and bottoms within the box', () => {
    expect(verticalAlignOffset('center', 100, 40)).toBe(30);
    expect(verticalAlignOffset('bottom', 100, 40)).toBe(60);
  });
  it('goes negative when text overflows the box (block extends above)', () => {
    expect(verticalAlignOffset('center', 40, 100)).toBe(-30);
    expect(verticalAlignOffset('bottom', 40, 100)).toBe(-60);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd ~/src/weasel && npx vitest run --project=kit src/features/text/verticalAlign.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/features/text/verticalAlign.ts`:

```ts
/**
 * Box vertical alignment for text draw commands. Given the command's box
 * `height` and the laid-out text block's height, returns the Y offset to
 * apply to every quad. `top` (and no box) is the legacy behavior: 0.
 */
export type TextVerticalAlign = 'top' | 'center' | 'bottom';

export function verticalAlignOffset(
  align: TextVerticalAlign | undefined,
  boxHeight: number | undefined,
  textHeight: number,
): number {
  if (align === undefined || align === 'top' || boxHeight === undefined) return 0;
  const slack = boxHeight - textHeight;
  return align === 'center' ? slack / 2 : slack;
}
```

`DrawCommand.ts` — extend `TextDrawCommand` (import the type):

```ts
import type { TextVerticalAlign } from '../features/text/verticalAlign';
// ... inside TextDrawCommand:
  /** Box height for vertical alignment. When set with `verticalAlign`,
   *  the laid-out block shifts within `[y, y+height]`. */
  height?: number;
  /** Default 'top' — the legacy top-anchored behavior. */
  verticalAlign?: TextVerticalAlign;
```

(If importing features→renderer creates a cycle, define the union inline in `DrawCommand.ts` as `'top' | 'center' | 'bottom'` and have `verticalAlign.ts` re-export the type from there instead. Check with `npm run typecheck`.)

`draw.ts` `drawText` — after `if (laid.groups.length === 0) return;`:

```ts
const dy = verticalAlignOffset(cmd.verticalAlign, cmd.height, laid.bounds.height);
if (dy !== 0) {
  for (const group of laid.groups) {
    for (const q of group.quads) { q.y0 += dy; q.y1 += dy; q.baselineY += dy; }
  }
}
```

`textCommand.ts` — two new trailing optional params, passed through:

```ts
export function textCommand(
  x: number,
  y: number,
  text: string,
  style?: TextStyle,
  maxWidth?: number,
  height?: number,
  verticalAlign?: TextVerticalAlign,
): DrawCommand {
  // ...existing body, plus in the returned object:
  //   height, verticalAlign,
}
```

`textLayer.ts` — `TextPose` gains `verticalAlign?: TextVerticalAlign;` (doc: "Box vertical alignment; the pose's `height` is the box"), and the packed command gains `height: pose.height, verticalAlign: pose.verticalAlign`.

`features/text/index.ts` — add `export * from './verticalAlign';`.

- [ ] **Step 4: Tests pass** — `npx vitest run --project=kit src/features/text` then `npm run typecheck`. Expected: PASS, no type errors.

- [ ] **Step 5: Commit** in `~/src/weasel`: `feat(text): box vertical alignment on TextDrawCommand`

### Task 2: Weasel — wrapped `measureTextBounds`

**Files:**
- Modify: `~/src/weasel/src/features/text/measureTextBounds.ts`
- Test: `~/src/weasel/src/features/text/measureTextBounds.test.ts` (create if absent)

- [ ] **Step 1: Failing test** (uses the test-only registry reset + `FIXTURE_FONT` pattern from `src/features/text/atlas/registerFont.test.ts` — copy its font-registration test setup verbatim; if that file registers a fixture font via an internal helper, reuse it):

```ts
import { describe, it, expect } from 'vitest';
import { measureTextBounds } from './measureTextBounds';
// + the same fixture-font setup used in atlas/registerFont.test.ts

describe('measureTextBounds with maxWidth', () => {
  it('wrapped text is taller and narrower than unwrapped', () => {
    const unwrapped = measureTextBounds('AB AB AB', { fontFamily: 'Inter', fontSize: 16 });
    const wrapped = measureTextBounds('AB AB AB', { fontFamily: 'Inter', fontSize: 16 }, { maxWidth: unwrapped.width / 2 });
    expect(wrapped.height).toBeGreaterThan(unwrapped.height);
    expect(wrapped.width).toBeLessThan(unwrapped.width);
  });
});
```

- [ ] **Step 2: Run to verify failure.** Expected: FAIL (opts param doesn't exist / measure equal).

- [ ] **Step 3: Implement**

```ts
export interface MeasureTextBoundsOpts {
  /** Wrap width; default Infinity (no wrap). */
  maxWidth?: number;
  /** Overrides the style's lineHeight multiplier. */
  lineHeight?: number;
}

export function measureTextBounds(
  text: string,
  style?: TextStyle,
  opts?: MeasureTextBoundsOpts,
): { width: number; height: number } {
  const resolved = resolveTextStyle(style);
  const runs = resolveRuns([{ text }], resolved);
  const { bounds } = layoutRuns(
    runs,
    {
      maxWidth: opts?.maxWidth ?? Infinity,
      lineHeight: opts?.lineHeight ?? resolved.lineHeight,
      align: resolved.align,
    },
    { x: 0, y: 0 },
  );
  return bounds;
}
```

Export `MeasureTextBoundsOpts` from the text barrel.

- [ ] **Step 4: Tests pass** + `npm run typecheck`.
- [ ] **Step 5: Commit** in weasel: `feat(text): measureTextBounds maxWidth/lineHeight opts`

### Task 3: Weasel — restore `gen-font` script + README fix

**Files:**
- Create: `~/src/weasel/scripts/gen-font.ts`
- Modify: `~/src/weasel/package.json` (add script)
- Modify: `~/src/weasel/README.md` (~line 66, stale 2-arg `registerFont` example)
- Modify: `~/src/weasel/docs/TODO.md` (mark the P3 `gen:font` item done)

- [ ] **Step 1: Write the script** (no unit test — verified by baking real atlases in Task 4; `msdf-bmfont-xml` is already a devDependency):

```ts
/**
 * Bake an MSDF font atlas for `registerFont`.
 *
 *   npm run gen:font -- <font.ttf|otf> --name <Family-Weight> --out <dir> [--size 42] [--charset latin1]
 *
 * Emits `<out>/<name>.json` (BmFont metrics) + `<out>/<name>.png` (atlas).
 * Charsets: `ascii` (0x20–0x7E), `latin1` (ascii + 0xA0–0xFF, default).
 */
import generateBMFont from 'msdf-bmfont-xml';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

function charset(kind: string): string {
  const range = (a: number, b: number) =>
    Array.from({ length: b - a + 1 }, (_, i) => String.fromCharCode(a + i)).join('');
  const ascii = range(0x20, 0x7e);
  if (kind === 'ascii') return ascii;
  if (kind === 'latin1') return ascii + range(0xa0, 0xff);
  throw new Error(`unknown charset: ${kind}`);
}

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
}

const fontPath = process.argv[2];
if (!fontPath || fontPath.startsWith('--')) throw new Error('usage: gen-font <font.ttf> --name <n> --out <dir>');
const name = arg('name');
const outDir = arg('out');
const fontSize = Number(arg('size', '42'));

generateBMFont(
  fontPath,
  {
    outputType: 'json',
    fieldType: 'msdf',
    fontSize,
    distanceRange: 4,
    charset: charset(arg('charset', 'latin1')),
    smartSize: true,
    pot: true,
  },
  (err: Error | null, textures: { filename: string; texture: Buffer }[], font: { data: string }) => {
    if (err) throw err;
    if (textures.length !== 1) throw new Error(`expected 1 atlas page, got ${textures.length} — raise textureSize`);
    mkdirSync(outDir, { recursive: true });
    // registerFont loads a single atlas image, so rewrite the page ref to our name.
    const data = JSON.parse(font.data);
    data.pages = [`${name}.png`];
    writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(data));
    writeFileSync(path.join(outDir, `${name}.png`), textures[0].texture);
    console.log(`baked ${name}: ${data.chars.length} glyphs -> ${outDir}`);
  },
);
```

`package.json` scripts: `"gen:font": "tsx scripts/gen-font.ts"` (weasel already uses `tsx` for scripts; if not present as a devDependency, use `vite-node` — check `ls node_modules/.bin/ | grep -E 'tsx|vite-node'` and match).

- [ ] **Step 2: README fix** — replace the stale example with the real signature:

```ts
import { registerFont } from '@weasel-js/core';
await registerFont('Inter', { weight: 400 }, '/fonts/Inter-400.json', '/fonts/Inter-400.png');
```

- [ ] **Step 3: TODO.md** — replace the `(P3) gen:font script` bullet's body with: restored 2026-07-25 as `scripts/gen-font.ts` (`npm run gen:font`).
- [ ] **Step 4: Typecheck** — `npm run typecheck` (add `declare module 'msdf-bmfont-xml';` to the script or a local `scripts/msdf-bmfont-xml.d.ts` if it lacks types — it does).
- [ ] **Step 5: Commit** in weasel: `feat(scripts): restore gen-font MSDF atlas generator`

### Task 4: lbx-editor — bake and commit the curated atlases

**Files:**
- Create: `~/src/lbx-editor/public/fonts/{Inter-400,Inter-700,BarlowCondensed-400,BarlowCondensed-700,JetBrainsMono-400,JetBrainsMono-700}.{json,png}`
- Modify: `~/src/lbx-editor/.gitignore` (add `public/fonts/local/`)

- [ ] **Step 1: Download static TTFs** to the session scratchpad (NOT the repo):
  - Inter: `https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip` → `extras/ttf/Inter-Regular.ttf`, `Inter-Bold.ttf` (inspect zip layout; any static non-variable Regular/Bold TTF pair is fine)
  - Barlow Condensed: `https://github.com/google/fonts/raw/main/ofl/barlowcondensed/BarlowCondensed-Regular.ttf` and `BarlowCondensed-Bold.ttf`
  - JetBrains Mono: `https://github.com/google/fonts/raw/main/ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf` is variable — instead use `https://github.com/JetBrains/JetBrainsMono/releases/download/v2.304/JetBrainsMono-2.304.zip` → `fonts/ttf/JetBrainsMono-Regular.ttf`, `JetBrainsMono-Bold.ttf`

  If any URL 404s, find the current release URL rather than substituting a different font.

- [ ] **Step 2: Bake** (from `~/src/weasel`), one call per variant, e.g.:

```bash
npm run gen:font -- <scratch>/Inter-Regular.ttf --name Inter-400 --out ~/src/lbx-editor/public/fonts
npm run gen:font -- <scratch>/Inter-Bold.ttf    --name Inter-700 --out ~/src/lbx-editor/public/fonts
# ... BarlowCondensed-{Regular,Bold} -> BarlowCondensed-{400,700}, JetBrainsMono likewise
```

Expected: six `.json`+`.png` pairs; each JSON parses and has `chars.length >= 190` (ASCII+Latin-1); each PNG under ~1 MB. Sanity-check one JSON has `pages: ["<name>.png"]`.

- [ ] **Step 3: .gitignore** — append `public/fonts/local/`.
- [ ] **Step 4: Commit** in lbx-editor: `feat(fonts): bundle MSDF atlases for Inter, Barlow Condensed, JetBrains Mono` (the binaries are intended to be committed; OFL license permits it — include `public/fonts/OFL-licenses.txt` with the three OFL notices copied from each font's LICENSE/OFL.txt).

### Task 5: lbx-editor — `src/fonts.ts` (registration + substitution)

**Files:**
- Create: `~/src/lbx-editor/src/fonts.ts`
- Create: `~/src/lbx-editor/src/fonts.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { substituteFontFamily, BUNDLED_FAMILIES } from './fonts';

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
```

- [ ] **Step 2: Verify failure** — `cd ~/src/lbx-editor && npx vitest run src/fonts.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**

```ts
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

/** Registered family for a node's fontFamily; never rewrites node data. */
export function substituteFontFamily(name: string): string {
  if (registered.has(name)) return name;
  const exact = SUBSTITUTIONS[name];
  if (exact) return exact;
  if (/cond|\bcn\b|cn$/i.test(name)) return 'Barlow Condensed';
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
```

Note: vitest runs in node with no `fetch`-served assets — `registerFonts` stays untested (browser-verified in Task 8); the pure functions are what the unit tests cover.

- [ ] **Step 4: Tests pass** — `npx vitest run src/fonts.test.ts`.
- [ ] **Step 5: Commit** in lbx-editor: `feat(fonts): registration + .lbx name substitution`

### Task 6: lbx-editor — draw swap, cache deletion, print gating

**Files:**
- Modify: `~/src/lbx-editor/src/App.tsx` (text case ~line 138; print handler ~line 851; preview effect ~line 472; startup)
- Delete: `~/src/lbx-editor/src/textBitmapCache.ts`, `~/src/lbx-editor/src/textRender.ts`, `~/src/lbx-editor/src/textRender.test.ts`

- [ ] **Step 1: Swap the text case** in `drawLabelNode`:

```ts
case 'text': {
  return [textCommand(
    x,
    y,
    data.text,
    {
      fontFamily: substituteFontFamily(data.fontFamily),
      fontSize: data.fontSize,
      fontWeight: data.fontWeight,
      fontStyle: data.italic ? 'italic' : 'normal',
      align: data.horizontalAlignment === 'CENTER' ? 'center'
        : data.horizontalAlignment === 'RIGHT' ? 'right'
        : 'left', // LEFT and JUSTIFY both render left (unchanged contract)
      fill: { fill: 'solid', color: data.color },
    },
    width,   // maxWidth: word-wrap at the box
    height,  // box height for verticalAlign
    data.verticalAlignment === 'CENTER' ? 'center'
      : data.verticalAlignment === 'BOTTOM' ? 'bottom'
      : 'top',
  )];
}
```

Imports: `textCommand` from `@weasel-js/core`; `substituteFontFamily`, `registerFonts` from `./fonts`. Remove the `getTextBitmap` import and the bitmap-null fallback frame (an unregistered font just paints no glyphs; the node stays selectable via its pose).

- [ ] **Step 2: Startup registration + redraw.** In `App()`:

```ts
const [fontsLoaded, setFontsLoaded] = useState(false);
useEffect(() => { registerFonts().then(() => setFontsLoaded(true)); }, []);
```

Thread `fontsLoaded` into whatever memo/dep chain hands `drawScreenNode`/`layers` to `SceneCanvas` (the existing `layers` memo at ~line 939 — add `fontsLoaded` to its dep array and, if the memo's identity alone doesn't trigger a canvas redraw, follow the same pattern the imageCache decode-landed redraw uses).

- [ ] **Step 3: Gate print + preview.** In the print handler and the preview effect, before calling `renderLabelToRgba`: `await registerFonts();` (preview effect: make its inner function async or chain `.then`).

- [ ] **Step 4: Delete dead files** — `git rm src/textBitmapCache.ts src/textRender.ts src/textRender.test.ts`. Then `grep -rn "textRender\|textBitmapCache\|getTextBitmap\|drawLabelText\|lineLayout\|cssFont\|textLines" src/` — fix any remaining importer (expected: none; if `textLines` has a live consumer, inline `text.split('\n')` at the call site).

- [ ] **Step 5: Verify** — `npx vitest run` (all remaining tests pass) and `npm run build` (clean). Then look at it: dev server is already running on localhost:5180 — load it (Playwright or chrome-devtools MCP), confirm text renders as glyphs, wraps at box width, and V-align works; screenshot for the record.

- [ ] **Step 6: Commit** in lbx-editor: `feat(text): render text via weasel MSDF on screen and print`

### Task 7: lbx-editor — Property panel font dropdown

**Files:**
- Modify: `~/src/lbx-editor/src/PropertyPanel.tsx` (font field, ~lines 104–110)

- [ ] **Step 1: Replace the free-text Font input** in `TextFields`:

```tsx
<label className="prop-field">
  Font
  <select
    value={data.fontFamily}
    onChange={(e) => update({ fontFamily: e.target.value })}
  >
    {!registeredFamilies().includes(data.fontFamily) && (
      <option value={data.fontFamily}>
        {data.fontFamily} → {substituteFontFamily(data.fontFamily)}
      </option>
    )}
    {registeredFamilies().map((f) => (
      <option key={f} value={f}>{f}</option>
    ))}
  </select>
</label>
```

Import `registeredFamilies`, `substituteFontFamily` from `./fonts`. The substitution `<option>` keeps the original .lbx name as the node's value (export round-trip); choosing a real family overwrites node data. No new CSS classes needed (matches the existing Align `<select>` styling).

- [ ] **Step 2: Verify in browser** — select a text node: dropdown lists the three bundled families; import a fixture .lbx (e.g. Two-line cable label): its node shows `Univers LT Std 57 Cn → Barlow Condensed` as the selected entry.
- [ ] **Step 3: Commit** in lbx-editor: `feat(panel): font family dropdown with substitution display`

### Task 8: End-to-end verification + docs

**Files:**
- Modify: `~/src/lbx-editor/CLAUDE.md` (Current state — text rendering bullet)
- Modify: `~/src/lbx-editor/docs/superpowers/plans/2026-07-18-eod-handoff.md` (deferred follow-ups: MSDF item done)

- [ ] **Step 1: Full suites** — lbx-editor `npx vitest run` + `npm run build`; weasel `npm run test:kit` + `npm run typecheck`. All green.
- [ ] **Step 2: Print-path check** — use the `/verify` skill (drives the real print flow in the automation Chrome, captures the print raster without hardware). Confirm the captured raster contains MSDF-rendered glyphs (not blank, not `?` boxes) for a label with text; `open` the raster image.
- [ ] **Step 3: Fixture review** — import each bil-lbx fixture, screenshot the canvas, `open` the screenshots.
- [ ] **Step 4: Update CLAUDE.md** — replace the "Text renders as real glyphs via a canvas rasterizer…" bullet with:

```
- Text renders via weasel MSDF text (screen and print share the same
  `textCommand` in `drawLabelNode`, so WYSIWYG holds). Bundled atlases
  (Inter, Barlow Condensed, JetBrains Mono; 400+700, synthetic italic) in
  `public/fonts/`; .lbx font names map through `substituteFontFamily`
  (`src/fonts.ts`) without rewriting node data; personal atlases go in
  gitignored `public/fonts/local/` + manifest (bake with weasel's
  `npm run gen:font`). Text word-wraps at the box width; `\n` forces
  breaks; JUSTIFY renders as LEFT.
```

- [ ] **Step 5: Commit** in lbx-editor: `docs: MSDF text migration in current-state notes`

---

## Self-review notes

- Spec coverage: weasel command/measure/gen-font → Tasks 1–3; atlases/substitution/local manifest → Tasks 4–5; draw swap/deletions/print gating → Task 6; panel dropdown → Task 7; testing/docs → Task 8. README fix + TODO.md in Task 3. No gaps found.
- Type consistency: `TextVerticalAlign` defined once in Task 1 and reused in Tasks 1/6; `substituteFontFamily`/`registeredFamilies`/`registerFonts` defined in Task 5, consumed in 6–7; `textCommand` extended signature (Task 1) matches Task 6's call.
- Known judgment calls for the executor: the `DrawCommand.ts` import direction (fallback given inline); vitest project name for weasel text tests (`--project=kit` assumed — adjust to the project that owns `src/`); JetBrains Mono inclusion is per spec (drop only if Mike says so).
