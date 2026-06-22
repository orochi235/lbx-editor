/**
 * Label-specific types bridging the weasel scene graph and the brother-lbx
 * serialization format. Each scene node carries one of these as its `data`.
 */

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
}

export interface LabelImageData {
  kind: 'image';
  /** Base64-encoded image data */
  src: string;
  originalName: string;
  mimeType: string;
}

export type LabelNodeData = LabelTextData | LabelRectData | LabelLineData | LabelImageData;

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
