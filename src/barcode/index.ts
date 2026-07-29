export {
  encodeBarcode,
  parseRatio,
  SUPPORTED_PROTOCOLS,
  isSupportedProtocol,
  type EncodeRequest,
} from './encode';
export {
  barcodeRects,
  barcodeBackgroundRect,
  barcodeModulePt,
  quietZonePt,
  HUMAN_READABLE_HEIGHT_PT,
  QUIET_ZONE_MODULES_1D,
  QUIET_ZONE_MODULES_2D,
  type Rect,
} from './geometry';
export {
  barcodeModuleDots,
  moduleFitness,
  MIN_RENDERABLE_MODULE_DOTS,
  MIN_RELIABLE_MODULE_DOTS,
  type ModuleFitness,
} from './scannability';
export { barcodeRequest } from './request';
export type { BarcodeSymbol, Symbol1D, Symbol2D, EncodeResult, EncodeFailure } from './types';
