# WebUSB Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Print button work over a USB cable via WebUSB (USB-first with Web Serial fallback), plus a keepalive that stops the PT-P710BT from auto-powering off while the app is open.

**Architecture:** A new `webUsbTransport.ts` implements the existing `Transport` interface over `navigator.usb` (structural `UsbDeviceLike` for testability, endpoints discovered from descriptors). `ptP710btProfile` becomes transport-agnostic (takes a built `Transport`). `App.tsx` picks USB when available (granted device → zero-click; else vendor-filtered picker) and falls back to Web Serial. A `keepalive.ts` polls printer status every 5 min with a briefly-claimed connection.

**Tech Stack:** TypeScript, React, Vitest (existing setup — `npm test`, `npm run build`). Spec: `docs/superpowers/specs/2026-07-18-webusb-transport-design.md`. Hardware facts: `docs/hardware/pt-p710bt.md`.

**Conventions:** every commit ends with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer. No inline styles. Never import non-public/`@internal` API into consumer code.

---

### Task 1: WebUSB transport

**Files:**
- Create: `src/printing/webUsbTransport.ts`
- Test: `src/printing/webUsbTransport.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/printing/webUsbTransport.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { createWebUsbTransport, type UsbDeviceLike, type UsbConfigurationLike } from './webUsbTransport'

/** Endpoint layout matching the real PT-P710BT (bulk OUT 0x02, bulk IN 0x81). */
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

function dataView(bytes: number[]): DataView {
  return new DataView(Uint8Array.from(bytes).buffer)
}

function fakeDevice(opts: { config?: UsbConfigurationLike | null; preConfigured?: boolean } = {}) {
  const config = opts.config === undefined ? PRINTER_CONFIG : opts.config
  const calls: string[] = []
  const written: Array<{ endpoint: number; bytes: Uint8Array }> = []
  const reads: Array<{ status: string; data?: DataView }> = []
  let configured = opts.preConfigured ?? false

  const device: UsbDeviceLike = {
    get configuration() {
      return configured ? config : null
    },
    async open() { calls.push('open') },
    async close() { calls.push('close') },
    async selectConfiguration(value: number) {
      calls.push(`selectConfiguration(${value})`)
      configured = true
    },
    async claimInterface(num: number) { calls.push(`claimInterface(${num})`) },
    async releaseInterface(num: number) { calls.push(`releaseInterface(${num})`) },
    async transferOut(endpoint: number, data: Uint8Array) {
      written.push({ endpoint, bytes: data })
      return { status: 'ok' as const, bytesWritten: data.length }
    },
    async transferIn() {
      const next = reads.shift()
      if (!next) return new Promise(() => {}) // hang, simulating no data — read() must time out
      return next
    },
  }
  return { device, calls, written, reads }
}

describe('WebUsbTransport', () => {
  it('open() selects configuration 1 when unset, claims the interface; close() releases and closes', async () => {
    const { device, calls } = fakeDevice()
    const t = createWebUsbTransport(device)
    await t.open()
    expect(calls).toEqual(['open', 'selectConfiguration(1)', 'claimInterface(0)'])
    await t.close()
    expect(calls).toEqual(['open', 'selectConfiguration(1)', 'claimInterface(0)', 'releaseInterface(0)', 'close'])
  })

  it('open() skips selectConfiguration when a configuration is already active', async () => {
    const { device, calls } = fakeDevice({ preConfigured: true })
    const t = createWebUsbTransport(device)
    await t.open()
    expect(calls).toEqual(['open', 'claimInterface(0)'])
  })

  it('open() discovers the bulk pair on a later interface and write() uses its OUT endpoint', async () => {
    const config: UsbConfigurationLike = {
      configurationValue: 1,
      interfaces: [
        {
          interfaceNumber: 0,
          alternates: [
            { endpoints: [{ endpointNumber: 3, direction: 'in', type: 'interrupt' }] },
          ],
        },
        {
          interfaceNumber: 1,
          alternates: [
            {
              endpoints: [
                { endpointNumber: 5, direction: 'in', type: 'bulk' },
                { endpointNumber: 4, direction: 'out', type: 'bulk' },
              ],
            },
          ],
        },
      ],
    }
    const { device, calls, written } = fakeDevice({ config, preConfigured: true })
    const t = createWebUsbTransport(device)
    await t.open()
    expect(calls).toContain('claimInterface(1)')
    await t.write(Uint8Array.from([1, 2, 3]))
    expect(written[0].endpoint).toBe(4)
  })

  it('open() throws when no interface has both bulk endpoints', async () => {
    const config: UsbConfigurationLike = {
      configurationValue: 1,
      interfaces: [
        {
          interfaceNumber: 0,
          alternates: [
            { endpoints: [{ endpointNumber: 1, direction: 'in', type: 'bulk' }] },
          ],
        },
      ],
    }
    const { device } = fakeDevice({ config, preConfigured: true })
    const t = createWebUsbTransport(device)
    await expect(t.open()).rejects.toThrow('no USB interface with bulk IN and OUT endpoints')
  })

  it('write() sends the bytes to the bulk OUT endpoint', async () => {
    const { device, written } = fakeDevice()
    const t = createWebUsbTransport(device)
    await t.open()
    await t.write(Uint8Array.from([9, 8, 7]))
    expect(written).toHaveLength(1)
    expect(written[0].endpoint).toBe(2)
    expect(Array.from(written[0].bytes)).toEqual([9, 8, 7])
  })

  it('write() throws on a non-ok transfer status', async () => {
    const { device } = fakeDevice()
    device.transferOut = async () => ({ status: 'stall', bytesWritten: 0 })
    const t = createWebUsbTransport(device)
    await t.open()
    await expect(t.write(Uint8Array.from([1]))).rejects.toThrow('USB write failed: stall')
  })

  it('write() throws on a short write', async () => {
    const { device } = fakeDevice()
    device.transferOut = async (_ep: number, data: Uint8Array) => ({ status: 'ok', bytesWritten: data.length - 1 })
    const t = createWebUsbTransport(device)
    await t.open()
    await expect(t.write(Uint8Array.from([1, 2]))).rejects.toThrow('USB short write: 1/2')
  })

  it('read() accumulates chunks until minBytes', async () => {
    const { device, reads } = fakeDevice()
    reads.push({ status: 'ok', data: dataView([1, 2]) }, { status: 'ok', data: dataView([3, 4, 5]) })
    const t = createWebUsbTransport(device)
    await t.open()
    const got = await t.read(1000, 5)
    expect(Array.from(got)).toEqual([1, 2, 3, 4, 5])
  })

  it('read() times out and returns what accumulated', async () => {
    const { device, reads } = fakeDevice()
    reads.push({ status: 'ok', data: dataView([1]) })
    // second transferIn hangs — the deadline must fire
    const t = createWebUsbTransport(device)
    await t.open()
    const got = await t.read(50, 32)
    expect(Array.from(got)).toEqual([1])
  })

  it('write() and read() throw before open()', async () => {
    const { device } = fakeDevice()
    const t = createWebUsbTransport(device)
    await expect(t.write(Uint8Array.from([1]))).rejects.toThrow('USB transport not open')
    await expect(t.read(10)).rejects.toThrow('USB transport not open')
  })

  it('read() stops early on a non-ok transfer status and returns the partial data', async () => {
    const { device, reads } = fakeDevice()
    reads.push({ status: 'stall', data: dataView([1, 2]) })
    const t = createWebUsbTransport(device)
    await t.open()
    const got = await t.read(1000, 32)
    expect(Array.from(got)).toEqual([1, 2])
  })

  it('open() failure at claimInterface leaves the transport unopened', async () => {
    const { device } = fakeDevice()
    device.claimInterface = async () => {
      throw new Error('claim denied')
    }
    const t = createWebUsbTransport(device)
    await expect(t.open()).rejects.toThrow('claim denied')
    await expect(t.write(Uint8Array.from([1]))).rejects.toThrow('USB transport not open')
    await t.close() // must not throw; nothing was claimed
  })

  it('close() swallows releaseInterface and close failures', async () => {
    const { device } = fakeDevice()
    device.releaseInterface = async () => {
      throw new Error('release failed')
    }
    device.close = async () => {
      throw new Error('close failed')
    }
    const t = createWebUsbTransport(device)
    await t.open()
    await expect(t.close()).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/printing/webUsbTransport.test.ts`
