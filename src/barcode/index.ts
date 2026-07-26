export {
  encodeBarcode,
  parseRatio,
  SUPPORTED_PROTOCOLS,
  isSupportedProtocol,
  type EncodeRequest,
} from './encode';
export { barcodeRects, barcodeModulePt, HUMAN_READABLE_HEIGHT_PT, type Rect } from './geometry';
export { barcodeRequest } from './request';
export type { BarcodeSymbol, Symbol1D, Symbol2D, EncodeResult, EncodeFailure } from './types';
