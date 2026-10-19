import { useEffect, useRef, useState } from 'react';
import { subscribeImageReady, type Scene } from '@weasel-js/core';
import { ditherToMask, type DitherAlgorithm } from 'obwat';
import type { LabelLayer, LabelNodeData, LabelPose, TapeSize } from './label';
import { maskToRgba } from './printPreview';
import { renderForPrint } from './printRender';
import { registerFonts } from './fonts';

interface PrintPreviewArgs {
  enabled: boolean;
  scene: Scene<LabelNodeData, LabelLayer, LabelPose>;
  sceneVersion: number;
  tapeSize: TapeSize;
  labelLength: number;
  paperHeight: number;
  inkCss: string;
  ditherAlgorithm: DitherAlgorithm;
}

/**
 * The dithered print preview: runs the real print pipeline (renderForPrint →
 * ditherToMask, with the same algorithm the print job uses) on every committed
 * scene change and returns the resulting dots as a bitmap of the printable
 * band — ink dots in the cassette ink color, everything else transparent so
 * the tape face shows through. One long-lived GL context is reused across
 * renders; the debounce absorbs bursts of scene mutations. Null while off.
 */
export function usePrintPreview({
  enabled, scene, sceneVersion, tapeSize, labelLength, paperHeight, inkCss, ditherAlgorithm,
}: PrintPreviewArgs): ImageBitmap | null {
  const [previewBitmap, setPreviewBitmap] = useState<ImageBitmap | null>(null);
  const previewGlRef = useRef<WebGL2RenderingContext | null>(null);
  // While the preview is up the live scene draw is suppressed, so nothing
  // else pulls image nodes through the kit cache — the preview render itself
  // starts the decode and this epoch re-runs it when the bitmap lands.
  const [imageEpoch, setImageEpoch] = useState(0);
  useEffect(() => subscribeImageReady(() => setImageEpoch((n) => n + 1)), []);
  useEffect(() => {
    if (!enabled) {
      setPreviewBitmap((prev) => {
        prev?.close();
        return null;
      });
      return;
    }
    let canceled = false;
    const handle = setTimeout(async () => {
      // Text needs its MSDF atlases registered before renderLabelToRgba draws
      // it; registerFonts() is idempotent so this is a no-op once settled.
      await registerFonts();
      if (canceled) return;
      if (!previewGlRef.current) {
        const canvas = new OffscreenCanvas(1, 1);
        const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, stencil: true });
        if (!gl) return;
        previewGlRef.current = gl;
      }
      const { rgba, protect } = renderForPrint({
        scene, tapeSize, labelLengthPt: labelLength, tapeWidthPt: paperHeight, gl: previewGlRef.current,
      });
      const mask = ditherToMask(rgba, { algorithm: ditherAlgorithm, protect });
      const pixels = maskToRgba(mask, rgba.width, rgba.height, inkCss);
      const out = new OffscreenCanvas(rgba.width, rgba.height);
      const ctx = out.getContext('2d')!;
      ctx.putImageData(new ImageData(pixels, rgba.width, rgba.height), 0, 0);
      const bmp = out.transferToImageBitmap();
      if (canceled) {
        bmp.close();
        return;
      }
      setPreviewBitmap((prev) => {
        prev?.close();
        return bmp;
      });
    }, 120);
    return () => {
      canceled = true;
      clearTimeout(handle);
    };
  }, [enabled, sceneVersion, imageEpoch, scene, tapeSize, labelLength, paperHeight, inkCss, ditherAlgorithm]);

  return previewBitmap;
}
