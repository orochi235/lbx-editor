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

/**
 * Periodically round-trips a status request so the PT-P710BT's idle
 * auto-power-off timer keeps getting reset while the app is open. The claim is
 * held only for the duration of one poll so other software can use the printer
 * between ticks. Opportunistic: every failure is swallowed.
 */
export function startUsbKeepalive(options: UsbKeepaliveOptions): () => void {
  const intervalMs = options.intervalMs ?? 5 * 60_000
  let ticking = false

  const tick = async () => {
    if (ticking || options.isBusy()) return
    ticking = true
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
    } finally {
      ticking = false
    }
  }

  const handle = setInterval(() => void tick(), intervalMs)
  return () => clearInterval(handle)
}
