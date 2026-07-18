# obwat Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the printer stack into a standalone `~/src/obwat` package with a new `BrotherPrinter` facade, and rewire lbx-editor to consume it.

**Architecture:** Two layers per the approved spec (`docs/superpowers/specs/2026-07-18-obwat-design.md`): primitives move verbatim from `src/printing/`; a new connectionless facade (`createBrotherPrinter`) owns acquisition, transport selection, keepalive, and an internal mutex. lbx-editor keeps rendering (`labelRender.ts`, `textRender.ts`) and all UX policy.

**Tech Stack:** TypeScript (strict), Vitest, linked-package via `file:../obwat` + vite alias + tsconfig paths (same pattern as bil-lbx).

---

### Task 1: Scaffold the obwat repo

**Files:**
- Create: `~/src/obwat/package.json`, `~/src/obwat/tsconfig.json`, `~/src/obwat/vitest.config.ts`, `~/src/obwat/.gitignore`, `~/src/obwat/CLAUDE.md`

- [ ] **Step 1: Create repo**

```bash
mkdir -p ~/src/obwat/src && cd ~/src/obwat && git init -b main
```

- [ ] **Step 2: Write package.json** (mirrors bil-lbx; consumers alias `src/index.ts` so `dist` is optional but `build` must work)

```json
{
  "name": "obwat",
  "version": "0.1.0",
  "description": "O Brother Where Art Thou — Brother P-touch raster printing from the browser (WebUSB / Web Serial)",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "license": "MIT",
  "devDependencies": {
    "typescript": "^5.8.3",
    "vitest": "^2.1.9"
  }
}
```

- [ ] **Step 3: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "module": "esnext",
    "moduleResolution": "bundler",
    "target": "es2022",
    "lib": ["ES2022", "DOM"],
    "sourceMap": true,
    "declaration": true,
    "declarationMap": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "src/**/*.test.ts"]
}
```

(`DOM` lib because the transports type against `DataView`/streams and the facade against timers; everything device-shaped stays structural/injectable.)

- [ ] **Step 4: Write vitest.config.ts** (same shape as lbx-editor's)

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

- [ ] **Step 5: .gitignore** — `node_modules/`, `dist/`

- [ ] **Step 6: CLAUDE.md** — short: what obwat is, two-layer architecture, "no UX policy in this package" rule, PT-P710BT is the only profile, hardware doc pointer, linked-consumer note (lbx-editor).

- [ ] **Step 7: `npm install`, commit**

```bash
git add -A && git commit -m "Scaffold obwat package"
```

### Task 2: Move primitives + tests + docs into obwat

**Files:**
- Create (copy from `lbx-editor/src/printing/`): `src/types.ts`, `src/packbits.ts`, `src/rasterCore.ts`, `src/brotherDriver.ts`, `src/webUsbTransport.ts`, `src/webSerialTransport.ts`, `src/profiles.ts`, `src/printJob.ts`, `src/keepalive.ts`, plus their 8 `.test.ts` files and `smoke.test.ts`
- Create: `docs/hardware/pt-p710bt.md` (copy), `scripts/hardware-debug/` (copy all 3 files)
- Create: `src/index.ts`

- [ ] **Step 1: Copy files** (plain `cp` — cross-repo, no history to preserve)

```bash
cd ~/src/obwat
cp ~/src/lbx-editor/src/printing/{types,packbits,rasterCore,brotherDriver,webUsbTransport,webSerialTransport,profiles,printJob,keepalive}.ts src/
cp ~/src/lbx-editor/src/printing/*.test.ts src/
mkdir -p docs/hardware scripts
cp ~/src/lbx-editor/docs/hardware/pt-p710bt.md docs/hardware/
cp -R ~/src/lbx-editor/scripts/hardware-debug scripts/
```

Do NOT copy `labelRender.ts` (stays in the app).

- [ ] **Step 2: Write `src/index.ts`** — the old index minus `renderLabelToRgba`, plus the USB structural types the app needs directly:

```ts
export * from './types'
export { rgbaToRaster } from './rasterCore'
export { createBrotherRasterDriver, encodeStatusRequest } from './brotherDriver'
export { createWebSerialTransport } from './webSerialTransport'
export type { SerialPortLike } from './webSerialTransport'
export { createWebUsbTransport } from './webUsbTransport'
export type { UsbDeviceLike } from './webUsbTransport'
export { ptP710btProfile, ptP710btMedia } from './profiles'
export { printRaster } from './printJob'
export { startUsbKeepalive } from './keepalive'
export type { UsbKeepalive } from './keepalive'
```

(Facade exports are appended in Task 4.)

- [ ] **Step 3: Run tests** — `npx vitest run`. All copied tests pass unmodified (imports are all relative within the folder). Expected: 9 test files pass. `npx tsc --noEmit` may flag `smoke.test.ts` exclusion — tests are excluded from `tsc` build; run `npm run build` and expect clean `dist/`.

- [ ] **Step 4: Commit** — `Move printing primitives from lbx-editor`

### Task 3: Slim DeviceProfile (drop makeTransport)

**Files:**
- Modify: `src/types.ts` (DeviceProfile), `src/profiles.ts`, `src/profiles.test.ts`

- [ ] **Step 1: Update the failing test first** — in `profiles.test.ts`, change `ptP710btProfile(transport, 12)`-style calls to `ptP710btProfile(12)` and delete any `makeTransport` assertions. Run: expect FAIL (signature mismatch).

- [ ] **Step 2: Implement** — `types.ts`: remove `makeTransport(): Transport` from `DeviceProfile`. `profiles.ts`:

```ts
/** PT-P710BT profile: geometry + driver. Transport construction lives in the facade/caller. */
export function ptP710btProfile(tapeWidthMm: number): DeviceProfile {
  return {
    model: 'Brother PT-P710BT',
    media: ptP710btMedia(tapeWidthMm),
    makeDriver: () => createBrotherRasterDriver(),
  }
}
```

Remove the now-unused `Transport` import.

- [ ] **Step 3: Run tests** — expect PASS. **Step 4: Commit** — `Slim DeviceProfile to geometry + driver`

### Task 4: BrotherPrinter facade (TDD)

**Files:**
- Create: `src/printer.ts`, `src/printer.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write `src/printer.test.ts`** (fake usb modeled on `webUsbTransport.test.ts`'s `fakeDevice`):

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createBrotherPrinter, NoGrantedDeviceError, type UsbLike, type UsbDeviceWithVendor } from './printer'
import type { UsbConfigurationLike } from './webUsbTransport'
import type { Raster1bpp } from './types'

