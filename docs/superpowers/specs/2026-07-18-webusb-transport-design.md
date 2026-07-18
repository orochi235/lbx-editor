# WebUSB transport — design

Approved 2026-07-18. Context: `docs/hardware/pt-p710bt.md` (hardware/OS reference,
all preconditions verified on hardware) and
`docs/superpowers/plans/2026-07-18-webusb-handoff.md`.

## Goal

Make the in-app Print button work over a USB cable via WebUSB, USB-first with
automatic fallback, plus an optional keepalive that stops the printer from
auto-powering off while the app is open.

## Components

### 1. `src/printing/webUsbTransport.ts`

`createWebUsbTransport(device: UsbDeviceLike): Transport` — mirrors
`webSerialTransport.ts` in shape and testing strategy.

- `UsbDeviceLike`: minimal structural subset of `USBDevice` (configuration
  state, `open/close/selectConfiguration/claimInterface/releaseInterface/
  transferOut/transferIn`), so unit tests use a plain fake — same pattern as
  `SerialPortLike`.
- `open()`: `device.open()` → `selectConfiguration(1)` when `configuration` is
  null → scan `configuration.interfaces[].alternates[0]` for the first
  interface exposing both a bulk IN and bulk OUT endpoint → `claimInterface`.
  Endpoint numbers are discovered, never hardcoded (PT-P710BT: OUT 0x02,
  IN 0x81 — used in tests as fake data only).
- `write(bytes)`: one `transferOut` on the bulk OUT endpoint; throws unless
  the result status is `ok` with all bytes written. Chromium packetizes.
- `read(timeoutMs, minBytes = 1)`: loop `transferIn(64)` accumulating bytes
  until `minBytes` or deadline, racing each transfer against the remaining
  time. WebUSB has no native transfer timeout; on timeout the dangling
  `transferIn` is abandoned and torn down by `close()`. Same single-use-per-
  open caveat the serial transport documents.
- `close()`: `releaseInterface` then `device.close()`, each best-effort.

### 2. Profile generalization (`src/printing/profiles.ts`)

`ptP710btProfile(transport: Transport, tapeWidthMm: number)` — drops the
`SerialPortLike` parameter and the transport construction; `makeTransport`
returns the injected transport. Profiles become transport-agnostic; the app
composes the transport. No USB-specific profile variant.

### 3. Print flow (`App.tsx`) — USB-first, auto

- If `navigator.usb` exists:
  - `getDevices()` → if a Brother (vendor `0x04F9`) device is granted, use it
    silently — zero-click reprint.
  - A `localStorage` flag records that a device grant exists (not that a print
    succeeded); it's set as soon as a device is acquired, whether via
    `getDevices()` or a fresh `requestDevice()` grant.
  - If a device was previously granted but is now absent, and the flag is
    set, show "Printer not found — it may have auto-powered off; press its
    power button, then print again" rather than opening the picker. The hint
    is one-shot: firing it clears the flag, so a repeat click falls through
    to `requestDevice()` — a genuinely revoked permission can't dead-end the
    Print button, while a printer that was merely asleep gets the zero-click
    path again once woken.
  - Otherwise `requestDevice({ filters: [{ vendorId: 0x04F9 }] })`, kept
    directly in the click-handler gesture chain. `NotFoundError` → silent
    (picker canceled), matching the serial path's convention.
- Else (no WebUSB): existing Web Serial path, unchanged.
- Everything downstream of transport construction (render → raster → driver →
  `printRaster`) is shared and unchanged.

### 4. Keepalive (`src/printing/keepalive.ts` + App wiring)

Goal: prevent auto-power-off (~10 min idle) while the app is open.

- `startUsbKeepalive({ getDevice, intervalMs = 5 * 60_000, onStatus })` —
  every tick: get the granted device, build a WebUsb transport, `open()`,
  send the status request (100×`00`, `1B 40`, `1B 69 53`), `read(2000, 32)`,
  `close()`. Claim is held only for the duration of one status round-trip so
  other software can use the printer between ticks. Returns a handle,
  `{ stop, idle }`: `stop()` clears the poll interval, and `idle()` resolves
  once any in-flight tick has finished (immediately when idle) so a caller
  can await exclusive device access.
- Skips a tick (silently) when the device is absent, a print is in progress
  (shared `printing` flag), or the previous tick is still running (tracked
  via the in-flight promise `idle()` also observes, not a separate boolean).
- `App.tsx`'s `handlePrint` awaits `keepaliveRef.current?.idle()` right after
  setting the busy flag and before claiming the device, so a print job can
  never interleave with an in-flight keepalive tick's own claim/release of the
  USB interface. The busy flag itself (`printingRef.current`) is now set and
  cleared entirely inside `handlePrint`'s try/finally, rather than via a
  render-phase `printingRef.current = printing;` assignment.
- `onStatus(PrinterStatus)` lets the UI show live tape width / error state
  later; initial wiring just keeps the timer alive.
- **Hardware verification item:** confirm a status poll actually resets the
  printer's idle timer (soak > 10 min with 5-min polls). If it does not,
  shorten the interval; if that fails too, drop the feature (no documented
  P710BT command disables auto-power-off, and reverse-engineering settings
  writes is out of scope).

## Error handling

- Transport errors surface through the existing `printRaster` → alert path.
- Sleeping/absent printer produces the "may have auto-powered off" hint, not a
  generic failure.
- Keepalive failures are silent (logged to console) — it is opportunistic.

## Testing

- `webUsbTransport.test.ts`: fake `UsbDeviceLike`; covers open/claim
  sequencing (incl. selectConfiguration only when unset), endpoint discovery
  (non-zero interface number, mixed endpoint order), write success/short-write
  error, read accumulation across chunks, read timeout returning partial
  bytes, close best-effort semantics.
- `keepalive.test.ts`: fake timers; covers tick cadence, skip-while-printing,
  skip-while-absent, no overlapping ticks, stop().
- Profile signature change is compile-time covered (tsc + App call site);
  `profiles.test.ts` continues to test `ptP710btMedia`.
- Hardware: real print via Print button (first-time picker + zero-click
  reprint), orientation/mirroring check (open watch-item), keepalive soak.
