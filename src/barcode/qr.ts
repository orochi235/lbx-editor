/**
 * QR codes. The Reed-Solomon and masking work comes from `qrcode-generator`
 * (MIT, zero dependencies); we take its module matrix and hand it to geometry
 * as rectangles, so the symbol stays vector at printer resolution.
 */
import qrcode from 'qrcode-generator';
import type { EncodeResult } from './types';

/** .lbx records error correction as a percentage string. */
const ECC: Record<string, 'L' | 'M' | 'Q' | 'H'> = {
  '7%': 'L', '15%': 'M', '25%': 'Q', '30%': 'H',
};

export interface QrOptions {
  eccLevel?: string;
  /** .lbx version: "auto", or "1".."40" pinning the symbol size. */
  version?: string;
}

export function encodeQr(data: string, opts: QrOptions): EncodeResult {
  if (data.length === 0) {
    return { ok: false, reason: 'invalid', detail: 'QR code needs a payload' };
  }
  const level = ECC[opts.eccLevel ?? '15%'] ?? 'M';
  const pinned = Number(opts.version);
  try {
    // 0 = auto-select the smallest version that fits.
    const typeNumber = Number.isInteger(pinned) && pinned >= 1 && pinned <= 40 ? pinned : 0;
    const qr = qrcode(typeNumber as Parameters<typeof qrcode>[0], level);
    qr.addData(data);
    qr.make();
    const size = qr.getModuleCount();
    const modules = Array.from({ length: size }, (_, r) =>
      Array.from({ length: size }, (_, c) => qr.isDark(r, c)),
    );
    return { ok: true, kind: '2d', size, modules, text: data };
  } catch (err) {
    // The library throws when the payload overflows the largest version.
    return { ok: false, reason: 'invalid', detail: String(err instanceof Error ? err.message : err) };
  }
}
