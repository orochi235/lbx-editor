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
    const stop = startUsbKeepalive({
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
    const stop = startUsbKeepalive({
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
    const stop = startUsbKeepalive({
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
    const stop = startUsbKeepalive({
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
    const stop = startUsbKeepalive({
      getDevice: async () => device,
      isBusy: () => false,
      intervalMs: 1000,
    })
    await vi.advanceTimersByTimeAsync(1000)
    stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(written).toHaveLength(1)
  })
})
