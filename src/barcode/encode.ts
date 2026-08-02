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
import { encodeCodabar } from './codabar';
import { encodeDataMatrix } from './datamatrix';
import { encodePdf417 } from './pdf417';

/**
 * The protocols `encodeBarcode` can actually draw, in the order the property
 * panel offers them. The dispatcher below is the authority; `encode.test.ts`
 * pins this list against it so the two can't drift.
 */
export const SUPPORTED_PROTOCOLS = [
  'CODE128',
  'GS1-128',
  'CODE39',
  'ITF',
  'CODABAR',
  'EAN13',
  'EAN8',
  'UPCA',
  'UPCE',
  'QRCODE',
  'DATAMATRIX',
  'PDF417',
] as const satisfies readonly BarcodeProtocol[];

export function isSupportedProtocol(protocol: BarcodeProtocol): boolean {
  return (SUPPORTED_PROTOCOLS as readonly BarcodeProtocol[]).includes(protocol);
}

export interface EncodeRequest {
  protocol: BarcodeProtocol;
  data: string;
  checkDigit?: boolean;
  zeroFill?: boolean;
  barRatio?: string;
  qrCode?: { eccLevel?: string; version?: string };
  dataMatrix?: { model?: string; cellSize?: number };
  pdf417?: { row?: string; column?: string; eccLevel?: string; aspect?: number };
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
    case 'CODABAR':
      return encodeCodabar(req.data, parseRatio(req.barRatio));
    case 'QRCODE':
      return encodeQr(req.data, {
        ...(req.qrCode?.eccLevel !== undefined ? { eccLevel: req.qrCode.eccLevel } : {}),
        ...(req.qrCode?.version !== undefined ? { version: req.qrCode.version } : {}),
      });
    case 'DATAMATRIX':
      return encodeDataMatrix(req.data);
    case 'PDF417':
      return encodePdf417(req.data, {
        ...(asCount(req.pdf417?.column) !== undefined
          ? { columns: asCount(req.pdf417?.column) }
          : {}),
        ...(asCount(req.pdf417?.row) !== undefined ? { rows: asCount(req.pdf417?.row) } : {}),
        ...(asEccLevel(req.pdf417?.eccLevel) !== undefined
          ? { eccLevel: asEccLevel(req.pdf417?.eccLevel) }
          : {}),
        ...(req.pdf417?.aspect !== undefined ? { aspect: req.pdf417.aspect } : {}),
      });
    default:
      return { ok: false, reason: 'unsupported', detail: unsupportedReason(req.protocol) };
  }
}

/**
 * Why a symbology we don't encode isn't coming. Two of these are permanent
 * enough to deserve a reason rather than a name: one of them no amount of work
 * here would fix, and the other is a name a user won't recognize under the one
 * P-touch writes.
 */
function unsupportedReason(protocol: BarcodeProtocol): string {
  switch (protocol) {
    case 'MAXICODE':
      // ISO/IEC 16023 fixes the symbol at 28.14 x 26.91mm and offers no smaller
      // version. The widest tape this printer takes is 24mm, whose printable
      // band is 128 dots at 180dpi -- 18.1mm. It cannot be printed at any size.
      return 'MaxiCode is a fixed size (26.9mm tall) and the widest printable band on this printer is 18.1mm, so it cannot be printed';
    // `RSS` is the name P-touch stamps for the same symbology bil-lbx calls
    // GS1DATABAR, so both have to answer to the name a user would look for.
    case 'GS1DATABAR':
    case 'RSS':
      return 'GS1 DataBar is not supported yet';
    default:
      // A whole sentence, because the property panel shows this verbatim and a
      // bare protocol name reads as a label rather than an explanation.
      return `${protocol} isn't rendered yet`;
  }
}

/**
 * A row or column count a file states, or undefined for anything else.
 *
 * "auto" is P-touch's way of saying "reader, pick one", and it is the value
 * every field here carries unless the user pinned it. A number means the file
 * states the symbol it was drawn with, and we draw that one — no two
 * implementations auto-select the same shape, so discarding a stated count
 * would reopen the file at a different size.
 */
function asCount(v: string | undefined): number | undefined {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * The same reading for an error correction level, which differs in exactly one
 * way: **0 is a level**, not an absence. `asCount`'s `n > 0` would drop it and
 * silently hand PDF417 the recommendation for the payload length instead —
 * which for a short payload is level 2, four times the error correction the
 * file asked for and a visibly bigger symbol. The upper bound is ISO 15438's.
 */
function asEccLevel(v: string | undefined): number | undefined {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isInteger(n) && n >= 0 && n <= 8 ? n : undefined;
}
