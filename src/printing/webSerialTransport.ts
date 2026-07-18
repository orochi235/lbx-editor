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