const PRINTER_CONFIG: UsbConfigurationLike = {
  configurationValue: 1,
  interfaces: [
    {
      interfaceNumber: 0,
      alternates: [
        {
          endpoints: [
            { endpointNumber: 2, direction: 'out', type: 'bulk' },
            { endpointNumber: 1, direction: 'in', type: 'bulk' },
          ],
        },
      ],
    },
  ],
}

/** 32-byte status reply: clean, 12 mm tape. */
function statusReply(): { status: string; data: DataView } {
  const bytes = new Uint8Array(32)
  bytes[10] = 12
  return { status: 'ok', data: new DataView(bytes.buffer) }
}

function fakeUsbDevice(): { device: UsbDeviceWithVendor; log: string[] } {
  const log: string[] = []
  let configured = false
  const device: UsbDeviceWithVendor = {
    vendorId: 0x04f9,
    get configuration() {
      return configured ? PRINTER_CONFIG : null
    },
    async open() { log.push('open') },
    async close() { log.push('close') },
    async selectConfiguration() { configured = true },
    async claimInterface() { log.push('claim') },
    async releaseInterface() { log.push('release') },
    async transferOut(_ep, data) {
      log.push(`out(${data.length})`)
      return { status: 'ok', bytesWritten: data.length }
    },
    async transferIn() {
      log.push('in')
      return statusReply()
    },
  }
  return { device, log }
}

function fakeUsb(devices: UsbDeviceWithVendor[]): UsbLike & { requested: number } {
  const usb = {
    requested: 0,
    async getDevices() { return devices },
    async requestDevice() {
      usb.requested++
      const { device } = fakeUsbDevice()
      devices.push(device)
      return device
    },
  }
  return usb
}

const raster: Raster1bpp = { lineBytes: 16, lineCount: 1, rows: [new Uint8Array(16)] }
const jobOpts = { tapeWidthMm: 12, autoCut: true, marginDots: 0 }

