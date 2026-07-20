# IMG Palette Tool (drag-to-place) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move image insertion from the app-chrome IMG button into the main tool
palette as a real drag-to-place tool: click IMG → file picker → drag on canvas
→ image lands aspect-fit inside the drag box.

**Architecture:** Zero weasel changes. The app registers weasel's built-in
`useImageTool` via SceneCanvas's public patch-form `tools` prop (`tools:
{ image: <tool instance> }` — note `image: true` does NOT work; `image` is not
in `KNOWN_BUILTIN_IDS`). The palette is registry-driven, so the tool gets one
real button with active state. The file picker opens from an app effect that
observes `tools.active` transitioning to `'image'` (the `onToolsCreated`
callback re-fires on every tools identity change, so `tools` state is live).
Node minting goes through the app's existing `insertNodeFactories` seam with a
new `'image'` entry backed by a pure, unit-tested `buildImageInsert` helper
that reads the picked file from a ref. Picker cancel reverts to the select
tool via the file input's native `cancel` event (Chrome 113+; this is a
Chrome-only app due to WebUSB).

**Tech Stack:** React 19, Vite, vitest (no DOM-testing lib — React wiring is
verified in-browser), weasel `@weasel-js/core` public API only.

**Key verified facts (don't re-derive):**
- `useImageTool` (weasel `src/tools/builtin/image/useImageTool.tsx`) takes
  `{ src, label }`, has NO picker, presentation group `'shape'`, id `'image'`.
  Its `src` option only rides the insert binding's params — unused here
  because the app factory reads its own ref. Pass `src: ''`.
- SceneCanvas patch-form `tools` prop (`SceneCanvas.tsx:479`) accepts
  `Record<string, AnyTool | true | false>`; an `AnyTool` value is added to the
  internal registry (`:1159`). Internal keybindings stay enabled for the patch
  form (only the full-ToolsApi takeover disables them, `:1188`).
- `onToolsCreated` fires on every `tools` identity change (`:1201`), and the
  app stores it in state (`App.tsx:578` `onToolsCreated={setTools}`), so
  `tools.active` is observable with a `useEffect`.
- A consumer `insertNodeFactories` entry fully owns `data` + optional `pose`;
  returning `null` rejects the insert (weasel `src/canvas/deps/insert.ts:89-100`).
- `LabelImageData.src` is bare base64, no `data:` prefix (`src/label.ts:35-41`).

---

### Task 1: Pure insert-factory helper `buildImageInsert`

**Files:**
- Create: `src/imageInsert.ts`
- Test: `src/imageInsert.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/imageInsert.test.ts
import { describe, expect, it } from 'vitest';
import { buildImageInsert, type PendingImage } from './imageInsert';

const PENDING: PendingImage = {
  src: 'aGVsbG8=',
  originalName: 'logo.png',
  mimeType: 'image/png',
  defaultWidth: 40,
  defaultHeight: 20,
};

