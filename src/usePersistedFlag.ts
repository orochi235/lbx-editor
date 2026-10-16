import { useCallback, useState } from 'react';

/** Reads a stored on/off flag: '1' or '0', anything else (or unreadable
 *  storage) falls back to `fallback`. */
export function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === '1' ? true : v === '0' ? false : fallback;
  } catch {
    return fallback;
  }
}

export function writeFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // Storage unavailable — the setting just won't survive a reload.
  }
}

/** A boolean setting persisted to localStorage under `key`. */
export function usePersistedFlag(key: string, fallback: boolean): [boolean, (on: boolean) => void] {
  const [value, setValue] = useState(() => readFlag(key, fallback));
  const set = useCallback((on: boolean) => {
    setValue(on);
    writeFlag(key, on);
  }, [key]);
  return [value, set];
}
