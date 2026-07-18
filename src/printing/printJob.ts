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
    // 32-byte Brother status; reply to the stream's early status request — printer
    // state around job start (missing tape, open cover), not completion. Blocking
    // here also ensures the printer consumed the job before we close the port.
    const status = await transport.read(2000, 32)
    return driver.parseStatus(status)
  } finally {
    await transport.close()
  }
}
