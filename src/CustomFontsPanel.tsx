import { useEffect, useState } from 'react';
import {
  addCustomFont,
  customFontKey,
  inferFontMeta,
  listCustomFonts,
  removeCustomFont,
  validateFilePair,
  validateMetricsJson,
  type CustomFontSummary,
} from './customFonts';
import { Button } from '@weasel-js/ui/components/Button';
import { CloseButton } from '@weasel-js/ui/components/CloseButton';
import { PropertyField, PropertyList } from '@weasel-js/ui/components/Properties';
import './customFontsPanel.css';

interface PendingUpload {
  jsonFile: File;
  pngFile: File;
  family: string;
  weight: number;
  italic: boolean;
}

/** Sidebar panel: lists stored custom (uploaded) MSDF fonts and lets the
 *  user add a new one from a baked atlas pair (.json metrics + .png atlas,
 *  as produced by weasel's `npm run gen:font`). */
export function CustomFontsPanel() {
  const [fonts, setFonts] = useState<CustomFontSummary[]>([]);
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set());
  // Keys re-added over an existing record: weasel's registerFont silently
  // skips an already-registered (family,weight,style), so the corrected
  // atlas is stored but the live glyphs don't update until reload.
  const [overwrittenKeys, setOverwrittenKeys] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void listCustomFonts().then(setFonts);
  }, []);

  async function handleFilesPicked(fileList: FileList | null) {
    setError(null);
    setPending(null);
    if (!fileList) return;
    const files = Array.from(fileList);
    const check = validateFilePair(files);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    const { jsonFile, pngFile } = check.pair;

    let text: string;
    try {
      text = await jsonFile.text();
    } catch {
      setError('Could not read the metrics file');
      return;
    }
    const metricsCheck = validateMetricsJson(text);
    if (!metricsCheck.ok) {
      setError(metricsCheck.error);
      return;
    }
    const meta = inferFontMeta(metricsCheck.parsed, jsonFile.name);
    setPending({
      jsonFile,
      pngFile,
      family: meta.family,
      weight: meta.weight,
      italic: meta.style === 'italic',
    });
  }

  async function handleConfirmAdd() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const family = pending.family.trim();
      const style = pending.italic ? 'italic' : 'normal';
      const key = customFontKey(family, pending.weight, style);
      const wasRemoved = removedKeys.has(key);
      // Only a genuine re-registration (the key was already live, not one
      // the user just removed) leaves stale glyphs until reload.
      const isOverwrite = !wasRemoved && fonts.some((f) => f.key === key);

      const metricsJson = await pending.jsonFile.text();
      await addCustomFont({
        family,
        weight: pending.weight,
        style,
        metricsJson,
        atlasBlob: pending.pngFile,
      });

      setPending(null);
      setAddOpen(false);
      setFonts(await listCustomFonts());
      if (wasRemoved) {
        setRemovedKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
      if (isOverwrite) {
        setOverwrittenKeys((prev) => new Set(prev).add(key));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add font');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(key: string) {
    setError(null);
    try {
      await removeCustomFont(key);
      setRemovedKeys((prev) => new Set(prev).add(key));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove font');
    }
  }

  const variantName = (f: CustomFontSummary) =>
    `${f.family} ${f.weight}${f.style === 'italic' ? ' italic' : ''}`;

  return (
    <div className="custom-fonts-panel">
      {fonts.length === 0 ? (
        <p className="custom-fonts-panel__note">No custom fonts yet.</p>
      ) : (
        <ul className="custom-fonts-panel__list">
          {fonts.map((f) => (
            <li key={f.key} className="custom-fonts-panel__row">
              {removedKeys.has(f.key) ? (
                <span className="custom-fonts-panel__note">
                  {variantName(f)} — removed, takes effect on reload
                </span>
              ) : overwrittenKeys.has(f.key) ? (
                <span className="custom-fonts-panel__note">
                  {variantName(f)} — updated, takes effect on reload
                </span>
              ) : (
                <>
                  <span>{variantName(f)}</span>
                  <CloseButton ariaLabel={`Remove ${variantName(f)}`} onClick={() => handleRemove(f.key)} />
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && !addOpen && <p className="custom-fonts-panel__error">{error}</p>}

      {!addOpen && (
        <Button size="sm" fullWidth onClick={() => setAddOpen(true)}>
          Add font…
        </Button>
      )}

      {addOpen && (
        <div className="custom-fonts-panel__form">
          <label className="custom-fonts-panel__file">
            Atlas pair (.json + .png)
            <input
              type="file"
              accept=".json,.png"
              multiple
              onChange={(e) => void handleFilesPicked(e.target.files)}
            />
          </label>

          {pending && (
            <PropertyList>
              <PropertyField
                kind="string"
                label="Family"
                value={pending.family}
                onChange={(family) => setPending({ ...pending, family })}
              />
              <PropertyField
                kind="number"
                label="Weight"
                step={100}
                min={100}
                max={900}
                value={pending.weight}
                onChange={(weight) => setPending({ ...pending, weight })}
              />
              <PropertyField
                kind="boolean"
                label="Italic"
                value={pending.italic}
                onChange={(italic) => setPending({ ...pending, italic })}
              />
            </PropertyList>
          )}

          {error && <p className="custom-fonts-panel__error">{error}</p>}

          <div className="custom-fonts-panel__actions">
            {pending && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => void handleConfirmAdd()}
                disabled={busy || !pending.family.trim()}
              >
                Add
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => {
                setAddOpen(false);
                setPending(null);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