describe('createBrotherPrinter', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('print() with no granted device rejects NoGrantedDeviceError and never opens a picker', async () => {
    const usb = fakeUsb([])
    const printer = createBrotherPrinter({ usb, serial: null, keepaliveMs: 0 })
    await expect(printer.print(raster, jobOpts)).rejects.toBeInstanceOf(NoGrantedDeviceError)
    expect(usb.requested).toBe(0)
  })

  it('print() uses a granted device, returns parsed status, and notifies listeners', async () => {
    const { device } = fakeUsbDevice()
    const printer = createBrotherPrinter({ usb: fakeUsb([device]), serial: null, keepaliveMs: 0 })
    const seen: unknown[] = []
    printer.onStatus((s) => seen.push(s))
    const status = await printer.print(raster, jobOpts)
    expect(status.hasError).toBe(false)
    expect(status.mediaWidthMm).toBe(12)
    expect(seen).toHaveLength(1)
  })

  it('requestDevice() grants, then print() succeeds', async () => {
    const usb = fakeUsb([])
    const printer = createBrotherPrinter({ usb, serial: null, keepaliveMs: 0 })
    await expect(printer.requestDevice()).resolves.toBe(true)
    expect(usb.requested).toBe(1)
    await expect(printer.print(raster, jobOpts)).resolves.toMatchObject({ hasError: false })
  })

  it('serializes print() against an in-flight operation (mutex)', async () => {
    const { device, log } = fakeUsbDevice()
    const printer = createBrotherPrinter({ usb: fakeUsb([device]), serial: null, keepaliveMs: 0 })
    const first = printer.print(raster, jobOpts)
    const second = printer.print(raster, jobOpts)
    await Promise.all([first, second])
    // Each job strictly opens → claims → transfers → releases → closes before the next starts.
    const opens = log.map((entry, i) => (entry === 'open' ? i : -1)).filter((i) => i >= 0)
    const closes = log.map((entry, i) => (entry === 'close' ? i : -1)).filter((i) => i >= 0)
    expect(opens).toHaveLength(2)
    expect(closes[0]).toBeLessThan(opens[1])
  })

  it('keepalive polls on the interval and fans out status; dispose() stops it', async () => {
    const { device } = fakeUsbDevice()
    const printer = createBrotherPrinter({ usb: fakeUsb([device]), serial: null, keepaliveMs: 1000 })
    const seen: unknown[] = []
    printer.onStatus((s) => seen.push(s))
    await vi.advanceTimersByTimeAsync(2100)
    expect(seen.length).toBe(2)
    printer.dispose()
    await vi.advanceTimersByTimeAsync(3000)
    expect(seen.length).toBe(2)
  })

  it('keepalive notifies null when no device is present', async () => {
    const printer = createBrotherPrinter({ usb: fakeUsb([]), serial: null, keepaliveMs: 1000 })
    const seen: unknown[] = []
    printer.onStatus((s) => seen.push(s))
    await vi.advanceTimersByTimeAsync(1100)
    expect(seen).toEqual([null])
    printer.dispose()
  })

  it('onStatus unsubscribe stops callbacks; dispose() rejects further prints', async () => {
    const { device } = fakeUsbDevice()
    const printer = createBrotherPrinter({ usb: fakeUsb([device]), serial: null, keepaliveMs: 0 })
    const seen: unknown[] = []
    const off = printer.onStatus((s) => seen.push(s))
    off()
    await printer.print(raster, jobOpts)
    expect(seen).toHaveLength(0)
    printer.dispose()
    await expect(printer.print(raster, jobOpts)).rejects.toThrow('disposed')
  })
})
```

- [ ] **Step 2: Run** — `npx vitest run src/printer.test.ts` — expect FAIL (`./printer` not found).

- [ ] **Step 3: Write `src/printer.ts`:**

```ts
import type { JobOptions, PrinterStatus, Raster1bpp, Transport } from './types'
import { createBrotherRasterDriver, encodeStatusRequest } from './brotherDriver'
import { printRaster } from './printJob'
import { createWebUsbTransport, type UsbDeviceLike } from './webUsbTransport'
import { createWebSerialTransport, type SerialPortLike } from './webSerialTransport'

export const USB_VENDOR_BROTHER = 0x04f9

export type UsbDeviceWithVendor = UsbDeviceLike & { vendorId: number }

/** Structural subset of navigator.usb (injectable for tests). */
export interface UsbLike {
  getDevices(): Promise<UsbDeviceWithVendor[]>
  requestDevice(options: { filters: Array<{ vendorId: number }> }): Promise<UsbDeviceWithVendor>
}

