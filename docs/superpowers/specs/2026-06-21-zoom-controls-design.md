# Zoom controls — design

## Goal

Add visible zoom controls to the label editor so the user can zoom in/out, drag
a slider, see and set an exact zoom percentage, fit the label to the viewport,
and reset to 100%. Labels are small in world units, so the editor frames content
sensibly on load and when the label changes. The canvas is **responsive**: it
fills the available space and all zoom/fit math uses the live canvas size.

## Background

`SceneCanvas` (from `@weasel-js/core`) already supports a controlled viewport via
`view` + `onViewChange`, and ships pure helpers and a `View` type:

- `View = { x, y, scale: { x, y } }` — `x/y` is the world point at canvas
  top-left; `scale` is pixels per world unit (1 = 100%).
- `zoomAt(view, anchor, factor, opts?)` — multiplicative zoom about a screen
  anchor, clamped (defaults 0.1–8×).
- `fitViewToBounds(bounds, viewportDims, currentView, opts?)` — fit world bounds
  into the viewport (`mode: 'contain'` default, `padding` default 16).
- `meanScale(scale)` — scalar zoom for display.

Built-in Cmd+wheel zoom and wheel-pan are already enabled; because the editor
runs `SceneCanvas` controlled (`view` + `onViewChange`), those interactions
surface to the readout.

### Responsive canvas

The canvas is **not** a fixed size. The canvas container fills the flex space
between the toolbar and the property panel. `App.tsx` measures the container with
a `ResizeObserver` and feeds the live `{ width, height }` to `SceneCanvas` as its
`width`/`height` props; weasel handles device-pixel-ratio internally. The canvas
is only rendered once a non-zero size has been measured (avoids a zero-size first
paint). All fit/center math uses the live measured size as the viewport
dimensions.

## Behavior

### Controls (in the existing `Toolbar`, after the object-creation tools)

| Control | Action |
|---|---|
| **−** | `zoomAt(view, CENTER, 0.8)` |
| **slider** | logarithmic range over the 10%–800% clamp; dragging maps slider position → percent and calls the same set-zoom path (`onZoomSet`) |
| **+** | `zoomAt(view, CENTER, 1.25)` |
| **% readout** | shows `Math.round(meanScale(view.scale) * 100)`; editable — typing N and committing (Enter/blur) zooms to scale `N/100` anchored at `CENTER`; Escape reverts |
| **⤢ Fit** | `fitViewToBounds(paperBounds, VIEWPORT, view, { padding: 16 })` |
| **Reset** | recenter paper at scale 1 (identical to initial-load view) |

- `CENTER = { x: canvasSize.width / 2, y: canvasSize.height / 2 }` (live
  canvas-center screen coords).
- `VIEWPORT = canvasSize` (the live measured `{ width, height }`).
- `paperBounds = { x: 0, y: 0, width: paperWidth, height: paperHeight }`.
- All zoom changes clamp to weasel's defaults (0.1–8×).
- The editable percentage and the slider both convert to a `zoomAt` factor of
  `targetScale / currentScale`, reusing the same anchored-zoom path.

#### Slider mapping

The slider is logarithmic so equal slider travel is equal proportional zoom.
Over `[ZOOM_MIN_PCT, ZOOM_MAX_PCT] = [10, 800]` with `SLIDER_STEPS = 1000`:

- `sliderToPercent(s) = ZOOM_MIN_PCT * exp(LOG_RATIO * s / SLIDER_STEPS)`
- `percentToSlider(p) = log(clamp(p) / ZOOM_MIN_PCT) / LOG_RATIO * SLIDER_STEPS`
- `LOG_RATIO = log(ZOOM_MAX_PCT / ZOOM_MIN_PCT)`

These constants live in `Toolbar.tsx` alongside the slider; the slider position
is derived from the live `zoomPercent` prop each render.

### Triggers

- **Initial measurement → paper centered at 100% (scale 1).** A
  `useLayoutEffect` measures the container before paint. On the first valid
  (non-zero) measurement, a `viewInitialized` ref guard runs once to center the
  paper. The centering formula (coordinate convention
  `screenX = (worldX - view.x) * scale`, scale 1) is:
  `view.x = paperWidth/2 - canvas.width/2`,
  `view.y = paperHeight/2 - canvas.height/2`.
- **Paper-size change → fit.** A single `useEffect` keyed on
  `[paperWidth, paperHeight, canvasSize]` calls fit. A `prevPaperSize` ref guard
  makes it a no-op unless the paper dimensions actually changed — so it does not
  override the initial centered view, and a **canvas-only resize does not refit**
  (the view is left untouched on container resize). Because `.lbx` import updates
  tape-size / auto-length / length state, and tape / length edits change
  `paperWidth`/`paperHeight`, **both import and manual tape changes flow through
  this one effect** — no separate fit call in `handleImport`.

View changes are instant (no tween). `useViewAnimation` remains available for a
later smoothing pass.

## Component boundaries

- **`App.tsx`** owns `view` state (`useState<View>`) and `canvasSize` state
  (`useState<CanvasSize>`), the container ref + `ResizeObserver` measurement, the
  initial-center and fit helpers, and the control handlers. Passes the live
  `width`/`height`, `view`, and `onViewChange` to `SceneCanvas` (rendered only
  once `canvasSize` is non-zero). Re-fits in a single effect keyed on
  `[paperWidth, paperHeight, canvasSize]`, guarded by the `prevPaperSize` ref.
- **`Toolbar.tsx`** stays presentational. New props: `zoomPercent: number`,
  `onZoomIn`, `onZoomOut`, `onZoomSet: (pct: number) => void`, `onZoomFit`,
  `onZoomReset`. Owns the slider's log-mapping helpers and the small `ZoomInput`
  sub-component (editable % with Enter/blur commit, Escape revert). Rendered as a
  zoom group (separator + `−` / slider / `+` / editable % / `⤢` / Reset) after
  the object-tool buttons.

## Style

The app uses inline styles throughout with no CSS-class infrastructure; the zoom
group matches that convention rather than introducing a lone stylesheet. The
canvas container uses `overflow: hidden` and `lineHeight: 0` so the measured size
is exactly the drawing surface.

## Out of scope

- Animated view transitions.
- Pan controls beyond weasel's built-in wheel/hand-tool behavior.