Expected: FAIL — cannot resolve `./webUsbTransport`.

- [ ] **Step 3: Implement the transport**

Create `src/printing/webUsbTransport.ts`:

```typescript
import type { Transport } from './types'

/** Minimal structural subset of WebUSB's `USBDevice` we depend on (testable with a plain fake). */
export interface UsbEndpointLike {
  endpointNumber: number
  direction: 'in' | 'out'
  type: 'bulk' | 'interrupt' | 'isochronous'
}

export interface UsbInterfaceLike {
  interfaceNumber: number
  alternates: Array<{ endpoints: UsbEndpointLike[] }>
}

export interface UsbConfigurationLike {
  configurationValue: number
  interfaces: UsbInterfaceLike[]
}

export interface UsbDeviceLike {
  readonly configuration: UsbConfigurationLike | null
  open(): Promise<void>
  close(): Promise<void>
  selectConfiguration(value: number): Promise<void>
  claimInterface(interfaceNumber: number): Promise<void>
  releaseInterface(interfaceNumber: number): Promise<void>
  transferOut(endpointNumber: number, data: Uint8Array): Promise<{ status?: string; bytesWritten: number }>
  transferIn(endpointNumber: number, length: number): Promise<{ status?: string; data?: DataView }>
}

const READ_PACKET_SIZE = 64 // PT-P710BT bulk max packet size; fine for any full-speed device

export function createWebUsbTransport(device: UsbDeviceLike): Transport {
  let claimed: { interfaceNumber: number; epIn: number; epOut: number } | null = null

  return {
    async open() {
      await device.open()
      if (device.configuration === null) await device.selectConfiguration(1)
      const config = device.configuration
      if (!config) throw new Error('USB device has no active configuration')
      let found: { interfaceNumber: number; epIn: number; epOut: number } | null = null
      for (const iface of config.interfaces) {
        const endpoints = iface.alternates[0]?.endpoints ?? []
        const bulkIn = endpoints.find((e) => e.type === 'bulk' && e.direction === 'in')
        const bulkOut = endpoints.find((e) => e.type === 'bulk' && e.direction === 'out')
        if (bulkIn && bulkOut) {
          found = {
            interfaceNumber: iface.interfaceNumber,
            epIn: bulkIn.endpointNumber,
            epOut: bulkOut.endpointNumber,
          }
          break
        }
      }
      if (!found) throw new Error('no USB interface with bulk IN and OUT endpoints')
      await device.claimInterface(found.interfaceNumber)
      claimed = found
    },

    async write(bytes: Uint8Array) {
      if (!claimed) throw new Error('USB transport not open')
      // Chromium packetizes a large transferOut internally; jobs are a few KB.
      const result = await device.transferOut(claimed.epOut, bytes)
      if (result.status !== 'ok') throw new Error(`USB write failed: ${result.status}`)
      if (result.bytesWritten !== bytes.length)
        throw new Error(`USB short write: ${result.bytesWritten}/${bytes.length}`)
    },

    async read(timeoutMs: number, minBytes: number = 1) {
      if (!claimed) throw new Error('USB transport not open')
      const deadline = Date.now() + timeoutMs
      const accumulated: number[] = []
      while (accumulated.length < minBytes) {
        const remainingMs = deadline - Date.now()
        if (remainingMs <= 0) break
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null
        // WebUSB has no native transfer timeout. On deadline we abandon the pending
        // transferIn; close() (device.close) tears it down — like the serial
        // transport, read() is effectively single-use per open().
        let result: { status?: string; data?: DataView } | null
        try {
          result = await Promise.race([
            device.transferIn(claimed.epIn, READ_PACKET_SIZE),
            new Promise<null>((resolve) => {
              timeoutHandle = setTimeout(() => resolve(null), remainingMs)
            }),
          ])
        } finally {
          if (timeoutHandle !== null) clearTimeout(timeoutHandle)
        }
        if (result === null) break
        if (result.data) {
          for (let i = 0; i < result.data.byteLength; i++) accumulated.push(result.data.getUint8(i))
        }
        if (result.status !== 'ok') break // stall/babble: stop and return what we have
      }
      return new Uint8Array(accumulated)
    },

    async close() {
      // Best-effort on both halves: a close failure must not mask the job's outcome.
      if (claimed) {
        await device.releaseInterface(claimed.interfaceNumber).catch(() => {})
        claimed = null
      }
      await device.close().catch(() => {})
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/printing/webUsbTransport.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/printing/webUsbTransport.ts src/printing/webUsbTransport.test.ts
git commit -m "Add WebUSB transport implementing the Transport interface"
```