/** Structural subset of navigator.serial (injectable for tests). */
export interface SerialLike {
  requestPort(): Promise<SerialPortLike>
}

/** print() found no already-granted device. The app decides picker vs. asleep-hint. */
export class NoGrantedDeviceError extends Error {
  constructor() {
    super('no granted printer device')
    this.name = 'NoGrantedDeviceError'
  }
}

export interface BrotherPrinterOptions {
  /** Status-poll interval that also keeps the printer awake; 0 disables. Default 60 s. */
  keepaliveMs?: number
  /** Override or disable (null) the WebUSB source. Default: navigator.usb when present. */
  usb?: UsbLike | null
  /** Override or disable (null) the Web Serial source. Default: navigator.serial when present. */
  serial?: SerialLike | null
}

export interface BrotherPrinter {
  /** Print via an already-granted device. Rejects NoGrantedDeviceError — never shows a picker. */
  print(raster: Raster1bpp, opts: JobOptions): Promise<PrinterStatus>
  /** Show the vendor-filtered picker (USB) or port picker (serial). Call inside a user gesture. */
  requestDevice(): Promise<boolean>
  /** One-shot status poll; null when the device is absent/unreachable (likely asleep). */
  queryStatus(): Promise<PrinterStatus | null>
  /** Fires after every print, keepalive tick, and queryStatus. Returns unsubscribe. */
  onStatus(cb: (status: PrinterStatus | null) => void): () => void
  dispose(): void
}

interface NavigatorLike {
  usb?: UsbLike
  serial?: SerialLike
}

/**
 * Connectionless session over a Brother P-touch printer. No consumer-visible
 * open/close: every operation acquires the device, claims, works, and releases,
 * serialized by an internal mutex — the printer auto-sleeps and vanishes from
 * enumeration, so "connected" is never a stable state worth exposing.
 */
