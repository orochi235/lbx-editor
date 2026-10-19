import type { Scene } from '@weasel-js/core';
import { Printers, type MediaSpec, type PixelRect, type RgbaImage } from 'obwat';
import { tapeWidthMm, type LabelLayer, type LabelNodeData, type LabelPose, type TapeSize } from './label';
import { labelRenderPlan, printableBandPt, renderLabelToRgba } from './labelRender';
import { printDrawOne } from './drawLabelNode';
import { protectedRegions } from './ditherProtect';

interface PrintRenderArgs {
  scene: Scene<LabelNodeData, LabelLayer, LabelPose>;
  tapeSize: TapeSize;
  labelLengthPt: number;
  tapeWidthPt: number;
  /** Reused context, sized here to this render before weasel draws into it. */
  gl?: WebGL2RenderingContext;
}

/**
 * The label at printer resolution, and the regions dithering must leave
 * alone. Shared by the print job and the print preview, so the preview is the
 * print's rendering by construction: the same drawOne as the screen, through
 * weasel's headless renderer.
 */
export function renderForPrint({ scene, tapeSize, labelLengthPt, tapeWidthPt, gl }: PrintRenderArgs): {
  media: MediaSpec;
  rgba: RgbaImage;
  protect: PixelRect[];
} {
  const media = Printers.ptP710bt.media(tapeWidthMm(tapeSize));
  const geometry = {
    labelLengthPt,
    tapeWidthPt,
    printableDots: media.printableDots,
    dpi: media.dpi,
  };
  if (gl) {
    const plan = labelRenderPlan(geometry);
    gl.canvas.width = Math.max(1, Math.round(plan.sourceRect.width * plan.scale.x));
    gl.canvas.height = Math.max(1, Math.round(plan.sourceRect.height * plan.scale.y));
  }
  const band = printableBandPt(geometry);
  const drawOne = printDrawOne({ dpi: media.dpi, originY: band.y });
  const rgba = renderLabelToRgba({ scene, drawOne, gl, ...geometry });
  const protect = protectedRegions(scene.nodes.values(), { band, dpi: media.dpi });
  return { media, rgba, protect };
}
