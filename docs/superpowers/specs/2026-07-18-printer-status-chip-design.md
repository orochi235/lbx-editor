# Printer status chip — design

Approved 2026-07-18. Builds on the WebUSB transport + keepalive
(`docs/superpowers/specs/2026-07-18-webusb-transport-design.md`).

## Goal

A toolbar chip showing live printer state: reachability, loaded tape width,
error state, last-seen time, and print-in-progress.

## Components

### 1. Status data (printing module)

- `PrinterStatus` (`src/printing/types.ts`) gains `mediaWidthMm: number | null`
  — byte 10 of the 32-byte reply, `null` when the reply is incomplete
  (fewer than 32 bytes). `parseStatus` in `brotherDriver.ts` fills it; tested.
- Keepalive callback widens to `onStatus?(status: PrinterStatus | null)` and
  fires **every tick**: parsed status on success, `null` when the device is
  absent or the tick failed — the UI learns about disappearance, not just
  presence. Existing swallow-all error behavior otherwise unchanged.

### 2. App state + cadence (`App.tsx`)

- Keepalive `intervalMs` passed by App drops to `60_000`. Mechanism unchanged
  (brief claim per tick; prints still take priority via `idle()`).
- App state: `printerLastSeen: { status: PrinterStatus; at: number } | null`
  and `printerReachable: boolean`. Updated on every keepalive tick (null tick
  → `printerReachable = false`, keep last `printerLastSeen`), and by each
  print's returned status (immediate refresh after printing).

### 3. Chip component

`src/PrinterStatusChip.tsx` + `src/printerStatusChip.css` (first app
stylesheet; new code uses CSS classes per repo rule — Toolbar's existing
inline styles untouched). Rendered by `Toolbar` from data props, placed right
of the spacer next to the Print button.

States:
- **Green dot** — reachable, no error: `PT-P710BT · 12mm · just now` /
  `· Nm ago`.
- **Red dot** — error bytes set: same text; tooltip "check tape/cover".
- **Gray dot** — never seen or unreachable: `PT-P710BT · —`; tooltip
  "not detected — may be asleep".
- **Pulsing dot + "printing…"** while a job is in flight (existing `printing`
  state).

Relative time re-renders on a 30s internal timer; tooltip includes the
absolute last-seen time. Dot color/pulse via CSS classes; incomplete status
(no width) renders the width segment as `—`.

## Error handling

Chip is presentational; all failure knowledge arrives as `null` ticks or
error-flagged statuses. No new alerts.

## Testing

- Driver: `mediaWidthMm` parsing (full reply, incomplete reply) in
  `brotherDriver.test.ts`.
- Keepalive: `onStatus(null)` on absent device and on tick failure;
  `onStatus(status)` on success — in `keepalive.test.ts`.
- Chip: presentational, verified in-app (printer on / off / tape-error easy to
  drive by hand). No component test harness exists in the repo; not adding one
  for this.
