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
