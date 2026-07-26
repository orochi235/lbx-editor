/**
 * Label-specific types bridging the weasel scene graph and the bil-lbx
 * serialization format. Each scene node carries one of these as its `data`.
 */
import type { BarcodeProtocol, QrEccLevel } from 'bil-lbx';

export interface LabelTextData {
  kind: 'text';
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  horizontalAlignment: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFY';
  verticalAlignment: 'TOP' | 'CENTER' | 'BOTTOM';
  color: string;
}

export interface LabelRectData {
  kind: 'rect';
  rounded: boolean;
  roundness: number;
  strokeStyle: string;
  strokeWidth: number;
  fillColor: string | null;
}

export interface LabelLineData {
  kind: 'line';
  strokeStyle: string;
  strokeWidth: number;
  /** True: the line runs top-left → bottom-right of its pose box; false: bottom-left → top-right. */
  descending: boolean;
}

export interface LabelImageData {
  kind: 'image';
  /** Base64-encoded image data */
  src: string;
  originalName: string;
  mimeType: string;
}

/**
 * Mirrors bil-lbx's BarcodeObject minus `type`/`position` — those live in the
 * node's kind and pose. Kept field-for-field so import/export is a rename
 * rather than a lossy projection.
 *
 * .lbx stores barcodes semantically (protocol + payload + parameters, never a
 * raster), so `src/barcode/` encodes them for display and print.
 */
export interface LabelBarcodeData {
  kind: 'barcode';
  protocol: BarcodeProtocol;
  data: string;
  /** Narrow-module width in pt as the file recorded it. Geometry uses the pose
   *  instead — this is re-derived from the pose on export. */
  barWidth: number;
  /** Narrow:wide ratio for the symbologies that have one, e.g. "1:3". */
  barRatio: string;
  humanReadable: boolean;
  humanReadableAlignment: 'LEFT' | 'CENTER' | 'RIGHT';
  checkDigit: boolean;
  zeroFill: boolean;
  qrCode?: { model?: number; eccLevel?: QrEccLevel; cellSize?: number; version?: string };
}

export type LabelNodeData =
  | LabelTextData
  | LabelRectData
  | LabelLineData
  | LabelImageData
  | LabelBarcodeData;

export type LabelLayer = 'objects';

export interface LabelPose {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Standard tape sizes — width in pt, displayed height is the label length */
export const TAPE_SIZES = {
  '6mm': { width: 17, displayName: '6mm' },
  '9mm': { width: 25.5, displayName: '9mm' },
  '12mm': { width: 33.6, displayName: '12mm' },
  '18mm': { width: 51, displayName: '18mm' },
  '24mm': { width: 68, displayName: '24mm' },
  '36mm': { width: 102, displayName: '36mm' },
} as const;

export type TapeSize = keyof typeof TAPE_SIZES;

export const DEFAULT_TAPE: TapeSize = '12mm';
export const DEFAULT_LABEL_LENGTH = 200; // pt, for fixed-length labels

/** The two endpoints of a line within its pose box, honoring its diagonal direction. */
export function lineEndpoints(
  pose: { x: number; y: number; width: number; height: number },
  descending: boolean,
): [{ x: number; y: number }, { x: number; y: number }] {
  return descending
    ? [{ x: pose.x, y: pose.y }, { x: pose.x + pose.width, y: pose.y + pose.height }]
    : [{ x: pose.x, y: pose.y + pose.height }, { x: pose.x + pose.width, y: pose.y }];
}
