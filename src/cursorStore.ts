import { useCallback, useMemo, useSyncExternalStore, type RefObject } from 'react';
import type { View } from '@weasel-js/core';

export interface Point {
  x: number;
  y: number;
}

/** The pointer's position over the canvas in label points, or null off it.
 *  Kept outside React state so a pointer move re-renders only its readers. */
export interface CursorStore {
  set(point: Point | null): void;
  get(): Point | null;
  subscribe(listener: () => void): () => void;
}

export function createCursorStore(): CursorStore {
  let current: Point | null = null;
  const listeners = new Set<() => void>();
  return {
    set(point) {
      current = point;
      for (const l of listeners) l();
    },
    get: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useCursor(store: CursorStore): Point | null {
  return useSyncExternalStore(store.subscribe, store.get);
}

/** A cursor store fed by the canvas container's pointer events. The view is
 *  a camera: world = view origin + client offset / scale. */
export function useCanvasCursor(viewRef: RefObject<View>) {
  const cursor = useMemo(createCursorStore, []);
  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const v = viewRef.current;
    cursor.set({ x: v.x + (e.clientX - r.left) / v.scale.x, y: v.y + (e.clientY - r.top) / v.scale.y });
  }, [cursor, viewRef]);
  const handlePointerLeave = useCallback(() => cursor.set(null), [cursor]);
  return { cursor, handlePointerMove, handlePointerLeave };
}
