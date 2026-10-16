import { useSyncExternalStore } from 'react';

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
