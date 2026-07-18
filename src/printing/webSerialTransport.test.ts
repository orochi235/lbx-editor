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
