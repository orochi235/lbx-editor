/**
 * Protocol dispatch: a barcode node's fields in, a drawable symbol out.
 *
 * .lbx stores barcodes semantically — protocol, payload, and rendering
 * parameters, never a raster — so the symbologies are encoded here. Symbologies
 * we don't implement fail closed; the canvas draws a placeholder and
 * printPreflight blocks the job rather than printing a box where bars belong.
 */
import type { BarcodeProtocol } from 'bil-lbx';
import type { EncodeResult } from './types';
import { encodeCode39 } from './code39';
import { encodeCode128 } from './code128';
import { encodeEan } from './ean';
import { encodeQr } from './qr';
import { encodeItf } from './itf';

export interface EncodeRequest {
  protocol: BarcodeProtocol;
  data: string;
  checkDigit?: boolean;
  zeroFill?: boolean;
  barRatio?: string;
  qrCode?: { eccLevel?: string; version?: string };
}

/** .lbx records the bar ratio as "1:N"; default 1:3 when absent or unparseable. */
export function parseRatio(barRatio: string | undefined): number {
  const n = Number(barRatio?.split(':')[1]);
  return Number.isFinite(n) && n >= 2 && n <= 3 ? n : 3;
}

/** Encode a payload, or say why we can't. Never throws — a bad payload is a
 *  normal state the canvas renders as a placeholder. */
export function encodeBarcode(req: EncodeRequest): EncodeResult {
  switch (req.protocol) {
    case 'CODE39':
      return encodeCode39(req.data, { ratio: parseRatio(req.barRatio) });
    case 'CODE128':
      return encodeCode128(req.data, { gs1: false });
    case 'GS1-128':
      return encodeCode128(req.data, { gs1: true });
    case 'EAN13':
    case 'EAN8':
    case 'UPCA':
    case 'UPCE':
      return encodeEan(req.data, req.protocol, { zeroFill: req.zeroFill ?? false });
    case 'ITF':
      return encodeItf(req.data, {
        ratio: parseRatio(req.barRatio),
        checkDigit: req.checkDigit ?? false,
      });
    case 'QRCODE':
      return encodeQr(req.data, {
        ...(req.qrCode?.eccLevel !== undefined ? { eccLevel: req.qrCode.eccLevel } : {}),
        ...(req.qrCode?.version !== undefined ? { version: req.qrCode.version } : {}),
      });
    default:
      return { ok: false, reason: 'unsupported', detail: req.protocol };
  }
}
