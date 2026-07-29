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

/** A label span in label points: where it starts, and how long it is. */
export interface LabelExtent {
  /** Left edge. `0` normally; negative while content hangs off the head. */
  originX: number;
  /** Distance from `originX` to the tail. */
  length: number;
}

/**
 * The label span that fits `poses`, allowing the head to extend for content at
 * negative x — what the label looks like mid-drag, before the rebase.
 *
 * The head extends only when content actually crosses zero, and never retracts
 * past it: a label whose leftmost object sits at x=50 keeps that 50pt leading
 * gap, exactly as the tail rule keeps content unreflowed.
 *
 * Distinct from `fitLengthToContent`, which answers the committed question —
 * origin pinned at 0, negative-x content ignored. The two agree whenever all
 * content is non-negative, which is every document that has been through a
 * `rebaseShift`.
 */
export function fitExtentToContent(poses: Iterable<LabelPose>): LabelExtent {
  let leftmost = 0;
  let rightmost = 0;
  for (const pose of poses) {
    if (pose.x < leftmost) leftmost = pose.x;
    const edge = pose.x + pose.width;
    if (edge > rightmost) rightmost = edge;
  }
  const originX = leftmost < 0 ? leftmost - LENGTH_MARGIN_PT : 0;
  const span = rightmost + LENGTH_MARGIN_PT - originX;
  return {
    originX,
    length: Math.min(MAX_LABEL_LENGTH_PT, Math.max(MIN_LABEL_LENGTH_PT, span)),
  };
}

/**
 * How far right to shift every object (and cut mark) so an extent whose head
 * hangs off the origin sits back at x=0 — .lbx has no way to say "negative x".
 *
 * It's just the overhang: shifting by −originX lands the leftmost object on
 * the leading margin and leaves the fitted length exactly where the drag left
 * it, so nothing moves relative to the label.
 */
export function rebaseShift(originX: number): number {
  return originX < 0 ? -originX : 0;
}
