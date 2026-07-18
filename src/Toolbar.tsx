import { useEffect, useState } from 'react';
import { TAPE_SIZES, type TapeSize } from './label';
import { PrinterStatusChip, type PrinterStatusChipProps } from './PrinterStatusChip';
import './toolbar.css';

// Zoom slider: logarithmic mapping over weasel's zoom clamp range (0.1×–8×), so
// equal slider travel is equal proportional zoom. Expressed in percent.
const ZOOM_MIN_PCT = 10;
const ZOOM_MAX_PCT = 800;
const SLIDER_STEPS = 1000;
const LOG_RATIO = Math.log(ZOOM_MAX_PCT / ZOOM_MIN_PCT);

function sliderToPercent(slider: number): number {
  const t = slider / SLIDER_STEPS;
  return ZOOM_MIN_PCT * Math.exp(LOG_RATIO * t);
}

function percentToSlider(percent: number): number {
  const clamped = Math.min(Math.max(percent, ZOOM_MIN_PCT), ZOOM_MAX_PCT);
  return (Math.log(clamped / ZOOM_MIN_PCT) / LOG_RATIO) * SLIDER_STEPS;
}

interface ToolbarProps {
  tapeSize: TapeSize;
  onTapeSizeChange: (size: TapeSize) => void;
  autoLength: boolean;
  onAutoLengthChange: (auto: boolean) => void;
  labelLength: number;
  onLabelLengthChange: (len: number) => void;
  onExport: () => void;
  onImport: () => void;
  onAddImage: () => void;
  onPrint: () => void;
  printDisabled?: boolean;
  autoCut: boolean;
  onAutoCutChange: (on: boolean) => void;
  zoomPercent: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomSet: (percent: number) => void;
  onZoomFit: () => void;
  onZoomReset: () => void;
  printerLastSeen: PrinterStatusChipProps['lastSeen'];
  printerReachable: boolean;
}

export function Toolbar({
  tapeSize,
  onTapeSizeChange,
  autoLength,
  onAutoLengthChange,
  labelLength,
  onLabelLengthChange,
  onExport,
  onImport,
  onAddImage,
  onPrint,
  printDisabled,
  autoCut,
  onAutoCutChange,
  zoomPercent,
  onZoomIn,
  onZoomOut,
  onZoomSet,
  onZoomFit,
  onZoomReset,
  printerLastSeen,
  printerReachable,
}: ToolbarProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '8px 16px',
      borderBottom: '1px solid #ddd',
      background: '#fff',
      flexShrink: 0,
      flexWrap: 'wrap',
    }}>
      {/* Tape config */}
      <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
        Tape:
        <select
          value={tapeSize}
          onChange={(e) => onTapeSizeChange(e.target.value as TapeSize)}
        >
          {Object.entries(TAPE_SIZES).map(([key, val]) => (
            <option key={key} value={key}>{val.displayName}</option>
          ))}
        </select>
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
        <input
          type="checkbox"
          checked={autoLength}
          onChange={(e) => onAutoLengthChange(e.target.checked)}
        />
        Auto length
      </label>

      {!autoLength && (
        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
          Length:
          <input
            type="number"
            value={labelLength}
            onChange={(e) => onLabelLengthChange(Number(e.target.value))}
            style={{ width: '50px' }}
          />
          pt
        </label>
      )}

      {/* Separator */}
      <div style={{ width: '1px', height: '24px', background: '#ddd' }} />

      {/* Image import (no weasel tool — images come from a file, not a drag) */}
      <button onClick={onAddImage} title="Add image">IMG</button>

      {/* Separator */}
      <div style={{ width: '1px', height: '24px', background: '#ddd' }} />

      {/* Zoom */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <button onClick={onZoomOut} title="Zoom out">−</button>
        <input
          type="range"
          min={0}
          max={SLIDER_STEPS}
          value={Math.round(percentToSlider(zoomPercent))}
          onChange={(e) => onZoomSet(sliderToPercent(Number(e.target.value)))}
          title="Zoom"
          style={{ width: '110px' }}
        />
        <button onClick={onZoomIn} title="Zoom in">+</button>
        <ZoomInput percent={zoomPercent} onCommit={onZoomSet} />
        <button onClick={onZoomFit} title="Zoom to fit">⤢</button>
        <button onClick={onZoomReset} title="Reset to 100%">Reset</button>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Printer status */}
      <PrinterStatusChip
        lastSeen={printerLastSeen}
        reachable={printerReachable}
        printing={printDisabled ?? false}
      />

      {/* File actions */}
      <button onClick={onImport}>Open .lbx</button>
      <button onClick={onExport}>Export .lbx</button>
      <label className="toolbar-check" title="Cut the tape automatically after printing">
        <input
          type="checkbox"
          checked={autoCut}
          onChange={(e) => onAutoCutChange(e.target.checked)}
        />
        Auto cut
      </label>
      <button type="button" onClick={onPrint} disabled={printDisabled} title="Print to label printer">
        Print
      </button>
    </div>
  );
}

/**
 * Editable zoom percentage. Shows the live zoom while not being edited; commits
 * a typed value on Enter or blur. Escape reverts to the live value.
 */
function ZoomInput({
  percent,
  onCommit,
}: {
  percent: number;
  onCommit: (percent: number) => void;
}) {
  const [draft, setDraft] = useState(String(percent));
  const [editing, setEditing] = useState(false);

  // Track the live zoom whenever the user isn't mid-edit.
  useEffect(() => {
    if (!editing) setDraft(String(percent));
  }, [percent, editing]);

  const commit = () => {
    setEditing(false);
    const value = Number(draft);
    if (Number.isFinite(value) && value > 0) {
      onCommit(value);
    } else {
      setDraft(String(percent));
    }
  };

  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '2px', fontSize: '13px' }}>
      <input
        type="text"
        inputMode="numeric"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => {
          setEditing(true);
          e.target.select();
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setDraft(String(percent));
            setEditing(false);
            e.currentTarget.blur();
          }
        }}
        style={{ width: '40px', textAlign: 'right' }}
      />
      %
    </label>
  );
}
