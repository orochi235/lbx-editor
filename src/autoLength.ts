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

/**
 * The label origin is pinned at x=0 on both the committed and the live path,
 * so `fitLengthToContent` serves both: the live fit during a drag is the same
 * function over the gesture's proposed poses (see `useLiveLength`).
 *
 * A head that grows for content dragged past x=0 was built and then removed —
 * it cannot coexist with the canvas's continuous refit. Growing the head moves
 * the very edge `fitViewToBounds` anchors to, so the refit pans, the pan maps
 * the same screen pointer to a larger world x, and the object is pushed back:
 * a feedback loop that parks the object at x≈0 and never grows the label. See
 * docs/superpowers/specs/2026-07-28-live-auto-length-design.md.
 */
