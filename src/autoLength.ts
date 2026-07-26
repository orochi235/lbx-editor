/**
 * Auto-length: the label ends a fixed margin past the rightmost content edge,
 * the way P-touch Editor's "auto length" does.
 *
 * Content is never reflowed — whatever leading gap the layout has is part of
 * the label. Only the tail is fitted.
 */
import { TAPE_MARGIN_PT, AUTO_LENGTH_MAX_PT } from 'bil-lbx';
import type { LabelPose } from './label';

/** Leader/trailer along the length axis (pt) — P-touch reserves 5.6pt (2mm). */
export const LENGTH_MARGIN_PT = TAPE_MARGIN_PT;
/** Shortest auto-fitted label: just the two margins (4mm). */
export const MIN_LABEL_LENGTH_PT = TAPE_MARGIN_PT * 2;
/** Longest: P-touch's auto-length ceiling (1000mm). */
export const MAX_LABEL_LENGTH_PT = AUTO_LENGTH_MAX_PT;

/**
 * The label length that fits `poses`, in pt. Empty content (or content that
 * lies entirely off the left of the tape) yields the minimum.
 */
export function fitLengthToContent(poses: Iterable<LabelPose>): number {
  let rightmost = 0;
  for (const pose of poses) {
    const edge = pose.x + pose.width;
    if (edge > rightmost) rightmost = edge;
  }
  const fitted = rightmost + LENGTH_MARGIN_PT;
  return Math.min(MAX_LABEL_LENGTH_PT, Math.max(MIN_LABEL_LENGTH_PT, fitted));
}
