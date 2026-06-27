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
`src/printing/` module) is intentionally **deferred** — the design keeps a clean
library boundary so that is a late, low-cost decision. v1 lives in `src/printing/`.

## Core insight

The printer-agnostic, broadly reusable work is **"content → monochrome bitmap at
a target DPI/geometry."** That bitmap is the library's primary type and the seam
every driver consumes. Printer/label/protocol specifics are thin (but fiddly)
*adapters* hanging off that spine.

The reusable spine is *general* but not where the difficulty lives — it is a few
hundred lines. The irreducible, hardware-coupled effort sits in the adapters:
per-device profiles, the Brother command/status protocol, and transport quirks.

## Transport reality (important — corrected from initial assumption)

Brother's Bluetooth label printers are **not uniform**:

- **PT-P710BT (CUBE Plus — the target device)** uses **Bluetooth Classic SPP/RFCOMM**,
  *not* BLE. Confirmed via the reference implementation, which connects over RFCOMM
  channel 1. **Web Bluetooth supports only BLE/GATT and cannot reach Classic SPP devices.**
- Therefore the **v1 transport is the Web Serial API**, not Web Bluetooth. The user pairs
  the printer once at the OS level, which exposes a virtual serial port
  (`/dev/cu.PT-P710BT…` on macOS, a `COM` port on Windows); Web Serial opens that port.
- **Web Bluetooth remains in the design** for genuinely-BLE devices (e.g. the smaller
  PT-P300BT, Niimbot printers). This is precisely the fragmentation the transport×driver
  split absorbs: the Brother raster *driver* is identical regardless of transport; only the
  transport adapter swaps.

## Architecture

```
RasterCore    rgba(label render at print dpi) + MediaSpec → Raster1bpp
              ── general, owned. The spine. (lean on portakal for dithering later)
Driver        Raster1bpp + JobOptions → command bytes
              ── Brother: write/port (commit hard). ZPL/ESC-POS/…: plug in portakal.
Transport     bytes ↔ device
              ── v1: WebSerialTransport (OS-paired SPP port). Later: WebBluetooth (BLE), USB.
DeviceProfile model → { dpi, printheadDots, tapeWidthMm, driver, transport }
              ── data, not code. Parameterizes RasterCore and selects the Driver.
```

### Layers

- **RasterCore** (owned, reusable spine). Pure functions over a plain RGBA struct
  (`{ width, height, data: Uint8ClampedArray }`) — **no DOM dependency**, so it is trivially
  unit-testable in Node. Responsibilities: grayscale + threshold (dithering later), rotate
  (P-touch prints sideways — each printer raster line is one column across the tape),
  center within the printhead width, MSB-first bit packing into fixed-width rows.
- **Driver** (printer-language adapter). `Raster1bpp + JobOptions → Uint8Array`. Pure
  bytes-in/bytes-out, unit-testable against the documented command sequence. v1:
  `BrotherRasterDriver`. Future non-Brother languages: plug in `portakal`.
- **Transport** (thin, side-effecty). `open()`, `write(bytes)`, `read()`, `close()`.
  v1: `WebSerialTransport`. Mockable for tests. Later: WebBluetooth, USB, localhost bridge.
- **DeviceProfile** (data). Maps a known model to its geometry + which `(driver, transport)`
  it needs. A new printer is usually one profile entry reusing existing adapters.

### Brother PT-P710BT protocol (verbatim from reference; basis for the driver)

Printhead: **128 dots wide = 16 bytes per raster line**, 180 dpi. PackBits (TIFF) compression.
Print job byte sequence, in order:

1. Invalidate: `0x00` × 100
2. Initialize: `1B 40` (ESC @)
3. Status request: `1B 69 53` (ESC i S) → printer returns a 32-byte status packet
4. Raster mode: `1B 69 61 01`
5. Print info: `1B 69 7A 84 00 {widthMm} 00` + `rasterLineCount` (4-byte LE) + `00 00`
   - `widthMm` = tape width in mm (per the loaded tape)
   - `rasterLineCount` = number of 16-byte lines = label length in dots
6. Auto-cut mode: `1B 69 4D 40` (0x40 = auto-cut bit)
7. Advanced mode: `1B 69 4B 08`
8. Margin: `1B 69 64 00 00` (2-byte LE margin in dots)
9. Compression mode: `4D 02` (TIFF/PackBits)
10. Raster data, per line: `47 {len LE 2 bytes} {packbits(16-byte row)}`; blank line: `5A`
11. Print + feed + cut: `1A` (Control-Z)

### Primary types (sketch, names provisional)