---

### Task 2: Transport-agnostic profile + export surface

**Files:**
- Modify: `src/printing/profiles.ts` (signature of `ptP710btProfile`)
- Modify: `src/printing/index.ts` (exports)
- Modify: `src/App.tsx:408-412` (call site keeps working via explicit serial transport)

- [ ] **Step 1: Change the profile signature**

In `src/printing/profiles.ts`, replace the import of `createWebSerialTransport`/`SerialPortLike` and the `ptP710btProfile` function:

```typescript
import type { DeviceProfile, MediaSpec, Transport } from './types'
import { createBrotherRasterDriver } from './brotherDriver'
```

```typescript
/** A PT-P710BT profile bound to an already-constructed transport (USB, serial, …). */
export function ptP710btProfile(transport: Transport, tapeWidthMm: number): DeviceProfile {
  return {
    model: 'Brother PT-P710BT',
    media: ptP710btMedia(tapeWidthMm),
    makeDriver: () => createBrotherRasterDriver(),
    makeTransport: () => transport,
  }
}
```

- [ ] **Step 2: Export the new transport from the module**

In `src/printing/index.ts`, add after the web-serial exports:

```typescript
export { createWebUsbTransport } from './webUsbTransport'
export type { UsbDeviceLike } from './webUsbTransport'
```

