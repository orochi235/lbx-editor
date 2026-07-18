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

## Verdict

The virtue Mike is after is real: object creation belongs in the object
toolbar, and today's IMG placement (app chrome, next to zoom) is a
category error. But "new shallow class of tool" aims at the wrong layer — the
Tool system is exactly the machinery a picker button doesn't need, and its
activation hook is dead code besides. The shallow thing should be either a
palette affordance (option 2) or nothing new at all (option 1).

**Recommendation:** check option 1 first (read `useImageTool` for its file
source); fall back to option 2 if the built-in doesn't fit. Both satisfy the
governing rule (weasel changes are fine when both sides get simpler); option 4
fails it.
