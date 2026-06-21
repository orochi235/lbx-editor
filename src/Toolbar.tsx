import { TAPE_SIZES, type TapeSize } from './label';

interface ToolbarProps {
  tapeSize: TapeSize;
  onTapeSizeChange: (size: TapeSize) => void;
  autoLength: boolean;
  onAutoLengthChange: (auto: boolean) => void;
  labelLength: number;
  onLabelLengthChange: (len: number) => void;
  onExport: () => void;
  onImport: () => void;
  onAddText: () => void;
  onAddRect: () => void;
  onAddLine: () => void;
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
  onAddText,
  onAddRect,
  onAddLine,
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

      {/* Object creation */}
      <button onClick={onAddText} title="Add text object">T</button>
      <button onClick={onAddRect} title="Add rectangle">▢</button>
      <button onClick={onAddLine} title="Add line">―</button>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* File actions */}
      <button onClick={onImport}>Open .lbx</button>
      <button onClick={onExport}>Export .lbx</button>
    </div>
  );
}