- [ ] **Step 3: Update the App call site (serial path stays functional)**

In `src/App.tsx`, extend the printing import with `createWebSerialTransport`:

```typescript
import {
  renderLabelToRgba,
  rgbaToRaster,
  ptP710btProfile,
  printRaster,
  createWebSerialTransport,
  type SerialPortLike,
} from './printing';
```

and change the two lines after `requestPort()` (currently `const profile = ptP710btProfile(port, tapeWidthMm);`):

```typescript
      const transport = createWebSerialTransport(port, { baudRate: 9600 });
      const profile = ptP710btProfile(transport, tapeWidthMm);
```

- [ ] **Step 4: Verify suite and build**

Run: `npm test && npm run build`
Expected: all tests pass (35 existing + 13 new), build clean.

- [ ] **Step 5: Commit**

```bash
git add src/printing/profiles.ts src/printing/index.ts src/App.tsx
git commit -m "Make ptP710btProfile transport-agnostic"
```

---

### Task 3: USB-first print flow

**Files:**
- Modify: `src/App.tsx` (handlePrint, imports, small helpers above the component)

- [ ] **Step 1: Add USB types/constants and rewrite handlePrint**

In `src/App.tsx`, extend the printing import with the USB transport and `Transport` type:

```typescript
import {
  renderLabelToRgba,
  rgbaToRaster,
  ptP710btProfile,
  printRaster,
  createWebSerialTransport,
  createWebUsbTransport,
  type SerialPortLike,
  type Transport,
  type UsbDeviceLike,
} from './printing';
```

