import type { PrinterStatus, TapeColor, TextColor } from 'obwat';
import { PropertyField, PropertyList, PropertyNote, type PropertyOption } from '@weasel-js/ui/components/Properties';
import {
  TAPE_COLOR_OPTIONS,
  TEXT_COLOR_OPTIONS,
  tapeColorCss,
  textColorCss,
} from './tapeColors';
import './debugPanel.css';

const LIVE = 'live';

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

function ColorSwatch({ css }: { css: string | null }) {
  if (!css) return null;
  // Data-driven color — the one legitimate inline style.
  return <span className="debug-swatch" style={{ background: css }} />;
}

function colorOptions<C extends string>(colors: readonly C[], css: (c: C) => string | null): PropertyOption<string>[] {
  return [
    { value: LIVE, label: '(live)' },
    ...colors.map((c) => ({ value: c, label: c, glyph: <ColorSwatch css={css(c)} /> })),
  ];
}

const TAPE_OPTIONS = colorOptions(TAPE_COLOR_OPTIONS, tapeColorCss);
const TEXT_OPTIONS = colorOptions(TEXT_COLOR_OPTIONS, textColorCss);

/** Dev/testing panel: cassette-color toggle + manual overrides for the
 *  tape/ink colors the canvas preview uses. */
export function DebugPanel(props: DebugPanelProps) {
  const { liveStatus } = props;
  return (
    <PropertyList>
      <PropertyField
        kind="boolean"
        label="Cassette colors on canvas"
        value={props.cassetteColorsEnabled}
        onChange={props.onCassetteColorsEnabledChange}
      />
      <PropertyField
        kind="enum"
        label="Tape color"
        value={props.tapeColorOverride ?? LIVE}
        options={TAPE_OPTIONS}
        disabled={!props.cassetteColorsEnabled}
        onChange={(v) => props.onTapeColorOverrideChange(v === LIVE ? null : (v as TapeColor))}
      />
      <PropertyField
        kind="enum"
        label="Text color"
        value={props.textColorOverride ?? LIVE}
        options={TEXT_OPTIONS}
        disabled={!props.cassetteColorsEnabled}
        onChange={(v) => props.onTextColorOverrideChange(v === LIVE ? null : (v as TextColor))}
      />
      <PropertyNote>
        live cassette: {liveStatus ? `${liveStatus.tapeColor ?? '?'} / ${liveStatus.textColor ?? '?'} ink` : 'none'}
      </PropertyNote>
    </PropertyList>
  );
}
