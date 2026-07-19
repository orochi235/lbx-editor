import type { PrinterStatus, TapeColor, TextColor } from 'obwat';
import {
  TAPE_COLOR_OPTIONS,
  TEXT_COLOR_OPTIONS,
  tapeColorCss,
  textColorCss,
} from './tapeColors';
import './debugPanel.css';

interface DebugPanelProps {
  cassetteColorsEnabled: boolean;
  onCassetteColorsEnabledChange: (on: boolean) => void;
  /** null → follow the live cassette */
  tapeColorOverride: TapeColor | null;
  onTapeColorOverrideChange: (color: TapeColor | null) => void;
  textColorOverride: TextColor | null;
  onTextColorOverrideChange: (color: TextColor | null) => void;
  /** Latest reachable-printer status, to show what the cassette reports. */
  liveStatus: PrinterStatus | null;
}

/** Dev/testing panel: cassette-color toggle + manual overrides for the
 *  tape/ink colors the canvas preview uses. */
export function DebugPanel({
  cassetteColorsEnabled,
  onCassetteColorsEnabledChange,
  tapeColorOverride,
  onTapeColorOverrideChange,
  textColorOverride,
  onTextColorOverrideChange,
  liveStatus,
}: DebugPanelProps) {
  return (
    <div className="debug-panel">
      <h3>Debug</h3>
      <label className="debug-check">
        <input
          type="checkbox"
          checked={cassetteColorsEnabled}
          onChange={(e) => onCassetteColorsEnabledChange(e.target.checked)}
        />
        Cassette colors on canvas
      </label>
      <label>
        Tape color
        <ColorSwatch css={tapeColorCss(tapeColorOverride)} />
        <select
          value={tapeColorOverride ?? ''}
          disabled={!cassetteColorsEnabled}
          onChange={(e) => onTapeColorOverrideChange((e.target.value || null) as TapeColor | null)}
        >
          <option value="">(live)</option>
          {TAPE_COLOR_OPTIONS.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </label>
      <label>
        Text color
        <ColorSwatch css={textColorCss(textColorOverride)} />
        <select
          value={textColorOverride ?? ''}
          disabled={!cassetteColorsEnabled}
          onChange={(e) => onTextColorOverrideChange((e.target.value || null) as TextColor | null)}
        >
          <option value="">(live)</option>
          {TEXT_COLOR_OPTIONS.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </label>
      <div className="debug-live">
        live cassette: {liveStatus ? `${liveStatus.tapeColor ?? '?'} / ${liveStatus.textColor ?? '?'} ink` : 'none'}
      </div>
    </div>
  );
}

function ColorSwatch({ css }: { css: string | null }) {
  if (!css) return null;
  // Data-driven color — the one legitimate inline style.
  return <span className="debug-swatch" style={{ background: css }} />;
}
