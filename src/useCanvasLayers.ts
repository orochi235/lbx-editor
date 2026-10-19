import { useCallback, useEffect, useMemo, useState } from 'react';
import { rectPath, type DrawCommand } from '@weasel-js/core';
import type { LabelNode, LabelPose } from './label';
import { drawLabelNode } from './drawLabelNode';
import { remapNodeInk } from './tapeColors';
import { PRINT_DPI } from './printDpi';
import { registerFonts } from './fonts';
import { paperLayer } from './paperLayer';

interface CanvasLayersArgs {
  /** The drawn length, which follows a drag in flight. */
  displayLength: number;
  /** The committed length. */
  paperWidth: number;
  paperHeight: number;
  tapeCss: string;
  tapeClear: boolean;
  inkCss: string;
  previewBitmap: ImageBitmap | null;
  printableBand: { y: number; height: number };
  cutMarks: number[];
  marginGuides: boolean;
}

/** SceneCanvas's `layers`: the tape beneath, the scene on it, and the
 *  selection handles. */
export function useCanvasLayers({
  displayLength, paperWidth, paperHeight, tapeCss, tapeClear, inkCss, previewBitmap, printableBand,
  cutMarks, marginGuides,
}: CanvasLayersArgs) {
  // MSDF fonts register asynchronously; text draws blank (no glyphs) until
  // this settles. Flipping this state forces the layers to a new identity
  // (see the `layers` memo below) so text appears without the user having to
  // interact with the canvas.
  const [fontsLoaded, setFontsLoaded] = useState(false);
  useEffect(() => {
    // No cancellation guard on this async callback: the editor is the root
    // component and never unmounts, so there's nothing to race.
    registerFonts().then(() => setFontsLoaded(true));
  }, []);

  const paper = useMemo(
    () => paperLayer({
      displayLength, paperWidth, paperHeight, tapeCss, tapeClear, previewBitmap, printableBand,
      cutMarks, marginGuides,
    }),
    [displayLength, paperWidth, paperHeight, tapeCss, tapeClear, previewBitmap, printableBand, cutMarks, marginGuides],
  );

  // Two recolor paths, and they are not interchangeable. `remapNodeInk`
  // rewrites colors the *document* carries — a text's color, a rect's fill —
  // which it can only do because they're on the node. A barcode has none: its
  // bars and its background are picked by the renderer, so they come through
  // the `options` argument instead. Print takes neither path: it keeps the raw
  // node data (a white-ink remap would erase the label under the <128
  // luminance threshold) and takes the parameter defaults.
  const drawScreenNode = useCallback((node: LabelNode, pose: LabelPose) => {
    const data = remapNodeInk(node.data, inkCss);
    return drawLabelNode(
      data === node.data ? node : { ...node, data },
      pose,
      { ink: inkCss, paper: tapeCss, grid: { dpi: PRINT_DPI, originY: printableBand.y } },
    );
  }, [inkCss, tapeCss, printableBand]);

  // --- Printable-bounds overlay ---
  // Content outside the printable area won't print: print crops at the label
  // length horizontally and at the printhead's reach vertically (the tape's
  // top/bottom margins — labelRender renders only the centered printable
  // band). Draw the scene twice: a faded full copy, then a crisp copy
  // clipped to that band — anything unprintable reads as semitransparent.
  // Commands and the clip path are world-space; weasel applies the view.
  // Follows the display pair: without that, a dragged object would read as
  // semitransparent — "outside the label" — while sitting inside the label
  // that just grew to hold it.
  const printablePath = useMemo(
    () => rectPath(0, printableBand.y, displayLength, printableBand.height),
    [printableBand, displayLength],
  );
  const dimOffLabel = useCallback(
    (cmds: DrawCommand[]): DrawCommand[] =>
      cmds.length === 0
        ? cmds
        : [
            { kind: 'group', alpha: 0.35, children: cmds },
            { kind: 'group', clip: printablePath, children: cmds },
          ],
    [printablePath],
  );

  // While the print preview bitmap is up, the live scene draw is suppressed —
  // the paper layer's dithered dots ARE the content. Selection handles stay.
  const drawNothing = useCallback(() => [], []);
  return useMemo(() => ({
    paper: { layer: paper, before: 'scene' as const },
    scene: previewBitmap
      ? { drawOne: drawNothing }
      : { drawOne: drawScreenNode, postProcess: dimOffLabel },
    selectionOverlay: { handles: { size: 5 } },
    // fontsLoaded isn't read here — it's a dependency only, so that the
    // fonts-ready transition changes this object's identity and SceneCanvas
    // redraws (mirroring how `previewBitmap` already does).
  }), [paper, previewBitmap, drawNothing, drawScreenNode, dimOffLabel, fontsLoaded]);
}