Add near the other module-level constants (after `const FIT_PADDING = 16;`):

```typescript
const USB_VENDOR_BROTHER = 0x04f9;
/** Set once a USB device grant exists; lets us distinguish "printer asleep" from "never granted". */
const USB_GRANT_FLAG = 'lbx-editor.hasUsbGrant';

type UsbDeviceWithVendor = UsbDeviceLike & { vendorId: number };
interface UsbNavigator {
  usb: {
    getDevices(): Promise<UsbDeviceWithVendor[]>;
    requestDevice(options: { filters: Array<{ vendorId: number }> }): Promise<UsbDeviceWithVendor>;
  };
}
```

Replace the body of `handlePrint` (keep `printing` guard, `tapeWidthMm` parse, and everything from `const nodes = …` down unchanged) so the transport-selection section reads:

```typescript
  const handlePrint = useCallback(async () => {
    if (printing) return;
    const tapeWidthMm = parseInt(tapeSize, 10);
    const hasWebUsb = 'usb' in navigator;
    if (!hasWebUsb && !('serial' in navigator)) {
      alert('Neither WebUSB nor Web Serial is supported in this browser. Use Chrome or Edge.');
      return;
    }
    setPrinting(true);
    try {
      let transport: Transport;
      if (hasWebUsb) {
        const usb = (navigator as unknown as UsbNavigator).usb;
        // Previously-granted device → zero-click print. getDevices() is fast, so the
        // user activation survives for requestDevice below when we need the picker.
        let device =
          (await usb.getDevices()).find((d) => d.vendorId === USB_VENDOR_BROTHER) ?? null;
        if (!device) {
          if (localStorage.getItem(USB_GRANT_FLAG)) {
            // One-shot hint: clearing the flag means a repeat click falls through to
            // the picker, so a revoked permission can't dead-end the Print button.
            localStorage.removeItem(USB_GRANT_FLAG);
            alert(
              'Printer not found — it may have auto-powered off. Press its power button, then print again.',
            );
            return;
          }
          device = await usb.requestDevice({ filters: [{ vendorId: USB_VENDOR_BROTHER }] });
        }
        // A grant now exists (or was reconfirmed) — remember for the asleep-vs-never-granted hint.
        localStorage.setItem(USB_GRANT_FLAG, '1');
        transport = createWebUsbTransport(device);
      } else {
        // User gesture: choose the OS-paired PT-P710BT serial port. Must stay
        // directly in the click handler chain (no long await before it).
        const port = await (
          navigator as unknown as { serial: { requestPort(): Promise<SerialPortLike> } }
        ).serial.requestPort();
        transport = createWebSerialTransport(port, { baudRate: 9600 });
      }

      const profile = ptP710btProfile(transport, tapeWidthMm);
```

After the existing `const status = await printRaster(…)` call, extend the result handling:

```typescript
      if (status.hasError) {
        alert('Printer reported an error (check tape/cover).');
      } else if (status.incomplete) {
        alert('Print sent, but the printer status reply was incomplete — check the printer.');
      }
```

The `catch` block's comment changes to reflect both pickers (`NotFoundError` covers both the serial picker cancel and the USB picker cancel/empty-chooser dismiss):

```typescript
    } catch (err) {
      // Dismissing the device/port picker is a normal cancel, not a failure.
      if (err instanceof DOMException && err.name === 'NotFoundError') return;
```

- [ ] **Step 2: Verify suite and build**

