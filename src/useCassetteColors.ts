import { useState } from 'react';
import type { PrinterStatus, TapeColor, TextColor } from 'obwat';
import { tapeColorCss, tapeIsClear, textColorCss } from './tapeColors';

/**
 * The colors the canvas previews the label in. The printer's status replies
 * (fed by the session's keepalive ticks) report the loaded cassette's tape +
 * ink colors; Debug-panel overrides win over the live cassette; `enabled`
 * kills the whole behavior. Print is untouched — the printer lays down its one
 * ink regardless of what the screen shows.
 */
export function useCassetteColors(enabled: boolean, liveStatus: PrinterStatus | null) {
  const [tapeColorOverride, setTapeColorOverride] = useState<TapeColor | null>(null);
  const [textColorOverride, setTextColorOverride] = useState<TextColor | null>(null);

  const tapeCss =
    (enabled ? tapeColorCss(tapeColorOverride ?? liveStatus?.tapeColor) : null) ?? '#ffffff';
  const tapeClear =
    enabled && tapeIsClear(tapeColorOverride ?? liveStatus?.tapeColor);
  const inkCss =
    (enabled ? textColorCss(textColorOverride ?? liveStatus?.textColor) : null) ?? '#000000';

  return {
    tapeCss, tapeClear, inkCss,
    tapeColorOverride, setTapeColorOverride,
    textColorOverride, setTextColorOverride,
  };
}
