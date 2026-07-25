# Local machine-font atlases

lbx-editor renders text with weasel's MSDF atlases. Only three families ship
in the repo (Inter, Barlow Condensed, JetBrains Mono; 400 + 700). Any other
.lbx font name — e.g. an imported label that says "Helvetica Neue Condensed
Bold" — gets mapped through `substituteFontFamily` (`src/fonts.ts`) to the
closest bundled family instead of rendering in its real font.

If you have the actual font file on your machine (e.g. Helvetica Neue
Condensed ships with macOS), you can bake it into a local atlas so the
editor renders the real glyphs instead of the substitute. This is
per-machine, not part of the repo — see Licensing below.

## When you'd want this

- An imported .lbx references a font you have locally but isn't bundled.
- The Property panel's font dropdown is missing a family you want to design
  with directly.

Locally registered families win over the substitution heuristic and show up
in the Property panel dropdown once registered.

## Two ways to load a baked atlas

Both start from the same bake step below; they differ in where the files
live afterwards:

1. **In-app upload (easiest):** the "Custom fonts" panel in the right
   sidebar (below Debug) has an "Add font…" picker. Select the baked
   `.json` + `.png` pair together; family/weight/italic are prefilled from
   the metrics and editable. The font registers immediately and persists in
   the browser's IndexedDB — no files in the repo tree at all. Removing (or
   re-uploading a corrected atlas for) a font takes effect on the next
   reload.
2. **`public/fonts/local/` + manifest:** drop the files in the gitignored
   dir and list them in `manifest.json` (below). Useful when you want the
   fonts served as plain files (e.g. shared across browser profiles or
   synced by other means).

## Finding the font file

On macOS, system and user fonts live under `/System/Library/Fonts`,
`/Library/Fonts`, and `~/Library/Fonts`. Font Book (or `mdfind` on the
PostScript name) can locate a specific style's `.ttf`/`.otf`/`.ttc` file.
For Helvetica Neue Condensed specifically, look for `HelveticaNeue.ttc` in
`/System/Library/Fonts/` — it's a collection, so you may need a font tool
that can extract a single face, or source a standalone `.ttf`/`.otf` for the
condensed weight you want.

## Baking an atlas

Baking runs from the weasel sibling repo (`~/src/weasel`), which owns
`gen:font`:

```sh
cd ~/src/weasel
npm run gen:font -- /path/to/HelveticaNeueCondensed-Regular.ttf \
  --name HelveticaNeueCondensed-400 --out /path/to/lbx-editor/public/fonts/local
npm run gen:font -- /path/to/HelveticaNeueCondensed-Bold.ttf \
  --name HelveticaNeueCondensed-700 --out /path/to/lbx-editor/public/fonts/local
```

Each call emits `<name>.json` (BmFont metrics) + `<name>.png` (MSDF atlas)
into `public/fonts/local/`. Optional flags: `--size` (default 42, the bake
resolution) and `--charset ascii|latin1` (default `latin1`).

## manifest.json

`registerFonts()` (`src/fonts.ts`) loads `/fonts/local/manifest.json` — an
array of entries, file names relative to `public/fonts/local/`:

```json
[
  {
    "family": "Helvetica Neue Condensed",
    "weight": 400,
    "metrics": "HelveticaNeueCondensed-400.json",
    "atlas": "HelveticaNeueCondensed-400.png"
  },
  {
    "family": "Helvetica Neue Condensed",
    "weight": 700,
    "metrics": "HelveticaNeueCondensed-700.json",
    "atlas": "HelveticaNeueCondensed-700.png"
  }
]
```

`style` is optional (`"normal"` | `"italic"`) and omitted here since both
bakes are upright faces. `family` is the name that has to match (or that you
want available in) the Property panel — it doesn't need to match the .lbx
substitution table unless you're aiming to replace a specific substitution.

Reload the page after adding/editing the manifest or atlas files — fonts
register once at startup.

## Failure behavior

Registration is best-effort: a missing manifest, a malformed manifest, or a
bad individual entry (missing files, bad JSON) is `console.warn`'d and
skipped rather than failing the whole app. Check the browser console if a
local font doesn't show up after reload.

## Licensing

`public/fonts/local/` is gitignored on purpose. Machine fonts (system fonts,
purchased fonts) generally can't be redistributed — keep baked atlases out
of the repo and out of any commits. This is a per-machine convenience, not a
shared asset.
