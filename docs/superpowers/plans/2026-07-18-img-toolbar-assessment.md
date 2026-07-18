# Assessment: IMG button on the main toolbar via a "really shallow tool class"

Requested 2026-07-18: move the IMG button from the app toolbar into the main
(weasel ToolPalette) toolbar, possibly by adding a new very shallow class of
tool to weasel. This is the requested meditation on that approach — no
implementation yet.

## What weasel already has (from a source survey)

- **Tools** are stateful canvas interaction modes (`src/tools/types.ts:141`).
  The palette (`packages/ui/.../ToolPalette.tsx`) is registry-driven and its
  click handler is hardcoded to `tools.setActive(tool.id)` — every button
  switches modes, nothing else.
- **A one-shot "shallow tool" concept already exists — as Actions, not
  Tools.** `Action` with an `ImmediateInvoker` (`timing: 'immediate'`,
  `src/interactions/actions/invoker.ts:315`) is exactly "fire a callback,
  change no mode," and `ActionBar` is its palette. Both are public API, and
  lbx-editor already mounts `ActionsProvider`.
- **Two booby traps in the naive tool-class route:** `Tool.onActivate` is
  declared but *never fired* on tool switch (the dispatcher lifecycle at
  `useGestureDispatcher.tsx:254-271` only fires `onDeactivate`), and
  `ToolsApi` keeps no previous-tool memory to revert to. A tool that
  "activates, fires, reverts" would silently do nothing today.
- **Weasel has a built-in image tool** (`src/tools/builtin/image/useImageTool.tsx`)
  that inserts via the same `insert` binding the app's other insert tools use,
  and `SceneCanvas`'s `tools` patch prop can pull out-of-tier built-ins into
  the bundle (`tools: { image: true }`).

## Options, ranked

1. **Use weasel's existing built-in image tool.** Add `image: true` to the
   SceneCanvas tools patch and an `image` entry to the app's
   `insertNodeFactories`. IMG becomes a real palette tool with placement UX
   (choose where the image lands, like rect/line/text) instead of "drop at
   (10,5)". *Open question to verify first:* how that tool sources its file —
   if it doesn't open a picker, the app may still need to hand it one. This is
   the most consistent outcome and possibly zero new weasel surface.
2. **Teach ToolPalette an "action" button kind.** A presentation-level
   discriminator (e.g. `presentation.kind: 'action'` + callback) so the
   palette's click branch calls the callback instead of `setActive`. Small,
   public, honest API (~1 file in `packages/ui` + a metadata field), and it's
   the "shallow class" idea placed at the right layer: the *palette* is where
   shallowness lives, not the tool dispatcher.
3. **Consumer-only ActionBar.** Register an app `Action`, render `<ActionBar>`
   adjacent to `<ToolPalette>`. Zero weasel changes, but a second visual
   surface butted against the palette — the seam will show.
4. **A true action-tool class in the Tool system.** Least advisable: it must
   first *reanimate the dead `onActivate` path*, add previous-tool memory, and
   special-case the palette anyway — the largest diff for the same pixels.

## Verification results (2026-07-18, post-assessment)

Read the weasel source to answer the open question in option 1. Three findings:

1. **`tools: { image: true }` does not work.** `image` is not in SceneCanvas's
   `KNOWN_BUILTIN_IDS` (`SceneCanvas.tsx:1079`); a `true` value for an unknown
   id is ignored with a dev warning. The patch form *does* accept a full tool
   instance — `tools: { image: useImageTool({ src }) }` — and that path is
   public API.
2. **`useImageTool` has no file picker.** It takes `src` (URL / `blob:` /
   `data:` URI) as a required hook option and bakes it into the insert
   binding's params; the insert dep stamps it onto each new node. It is a
   drag-to-place stamp tool for an image you already have.
3. **No activation hook to open a picker from.** `Tool.onActivate` is the
   already-flagged dead code path, so "activate image tool → picker opens"
   cannot be built without reanimating it (option 4 territory).

Consequence: **option 1 alone cannot deliver a picker-opening IMG button in
the palette.** Option 2 (ToolPalette "action" button kind) is the required
piece. Option 1 survives as an optional UX upgrade layered on top: the action
button opens the picker, the picked file becomes a blob/data URI in app state,
the app registers `tools: { image: useImageTool({ src }) }` + an `'image'`
entry in its `insertNodeFactories` (minting the app-shaped
`{ kind: 'image', src, ... }` node), and activates the tool via its ToolsApi
handle for drag-to-place — replacing today's insert-at-(10,5).

## Verdict

The virtue Mike is after is real: object creation belongs in the object
toolbar, and today's IMG placement (app chrome, next to zoom) is a
category error. But "new shallow class of tool" aims at the wrong layer — the
Tool system is exactly the machinery a picker button doesn't need, and its
activation hook is dead code besides. The shallow thing should be either a
palette affordance (option 2) or nothing new at all (option 1).

**Recommendation (updated after verification):** option 2 — teach ToolPalette
an "action" button kind — is the required piece; option 1's `image: true`
mechanism doesn't exist and its tool has no picker. The remaining pick is UX
scope: (a) action button only — picker opens, image inserts at the default
spot as today, just launched from the palette; or (b) action button + image
tool — after picking, activate `useImageTool` (registered via the tools patch
with the picked src) so the user drags the image into place like the other
shape tools. Both satisfy the governing rule; option 4 still fails it.
