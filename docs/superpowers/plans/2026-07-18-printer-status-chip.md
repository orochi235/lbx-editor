# Printer Status Chip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A toolbar chip showing live printer state (reachability, tape width, errors, last-seen, printing) fed by the existing USB keepalive at a 60s cadence.

**Architecture:** `PrinterStatus` gains `mediaWidthMm`; the keepalive's `onStatus` fires every tick with `PrinterStatus | null` (null = absent/failed). App tracks `printerLastSeen`/`printerReachable`, passes them to `Toolbar`, which renders a new presentational `PrinterStatusChip` styled by the app's first CSS file.

**Tech Stack:** existing Vite + React + TS + Vitest. Spec: `docs/superpowers/specs/2026-07-18-printer-status-chip-design.md`.

**Conventions:** commits end with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer. Printing-module files: no semicolons. App files: semicolons. New UI code uses CSS classes, not inline styles.

---

### Task 1: Status data — mediaWidthMm + null ticks

**Files:**
- Modify: `src/printing/types.ts` (PrinterStatus)
- Modify: `src/printing/brotherDriver.ts` (parseStatus)
- Modify: `src/printing/keepalive.ts` (onStatus signature + null ticks)
- Test: `src/printing/brotherDriver.test.ts`, `src/printing/keepalive.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/printing/brotherDriver.test.ts`, add inside the existing describe block (match the file's existing fixture style — read the file first; construct raw statuses as 32-byte arrays):

```typescript
  it('parseStatus extracts media width from byte 10', () => {
    const raw = new Uint8Array(32)
    raw[10] = 12
    expect(createBrotherRasterDriver().parseStatus(raw).mediaWidthMm).toBe(12)
  })

  it('parseStatus reports null media width for an incomplete reply', () => {
    const raw = new Uint8Array(16)
    raw[10] = 12
    expect(createBrotherRasterDriver().parseStatus(raw).mediaWidthMm).toBeNull()
  })
```

In `src/printing/keepalive.test.ts`, add:

```typescript
  it('reports null status when no device is granted', async () => {
    const statuses: unknown[] = []
    const { stop } = startUsbKeepalive({
      getDevice: async () => null,
      isBusy: () => false,
      intervalMs: 1000,
      onStatus: (s) => statuses.push(s),
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(statuses).toEqual([null])
    stop()
  })

  it('reports null status when the tick fails', async () => {
    const statuses: unknown[] = []
    const { stop } = startUsbKeepalive({
      getDevice: async () => {
        throw new Error('boom')
      },
      isBusy: () => false,
      intervalMs: 1000,
      onStatus: (s) => statuses.push(s),
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(statuses).toEqual([null])
    stop()
  })
```

- [ ] **Step 2: Run to verify failures**

`npx vitest run src/printing/brotherDriver.test.ts src/printing/keepalive.test.ts` — the four new tests FAIL (missing field / callback not invoked with null).

- [ ] **Step 3: Implement**

`src/printing/types.ts` — extend the interface:

```typescript
/** Parsed printer status reply. */
export interface PrinterStatus {
  raw: Uint8Array
  hasError: boolean
  /** True when fewer bytes than a full status reply arrived (timeout/disconnect). */
  incomplete: boolean
  /** Loaded tape width in mm (byte 10), or null when the reply is incomplete. */
  mediaWidthMm: number | null
}
```

`src/printing/brotherDriver.ts` — `parseStatus` becomes:

```typescript
    parseStatus(raw: Uint8Array): PrinterStatus {
      // Brother 32-byte status: error-information bytes at offsets 8 and 9.
      const hasError = raw.length >= 10 && (raw[8] !== 0 || raw[9] !== 0)
      // Full Brother status is 32 bytes; fewer means a timeout/disconnect truncated it.
      const incomplete = raw.length < 32
      const mediaWidthMm = incomplete ? null : raw[10]
      return { raw, hasError, incomplete, mediaWidthMm }
    },
```

`src/printing/keepalive.ts` — widen the callback and report every tick:

```typescript
  /** Called after every tick: parsed status on success, null when absent or failed. */
  onStatus?(status: PrinterStatus | null): void
```

and the tick body becomes:

```typescript
  const tick = async () => {
    let status: PrinterStatus | null = null
    try {
      const device = await options.getDevice()
      if (!device) return
      const transport = createWebUsbTransport(device)
      await transport.open()
      try {
        await transport.write(encodeStatusRequest())
        const raw = await transport.read(2000, 32)
        status = createBrotherRasterDriver().parseStatus(raw)
      } finally {
        await transport.close()
      }
    } catch (err) {
      console.warn('USB keepalive tick failed:', err)
    } finally {
      options.onStatus?.(status)
    }
  }
```

(The doc comment on the interface's `onStatus` replaces the old one; `runTick`/`idle` unchanged.)

- [ ] **Step 4: Run tests**

`npm test` — expect 60 tests passing (56 + 4 new). Note: the existing keepalive test "polls status on each tick and reports it" still passes — successful ticks report the parsed status as before.

- [ ] **Step 5: Commit**

```bash
git add src/printing/types.ts src/printing/brotherDriver.ts src/printing/keepalive.ts src/printing/brotherDriver.test.ts src/printing/keepalive.test.ts
git commit -m "Report tape width and null ticks through the keepalive status callback"
```

---

### Task 2: Chip component + wiring

**Files:**
- Create: `src/PrinterStatusChip.tsx`, `src/printerStatusChip.css`
- Modify: `src/Toolbar.tsx`, `src/App.tsx`

- [ ] **Step 1: Create the chip component**

`src/printerStatusChip.css`:

```css
.printer-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #444;
  padding: 2px 8px;
  border: 1px solid #ddd;
  border-radius: 12px;
  white-space: nowrap;
}

.printer-chip__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.printer-chip--ready .printer-chip__dot {
  background: #2e9e44;
}

.printer-chip--error .printer-chip__dot {
  background: #d33;
}

.printer-chip--unknown .printer-chip__dot {
  background: #aaa;
}

.printer-chip--printing .printer-chip__dot {
  background: #2b7de9;
  animation: printer-chip-pulse 1s ease-in-out infinite;
}

@keyframes printer-chip-pulse {
  50% {
    opacity: 0.3;
  }
}
```

`src/PrinterStatusChip.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { PrinterStatus } from './printing';
import './printerStatusChip.css';

export interface PrinterStatusChipProps {
  lastSeen: { status: PrinterStatus; at: number } | null;
  reachable: boolean;
  printing: boolean;
}

const MODEL = 'PT-P710BT';

function relativeTime(at: number, now: number): string {
  const mins = Math.floor((now - at) / 60_000);
  return mins < 1 ? 'just now' : `${mins}m ago`;
}

/** Toolbar chip: printer reachability, tape width, error state, last-seen. */
export function PrinterStatusChip({ lastSeen, reachable, printing }: PrinterStatusChipProps) {
  // Re-render on a coarse timer so the relative time stays honest.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(handle);
  }, []);

  let variant: 'ready' | 'error' | 'unknown' | 'printing';
  let text: string;
  let tooltip: string;

  if (printing) {
    variant = 'printing';
    text = `${MODEL} · printing…`;
    tooltip = 'Sending job to the printer';
  } else if (!reachable || !lastSeen) {
    variant = 'unknown';
    text = `${MODEL} · —`;
    tooltip = 'Printer not detected — it may be asleep (press its power button)';
  } else {
    const { status, at } = lastSeen;
    variant = status.hasError ? 'error' : 'ready';
    const width = status.mediaWidthMm !== null ? `${status.mediaWidthMm}mm` : '—';
    text = `${MODEL} · ${width} · ${relativeTime(at, now)}`;
    tooltip = status.hasError
      ? `Printer reports an error — check tape/cover (last seen ${new Date(at).toLocaleTimeString()})`
      : `Ready (last seen ${new Date(at).toLocaleTimeString()})`;
  }

  return (
    <div className={`printer-chip printer-chip--${variant}`} title={tooltip}>
      <span className="printer-chip__dot" />
      {text}
    </div>
  );
}
```

- [ ] **Step 2: Wire into Toolbar**

`src/Toolbar.tsx`: import the chip and its prop type; extend `ToolbarProps` with:

```typescript
  printerLastSeen: PrinterStatusChipProps['lastSeen'];
  printerReachable: boolean;
```

(import: `import { PrinterStatusChip, type PrinterStatusChipProps } from './PrinterStatusChip';`), destructure the two new props, and render after the spacer, before the file actions:

```tsx
      {/* Printer status */}
      <PrinterStatusChip
        lastSeen={printerLastSeen}
        reachable={printerReachable}
        printing={printDisabled ?? false}
      />
```

(`printDisabled` is the existing printing flag passed from App.)

- [ ] **Step 3: Wire App state**

`src/App.tsx`:
- Add `type PrinterStatus` to the `./printing` import list.
- Next to the printing state:

```typescript
  const [printerLastSeen, setPrinterLastSeen] = useState<{ status: PrinterStatus; at: number } | null>(null);
  const [printerReachable, setPrinterReachable] = useState(false);
```

- In the keepalive effect, pass the interval and the callback:

```typescript
    const keepalive = startUsbKeepalive({
      getDevice: async () =>
        (await usb.getDevices()).find((d) => d.vendorId === USB_VENDOR_BROTHER) ?? null,
      isBusy: () => printingRef.current,
      intervalMs: 60_000,
      onStatus: (status) => {
        setPrinterReachable(status !== null);
        if (status !== null) setPrinterLastSeen({ status, at: Date.now() });
      },
    });
```

- In `handlePrint`, right after `const status = await printRaster(…)`:

```typescript
      setPrinterLastSeen({ status, at: Date.now() });
      setPrinterReachable(true);
```

- Pass the two new props where `<Toolbar … />` is rendered:

```tsx
        printerLastSeen={printerLastSeen}
        printerReachable={printerReachable}
```

- [ ] **Step 4: Verify**

`npm test && npm run build` — 60 tests, clean build. Then in the running dev app (localhost:5180): chip visible in toolbar; gray "—" before any tick; green with tape width within ~60s of load with printer on.

- [ ] **Step 5: Commit**

```bash
git add src/PrinterStatusChip.tsx src/printerStatusChip.css src/Toolbar.tsx src/App.tsx
git commit -m "Add printer status chip to the toolbar"
```