```ts
interface RgbaImage { width: number; height: number; data: Uint8ClampedArray /* RGBA */ }
interface MediaSpec { dpi: number; printheadDots: number; printableDots: number; tapeWidthMm: number }
interface Raster1bpp { lineBytes: number; lineCount: number; rows: Uint8Array[] /* each lineBytes long, MSB-first */ }
interface JobOptions { tapeWidthMm: number; autoCut: boolean; marginDots: number }
interface Driver { encode(raster: Raster1bpp, opts: JobOptions): Uint8Array }
interface Transport { open(): Promise<void>; write(b: Uint8Array): Promise<void>; read(timeoutMs: number): Promise<Uint8Array>; close(): Promise<void> }
interface DeviceProfile { model: string; media: MediaSpec; makeDriver(): Driver; makeTransport(): Transport }
```

## v1 scope

Smallest path to printing on real hardware, with the spine + one of each adapter:

- **RasterCore** — RGBA → `Raster1bpp` at 180 dpi. Threshold for v1; dithering via `portakal` later.
- **PackBits encoder** — standard TIFF run-length, used per raster line.
- **`BrotherRasterDriver`** — emits the exact sequence above for the **Brother PT-P710BT**.
- **`WebSerialTransport`** — opens the OS-paired SPP serial port; chunked writes; status read.
- **One DeviceProfile** for the PT-P710BT.
- **Editor integration** — a Print affordance that renders the current label to RGBA at 180 dpi
  (off-screen, white background, no editor chrome), runs the job, and surfaces status errors.

## Dependencies

- **`portakal`** (MIT, npm, pure-TS, zero-dep) — later: RGBA→monochrome **dithering** and the
  on-ramp to every other printer *language* (ZPL, ESC/POS, TSC, EPL, CPCL, Star, …).
  Encoding-only (no transport) and **does not cover Brother P-touch/QL** — which is exactly why
  Brother is the commit-hard adapter and portakal handles the rest. Not a v1 dependency.
- **`niimbluelib`** — reference for a future Web Bluetooth transport + Niimbot driver.

## Buy vs. build summary

| Layer | v1 | Strategy |
|---|---|---|
| RasterCore (spine) | own | write; reuse `portakal` dithering later |
| PackBits encoder | own | write (standard algorithm) |
| Brother driver | own | **commit hard** — no web JS lib exists; bytes ported from reference |
| Other-language drivers | later | **plug in** `portakal` |
| Web Serial transport | own | write thin |
| Web Bluetooth / Niimbot / Zebra / DYMO | later | new adapters + profiles |

## Non-goals (v1, YAGNI)

- Web Bluetooth, WebUSB, and localhost-bridge transports (later; Web Serial covers the Cube Plus).
- Non-Brother drivers (deferred to `portakal` plug-in).
- Dithering UI controls.
- Final library packaging decision (separate repo/npm vs. internal module).
- Safari/Firefox support — Web Serial is Chromium-only.

## Error handling & status

Brother printers return a 32-byte status packet (errors: no media, cover open, wrong tape
width, busy) on the same channel. The job orchestrator reads status before/after printing and
surfaces typed errors to the editor. Serial specifics (port open, chunked writes, read timeout)
live entirely in `WebSerialTransport`.

## Testing strategy

- **PackBits & Driver**: pure bytes-in/bytes-out — golden tests against the documented sequence.
- **RasterCore**: deterministic unit tests over plain RGBA structs (no DOM).
- **Transport**: mocked `SerialPort` for unit tests; manual hardware verification on the PT-P710BT.
- **Editor render + end-to-end**: manual hardware verification (requires the device + OS pairing).

## Platform constraints

Chromium only (Chrome/Edge); Web Serial is unavailable in Safari/Firefox. The Cube Plus must be
**paired at the OS level first** so the virtual serial port exists. WebUSB is reserved for later
(printer-class is spooler-claimed on macOS/Windows). These are accepted limits of a zero-install
browser-direct approach; a future local bridge lifts them.

## References

- `pt-p710bt-label-maker` (Python, RFCOMM; source of the exact byte sequence) —
  https://github.com/robby-cornelissen/pt-p710bt-label-maker
- `brother_pt` (Python) — https://github.com/treideme/brother_pt
- `rust-ptouch` (Rust) — https://github.com/ryankurte/rust-ptouch
- `portakal` (universal printer-language SDK, TS) — https://github.com/productdevbook/portakal
- `niimblue` / `niimbluelib` (Web Bluetooth TS) — https://github.com/MultiMote/niimblue
- Brother "Raster Command Reference" (PT-P710BT) — Brother support site
