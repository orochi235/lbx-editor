import type { RefObject } from 'react';
import type { InsertNodeFactory } from '@weasel-js/core';
import type { LabelNodeData } from './label';
import { buildImageInsert, type PendingImage } from './imageInsert';
import { snapNodePose } from './dotSnap';
import { PRINT_DPI } from './printDpi';

/**
 * The per-kind factories the `insert` action materializes nodes through. Each
 * returns a `LabelNode`'s data + pose in the app's own shape (matching
 * `drawLabelNode` / PropertyPanel / export) rather than the kit's default
 * `{ path, fill }` node.
 */
export function labelInsertFactories(
  pendingImageRef: RefObject<PendingImage | null>,
): Record<string, InsertNodeFactory> {
  return {
    rect: (b) => ({
      pose: { x: b.x, y: b.y, width: b.width, height: b.height },
      data: {
        kind: 'rect',
        rounded: false,
        roundness: 0,
        strokeStyle: '#000000',
        strokeWidth: 0.8,
        fillColor: null,
      } satisfies LabelNodeData,
    }),
    line: (b, extras) => {
      // The line tool passes its endpoints in `extras`; fall back to the AABB
      // diagonal. Height floors at the stroke width so the pose stays pickable.
      const e = extras as { a?: { x: number; y: number }; b?: { x: number; y: number } };
      const a = e.a ?? { x: b.x, y: b.y };
      const c = e.b ?? { x: b.x + b.width, y: b.y + b.height };
      return {
        pose: {
          x: Math.min(a.x, c.x),
          y: Math.min(a.y, c.y),
          width: Math.max(Math.abs(c.x - a.x), 1),
          height: Math.max(Math.abs(c.y - a.y), 0.5),
        },
        data: {
          kind: 'line',
          strokeStyle: '#000000',
          strokeWidth: 0.5,
          descending: (c.x - a.x) * (c.y - a.y) >= 0,
        } satisfies LabelNodeData,
      };
    },
    text: (b) => ({
      pose: { x: b.x, y: b.y, width: Math.max(b.width, 40), height: Math.max(b.height, 12) },
      data: {
        kind: 'text',
        text: 'Text',
        fontFamily: 'Helvetica',
        fontSize: 12,
        fontWeight: 700,
        italic: false,
        horizontalAlignment: 'LEFT',
        verticalAlignment: 'CENTER',
        color: '#000000',
      } satisfies LabelNodeData,
    }),
    image: (b) => buildImageInsert(pendingImageRef.current, b),
    barcode: (b) => {
      const data = {
        kind: 'barcode',
        protocol: 'CODE128',
        data: '12345678',
        barWidth: 1.2,
        barRatio: '1:3',
        humanReadable: true,
        humanReadableAlignment: 'CENTER',
        checkDigit: false,
        zeroFill: false,
        opaqueBackground: true,
      } satisfies LabelNodeData;
      const pose = { x: b.x, y: b.y, width: Math.max(b.width, 40), height: Math.max(b.height, 16) };
      return { pose: snapNodePose(data, pose, PRINT_DPI), data };
    },
  };
}
