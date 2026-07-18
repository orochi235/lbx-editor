# Web Label Printing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Print the current label from the browser to a Brother PT-P710BT (CUBE Plus) over the Web Serial API.

**Architecture:** A `src/printing/` library split into a printer-agnostic raster spine (RGBA → 1-bpp), a Brother raster `Driver` (1-bpp → command bytes), and a `WebSerialTransport` (bytes → OS-paired SPP serial port). A device profile and a job orchestrator wire them together; the editor renders the label off-screen to RGBA and runs a print job.

**Tech Stack:** TypeScript (ESM, ES2022, strict), Vite, React, Vitest (added in Task 1). The Brother byte sequence and PackBits framing are taken verbatim from the reference impl (`pt-p710bt-label-maker`).

**Key constants:** printhead = 128 dots = 16 bytes/line; 180 dpi; `DOTS_PER_PT = 180/72 = 2.5`; PackBits (TIFF) compression; per-line opcode `0x47` (data) or `0x5A` (blank line).

---

### Task 1: Vitest setup + printing module skeleton + shared types

**Files:**
- Modify: `/Users/mike/src/lbx-editor/package.json` (scripts + devDependency)
- Create: `/Users/mike/src/lbx-editor/vitest.config.ts`
- Create: `/Users/mike/src/lbx-editor/src/printing/types.ts`
- Test: `/Users/mike/src/lbx-editor/src/printing/smoke.test.ts`

- [ ] **Step 1: Install vitest**

Run: `cd /Users/mike/src/lbx-editor && npm install -D vitest@^2`
Expected: vitest added to devDependencies; no errors.

- [ ] **Step 2: Add test scripts to package.json**

In `package.json` `"scripts"`, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create vitest config**

`vitest.config.ts` (node environment — the library core has no DOM dependency):

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/printing/**/*.test.ts'],
  },
})
```

- [ ] **Step 4: Create shared types**

`src/printing/types.ts`:

```ts
/** A plain RGBA bitmap — no DOM dependency, so the raster core is testable in Node. */
export interface RgbaImage {
  width: number
  height: number
  data: Uint8ClampedArray // length === width * height * 4, RGBA
}

/** Physical printer geometry for a loaded medium. */
export interface MediaSpec {
  dpi: number
  printheadDots: number // total dots across the head (128 for PT-P710BT)
  printableDots: number // dots actually printed for this tape, centered in the head
  tapeWidthMm: number
}

/** Monochrome raster ready for a driver: one fixed-width row per printer raster line. */
export interface Raster1bpp {
  lineBytes: number // bytes per row (16 for PT-P710BT)
  lineCount: number // number of raster lines (label length in dots)
  rows: Uint8Array[] // each row is lineBytes long, MSB-first (bit 7 of byte 0 = dot 0)
}

export interface JobOptions {
  tapeWidthMm: number
  autoCut: boolean
  marginDots: number
}

export interface Driver {
  encode(raster: Raster1bpp, opts: JobOptions): Uint8Array
}

export interface Transport {
  open(): Promise<void>
  write(bytes: Uint8Array): Promise<void>
  read(timeoutMs: number): Promise<Uint8Array>
  close(): Promise<void>
}

export interface DeviceProfile {
  model: string
  media: MediaSpec
  makeDriver(): Driver
  makeTransport(): Transport
}
```

- [ ] **Step 5: Write a smoke test**

`src/printing/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { RgbaImage } from './types'

describe('printing module', () => {
  it('types are importable and test runner works', () => {
    const img: RgbaImage = { width: 1, height: 1, data: new Uint8ClampedArray(4) }
    expect(img.data.length).toBe(4)
  })
})
```

- [ ] **Step 6: Run the test**

Run: `cd /Users/mike/src/lbx-editor && npm test`
Expected: PASS, 1 test passed.

- [ ] **Step 7: Commit**

```bash
cd /Users/mike/src/lbx-editor
git add package.json package-lock.json vitest.config.ts src/printing/types.ts src/printing/smoke.test.ts
git commit -m "Add vitest and printing module skeleton"
```

---

### Task 2: PackBits (TIFF) compression encoder

**Files:**
- Create: `/Users/mike/src/lbx-editor/src/printing/packbits.ts`
- Test: `/Users/mike/src/lbx-editor/src/printing/packbits.test.ts`

- [ ] **Step 1: Write the failing test**

`src/printing/packbits.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { packbits } from './packbits'

const enc = (a: number[]) => Array.from(packbits(Uint8Array.from(a)))

