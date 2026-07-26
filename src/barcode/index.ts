export {
  encodeBarcode,
  parseRatio,
  SUPPORTED_PROTOCOLS,
  isSupportedProtocol,
  type EncodeRequest,
} from './encode';
export { barcodeRects, barcodeModulePt, HUMAN_READABLE_HEIGHT_PT, type Rect } from './geometry';
export {
  barcodeModuleDots,
  moduleFitness,
  MIN_RENDERABLE_MODULE_DOTS,
  MIN_RELIABLE_MODULE_DOTS,
  type ModuleFitness,
} from './scannability';
export { barcodeRequest } from './request';
export type { BarcodeSymbol, Symbol1D, Symbol2D, EncodeResult, EncodeFailure } from './types';
