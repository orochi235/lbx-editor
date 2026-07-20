import type { LabelImageData, LabelPose } from './label';

/** The file most recently chosen from the IMG tool's picker, held app-side
 *  until a canvas drag commits it (see the `image` insertNodeFactory). */
export interface PendingImage {
  /** Base64 image bytes, no `data:` prefix — matches `LabelImageData.src`. */
  src: string;
  originalName: string;
  mimeType: string;
  /** Natural size scaled to fit the label, computed at pick time. */
  defaultWidth: number;
  defaultHeight: number;
}

/** Drags below this (pt) in either axis count as a click: the image drops at
 *  its default size instead of contain-fitting into a sliver. */
const MIN_DRAG_PT = 4;

/** Node factory core for the `image` insert kind. Contain-fits the picked
 *  image into the drag box (preserving aspect), anchored at the drag origin.
 *  Returns `null` (rejecting the insert) when nothing has been picked. */
export function buildImageInsert(
  pending: PendingImage | null,
  bounds: { x: number; y: number; width: number; height: number },
): { data: LabelImageData; pose: LabelPose } | null {
  if (!pending) return null;
  const { defaultWidth, defaultHeight } = pending;
  let width = defaultWidth;
  let height = defaultHeight;
  if (bounds.width >= MIN_DRAG_PT && bounds.height >= MIN_DRAG_PT) {
    const s = Math.min(bounds.width / defaultWidth, bounds.height / defaultHeight);
    width = defaultWidth * s;
    height = defaultHeight * s;
  }
  return {
    data: {
      kind: 'image',
      src: pending.src,
      originalName: pending.originalName,
      mimeType: pending.mimeType,
    },
    pose: { x: bounds.x, y: bounds.y, width, height },
  };
}
