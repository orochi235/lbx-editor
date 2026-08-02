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
    ...(data.dataMatrix
      ? {
          dataMatrix: {
            ...(data.dataMatrix.model !== undefined ? { model: data.dataMatrix.model } : {}),
            ...(data.dataMatrix.cellSize !== undefined
              ? { cellSize: data.dataMatrix.cellSize }
              : {}),
          },
        }
      : {}),
    ...(data.pdf417
      ? {
          pdf417: {
            ...(data.pdf417.row !== undefined ? { row: data.pdf417.row } : {}),
            ...(data.pdf417.column !== undefined ? { column: data.pdf417.column } : {}),
            ...(data.pdf417.eccLevel !== undefined ? { eccLevel: data.pdf417.eccLevel } : {}),
            ...(data.pdf417.aspect !== undefined ? { aspect: data.pdf417.aspect } : {}),
          },
        }
      : {}),
  };
}