describe('buildImageInsert', () => {
  it('rejects the insert when no image has been picked', () => {
    expect(buildImageInsert(null, { x: 0, y: 0, width: 30, height: 30 })).toBeNull();
  });

  it('passes picked-file fields through as app image data', () => {
    const built = buildImageInsert(PENDING, { x: 1, y: 2, width: 40, height: 20 });
    expect(built?.data).toEqual({
      kind: 'image',
      src: 'aGVsbG8=',
      originalName: 'logo.png',
      mimeType: 'image/png',
    });
  });

  it('contain-fits a wide drag box (height is the limiting axis)', () => {
    // aspect 2:1 into an 80x10 box → scale 0.5 → 20x10, anchored at drag origin
    const built = buildImageInsert(PENDING, { x: 5, y: 7, width: 80, height: 10 });
    expect(built?.pose).toEqual({ x: 5, y: 7, width: 20, height: 10 });
  });

  it('contain-fits a tall drag box (width is the limiting axis)', () => {
    // aspect 2:1 into a 20x40 box → scale 0.5 → 20x10
    const built = buildImageInsert(PENDING, { x: 0, y: 0, width: 20, height: 40 });
    expect(built?.pose).toEqual({ x: 0, y: 0, width: 20, height: 10 });
  });

  it('drops at the default size for a click-sized drag', () => {
    const built = buildImageInsert(PENDING, { x: 3, y: 4, width: 1, height: 0.5 });
    expect(built?.pose).toEqual({ x: 3, y: 4, width: 40, height: 20 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/imageInsert.test.ts`
Expected: FAIL — cannot resolve `./imageInsert`.

- [ ] **Step 3: Write the implementation**

```ts
// src/imageInsert.ts
import type { LabelImageData, LabelPose } from './label';

/** The file most recently chosen from the IMG tool's picker, held app-side
 *  until a canvas drag commits it (see the `image` insertNodeFactory). */
export interface PendingImage {
  /** Base64 image bytes, no `data:` prefix — matches `LabelImageData.src`. */
  src: string;
  originalName: string;
  mimeType: string;
  /** Natural size scaled to fit the label, computed at pick time. */
  defaultWidth: number;
  defaultHeight: number;
}

/** Drags below this (pt) in either axis count as a click: the image drops at
 *  its default size instead of contain-fitting into a sliver. */
const MIN_DRAG_PT = 4;

/** Node factory core for the `image` insert kind. Contain-fits the picked
 *  image into the drag box (preserving aspect), anchored at the drag origin.
 *  Returns `null` (rejecting the insert) when nothing has been picked. */
export function buildImageInsert(
  pending: PendingImage | null,
  bounds: { x: number; y: number; width: number; height: number },
): { data: LabelImageData; pose: LabelPose } | null {
  if (!pending) return null;
  const { defaultWidth, defaultHeight } = pending;
  let width = defaultWidth;
  let height = defaultHeight;
  if (bounds.width >= MIN_DRAG_PT && bounds.height >= MIN_DRAG_PT) {
    const s = Math.min(bounds.width / defaultWidth, bounds.height / defaultHeight);
    width = defaultWidth * s;
    height = defaultHeight * s;
  }
  return {
    data: {
      kind: 'image',
      src: pending.src,
      originalName: pending.originalName,
      mimeType: pending.mimeType,
    },
    pose: { x: bounds.x, y: bounds.y, width, height },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/imageInsert.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/imageInsert.ts src/imageInsert.test.ts
git commit -m "Add buildImageInsert factory core for drag-to-place images"
```
(Repo convention: end the commit message with the `Co-Authored-By: Claude
Fable 5 <noreply@anthropic.com>` trailer.)

---

### Task 2: App wiring — register the tool, picker-on-activate, insert factory

**Files:**
- Modify: `src/App.tsx` (imports; state near `imageInputRef` ~line 346;
  `insertNodeFactories` memo ~line 276; `handleImagePick` ~line 348;
  SceneCanvas props ~line 570)

- [ ] **Step 1: Add imports**

In the existing `@weasel-js/core` import in `src/App.tsx`, add `useImageTool`.
Add:

```ts
import { buildImageInsert, type PendingImage } from './imageInsert';
```

- [ ] **Step 2: Add pending-image ref + tool instance + patch memo**

Next to `const imageInputRef = useRef<HTMLInputElement>(null);` (~line 346):

```ts
const pendingImageRef = useRef<PendingImage | null>(null);
// `src` is unused: the app's `image` insertNodeFactory reads pendingImageRef
// instead of the binding's params. The tool exists for its palette button,
// crosshair, and drag-rect insert gesture.
const imageTool = useImageTool({ src: '', label: 'Image' });
const toolsPatch = useMemo(() => ({ image: imageTool }), [imageTool]);
```

(`toolsPatch` is memoized so the SceneCanvas registry contents stay
render-stable — `useTools` identity churn would re-fire `onToolsCreated`.)

- [ ] **Step 3: Add the `image` entry to `insertNodeFactories`**

Inside the existing `insertNodeFactories` memo (~line 276), add:

```ts
image: (bounds) => buildImageInsert(pendingImageRef.current, bounds),
```

No new memo deps — the ref is stable.

- [ ] **Step 4: Rework `handleImagePick` to stage instead of insert**

Replace the existing `handleImagePick` (~line 348-352) with:

```ts
const handleImagePick = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (imageInputRef.current) imageInputRef.current.value = '';
  if (!file) return;
  const mimeType = guessMimeType(file.name);
  const src = await fileToBase64(file);
  const dims = await getImageDimensions(src, mimeType, paperWidth - 20, paperHeight - 10);
  pendingImageRef.current = {
    src,
    originalName: file.name,
    mimeType,
    defaultWidth: dims.width,
    defaultHeight: dims.height,
  };
}, [paperWidth, paperHeight]);
```

Leave `addImageFromFile` and the drag-drop handlers untouched — dropping a
file onto the canvas still inserts directly.

- [ ] **Step 5: Picker-on-activation + cancel-reverts-to-select effects**

Below `handleImagePick`:

```ts
// The palette's IMG button just does tools.setActive('image') (registry-
// driven palette, no picker hook on the tool). Observe the activation
// transition and open the hidden file input; a fresh pick happens on every
// entry into the tool. Re-picking without switching tools first is not
// supported (setActive on the active id is a no-op).
const prevActiveToolRef = useRef<string | null>(null);
useEffect(() => {
  const active = tools?.active ?? null;
  if (active === 'image' && prevActiveToolRef.current !== 'image') {
    imageInputRef.current?.click();
  }
  prevActiveToolRef.current = active;
}, [tools]);

// Dismissing the picker means "never mind": revert to select so an
// imageless crosshair tool isn't left active. Native `cancel` event
// (Chrome 113+); this app is Chrome-only (WebUSB).
const toolsRef = useRef(tools);
toolsRef.current = tools;
useEffect(() => {
  const input = imageInputRef.current;
  if (!input) return;
  const onCancel = () => {
    const t = toolsRef.current;
    if (t?.active === 'image') t.setActive('select');
  };
  input.addEventListener('cancel', onCancel);
  return () => input.removeEventListener('cancel', onCancel);
}, []);
```

(`tools` is the existing `useState`-held ToolsApi from `onToolsCreated`.)

- [ ] **Step 6: Pass the patch to SceneCanvas**

On the `<SceneCanvas ...>` element (~line 570), next to
`defaultTools={['select', 'hand', 'rect', 'line', 'text']}`, add:

```tsx
tools={toolsPatch}
```

- [ ] **Step 7: Typecheck + full test run**

Run: `npm run build && npm test`
Expected: build clean, all tests pass (5 new + existing).

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "Register weasel image tool in palette; picker on activation"
```

---

### Task 3: Remove the app-chrome IMG button

**Files:**
- Modify: `src/Toolbar.tsx` (prop decl line 32, destructure line 56, button line 120)
- Modify: `src/App.tsx` (drop `onAddImage` prop at ~line 527)

- [ ] **Step 1: Delete the IMG button and `onAddImage` prop**

In `src/Toolbar.tsx` remove:
- `onAddImage: () => void;` from the props interface (line 32)
- `onAddImage,` from the destructure (line 56)
- `<button onClick={onAddImage} title="Add image">IMG</button>` (line 120)

In `src/App.tsx` remove the `onAddImage={() => imageInputRef.current?.click()}`
prop from `<Toolbar>` (~line 527). Keep the hidden image `<input>` — it is now
the tool's picker.

- [ ] **Step 2: Typecheck + tests**

Run: `npm run build && npm test`
Expected: clean; an unused-prop or missing-prop error here means a reference
was missed.

- [ ] **Step 3: Commit**

```bash
git add src/Toolbar.tsx src/App.tsx
git commit -m "Remove app-chrome IMG button; palette tool replaces it"
```

---

### Task 4: In-browser verification of the full flow

No unit harness covers the React wiring, so drive the real app.

- [ ] **Step 1: Start the dev server** (`npm run dev`, port 5180) if not running.

- [ ] **Step 2: Drive the flow with Playwright MCP** (its file-chooser
  interception prevents the native dialog from blocking):
  1. Navigate to `http://localhost:5180`.
  2. Screenshot: palette shows an Image button in the shape group (after
     rect/line), with the kit image icon.
  3. Click the Image button; use `browser_file_upload` to satisfy the file
     chooser with any small PNG (write one to the scratchpad first).
  4. Drag a rect on the canvas (e.g. 100,100 → 260,180).
  5. Screenshot: the image renders inside the drag box, aspect preserved;
     PropertyPanel shows an image node selected? (selection behavior follows
     the insert action's default — just confirm the node exists visually).
  6. Press Escape / click select, click Image again, and dismiss the chooser
     (if the MCP can cancel; otherwise skip) → active tool returns to select.

- [ ] **Step 3: Fallback if Playwright can't intercept the chooser** — report
  the exact manual steps for Mike and mark this task pending-manual in the
  handoff instead of claiming verification.

---

### Task 5: Docs sync

**Files:**
- Modify: `docs/superpowers/plans/2026-07-18-img-toolbar-assessment.md`
- Modify: `docs/superpowers/plans/2026-07-18-eod-handoff.md`
- Modify: `CLAUDE.md` ("Current state" bullet about object creation is still
  accurate — only touch if something above changed behavior it describes)

- [ ] **Step 1: Correct the assessment doc**

Append to the verification-results section: the ToolPalette action-button kind
turned out unnecessary too — `onToolsCreated` re-fires on every tools identity
change, so the app can observe `tools.active` and open the picker on the
activation transition. Implemented as option 1 via the tools-patch instance
form with zero weasel changes; option 2 remains the fallback design if a
palette button must ever fire without activating any tool.

- [ ] **Step 2: Update the handoff**

Mark open item 5 DONE with a one-line summary (palette IMG tool, picker on
activation, drag-to-place contain-fit, no weasel changes) and a pointer to
this plan. Note the in-browser verification result (or that it's
pending-manual).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-07-18-img-toolbar-assessment.md docs/superpowers/plans/2026-07-18-eod-handoff.md
git commit -m "Sync IMG-toolbar docs: palette tool shipped with no weasel changes"
```
