/**
 * Preferences schema for the kit `PrefsDialog`. The modal is a second view
 * over App state the sidebar panels already edit — each leaf's path maps to
 * an existing setter (and its localStorage persistence) in App.tsx, so
 * changes apply live and both surfaces stay in sync.
 */
import type { PrefGroup } from '@weasel-js/ui/components/Prefs';
import type { DitherAlgorithm } from 'obwat';

/** Display names for obwat's dither algorithms — shared by the Printer
 *  panel's selector and the preferences modal. */
export const DITHER_LABELS: Record<DitherAlgorithm, string> = {
  'threshold': 'Threshold',
  'floyd-steinberg': 'Floyd–Steinberg',
  'atkinson': 'Atkinson',
  'bayer': 'Bayer',
};

/** Value shape mirrored by the schema tree below. */
export interface EditorPrefValues {
  printing: {
    autoCut: boolean;
    printPreview: boolean;
    dithering: DitherAlgorithm;
    preflightChecks: boolean;
  };
  canvas: {
    cassetteColors: boolean;
    documentWarnings: boolean;
  };
}

export const PREFS_SCHEMA: PrefGroup = {
  name: 'Preferences',
  children: {
    printing: {
      name: 'Printing',
      children: {
        autoCut: {
          kind: 'boolean',
          name: 'Auto cut',
          description: 'Cut the tape automatically after printing',
          default: true,
        },
        printPreview: {
          kind: 'boolean',
          name: 'Print preview',
          description:
            'Show the label as the printer will render it: dithered black-and-white dots at print resolution',
          default: false,
        },
        preflightChecks: {
          kind: 'boolean',
          name: 'Pre-print checks',
          description:
            'Stop a print that would waste tape — a barcode too small to render, or a tape ' +
            'size that disagrees with the loaded cassette. Turn off to print anyway; the ' +
            'printer stays the final authority either way.',
          default: true,
        },
        dithering: {
          kind: 'enum',
          name: 'Dithering',
          description:
            "How colors and grays quantize to the printer's black dots — applies to the preview and the printed label alike",
          default: 'threshold',
          options: (Object.entries(DITHER_LABELS) as [DitherAlgorithm, string][]).map(
            ([value, label]) => ({ value, label }),
          ),
        },
      },
    },
    canvas: {
      name: 'Canvas',
      children: {
        cassetteColors: {
          kind: 'boolean',
          name: 'Cassette colors',
          description:
            "Preview the loaded cassette's tape and ink colors on the canvas (print is unaffected)",
          default: true,
        },
        documentWarnings: {
          kind: 'boolean',
          name: 'Document warnings',
          description:
            'Point out objects that will not print correctly — barcodes too small to scan, ' +
            'or anything overhanging the printable area. Printing still blocks on problems it cannot render.',
          default: true,
        },
      },
    },
  },
};
