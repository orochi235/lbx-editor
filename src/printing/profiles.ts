import type { DeviceProfile, MediaSpec } from './types'
import { createBrotherRasterDriver } from './brotherDriver'
import { createWebSerialTransport, type SerialPortLike } from './webSerialTransport'

export const PT_P710BT_DPI = 180
export const PT_P710BT_PRINTHEAD_DOTS = 128

/** Build the media spec for a given tape width (mm) on the PT-P710BT. */
export function ptP710btMedia(tapeWidthMm: number): MediaSpec {
  const printableDots = Math.min(
    PT_P710BT_PRINTHEAD_DOTS,
    Math.round((tapeWidthMm / 25.4) * PT_P710BT_DPI),
  )
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