describe('packbits', () => {
  it('encodes a single literal byte', () => {
    expect(enc([0x00])).toEqual([0x00, 0x00]) // control 0 (1 literal), data
  })
  it('encodes a literal run', () => {
    expect(enc([1, 2, 3])).toEqual([0x02, 1, 2, 3]) // control n-1=2, then 3 bytes
  })
  it('encodes a replicate run', () => {
    expect(enc([0xaa, 0xaa, 0xaa, 0xaa, 0xaa])).toEqual([0xfc, 0xaa]) // 257-5=0xFC
  })
  it('encodes mixed runs', () => {
    expect(enc([0xaa, 0xaa, 0xaa, 1, 2])).toEqual([0xfe, 0xaa, 0x01, 1, 2]) // rep3 then lit2
  })
  it('encodes empty input as empty', () => {
    expect(enc([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/mike/src/lbx-editor && npx vitest run src/printing/packbits.test.ts`
Expected: FAIL — cannot find module './packbits'.

- [ ] **Step 3: Write the implementation**

`src/printing/packbits.ts`:

```ts
/**
 * TIFF/PackBits run-length encoding, as expected by the Brother raster protocol.
 * Literal run of n (1..128): control byte (n-1), then n data bytes.
 * Replicate run of n (2..128): control byte (257-n), then 1 data byte.
 */
export function packbits(input: Uint8Array): Uint8Array {
  const out: number[] = []
  let i = 0
  const n = input.length
  while (i < n) {
    // measure a run of identical bytes starting at i
    let run = 1
    while (i + run < n && input[i + run] === input[i] && run < 128) run++

    if (run >= 2) {
      out.push(257 - run, input[i])
      i += run
    } else {
      // gather a literal run until the next >=2 repeat (or cap at 128)
      const start = i
      let lit = 1
      i++
      while (i < n && lit < 128) {
        const repeatAhead = i + 1 < n && input[i + 1] === input[i]
        if (repeatAhead) break
        lit++
        i++
      }
      out.push(lit - 1)
      for (let k = 0; k < lit; k++) out.push(input[start + k])
    }
  }
  return Uint8Array.from(out)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/mike/src/lbx-editor && npx vitest run src/printing/packbits.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/mike/src/lbx-editor
git add src/printing/packbits.ts src/printing/packbits.test.ts
git commit -m "Add PackBits encoder for Brother raster"
```

---

### Task 3: RasterCore — RGBA → Raster1bpp

**Files:**
- Create: `/Users/mike/src/lbx-editor/src/printing/rasterCore.ts`
- Test: `/Users/mike/src/lbx-editor/src/printing/rasterCore.test.ts`

Mapping rules: input RGBA is the label rendered landscape (width = length in dots, height MUST equal `media.printableDots`). Each image **column** becomes one printer raster line (the printer prints sideways). A pixel is "on" (black) when alpha > 127 and luminance < 128. Within a row, the printable band is centered in the head: `offset = floor((printheadDots - printableDots) / 2)`; dot index = `offset + y`; bit is MSB-first (`byte = dot >> 3`, `mask = 1 << (7 - (dot & 7))`).

- [ ] **Step 1: Write the failing test**

`src/printing/rasterCore.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { rgbaToRaster } from './rasterCore'
import type { RgbaImage, MediaSpec } from './types'

// helper: build an RGBA image from a width x height map of booleans (true = black)
function img(width: number, height: number, black: (x: number, y: number) => boolean): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const v = black(x, y) ? 0 : 255
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255
    }
  }
  return { width, height, data }
}

const media: MediaSpec = { dpi: 180, printheadDots: 128, printableDots: 8, tapeWidthMm: 12 }

describe('rgbaToRaster', () => {
  it('produces one row per image column', () => {
    const r = rgbaToRaster(img(3, 8, () => false), media)
    expect(r.lineCount).toBe(3)
    expect(r.lineBytes).toBe(16)
    expect(r.rows).toHaveLength(3)
    expect(Array.from(r.rows[0])).toEqual(new Array(16).fill(0))
  })

  it('sets the correct centered bit for a single black pixel', () => {
    // printableDots=8 centered in 128 -> offset = (128-8)/2 = 60. Pixel at column 1, y=0 -> dot 60.
    const r = rgbaToRaster(img(3, 8, (x, y) => x === 1 && y === 0), media)
    const row = r.rows[1]
    // dot 60 -> byte 7 (60>>3=7), bit mask 1 << (7 - (60 & 7)) = 1 << (7-4) = 0x08
    expect(row[7]).toBe(0x08)
    // all other bytes zero
    expect(Array.from(row).filter((b, i) => i !== 7).every((b) => b === 0)).toBe(true)
  })

  it('throws when image height does not match printableDots', () => {
    expect(() => rgbaToRaster(img(2, 7, () => false), media)).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/mike/src/lbx-editor && npx vitest run src/printing/rasterCore.test.ts`
Expected: FAIL — cannot find module './rasterCore'.

- [ ] **Step 3: Write the implementation**

`src/printing/rasterCore.ts`:

```ts
import type { RgbaImage, MediaSpec, Raster1bpp } from './types'

function isBlack(data: Uint8ClampedArray, i: number): boolean {
  const a = data[i + 3]
  if (a <= 127) return false
  const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  return lum < 128
}

/**
 * Convert a landscape RGBA label render to a Brother raster.
 * Image width = label length in dots; image height MUST equal media.printableDots.
 * Each image column becomes one raster line (printer prints sideways).
 */
export function rgbaToRaster(image: RgbaImage, media: MediaSpec): Raster1bpp {
  if (image.height !== media.printableDots) {
    throw new Error(
      `image height ${image.height} must equal printableDots ${media.printableDots}`,
    )
  }
  const lineBytes = media.printheadDots / 8
  if (!Number.isInteger(lineBytes)) {
    throw new Error(`printheadDots ${media.printheadDots} must be a multiple of 8`)
  }
  const offset = Math.floor((media.printheadDots - media.printableDots) / 2)
  const rows: Uint8Array[] = []
  for (let x = 0; x < image.width; x++) {
    const row = new Uint8Array(lineBytes)
    for (let y = 0; y < image.height; y++) {
      const i = (y * image.width + x) * 4
      if (isBlack(image.data, i)) {
        const dot = offset + y
        row[dot >> 3] |= 1 << (7 - (dot & 7))
      }
    }
    rows.push(row)
  }
  return { lineBytes, lineCount: image.width, rows }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/mike/src/lbx-editor && npx vitest run src/printing/rasterCore.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/mike/src/lbx-editor
git add src/printing/rasterCore.ts src/printing/rasterCore.test.ts
git commit -m "Add RasterCore: RGBA to centered 1-bpp raster"
```

---

### Task 4: BrotherRasterDriver — Raster1bpp → command bytes

**Files:**
- Create: `/Users/mike/src/lbx-editor/src/printing/brotherDriver.ts`
- Test: `/Users/mike/src/lbx-editor/src/printing/brotherDriver.test.ts`

The byte sequence is verbatim from the reference (see plan header / spec). Blank rows (all-zero) emit `0x5A`; non-blank rows emit `0x47` + 2-byte LE length + PackBits payload.

- [ ] **Step 1: Write the failing test**

`src/printing/brotherDriver.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createBrotherRasterDriver } from './brotherDriver'
import { packbits } from './packbits'
import type { Raster1bpp, JobOptions } from './types'

const opts: JobOptions = { tapeWidthMm: 12, autoCut: true, marginDots: 0 }

function blankRaster(lineCount: number): Raster1bpp {
  return { lineBytes: 16, lineCount, rows: Array.from({ length: lineCount }, () => new Uint8Array(16)) }
}

describe('BrotherRasterDriver', () => {
  it('emits the documented header, blank-line opcode, and print-cut footer', () => {
    const out = Array.from(createBrotherRasterDriver().encode(blankRaster(1), opts))
    const expected = [
      ...new Array(100).fill(0x00), // invalidate
      0x1b, 0x40, // init
      0x1b, 0x69, 0x53, // status request
      0x1b, 0x69, 0x61, 0x01, // raster mode
      0x1b, 0x69, 0x21, 0x00, // status notification mode
      0x1b, 0x69, 0x7a, 0x84, 0x00, 0x0c, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, // print info (12mm, 1 line)
      0x1b, 0x69, 0x4d, 0x40, // auto-cut
      0x1b, 0x69, 0x4b, 0x08, // advanced mode
      0x1b, 0x69, 0x64, 0x00, 0x00, // margin
      0x4d, 0x02, // compression
      0x5a, // blank raster line
      0x1a, // print + feed + cut
    ]
    expect(out).toEqual(expected)
  })

  it('emits 0x47 + LE length + packbits for a non-blank line', () => {
    const row = new Uint8Array(16)
    row[0] = 0xff
    const raster: Raster1bpp = { lineBytes: 16, lineCount: 1, rows: [row] }
    const out = Array.from(createBrotherRasterDriver().encode(raster, opts))
    const payload = Array.from(packbits(row))
    const gIndex = out.lastIndexOf(0x47)
    expect(gIndex).toBeGreaterThan(-1)
    expect(out[gIndex + 1]).toBe(payload.length & 0xff)
    expect(out[gIndex + 2]).toBe((payload.length >> 8) & 0xff)
    expect(out.slice(gIndex + 3, gIndex + 3 + payload.length)).toEqual(payload)
  })

  it('clears the auto-cut bit when autoCut is false', () => {
    const out = Array.from(createBrotherRasterDriver().encode(blankRaster(1), { ...opts, autoCut: false }))
    const idx = out.findIndex((b, i) => b === 0x1b && out[i + 1] === 0x69 && out[i + 2] === 0x4d)
    expect(out[idx + 3]).toBe(0x00)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/mike/src/lbx-editor && npx vitest run src/printing/brotherDriver.test.ts`
Expected: FAIL — cannot find module './brotherDriver'.

- [ ] **Step 3: Write the implementation**

`src/printing/brotherDriver.ts`:

```ts
import type { Driver, Raster1bpp, JobOptions } from './types'
import { packbits } from './packbits'

function isBlankRow(row: Uint8Array): boolean {
  for (let i = 0; i < row.length; i++) if (row[i] !== 0) return false
  return true
}

/** Brother PT-P710BT raster driver. Byte sequence taken verbatim from the reference impl. */
export function createBrotherRasterDriver(): Driver {
  return {
    encode(raster: Raster1bpp, opts: JobOptions): Uint8Array {
      const out: number[] = []

      // 1. invalidate
      for (let i = 0; i < 100; i++) out.push(0x00)
      // 2. initialize
      out.push(0x1b, 0x40)
      // 3. status request
      out.push(0x1b, 0x69, 0x53)
      // 4. raster mode
      out.push(0x1b, 0x69, 0x61, 0x01)
      // 4.5. switch automatic status notification mode: notify (default)
      out.push(0x1b, 0x69, 0x21, 0x00)
      // 5. print information: ESC i z, flags 0x84, media 0x00, width mm, length 0x00,
      //    raster count (4-byte LE), trailing 0x00 0x00
      const n = raster.lineCount
      out.push(
        0x1b, 0x69, 0x7a, 0x84, 0x00, opts.tapeWidthMm & 0xff, 0x00,
        n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff,
        0x00, 0x00,
      )
      // 6. various mode: auto-cut bit (0x40)
      out.push(0x1b, 0x69, 0x4d, opts.autoCut ? 0x40 : 0x00)
      // 7. advanced mode
      out.push(0x1b, 0x69, 0x4b, 0x08)
      // 8. margin (2-byte LE)
      out.push(0x1b, 0x69, 0x64, opts.marginDots & 0xff, (opts.marginDots >> 8) & 0xff)
      // 9. compression mode: TIFF/PackBits
      out.push(0x4d, 0x02)
      // 10. raster data
      for (const row of raster.rows) {
        if (isBlankRow(row)) {
          out.push(0x5a)
        } else {
          const packed = packbits(row)
          out.push(0x47, packed.length & 0xff, (packed.length >> 8) & 0xff)
          for (const b of packed) out.push(b)
        }
      }
      // 11. print + feed + cut
      out.push(0x1a)

      return Uint8Array.from(out)
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/mike/src/lbx-editor && npx vitest run src/printing/brotherDriver.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/mike/src/lbx-editor
git add src/printing/brotherDriver.ts src/printing/brotherDriver.test.ts
git commit -m "Add Brother PT-P710BT raster driver"
```

---

### Task 5: WebSerialTransport

**Files:**
- Create: `/Users/mike/src/lbx-editor/src/printing/webSerialTransport.ts`
- Test: `/Users/mike/src/lbx-editor/src/printing/webSerialTransport.test.ts`

The transport takes an already-selected `SerialPort` (the caller does the `navigator.serial.requestPort()` user-gesture step). This keeps it injectable and testable with a fake port. Web Serial type definitions are minimal here to avoid a DOM-lib dependency in the node test env.

- [ ] **Step 1: Write the failing test**

`src/printing/webSerialTransport.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createWebSerialTransport, type SerialPortLike } from './webSerialTransport'

function fakePort() {
  const written: Uint8Array[] = []
  let opened = false
  const port: SerialPortLike = {
    async open() { opened = true },
    async close() { opened = false },
    get writable() {
      return {
        getWriter: () => ({
          async write(chunk: Uint8Array) { written.push(chunk) },
          releaseLock() {},
        }),
      }
    },
    get readable() {
      return {
        getReader: () => ({
          async read() { return { value: Uint8Array.from([0x80]), done: false } },
          releaseLock() {},
          async cancel() {},
        }),
      }
    },
  }
  return { port, written, isOpen: () => opened }
}

describe('WebSerialTransport', () => {
  it('opens, writes, and closes through the injected port', async () => {
    const { port, written, isOpen } = fakePort()
    const t = createWebSerialTransport(port, { baudRate: 9600 })
    await t.open()
    expect(isOpen()).toBe(true)
    await t.write(Uint8Array.from([1, 2, 3]))
    expect(Array.from(written[0])).toEqual([1, 2, 3])
    await t.close()
    expect(isOpen()).toBe(false)
  })

  it('reads available bytes', async () => {
    const { port } = fakePort()
    const t = createWebSerialTransport(port, { baudRate: 9600 })
    await t.open()
    const got = await t.read(100)
    expect(Array.from(got)).toEqual([0x80])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/mike/src/lbx-editor && npx vitest run src/printing/webSerialTransport.test.ts`
Expected: FAIL — cannot find module './webSerialTransport'.

- [ ] **Step 3: Write the implementation**

`src/printing/webSerialTransport.ts`:

```ts
import type { Transport } from './types'

/** Minimal structural subset of the Web Serial `SerialPort` we depend on. */
export interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>
  close(): Promise<void>
  readonly writable: { getWriter(): { write(chunk: Uint8Array): Promise<void>; releaseLock(): void } } | null
  readonly readable: {
    getReader(): {
      read(): Promise<{ value?: Uint8Array; done: boolean }>
      releaseLock(): void
      cancel(): Promise<void>
    }
  } | null
}

export interface WebSerialOptions {
  baudRate: number // SPP ignores this, but Web Serial requires a value
}

export function createWebSerialTransport(port: SerialPortLike, options: WebSerialOptions): Transport {
  return {
    async open() {
      await port.open({ baudRate: options.baudRate })
    },
    async write(bytes: Uint8Array) {
      if (!port.writable) throw new Error('serial port not writable')
      const writer = port.writable.getWriter()
      try {
        await writer.write(bytes)
      } finally {
        writer.releaseLock()
      }
    },
    async read(timeoutMs: number) {
      if (!port.readable) throw new Error('serial port not readable')
      const reader = port.readable.getReader()
      const timeout = new Promise<{ value?: Uint8Array; done: boolean }>((resolve) =>
        setTimeout(() => resolve({ value: new Uint8Array(0), done: false }), timeoutMs),
      )
      try {
        const result = await Promise.race([reader.read(), timeout])
        return result.value ?? new Uint8Array(0)
      } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
    },
    async close() {
      await port.close()
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/mike/src/lbx-editor && npx vitest run src/printing/webSerialTransport.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/mike/src/lbx-editor
git add src/printing/webSerialTransport.ts src/printing/webSerialTransport.test.ts
git commit -m "Add WebSerialTransport over an injected SerialPort"
```

---

### Task 6: Device profile + print job orchestrator

**Files:**
- Create: `/Users/mike/src/lbx-editor/src/printing/profiles.ts`
- Create: `/Users/mike/src/lbx-editor/src/printing/printJob.ts`
- Test: `/Users/mike/src/lbx-editor/src/printing/printJob.test.ts`
- Modify: `/Users/mike/src/lbx-editor/src/printing/types.ts`, `/Users/mike/src/lbx-editor/src/printing/brotherDriver.ts`, `/Users/mike/src/lbx-editor/src/printing/brotherDriver.test.ts`
- Test: `/Users/mike/src/lbx-editor/src/printing/profiles.test.ts`

> **Amended after code review of earlier tasks:** status parsing is printer-specific (Brother's
> error bytes at offsets 8/9 of a 32-byte status), so it lives on the `Driver` as
> `parseStatus(raw): PrinterStatus`, implemented in `brotherDriver.ts` — not inlined in the
> printer-agnostic `printJob.ts`. The orchestrator also reads the full 32-byte status
> (`transport.read(2000, 32)`), since a Web Serial/BT SPP read can return partial chunks.
>
> **Amended again after a second code-review pass:**
> - `ptP710btMedia` uses a documented per-width print-area lookup table instead of a pure linear
>   formula (the printer reserves edge margins), falling back to the clamped formula for
>   unlisted widths.
> - `printRaster`'s `finally` closes the transport best-effort (`.catch(() => {})`) so a
>   rejecting `close()` never masks the job's real outcome (success or the original error).
> - `PrinterStatus` gained `incomplete: boolean` (`raw.length < 32`) so a short/absent status
>   reply (timeout/disconnect) is distinguishable from a genuine all-clear.
> - The `printJob.ts` comment on the status read was softened: the 32-byte reply answers the
>   stream's *early* status-request command, so it reflects job-start printer state (missing
>   tape, open cover) and does **not** guarantee the printer finished consuming the job before
>   `close()` races it — that race is a Task 8 hardware-verification item.

- [ ] **Step 1: Write the failing test**

`src/printing/printJob.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { printRaster } from './printJob'
import { createBrotherRasterDriver } from './brotherDriver'
import type { Raster1bpp, Transport, JobOptions } from './types'

function recordingTransport() {
  const events: string[] = []
  const writes: Uint8Array[] = []
  const transport: Transport = {
    async open() { events.push('open') },
    async write(b) { events.push('write'); writes.push(b) },
    async read() { events.push('read'); return Uint8Array.from([0x80, 0x00]) },
    async close() { events.push('close') },
  }
  return { transport, events, writes }
}

const raster: Raster1bpp = { lineBytes: 16, lineCount: 1, rows: [new Uint8Array(16)] }
const opts: JobOptions = { tapeWidthMm: 12, autoCut: true, marginDots: 0 }

describe('printRaster', () => {
  it('opens, writes encoded bytes, reads status, and closes in order', async () => {
    const { transport, events, writes } = recordingTransport()
    await printRaster(raster, { driver: createBrotherRasterDriver(), transport, opts })
    expect(events[0]).toBe('open')
    expect(events[events.length - 1]).toBe('close')
    expect(events).toContain('write')
    expect(writes[0][0]).toBe(0x00) // first encoded byte is the invalidate run
  })

  it('always closes even if write throws', async () => {
    const events: string[] = []
    const transport: Transport = {
      async open() { events.push('open') },
      async write() { throw new Error('boom') },
      async read() { return new Uint8Array(0) },
      async close() { events.push('close') },
    }
    await expect(
      printRaster(raster, { driver: createBrotherRasterDriver(), transport, opts }),
    ).rejects.toThrow('boom')
    expect(events).toContain('close')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/mike/src/lbx-editor && npx vitest run src/printing/printJob.test.ts`
Expected: FAIL — cannot find module './printJob'.

- [ ] **Step 3: Write the profile**

`src/printing/profiles.ts`:

```ts
import type { DeviceProfile, MediaSpec } from './types'
import { createBrotherRasterDriver } from './brotherDriver'
import { createWebSerialTransport, type SerialPortLike } from './webSerialTransport'

export const PT_P710BT_DPI = 180
export const PT_P710BT_PRINTHEAD_DOTS = 128

/**
 * Documented print-area dot counts per tape width (PT-P700-series raster reference).
 * The printer reserves top/bottom margins, so these are smaller than the physical
 * tape width in dots. TODO(task8): confirm against hardware.
 */
const PT_P710BT_PRINTABLE_DOTS: Record<number, number> = {
  3.5: 24,
  6: 32,
  9: 50,
  12: 70,
  18: 112,
  24: 128,
}

/** Build the media spec for a given tape width (mm) on the PT-P710BT. */
export function ptP710btMedia(tapeWidthMm: number): MediaSpec {
  const printableDots =
    PT_P710BT_PRINTABLE_DOTS[tapeWidthMm] ??
    Math.min(PT_P710BT_PRINTHEAD_DOTS, Math.round((tapeWidthMm / 25.4) * PT_P710BT_DPI))
  return { dpi: PT_P710BT_DPI, printheadDots: PT_P710BT_PRINTHEAD_DOTS, printableDots, tapeWidthMm }
}

/** A PT-P710BT profile bound to an already-selected Web Serial port. */
export function ptP710btProfile(port: SerialPortLike, tapeWidthMm: number): DeviceProfile {
  return {
    model: 'Brother PT-P710BT',
    media: ptP710btMedia(tapeWidthMm),
    makeDriver: () => createBrotherRasterDriver(),
    makeTransport: () => createWebSerialTransport(port, { baudRate: 9600 }),
  }
}
```

`profiles.test.ts` covers: 12mm → 70, 24mm → 128, 18mm → 112, an unlisted width (10mm) falling
back to `min(128, round(10/25.4*180)) = 71`, and dpi/printheadDots/tapeWidthMm passthrough.

- [ ] **Step 4: Add `PrinterStatus` (with `incomplete`) and `parseStatus` to the `Driver` contract**

`src/printing/types.ts` gains:

```ts
/** Parsed printer status reply. */
export interface PrinterStatus {
  raw: Uint8Array
  hasError: boolean
  /** True when fewer bytes than a full status reply arrived (timeout/disconnect). */
  incomplete: boolean
}

export interface Driver {
  encode(raster: Raster1bpp, opts: JobOptions): Uint8Array
  parseStatus(raw: Uint8Array): PrinterStatus
}
```

`src/printing/brotherDriver.ts` implements it on the returned driver:

```ts
parseStatus(raw: Uint8Array): PrinterStatus {
  // Brother 32-byte status: error-information bytes at offsets 8 and 9.
  const hasError = raw.length >= 10 && (raw[8] !== 0 || raw[9] !== 0)
  // Full Brother status is 32 bytes; fewer means a timeout/disconnect truncated it.
  const incomplete = raw.length < 32
  return { raw, hasError, incomplete }
},
```

`brotherDriver.test.ts` covers: a set bit at offset 8 → `hasError: true`; a set bit at offset 9 →
`true`; 32 zero bytes → `{hasError: false, incomplete: false}`; a short (<10-byte) reply →
`{hasError: false, incomplete: true}`.

- [ ] **Step 5: Write the orchestrator**

`src/printing/printJob.ts`:

```ts
import type { Driver, Transport, Raster1bpp, JobOptions, PrinterStatus } from './types'

export interface PrintRasterArgs {
  driver: Driver
  transport: Transport
  opts: JobOptions
}

/** Open, send the encoded job, read the trailing status, and always close. */
export async function printRaster(
  raster: Raster1bpp,
  { driver, transport, opts }: PrintRasterArgs,
): Promise<PrinterStatus> {
  const bytes = driver.encode(raster, opts)
  await transport.open()
  try {
    await transport.write(bytes)
    // 32-byte Brother status; this is the reply to the stream's EARLY status-request
    // command, so it reflects printer state around job start (missing tape, open
    // cover) — it is not a print-completion acknowledgment, and the printer may still
    // be consuming the job when this resolves. Whether closing here races the transfer
    // on real hardware is a Task 8 hardware-verification item.
    const status = await transport.read(2000, 32)
    return driver.parseStatus(status)
  } finally {
    // best-effort: a close failure must not mask the job's real outcome
    await transport.close().catch(() => {})
  }
}
```

No status-parsing logic lives here; it's delegated to `driver.parseStatus`. Closing is
best-effort — a rejecting `close()` never replaces a successful result or masks the write
error that's actually surfacing.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/mike/src/lbx-editor && npx vitest run src/printing/printJob.test.ts src/printing/brotherDriver.test.ts src/printing/profiles.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full suite**

Run: `cd /Users/mike/src/lbx-editor && npm test`
Expected: PASS — all printing tests green.

- [ ] **Step 8: Commit**

```bash
cd /Users/mike/src/lbx-editor
git add src/printing/profiles.ts src/printing/profiles.test.ts src/printing/printJob.ts \
  src/printing/printJob.test.ts src/printing/types.ts src/printing/brotherDriver.ts \
  src/printing/brotherDriver.test.ts
git commit -m "Add PT-P710BT profile and print job orchestrator"
```

---

### Task 7: Label → RGBA renderer (editor bridge)

**Files:**
- Create: `/Users/mike/src/lbx-editor/src/printing/labelRender.ts`
- Create: `/Users/mike/src/lbx-editor/src/printing/index.ts`

This module is DOM-dependent (uses an off-screen `<canvas>`), so it is verified manually in Task 8 rather than unit-tested. It renders label nodes to a clean white bitmap at print resolution — no zoom, brick background, or selection chrome. Text renders as a stroked outline of its bounding box (matching the current editor behavior of treating text as bounding boxes, which itself draws an outline, not a fill — see `drawLabelNode` in `App.tsx`); refine when weasel gains MSDF text. `DOTS_PER_PT = dpi / 72`.

Image nodes originally fell back to an opaque filled box unconditionally — a placed logo printed as a black slab. A whole-branch review caught this: the editor already decodes and caches real bitmaps via `getImageBitmap`/`imageBitmapCache.ts` for on-screen rendering (`drawLabelNode`'s `'image'` case), so the print path should reuse that instead of introducing its own decoding. `RenderArgs` gained an optional `getImageBitmap?: (node: LabelNode) => ImageBitmap | undefined` resolver — a callback rather than importing the cache directly, keeping `labelRender.ts` decoupled from `App.tsx`/cache internals. The image branch calls it and `ctx.drawImage`s the bitmap when present (rasterCore's luminance-threshold monochroming handles the rest); the filled-box path is now explicitly the no-bitmap fallback (resolver omitted, or image not yet decoded — the cache returns `null` synchronously until `base64ToImageBitmap` resolves).

`src/label.ts`'s `LabelNodeData` already uses `kind` as its discriminant (`'text' | 'rect' | 'line' | 'image'`) with `fillColor`/`strokeWidth` on `LabelRectData`, matching the draft below. Weasel's `SceneNode<TData, TLayer, TPose>` (`Node<TData, TLayer, TPose>` in `src/core/scene/types.ts`) is a plain discriminated union exposing `.data` and `.pose` directly — no forced casting needed, so the implemented version drops the draft's `poseOf`/`dataOf` `as unknown as` helpers and imports `LabelLayer` to build the concrete `LabelNode = SceneNode<LabelNodeData, LabelLayer, LabelPose>` alias (mirroring `App.tsx`).

One real gap the draft missed: node `y`/`height` are authored in points against the *full* tape width (`TAPE_SIZES[...].width`, i.e. the paper height in `App.tsx`), not against `printableDots`. `RenderArgs` therefore adds a `tapeWidthPt` field, and the renderer scales y/height by `printableDots / (tapeWidthPt * dotsPerPt)` in addition to `dotsPerPt` — see the vertical-scale doc comment in the implementation for the chosen squeeze-vs-crop tradeoff. Task 8's `handlePrint` must pass `tapeWidthPt: tape.width` (or equivalent) alongside `labelLengthPt`.

- [ ] **Step 1: Write the renderer**

`src/printing/labelRender.ts` (implemented; see file for the full vertical-scale doc comment):

```ts
import type { SceneNode } from '@weasel-js/core'
import type { LabelNodeData, LabelLayer, LabelPose } from '../label'
import type { RgbaImage } from './types'

type LabelNode = SceneNode<LabelNodeData, LabelLayer, LabelPose>

interface RenderArgs {
  nodes: LabelNode[]
  labelLengthPt: number
  tapeWidthPt: number // full tape width in pt — see vertical-scale note below
  printableDots: number
  dpi: number
  /** Resolve a decoded bitmap for an image node; undefined falls back to a filled box. */
  getImageBitmap?: (node: LabelNode) => ImageBitmap | undefined
}

export function renderLabelToRgba({
  nodes,
  labelLengthPt,
  tapeWidthPt,
  printableDots,
  dpi,
  getImageBitmap,
}: RenderArgs): RgbaImage {
  const dotsPerPt = dpi / 72
  const widthDots = Math.max(1, Math.round(labelLengthPt * dotsPerPt))
  const fullHeightDots = tapeWidthPt * dotsPerPt
  const verticalScale = fullHeightDots > 0 ? printableDots / fullHeightDots : 1
  // ... canvas setup, white background, per-node switch on data.kind
  // (image/rect/line/text), each scaling x/w by dotsPerPt and y/h by
  // dotsPerPt * verticalScale. 'image' calls getImageBitmap?.(node) and
  // ctx.drawImage()s the result, falling back to ctx.fillRect() when no
  // bitmap is available. See src/printing/labelRender.ts for the full
  // implementation.
}
```

- [ ] **Step 2: Write the public barrel export**

`src/printing/index.ts`:

```ts
export * from './types'
export { rgbaToRaster } from './rasterCore'
export { createBrotherRasterDriver } from './brotherDriver'
export { createWebSerialTransport } from './webSerialTransport'
export type { SerialPortLike } from './webSerialTransport'
export { ptP710btProfile, ptP710btMedia } from './profiles'
export { printRaster } from './printJob'
export { renderLabelToRgba } from './labelRender'
```

- [ ] **Step 3: Type-check the build**

Run: `cd /Users/mike/src/lbx-editor && npm run build`
Expected: tsc passes (fix any property-name mismatches flagged against `src/label.ts`), Vite build succeeds.

- [ ] **Step 4: Commit**

```bash
cd /Users/mike/src/lbx-editor
git add src/printing/labelRender.ts src/printing/index.ts
git commit -m "Add label-to-RGBA renderer and printing barrel export"
```

---

### Task 8: Editor integration — Print button + Web Serial flow

**Files:**
- Modify: `/Users/mike/src/lbx-editor/src/Toolbar.tsx` (add a Print button)
- Modify: `/Users/mike/src/lbx-editor/src/App.tsx` (wire the print handler)

This task is verified manually against hardware (requires the PT-P710BT paired at the OS level). The Web Serial `requestPort()` call MUST run inside a user-gesture handler (the button click).

- [ ] **Step 1: Add a Print button to the Toolbar**

In `src/Toolbar.tsx`, add an `onPrint: () => void` prop to the toolbar's props interface, and render a button that calls it:

```tsx
<button type="button" onClick={onPrint} title="Print to label printer">
  Print
</button>
```

- [ ] **Step 2: Add the print handler in App.tsx**

In `src/App.tsx`, import the printing API and add a handler. `App` already holds `tapeSize` (`TapeSize`, e.g. `'12mm'`), `labelLength` (pt, doubles as `paperWidth`), and `paperHeight` (`TAPE_SIZES[tapeSize].width`, the full tape height in pt — exactly the `tapeWidthPt` the renderer needs). Label nodes live in `scene.nodes`, a `Map<NodeId, LabelNode>`, but the canvas paints via `scene.renderOrder()` (a layer-major DFS-preorder `Iterable<NodeId>`, confirmed on weasel's `Scene` type in `src/core/scene/scene.ts`) — after any z-reorder, Map insertion order and paint order diverge, so the handler builds `nodes` from `renderOrder()`, not `scene.nodes.values()`, to keep printed stacking matching the screen (`handleExport` is left on Map order — out of scope here). `renderLabelToRgba` wants the node values directly (not the `{id, data, pose}` shape `handleExport` builds for `bil-lbx`). The real `SerialPort` is structurally assignable to the exported `SerialPortLike`, so only `navigator` needs a cast — never the port. A `printing` boolean state guards against double-clicks (two concurrent jobs on one port can lock the stream and garble a label mid-print), and dismissing the Web Serial port picker rejects with a `NotFoundError` `DOMException` — a normal cancel, not a failure, so it's swallowed before the generic alert.

```tsx
import {
  renderLabelToRgba,
  rgbaToRaster,
  ptP710btProfile,
  printRaster,
  type SerialPortLike,
} from './printing'

// inside the App component:
const [printing, setPrinting] = useState(false)
const handlePrint = useCallback(async () => {
  if (printing) return
  const tapeWidthMm = parseInt(tapeSize, 10) // tapeSize keys look like '12mm'
  if (!('serial' in navigator)) {
    alert('Web Serial is not supported in this browser. Use Chrome or Edge.')
    return
  }
  setPrinting(true)
  try {
    // User gesture: choose the OS-paired PT-P710BT serial port. Must stay
    // directly in the click handler chain (no await before it).
    const port = await (
      navigator as unknown as { serial: { requestPort(): Promise<SerialPortLike> } }
    ).serial.requestPort()

    const profile = ptP710btProfile(port, tapeWidthMm)
    // Render order (layer-major DFS preorder), not Map insertion order, so
    // printed stacking matches what's on screen after any z-reorder.
    const nodes = Array.from(scene.renderOrder(), (id) => scene.nodes.get(id)!)
    const rgba = renderLabelToRgba({
      nodes,
      labelLengthPt: labelLength,
      tapeWidthPt: paperHeight, // full tape height in pt, TAPE_SIZES[tapeSize].width
      printableDots: profile.media.printableDots,
      dpi: profile.media.dpi,
      // Same lookup drawLabelNode uses for on-screen rendering; the cache
      // returns null (not yet decoded) rather than undefined.
      getImageBitmap: (node) =>
        node.data.kind === 'image'
          ? getImageBitmap(node.data.src, node.data.mimeType) ?? undefined
          : undefined,
    })
    const raster = rgbaToRaster(rgba, profile.media)
    const status = await printRaster(raster, {
      driver: profile.makeDriver(),
      transport: profile.makeTransport(),
      opts: { tapeWidthMm, autoCut: true, marginDots: 0 },
    })
    if (status.hasError) {
      alert('Printer reported an error (check tape/cover).')
    } else if (status.incomplete) {
      alert('Print sent, but the printer status reply was incomplete — check the printer.')
    }
  } catch (err) {
    // Dismissing the port picker is a normal cancel, not a failure.
    if (err instanceof DOMException && err.name === 'NotFoundError') return
    alert(`Print failed: ${(err as Error).message}`)
  } finally {
    setPrinting(false)
  }
}, [printing, tapeSize, scene, labelLength, paperHeight])
```

Wire `onPrint={handlePrint}` and `printDisabled={printing}` into the `<Toolbar />` usage; `Toolbar.tsx` takes a new optional `printDisabled?: boolean` prop and passes it to the Print button's `disabled`.

- [ ] **Step 3: Type-check**

Run: `cd /Users/mike/src/lbx-editor && npm run build`
Expected: tsc + Vite build pass.

- [ ] **Step 4: Manual hardware verification**

1. Pair the PT-P710BT at the OS level (macOS: System Settings → Bluetooth; confirm a `/dev/cu.PT-P710BT…` port exists via `ls /dev/cu.*`).
2. Run `cd /Users/mike/src/lbx-editor && npm run dev`, open `http://localhost:5180` in Chrome.
3. Create a simple label (a rect or text box), click **Print**, and select the printer's serial port.
4. Confirm a label prints and auto-cuts.
5. If the print is mirrored or rotated 180°, note it — the fix is reversing column or dot order in `rgbaToRaster` (a follow-up, not part of v1 acceptance).
6. Also watch: does the incomplete-status alert fire on good prints? If so, downgrade it to `console.warn` — the 2000ms/32-byte read in `printJob.ts` may just be racing a real (but slow) status reply rather than reporting an actual disconnect.
7. Note (academic, no action needed): 36mm tape falls back to the `Math.round((tapeWidthMm / 25.4) * PT_P710BT_DPI)` estimate in `ptP710btMedia` (capped at 128 dots) since it's not in `PT_P710BT_PRINTABLE_DOTS`, but the PT-P710BT's hardware max is 24mm tape — the printer physically can't load 36mm, so this path is unreachable in practice.

- [ ] **Step 5: Commit**

```bash
cd /Users/mike/src/lbx-editor
git add src/Toolbar.tsx src/App.tsx
git commit -m "Wire Print button to Web Serial label printing"
```

---

## Self-Review Notes

- **Spec coverage:** RasterCore (Task 3), PackBits (Task 2), BrotherRasterDriver (Task 4),
  WebSerialTransport (Task 5), DeviceProfile + orchestrator (Task 6), editor render + Print
  button (Tasks 7–8). Status read/parse: Task 6. Test runner setup (none existed): Task 1.
- **Known integration risks to verify during execution:**
  - `src/label.ts` discriminant + field names (`kind`, `fillColor`, `strokeWidth`) and how
    `SceneNode` stores `pose`/`data` — flagged in Task 7.
  - Actual `App.tsx` state variable names for nodes/tape/length — flagged in Task 8.
  - Print orientation/mirroring is only knowable on hardware — flagged as a Task 8 follow-up,
    deliberately out of v1 acceptance.
- **Hardware-independent vs. dependent:** Tasks 1–6 are fully unit-tested and need no printer.
  Tasks 7–8 require the device + OS pairing and are verified manually.
- **Follow-ups:**
  - Vertical print fidelity — `labelRender`'s squeeze-to-fit vertical scale distorts 16.7% on
    12mm tape, ~25% on 6mm/24mm, and worse (~50%) for widths that fall through to the 128-dot
    printhead fallback. Replace with 1:1 vertical scale + center offset, and constrain the
    editor's authorable area (or draw margin guides) to the printable band so nodes can't be
    placed where they'd be clipped. Related: line nodes currently print as a horizontal
    centerline through the pose box (matching how the editor draws them) — fine for
    near-horizontal lines, but should be revisited alongside this fidelity work.
