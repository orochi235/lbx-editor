# brother-lbx-editor

Web-based visual editor for Brother P-touch label files (.lbx).

## Architecture

Standalone Vite + React app consuming:
- `@weasel-js/core` (linked from `../weasel`) — 2D scene graph, canvas rendering, tools
- `brother-lbx` (linked from `../brother-lbx`) — .lbx serialization/parsing

## Local development

```sh
npm install
npm run dev    # starts on http://localhost:5180
```

Requires sibling repos: `~/src/weasel` and `~/src/brother-lbx`.

## Weasel integration

Uses `weaselAliases()` from weasel's scripts to resolve all `@weasel-js/*` imports
and the kit's internal bare-path imports (`core/...`, `features/...`, etc.) to
local weasel source.

Key weasel APIs used:
- `SceneCanvas` with `layers.scene.drawOne` for custom rendering
- `useScene` for the document model
- `useSelection` for selection state
- `toolBundle: "standard"` for built-in select/hand/rect tools

## Current state

- Text renders as bounding boxes (waiting on weasel MSDF font support for proper text rendering)
- Objects can be created, selected, moved, resized via weasel tools
- Import/export .lbx files works end-to-end
- Property panel for editing text, rect, and pose properties

## Governing rule

It's OK to make changes to the weasel API when it makes both sides simpler, cleaner, or more elegant.