export function createBrotherPrinter(options: BrotherPrinterOptions = {}): BrotherPrinter {
  const nav = (globalThis as { navigator?: NavigatorLike }).navigator
  const usb = options.usb === undefined ? (nav?.usb ?? null) : options.usb
  const serial = options.serial === undefined ? (nav?.serial ?? null) : options.serial
  const keepaliveMs = options.keepaliveMs ?? 60_000

  let serialPort: SerialPortLike | null = null
  let disposed = false
  const listeners = new Set<(status: PrinterStatus | null) => void>()
  const notify = (status: PrinterStatus | null) => {
    for (const cb of listeners) cb(status)
  }

  // Serializes device operations (prints, keepalive ticks, status polls) so a
  // claim is never attempted while another operation holds the interface.
  let chain: Promise<unknown> = Promise.resolve()
  const withLock = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn)
    chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  const grantedUsbDevice = async (): Promise<UsbDeviceWithVendor | null> =>
    usb ? ((await usb.getDevices()).find((d) => d.vendorId === USB_VENDOR_BROTHER) ?? null) : null

  /** Transport for an already-available device, or null when none. */
  const acquireTransport = async (): Promise<Transport | null> => {
    const device = await grantedUsbDevice()
    if (device) return createWebUsbTransport(device)
    if (serialPort) return createWebSerialTransport(serialPort, { baudRate: 9600 })
    return null
  }

  const pollStatus = async (): Promise<PrinterStatus | null> => {
    const transport = await acquireTransport()
    if (!transport) return null
    await transport.open()
    try {
      await transport.write(encodeStatusRequest())
      const raw = await transport.read(2000, 32)
      return createBrotherRasterDriver().parseStatus(raw)
    } finally {
      await transport.close().catch(() => {})
    }
  }

  const keepaliveTick = async () => {
    let status: PrinterStatus | null = null
    try {
      status = await pollStatus()
    } catch {
      status = null
    }
    notify(status)
  }

  let keepaliveHandle: ReturnType<typeof setInterval> | null = null
  if (keepaliveMs > 0) {
    keepaliveHandle = setInterval(() => {
      if (!disposed) void withLock(keepaliveTick)
    }, keepaliveMs)
  }

  const assertLive = () => {
    if (disposed) throw new Error('printer disposed')
  }

  return {
    print: (raster, opts) => {
      assertLive()
      return withLock(async () => {
        const transport = await acquireTransport()
        if (!transport) throw new NoGrantedDeviceError()
        const status = await printRaster(raster, {
          driver: createBrotherRasterDriver(),
          transport,
          opts,
        })
        notify(status)
        return status
      })
    },

    requestDevice: async () => {
      assertLive()
      // Deliberately NOT under the mutex: must run directly in the user
      // gesture, and the picker can stay open indefinitely.
      if (usb) {
        await usb.requestDevice({ filters: [{ vendorId: USB_VENDOR_BROTHER }] })
        return true
      }
      if (serial) {
        serialPort = await serial.requestPort()
        return true
      }
      throw new Error('neither WebUSB nor Web Serial is available')
    },

    queryStatus: () => {
      assertLive()
      return withLock(async () => {
        let status: PrinterStatus | null = null
        try {
          status = await pollStatus()
        } catch {
          status = null
        }
        notify(status)
        return status
      })
    },

    onStatus: (cb) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },

    dispose: () => {
      disposed = true
      if (keepaliveHandle !== null) clearInterval(keepaliveHandle)
      listeners.clear()
    },
  }
}
```

- [ ] **Step 4: Append facade exports to `src/index.ts`:**

```ts
export { createBrotherPrinter, NoGrantedDeviceError, USB_VENDOR_BROTHER } from './printer'
export type { BrotherPrinter, BrotherPrinterOptions, UsbLike, SerialLike, UsbDeviceWithVendor } from './printer'
```

- [ ] **Step 5: Run** — `npx vitest run` (all files) — expect PASS; `npm run build` — expect clean.

- [ ] **Step 6: Commit** — `Add BrotherPrinter connectionless facade`

### Task 5: Link obwat into lbx-editor and rewire the app

**Files:**
- Modify: `~/src/lbx-editor/package.json` (add `"obwat": "file:../obwat"` to dependencies)
- Modify: `~/src/lbx-editor/vite.config.ts` (alias), `~/src/lbx-editor/tsconfig.json` (paths)
- Move: `src/printing/labelRender.ts` → `src/labelRender.ts`
- Delete: `src/printing/` (everything else)
- Modify: `src/App.tsx`

- [ ] **Step 1: package.json + `npm install`** — add dep, run install (creates the symlink).

- [ ] **Step 2: vite.config.ts** — add to the alias array (before or after bil-lbx, order irrelevant):

```ts
{ find: 'obwat', replacement: resolve(__dirname, '../obwat/src/index.ts') },
```

- [ ] **Step 3: tsconfig.json paths** — add:

```json
"obwat": ["../obwat/src/index.ts"],
"obwat/*": ["../obwat/src/*"]
```

- [ ] **Step 4: Move labelRender**

```bash
cd ~/src/lbx-editor
git mv src/printing/labelRender.ts src/labelRender.ts
```

Fix its imports: `'../label'` → `'./label'`, `'../textRender'` → `'./textRender'`, `'./types'` → `obwat` (`import type { RgbaImage } from 'obwat'`).

- [ ] **Step 5: Rewire App.tsx.** Replace the `./printing` import block with:

```tsx
import {
  rgbaToRaster,
  ptP710btMedia,
  createBrotherPrinter,
  NoGrantedDeviceError,
  type BrotherPrinter,
  type PrinterStatus,
} from 'obwat';
import { renderLabelToRgba } from './labelRender';
```

Delete from App.tsx: `USB_VENDOR_BROTHER`, `UsbDeviceWithVendor`, `UsbNavigator`, `keepaliveRef`, and the keepalive `useEffect`. Keep `USB_GRANT_FLAG` and `AUTOCUT_KEY` (app policy).

Add printer lifecycle (one printer per mount, status subscription feeds the chip):

```tsx
const printerRef = useRef<BrotherPrinter | null>(null);
useEffect(() => {
  const printer = createBrotherPrinter();
  printerRef.current = printer;
  const off = printer.onStatus((status) => {
    setPrinterReachable(status !== null);
    if (status !== null) setPrinterLastSeen({ status, at: Date.now() });
  });
  return () => {
    off();
    printerRef.current = null;
    printer.dispose();
  };
}, []);
```

Replace `handlePrint` with:

```tsx
const handlePrint = useCallback(async () => {
  if (printingRef.current) return;
  const printer = printerRef.current;
  if (!printer) return;
  const tapeWidthMm = parseInt(tapeSize, 10);
  if (!('usb' in navigator) && !('serial' in navigator)) {
    alert('Neither WebUSB nor Web Serial is supported in this browser. Use Chrome or Edge.');
    return;
  }
  setPrinting(true);
  printingRef.current = true;
  try {
    const media = ptP710btMedia(tapeWidthMm);
    // Render order (layer-major DFS preorder), not Map insertion order, so
    // printed stacking matches what's on screen after any z-reorder.
    const nodes = Array.from(scene.renderOrder(), (id) => scene.nodes.get(id)!);
    const rgba = renderLabelToRgba({
      nodes,
      labelLengthPt: labelLength,
      tapeWidthPt: paperHeight,
      printableDots: media.printableDots,
      dpi: media.dpi,
      getImageBitmap: (node) =>
        node.data.kind === 'image'
          ? getImageBitmap(node.data.src, node.data.mimeType) ?? undefined
          : undefined,
    });
    const raster = rgbaToRaster(rgba, media);
    const jobOpts = { tapeWidthMm, autoCut, marginDots: 0 };

    let status: PrinterStatus;
    try {
      status = await printer.print(raster, jobOpts);
    } catch (err) {
      if (!(err instanceof NoGrantedDeviceError)) throw err;
      if (localStorage.getItem(USB_GRANT_FLAG)) {
        // One-shot hint: clearing the flag means a repeat click falls through to
        // the picker, so a revoked permission can't dead-end the Print button.
        localStorage.removeItem(USB_GRANT_FLAG);
        alert('Printer not found — it may have auto-powered off. Press its power button, then print again.');
        return;
      }
      await printer.requestDevice();
      status = await printer.print(raster, jobOpts);
    }
    // A grant exists (print succeeded) — remember for the asleep-vs-never-granted hint.
    if ('usb' in navigator) localStorage.setItem(USB_GRANT_FLAG, '1');
    if (status.hasError) {
      alert('Printer reported an error (check tape/cover).');
    } else if (status.incomplete) {
      alert('Print sent, but the printer status reply was incomplete — check the printer.');
    }
  } catch (err) {
    // Dismissing the device/port picker is a normal cancel, not a failure.
    if (err instanceof DOMException && err.name === 'NotFoundError') return;
    alert(`Print failed: ${(err as Error).message}`);
  } finally {
    printingRef.current = false;
    setPrinting(false);
  }
}, [printing, tapeSize, scene, labelLength, paperHeight, autoCut]);
```

(Behavior notes vs. today: the facade's mutex replaces the explicit `keepalive.idle()` await; `setPrinterLastSeen`/`setPrinterReachable` after a print now happen via the `onStatus` subscription instead of inline. The unsupported-browser alert stays app-side.)

- [ ] **Step 6: Delete the rest of `src/printing/`**

```bash
git rm -r src/printing
```

- [ ] **Step 7: Verify** — `npx tsc --noEmit` clean; `npx vitest run` (remaining app tests: label, textRender pass); `npm run build` clean.

- [ ] **Step 8: Commit** — `Consume obwat; delete src/printing`

### Task 6: Docs + index sync

**Files:**
- Modify: `~/src/lbx-editor/CLAUDE.md` (architecture: add obwat to consumed packages; current-state note), `~/src/lbx-editor/docs/superpowers/plans/2026-07-18-eod-handoff.md` (mark open item 1 done)
- Modify: `~/src/PROJECTS.md` (add obwat line)
- Delete (moved): `~/src/lbx-editor/docs/hardware/pt-p710bt.md`, `~/src/lbx-editor/scripts/hardware-debug/` — replace doc with a one-line pointer file OR update references in the handoff to point at obwat. Preference: leave a stub `docs/hardware/pt-p710bt.md` containing "Moved to ~/src/obwat/docs/hardware/pt-p710bt.md" to keep old links from dangling.

- [ ] **Step 1: Make the doc/index edits.** **Step 2: Commit both repos.** obwat: `Add hardware doc + debug scripts` (if not already in Task 2 commit). lbx-editor: `Point docs at obwat; update handoff`.

### Task 7: Final verification

- [ ] obwat: `npx vitest run` (expect 10 files incl. printer.test), `npm run build` clean.
- [ ] lbx-editor: `npx tsc --noEmit`, `npx vitest run`, `npm run build` all clean.
- [ ] `npm run dev` boots; page loads (browser check optional — real print requires hardware; note in handoff that a hardware re-verify of the facade path is pending).
