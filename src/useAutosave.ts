import { useEffect, useRef } from 'react';
import type { Scene } from '@weasel-js/core';
import { TAPE_SIZES, type LabelLayer, type LabelNodeData, type LabelPose, type TapeSize } from './label';
import { migratePersistedScene } from './docMigrate';
import { bumpNodeIdCounter } from './nodeIds';
import type { LabelConfig } from './useLabelConfig';

/** Autosaved document (scene + tape config) — restored on load so a refresh
 *  doesn't lose the label being edited. */
const DOC_KEY = 'lbx-editor.doc';

/**
 * Restores the autosaved document once on mount (before the save effect ever
 * writes), then debounce-saves scene + tape config on every committed change.
 * Corrupt/stale snapshots are discarded, quota failures skipped — persistence
 * must never take the editor down.
 */
export function useAutosave(
  scene: Scene<LabelNodeData, LabelLayer, LabelPose>,
  sceneVersion: number,
  config: LabelConfig,
): void {
  const { tapeSize, autoLength, manualLength, cutMarks } = config;
  const { setTapeSize, setManualLength, setAutoLength, setCutMarks } = config;

  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const raw = localStorage.getItem(DOC_KEY);
    if (!raw) return;
    try {
      const doc = JSON.parse(raw) as {
        tapeSize?: TapeSize;
        autoLength?: boolean;
        labelLength?: number;
        cutMarks?: number[];
        scene?: Parameters<typeof scene.loadState>[0];
      };
      if (doc.tapeSize && doc.tapeSize in TAPE_SIZES) setTapeSize(doc.tapeSize);
      if (typeof doc.labelLength === 'number' && Number.isFinite(doc.labelLength) && doc.labelLength > 0) {
        setManualLength(doc.labelLength);
      }
      if (typeof doc.autoLength === 'boolean') setAutoLength(doc.autoLength);
      if (Array.isArray(doc.cutMarks) && doc.cutMarks.every((x) => typeof x === 'number' && Number.isFinite(x))) {
        setCutMarks(doc.cutMarks);
      }
      if (doc.scene) {
        // `loadState` stores node data verbatim, so a field added since this
        // snapshot was written arrives undefined and the compiler can't see it.
        scene.loadState(migratePersistedScene(doc.scene));
        bumpNodeIdCounter(scene.nodes.keys());
      }
    } catch {
      localStorage.removeItem(DOC_KEY);
    }
  }, [scene]);

  useEffect(() => {
    const handle = setTimeout(() => {
      try {
        localStorage.setItem(
          DOC_KEY,
          // labelLength persists the manual value: under auto-length the
          // length is derived from the scene, so it restores itself.
          JSON.stringify({ tapeSize, autoLength, labelLength: manualLength, cutMarks, scene: scene.toJSON() }),
        );
      } catch {
        // Storage full (huge embedded images) or unavailable — skip this save.
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [scene, sceneVersion, tapeSize, autoLength, manualLength, cutMarks]);
}
