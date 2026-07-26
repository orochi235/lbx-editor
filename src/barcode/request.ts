/**
 * The one place a barcode node's fields become an encode request. The canvas,
 * the exporter and the print preflight all encode the same node and must agree
 * on the result, so they share this rather than each assembling their own.
 */
import type { LabelBarcodeData } from '../label';
import type { EncodeRequest } from './encode';

export function barcodeRequest(data: LabelBarcodeData): EncodeRequest {
  return {
    protocol: data.protocol,
    data: data.data,
    checkDigit: data.checkDigit,
    zeroFill: data.zeroFill,
    barRatio: data.barRatio,
    ...(data.qrCode
      ? {
          qrCode: {
            ...(data.qrCode.eccLevel !== undefined ? { eccLevel: data.qrCode.eccLevel } : {}),
            ...(data.qrCode.version !== undefined ? { version: data.qrCode.version } : {}),
          },
        }
      : {}),
  };
}
