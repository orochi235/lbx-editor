import { useCallback, useMemo, useState } from 'react';
import type { DitherAlgorithm } from 'obwat';
import type { EditorPrefValues } from './prefs';
import { usePersistedFlag } from './usePersistedFlag';

const AUTOCUT_KEY = 'lbx-editor.autoCut';
const CASSETTE_COLORS_KEY = 'lbx-editor.cassetteColors';
const DOCUMENT_WARNINGS_KEY = 'lbx-editor.documentWarnings';
const MARGIN_GUIDES_KEY = 'lbx-editor.marginGuides';
const PREFLIGHT_CHECKS_KEY = 'lbx-editor.preflightChecks';
const PRINT_PREVIEW_KEY = 'lbx-editor.printPreview';
const DITHER_KEY = 'lbx-editor.dither';

const DITHER_ALGORITHMS: readonly DitherAlgorithm[] = [
  'threshold', 'floyd-steinberg', 'atkinson', 'bayer',
];

function savedDitherAlgorithm(): DitherAlgorithm {
  const v = localStorage.getItem(DITHER_KEY) as DitherAlgorithm | null;
  return v && DITHER_ALGORITHMS.includes(v) ? v : 'threshold';
}

/**
 * The persisted editor settings. The sidebar panels and the Preferences modal
 * are two views over these: each modal leaf path dispatches to the same
 * persisting setter the panels use, so both surfaces stay in sync.
 */
export function useEditorPrefs() {
  const [autoCut, handleAutoCutChange] = usePersistedFlag(AUTOCUT_KEY, true);
  const [cassetteColorsEnabled, handleCassetteColorsChange] = usePersistedFlag(CASSETTE_COLORS_KEY, true);
  const [documentWarnings, handleDocumentWarningsChange] = usePersistedFlag(DOCUMENT_WARNINGS_KEY, true);
  const [marginGuides, handleMarginGuidesChange] = usePersistedFlag(MARGIN_GUIDES_KEY, false);
  const [preflightChecks, handlePreflightChecksChange] = usePersistedFlag(PREFLIGHT_CHECKS_KEY, true);
  const [printPreview, handlePrintPreviewChange] = usePersistedFlag(PRINT_PREVIEW_KEY, false);
  // Dither algorithm — one setting drives both the preview and the real
  // print job (rgbaToRaster), so what you see is what the head lays down.
  const [ditherAlgorithm, setDitherAlgorithm] = useState<DitherAlgorithm>(savedDitherAlgorithm);
  const handleDitherAlgorithmChange = useCallback((algorithm: DitherAlgorithm) => {
    setDitherAlgorithm(algorithm);
    localStorage.setItem(DITHER_KEY, algorithm);
  }, []);

  const prefValues: EditorPrefValues = useMemo(() => ({
    printing: { autoCut, printPreview, dithering: ditherAlgorithm, preflightChecks },
    canvas: { cassetteColors: cassetteColorsEnabled, documentWarnings, marginGuides },
  }), [autoCut, printPreview, ditherAlgorithm, preflightChecks, cassetteColorsEnabled, documentWarnings, marginGuides]);
  const handlePrefChange = useCallback((path: string, value: unknown) => {
    switch (path) {
      case 'printing.autoCut': handleAutoCutChange(value as boolean); break;
      case 'printing.printPreview': handlePrintPreviewChange(value as boolean); break;
      case 'printing.dithering': handleDitherAlgorithmChange(value as DitherAlgorithm); break;
      case 'canvas.cassetteColors': handleCassetteColorsChange(value as boolean); break;
      case 'canvas.documentWarnings': handleDocumentWarningsChange(value as boolean); break;
      case 'canvas.marginGuides': handleMarginGuidesChange(value as boolean); break;
      case 'printing.preflightChecks': handlePreflightChecksChange(value as boolean); break;
    }
  }, [handleAutoCutChange, handlePrintPreviewChange, handleDitherAlgorithmChange, handleCassetteColorsChange, handleDocumentWarningsChange, handleMarginGuidesChange, handlePreflightChecksChange]);

  return {
    autoCut, handleAutoCutChange,
    cassetteColorsEnabled, handleCassetteColorsChange,
    documentWarnings, handleDocumentWarningsChange,
    marginGuides, handleMarginGuidesChange,
    preflightChecks, handlePreflightChecksChange,
    printPreview, handlePrintPreviewChange,
    ditherAlgorithm, handleDitherAlgorithmChange,
    prefValues, handlePrefChange,
  };
}