Run: `npm test && npm run build`
Expected: green. (The flow itself is exercised on hardware in Task 5.)

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "Print over WebUSB when available, serial as fallback"
```

---

### Task 4: Keepalive

**Files:**
- Modify: `src/printing/brotherDriver.ts` (export status-request builder)
- Create: `src/printing/keepalive.ts`
- Test: `src/printing/keepalive.test.ts`
- Modify: `src/printing/index.ts`, `src/App.tsx` (wiring)

- [ ] **Step 1: Export the status request from the driver**

In `src/printing/brotherDriver.ts`, add above `createBrotherRasterDriver`:

```typescript
/** Stand-alone status query: 100-byte invalidate + initialize (ESC @) + status request (ESC i S). */
export function encodeStatusRequest(): Uint8Array {
  const out = new Uint8Array(105)
  out.set([0x1b, 0x40, 0x1b, 0x69, 0x53], 100)
  return out
}
```

- [ ] **Step 2: Write the failing keepalive tests**

Create `src/printing/keepalive.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { startUsbKeepalive } from './keepalive'
import type { UsbDeviceLike, UsbConfigurationLike } from './webUsbTransport'

const CONFIG: UsbConfigurationLike = {
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

function fakeDevice(statusBytes: number[]) {
  const written: Uint8Array[] = []
  const device: UsbDeviceLike = {
    configuration: CONFIG,
    async open() {},
    async close() {},
    async selectConfiguration() {},
    async claimInterface() {},
    async releaseInterface() {},
    async transferOut(_ep, data) {
      written.push(data)
      return { status: 'ok', bytesWritten: data.length }
    },
    async transferIn() {
      return { status: 'ok', data: new DataView(Uint8Array.from(statusBytes).buffer) }
    },
  }
  return { device, written }
}

const FULL_STATUS = Array.from({ length: 32 }, (_, i) => (i === 0 ? 0x80 : 0))

describe('startUsbKeepalive', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('polls status on each tick and reports it', async () => {
    const { device, written } = fakeDevice(FULL_STATUS)
    const statuses: unknown[] = []
    const { stop } = startUsbKeepalive({
      getDevice: async () => device,
      isBusy: () => false,
      intervalMs: 1000,
      onStatus: (s) => statuses.push(s),
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(written).toHaveLength(1)
    // invalidate + init + ESC i S
    expect(written[0].length).toBe(105)
    expect(Array.from(written[0].slice(100))).toEqual([0x1b, 0x40, 0x1b, 0x69, 0x53])
    expect(statuses).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(written).toHaveLength(2)
    stop()
  })

  it('skips ticks while busy', async () => {
    const { device, written } = fakeDevice(FULL_STATUS)
    let busy = true
    const { stop } = startUsbKeepalive({
      getDevice: async () => device,
      isBusy: () => busy,
      intervalMs: 1000,
    })
    await vi.advanceTimersByTimeAsync(2000)
    expect(written).toHaveLength(0)
    busy = false
    await vi.advanceTimersByTimeAsync(1000)
    expect(written).toHaveLength(1)
    stop()
  })

  it('skips ticks when no device is granted', async () => {
    let calls = 0
    const { stop } = startUsbKeepalive({
      getDevice: async () => {
        calls++
        return null
      },
      isBusy: () => false,
      intervalMs: 1000,
    })
    await vi.advanceTimersByTimeAsync(3000)
    expect(calls).toBe(3) // looked, found nothing, did not blow up
    stop()
  })

  it('swallows tick errors', async () => {
    const { stop } = startUsbKeepalive({
      getDevice: async () => {
        throw new Error('boom')
      },
      isBusy: () => false,
      intervalMs: 1000,
    })
    await expect(vi.advanceTimersByTimeAsync(1000)).resolves.not.toThrow()
    stop()
  })

  it('stop() halts polling', async () => {
    const { device, written } = fakeDevice(FULL_STATUS)
    const { stop } = startUsbKeepalive({
      getDevice: async () => device,
      isBusy: () => false,
      intervalMs: 1000,
    })
    await vi.advanceTimersByTimeAsync(1000)
    stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(written).toHaveLength(1)
  })

  it('idle() resolves immediately when no tick is in flight', async () => {
    const { device } = fakeDevice(FULL_STATUS)
    const keepalive = startUsbKeepalive({
      getDevice: async () => device,
      isBusy: () => false,
      intervalMs: 1000,
    })
    await expect(keepalive.idle()).resolves.toBeUndefined()
    keepalive.stop()
  })

  it('idle() waits for the in-flight tick to finish', async () => {
    let releaseRead: (() => void) | undefined
    const { device } = fakeDevice(FULL_STATUS)
    const originalTransferIn = device.transferIn.bind(device)
    device.transferIn = async (ep, len) => {
      await new Promise<void>((resolve) => {
        releaseRead = resolve
      })
      return originalTransferIn(ep, len)
    }
    const keepalive = startUsbKeepalive({
      getDevice: async () => device,
      isBusy: () => false,
      intervalMs: 1000,
    })
    await vi.advanceTimersByTimeAsync(1000) // tick starts, parked inside transferIn
    let idleResolved = false
    const idlePromise = keepalive.idle().then(() => {
      idleResolved = true
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(idleResolved).toBe(false)
    releaseRead?.()
    await vi.advanceTimersByTimeAsync(0)
    await idlePromise
    expect(idleResolved).toBe(true)
    keepalive.stop()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/printing/keepalive.test.ts`
Expected: FAIL — cannot resolve `./keepalive`.

- [ ] **Step 4: Implement keepalive**

Create `src/printing/keepalive.ts`:

```typescript
import type { PrinterStatus } from './types'
import { createBrotherRasterDriver, encodeStatusRequest } from './brotherDriver'
import { createWebUsbTransport, type UsbDeviceLike } from './webUsbTransport'

export interface UsbKeepaliveOptions {
  /** Resolve the currently-granted printer, or null when absent/asleep. */
  getDevice(): Promise<UsbDeviceLike | null>
  /** True while a print job is running — the tick yields to it. */
  isBusy(): boolean
  intervalMs?: number
  onStatus?(status: PrinterStatus): void
}

export interface UsbKeepalive {
  /** Stop polling. */
  stop(): void
  /** Resolves once any in-flight tick has finished (immediately when idle). */
  idle(): Promise<void>
}

/**
 * Periodically round-trips a status request so the PT-P710BT's idle
 * auto-power-off timer keeps getting reset while the app is open. The claim is
 * held only for the duration of one poll so other software can use the printer
 * between ticks. Opportunistic: every failure is swallowed. Callers that need
 * exclusive device access await `idle()` first.
 */
export function startUsbKeepalive(options: UsbKeepaliveOptions): UsbKeepalive {
  const intervalMs = options.intervalMs ?? 5 * 60_000
  let inFlight: Promise<void> | null = null

  const tick = async () => {
    try {
      const device = await options.getDevice()
      if (!device) return
      const transport = createWebUsbTransport(device)
      await transport.open()
      try {
        await transport.write(encodeStatusRequest())
        const raw = await transport.read(2000, 32)
        options.onStatus?.(createBrotherRasterDriver().parseStatus(raw))
      } finally {
        await transport.close()
      }
    } catch (err) {
      console.warn('USB keepalive tick failed:', err)
    }
  }

  const runTick = () => {
    if (inFlight || options.isBusy()) return
    inFlight = tick().finally(() => {
      inFlight = null
    })
  }

  const handle = setInterval(runTick, intervalMs)
  return {
    stop: () => clearInterval(handle),
    idle: () => inFlight ?? Promise.resolve(),
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/printing/keepalive.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Export and wire into the app**

In `src/printing/index.ts` add:

```typescript
export { startUsbKeepalive } from './keepalive'
export type { UsbKeepalive } from './keepalive'
export { encodeStatusRequest } from './brotherDriver'
```

(Adjust the existing `createBrotherRasterDriver` export line to keep one export per module if it already exports from `./brotherDriver` — merge into a single line: `export { createBrotherRasterDriver, encodeStatusRequest } from './brotherDriver'` and drop the separate line added above.)

In `src/App.tsx`: import `startUsbKeepalive` and `type UsbKeepalive` (add to the `./printing` import list), add `useRef`-based busy tracking, a ref to hold the keepalive handle, and the effect. Next to `const [printing, setPrinting] = useState(false);`:

```typescript
  const printingRef = useRef(false);
  const keepaliveRef = useRef<UsbKeepalive | null>(null);
```

At the top of `handlePrint`'s `try` block (right after `setPrinting(true);`), await any in-flight tick before claiming the device:

```typescript
    try {
      printingRef.current = true;
      // Let any in-flight keepalive poll release the interface before we claim it
      // (≤2 s worst case; Chrome's user-activation window comfortably outlives it).
      await keepaliveRef.current?.idle();
```

and in the `finally`, before `setPrinting(false);`, add `printingRef.current = false;` — the busy flag is now set/cleared entirely inside `handlePrint`'s try/finally rather than via a render-phase ref write.

After `handlePrint`'s definition add:

```typescript
  // Keep the printer awake (it auto-powers off after ~10 min idle) while the
  // app is open and a USB grant exists. See docs/hardware/pt-p710bt.md.
  useEffect(() => {
    if (!('usb' in navigator)) return;
    const usb = (navigator as unknown as UsbNavigator).usb;
    const keepalive = startUsbKeepalive({
      getDevice: async () =>
        (await usb.getDevices()).find((d) => d.vendorId === USB_VENDOR_BROTHER) ?? null,
      isBusy: () => printingRef.current,
    });
    keepaliveRef.current = keepalive;
    return () => {
      keepaliveRef.current = null;
      keepalive.stop();
    };
  }, []);
```

(`useEffect`/`useRef` are already imported in App.tsx; verify and extend the React import if not.)

- [ ] **Step 7: Verify suite and build**

Run: `npm test && npm run build`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add src/printing/brotherDriver.ts src/printing/keepalive.ts src/printing/keepalive.test.ts src/printing/index.ts src/App.tsx
git commit -m "Add USB keepalive to counter printer auto-power-off"
```

---

### Task 5: Full verification + hardware pass

**Files:**
- Modify: `docs/superpowers/plans/2026-07-18-webusb-handoff.md` (record outcome)

- [ ] **Step 1: Full suite + build**

Run: `npm test && npm run build`
Expected: all tests green (56 total expected), clean build.

- [ ] **Step 2: Hardware — first print via picker**

Dev server on :5180, printer awake. In Chrome: draw a small label, click Print, pick "PT-P710BT" in the USB chooser. Expected: label prints and auto-cuts; no alert. Check orientation/mirroring on the physical label (open watch-item from the original plan).

- [ ] **Step 3: Hardware — zero-click reprint**

Click Print again without touching any picker. Expected: prints immediately (granted-device path).

- [ ] **Step 4: Hardware — sleep hint**

Power the printer off with its button, click Print. Expected: "Printer not found — it may have auto-powered off…" alert, no picker.

- [ ] **Step 5: Hardware — keepalive soak**

With the app open, printer on, temporarily set `intervalMs` to 5 min (it is the default) and leave the rig idle >12 min. Expected: printer still on. If it powered off, retry with a shorter interval (e.g. 2 min); if that also fails, remove the keepalive wiring and record the finding in `docs/hardware/pt-p710bt.md`.

- [ ] **Step 6: Record results + commit**

Update the handoff doc's verification section with results (including the orientation check), then:

```bash
git add docs/superpowers/plans/2026-07-18-webusb-handoff.md docs/hardware/pt-p710bt.md
git commit -m "Record WebUSB hardware verification results"
```
