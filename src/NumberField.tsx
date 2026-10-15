import { useState, type ReactNode } from 'react';
import './numberField.css';

/** A number shown at `decimals` places, trailing zeros kept so a column of
 *  them lines up. */
export function formatNumber(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

/**
 * A labeled number input with a unit. Shows the value rounded to `decimals`
 * until it's focused; while focused it holds exactly what was typed, so the
 * rounding never rewrites a number mid-entry. `value: null` reads as "mixed"
 * (a multi-selection that disagrees) and stays empty until a number is typed.
 */
export function NumberField({ label, value, unit, decimals = 1, step, onChange }: {
  label: string;
  value: number | null;
  unit?: string;
  decimals?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === null ? '' : formatNumber(value, decimals));

  return (
    <label className="number-field">
      <span className="number-field__label">{label}</span>
      <input
        type="number"
        value={shown}
        placeholder={value === null ? 'mixed' : undefined}
        step={step ?? 10 ** -decimals}
        onFocus={() => setDraft(shown)}
        onBlur={() => setDraft(null)}
        onChange={(e) => {
          setDraft(e.target.value);
          if (e.target.value !== '' && Number.isFinite(Number(e.target.value))) {
            onChange(Number(e.target.value));
          }
        }}
      />
      {unit && <span className="number-field__unit">{unit}</span>}
    </label>
  );
}

/** Two fields side by side. */
export function FieldPair({ children }: { children: ReactNode }) {
  return <div className="field-pair">{children}</div>;
}
