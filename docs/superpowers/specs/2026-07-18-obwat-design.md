# obwat ("O Brother Where Art Thou") — design

Extract the printer stack from `lbx-editor/src/printing/` into a standalone
sibling package, and add a consumer-facing abstraction layer so apps stop
hand-assembling the printer plumbing.

Decisions made with the user 2026-07-18:

1. **API altitude:** high-level facade *plus* exported primitives.
2. **Grant/permission UX:** device acquisition lives in obwat; UX policy
   (localStorage grant flag, asleep hint, alerts) stays in the app.
3. **Connection model:** connectionless session — no consumer-visible
   open/close; every operation acquires → claims → works → releases behind an
   internal mutex.
4. **Packaging:** single package `obwat`, repo `~/src/obwat`, flat export
   surface. No monorepo, no scoped packages.

## Repo & packaging

- `~/src/obwat`, `git init -b main`. Update `~/src/PROJECTS.md`.
- npm name `obwat`; linked into lbx-editor the same way as weasel/bil-lbx
  (sibling checkout + alias/link; match the existing pattern in
  lbx-editor's vite config).
- Vitest for tests (same glob convention as lbx-editor).
- Ships with `docs/hardware/pt-p710bt.md` (moves; canonical home becomes
  obwat) and `scripts/hardware-debug/`.
- No second-printer profiles until real hardware exists (per handoff).

## Layer 1 — primitives (move as-is, stay exported)

`types.ts`, `packbits.ts`, `rasterCore.ts` (`rgbaToRaster`),
`brotherDriver.ts`, `webUsbTransport.ts`, `webSerialTransport.ts`,
`profiles.ts`, `printJob.ts` (`printRaster`), `keepalive.ts`
(`startUsbKeepalive`) — each with its existing test file, moved verbatim
except for import paths.

**Stays in the app:** `labelRender.ts` (weasel/editor-coupled) and
`textRender.ts` (DOM/editor concern).

**Package boundary type:** `RgbaImage` / `Raster1bpp`. The app renders
pixels; obwat owns everything from pixels to paper.

**Profile cleanup folded in:** `DeviceProfile` currently exposes
`makeTransport()`, which couples media geometry to transport construction.
The facade absorbs transport creation, so `DeviceProfile` slims to
`{ model, media, makeDriver }`. `printRaster` keeps taking an explicit
transport (it is a primitive; the facade supplies one).

## Layer 2 — facade (new)

```ts
createBrotherPrinter(options?: {
  keepaliveMs?: number            // default 60_000; 0/undefined disables
  usb?: UsbLike                   // injectable; default navigator.usb
  serial?: SerialLike             // injectable; default navigator.serial
}): BrotherPrinter

interface BrotherPrinter {
  /** Print using an already-granted device. Rejects with typed
      NoGrantedDeviceError if none — never shows a picker. */
  print(raster: Raster1bpp, opts: JobOptions): Promise<PrinterStatus>
  /** Show the vendor-filtered picker. Must be called inside a user
      gesture. Resolves true when a device was granted. */
  requestDevice(): Promise<boolean>
  /** One-shot status poll; null = unreachable (likely asleep). */
  queryStatus(): Promise<PrinterStatus | null>
  /** Fires on every keepalive tick and after every print. */
  onStatus(cb: (s: PrinterStatus | null) => void): () => void
  dispose(): void
}
```

Behavior:

- **Connectionless:** each operation internally acquires the device, claims,
  works, releases. An internal mutex serializes operations — this formalizes
  today's `keepalive.idle()` handshake between prints and keepalive ticks.
- **Transport selection** (WebUSB preferred, Web Serial fallback) happens
  inside acquisition. `navigator.usb`/`navigator.serial` are injectable for
  tests, extending the existing `UsbDeviceLike`/`SerialPortLike` pattern.
- **Keepalive** is owned by the facade and started at creation (when
  `keepaliveMs` > 0); it feeds `onStatus`. The `startUsbKeepalive` primitive
  remains exported for à-la-carte use.
- **Typed errors, no UX:** `NoGrantedDeviceError` (no granted device found;
  the app decides picker vs. asleep-hint), plus pass-through of transport
  errors. obwat never touches localStorage, never alerts.

## lbx-editor after extraction

- `handlePrint` shrinks to: render → `rgbaToRaster` → `printer.print`;
  catch `NoGrantedDeviceError` → consult `USB_GRANT_FLAG` policy → either
  asleep hint or `printer.requestDevice()` + retry. Grant flag and alert
  copy stay in App.tsx.
- The keepalive `useEffect` becomes a `printer.onStatus` subscription
  feeding `printerLastSeen` / `printerReachable`.
- `src/printing/` is deleted; imports switch to `obwat`.
  `labelRender.ts` moves up to `src/` (or stays put minus the folder —
  implementer's choice, single file either way).

## Error handling

- Facade maps "device present but claim failed" and "device absent" to
  distinct typed errors; picker dismissal (`NotFoundError` DOMException)
  keeps passing through unchanged so the app's cancel handling still works.
- `PrinterStatus.incomplete` / `hasError` semantics are unchanged.

## Testing

- Existing printing tests move verbatim (import paths only).
- New facade tests (fake usb/serial):
  - mutex: `print()` issued during a keepalive tick waits, never interleaves;
  - `print()` with no granted device rejects `NoGrantedDeviceError`;
  - `requestDevice()` grant → subsequent `print()` succeeds;
  - `onStatus` fan-out on tick and after print; unsubscribe works;
  - `dispose()` stops keepalive and rejects further operations.
- lbx-editor keeps its app-level tests; CI for obwat is plain `vitest run`.

## Out of scope

- Second-printer profiles (no hardware).
- Print-fidelity work (vertical squeeze, diagonal-line stepping — tracked in
  the EOD handoff open items).
- Publishing to npm; linked-package only for now.
