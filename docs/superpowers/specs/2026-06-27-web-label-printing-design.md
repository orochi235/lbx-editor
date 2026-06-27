# Web Label Printing — Design

**Date:** 2026-06-27
**Status:** Approved (brainstorm) — pending spec review

## Goal

Print labels to physical label printers from a browser (Chromium), with an
architecture that supports *sweeping device coverage* over time. Two artifacts:

1. **A reusable printing library** whose center of gravity is monochrome raster
   generation, not any one printer.
2. **A print capability in the `lbx-editor` app**, as the library's first consumer.

Where the print code physically lives (separate repo/npm package vs. internal
`packages/` module) is intentionally **deferred** — the design makes that a late,
low-cost decision by keeping a clean library boundary.

## Core insight

The printer-agnostic, broadly reusable work is **"content → monochrome bitmap at
a target DPI/geometry."** That bitmap is the library's primary type and the seam
every driver consumes. Printer/label/protocol specifics are thin (but fiddly)
*adapters* hanging off that spine.

The reusable spine is *general* but not where the difficulty lives — it is a few
hundred lines and the dithering half is available off the shelf. The irreducible,
hardware-coupled effort sits in the adapters: per-device profiles, the Brother
command/status protocol, and Web Bluetooth transport quirks.

## Architecture

```
RasterCore    content(canvas/ImageData) + MediaSpec(dpi, widthDots, orient) → Raster1bpp
              ── general, owned. The spine. (lean on portakal for dithering)
Driver        Raster1bpp + opts → command bytes
              ── Brother: write/port (commit hard). ZPL/ESC-POS/…: plug in portakal.
Transport     bytes ↔ device
              ── WebBluetoothTransport (write; reference niimbluelib). Serial/USB later.
DeviceProfile model → { dpi, widthDots, driver, transport, margins, orient }
              ── data, not code. Parameterizes RasterCore and selects the Driver.
```

### Layers

- **RasterCore** (owned, reusable spine). Pure functions. Responsibilities:
  DPI/mm→dots scaling, RGBA→1-bpp threshold/**dithering**, rotation (P-touch prints
  sideways — raster lines run *across* the tape), MSB-first bit packing, centering
  within the printhead width. Lean on `portakal`'s dithering rather than hand-rolling.
- **Driver** (printer-language adapter). `Raster1bpp + opts → Uint8Array | AsyncIterable<Uint8Array>`.
  Pure bytes-in/bytes-out, so unit-testable against captured reference streams with no
  hardware. v1: `BrotherRasterDriver`. Future non-Brother languages: plug in `portakal`.
- **Transport** (thin, side-effecty). `connect()`, `write(bytes)`, `read()`, `disconnect()`.
  v1: `WebBluetoothTransport`. Mockable for tests. Later: Serial, USB, localhost bridge.
- **DeviceProfile** (data). Maps a known model to its geometry + which `(driver, transport)`
  it needs. A new printer is usually one profile entry reusing existing adapters.

### Primary types (sketch, names provisional)

```ts
interface MediaSpec { dpi: number; widthDots: number; orientation: 'normal' | 'rotated'; margins?: ... }
interface Raster1bpp { widthDots: number; heightDots: number; bits: Uint8Array /* 1bpp, MSB-first */ }
interface Driver { encode(raster: Raster1bpp, opts: JobOptions): Uint8Array | AsyncIterable<Uint8Array> }
interface Transport { connect(): Promise<void>; write(b: Uint8Array): Promise<void>; read(): Promise<Uint8Array>; disconnect(): Promise<void> }
interface DeviceProfile { model: string; media: MediaSpec; driver: Driver; transport: Transport }
```

## v1 scope

Smallest path to printing on real hardware, with the spine + one of each adapter:

- **RasterCore** — canvas/ImageData → `Raster1bpp` at 180 dpi. Threshold for v1; dithering
  via `portakal` available immediately.
- **`BrotherRasterDriver`** — targets the **Brother PT-P710BT** (P-touch CUBE Plus). Ported
  and validated against existing non-browser implementations (see References). Handles init,
  mode/media commands, per-line raster (`G`), feed/cut, and status reads.
- **`WebBluetoothTransport`** — BLE serial-style service; handles MTU chunking and status reads.
  Structural reference: `niimbluelib`.
- **One DeviceProfile** for the PT-P710BT.
- **Editor integration** — a Print affordance that: renders the current label to `Raster1bpp`
  at the device DPI, builds `MediaSpec` from the selected tape, runs the job through the
  library, and surfaces connect state + Brother status errors (no tape / cover open / etc.).

## Dependencies

- **`portakal`** (MIT, npm, pure-TS, zero-dep) — used now for RGBA→monochrome **dithering**;
  the on-ramp to every other printer *language* later (ZPL, ESC/POS, TSC, EPL, CPCL, Star, …).
  **Encoding-only by design** (no transport) and **does not cover Brother P-touch/QL**, which
  is exactly why Brother is the commit-hard adapter and portakal handles the rest.
- **`niimbluelib`** — reference (and possible future dependency) for Web Bluetooth transport
  patterns and a Niimbot driver.

## Buy vs. build summary

| Layer | v1 | Strategy |
|---|---|---|
| RasterCore (spine) | own | write; reuse `portakal` dithering |
| Brother driver | own | **commit hard** — no web JS lib exists; port from CLI/Python/Rust refs |
| Other-language drivers | later | **plug in** `portakal` |
| Web Bluetooth transport | own | write thin; reference `niimbluelib` |
| Niimbot / Phomemo / Zebra / DYMO | later | plug in / new profiles + adapters |

## Non-goals (v1, YAGNI)

- Local bridge/agent, WebUSB, Web Serial transports.
- Non-Brother drivers (deferred to `portakal` plug-in).
- Dithering UI controls (algorithm available; not exposed yet).
- Final library packaging decision (separate repo/npm vs. internal module) — design to the
  interface; decide when a second consumer appears.
- Safari/Firefox support — Web Bluetooth is Chromium-only; out of scope by platform.

## Error handling & status

Brother printers return status packets (errors: no media, cover open, wrong tape width, busy)
over the same channel. The job orchestrator reads status before/after printing and surfaces
typed errors to the editor. BLE specifics (MTU chunking, flow control, awaiting status between
lines) live entirely in `WebBluetoothTransport`.

## Testing strategy

- **Driver**: pure bytes-in/bytes-out — golden-file tests against captured reference command
  streams from the port sources. No hardware needed.
- **RasterCore**: deterministic unit tests (known image → known packed bits / dimensions).
- **Transport**: mocked for unit tests; manual hardware verification against the PT-P710BT.

## Platform constraints

Chromium only (Chrome/Edge). Web Bluetooth is unavailable in Safari/Firefox. USB printer-class
is claimed by the OS spooler on macOS/Windows, so WebUSB is reserved for later/Linux. These are
accepted limits of a zero-install browser-direct approach; a future local bridge lifts them.

## References

- `pt-p710bt-label-maker` (Node CLI) — https://github.com/robby-cornelissen/pt-p710bt-label-maker
- `brother_pt` (Python) — https://github.com/treideme/brother_pt
- `rust-ptouch` (Rust) — https://github.com/ryankurte/rust-ptouch
- `portakal` (universal printer-language SDK, TS) — https://github.com/productdevbook/portakal
- `niimblue` / `niimbluelib` (Web Bluetooth TS) — https://github.com/MultiMote/niimblue
- Brother PT-P710BT product / raster command reference — Brother support site
