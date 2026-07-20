import {
  renderSceneToPixels,
  type Scene,
  type SceneViewDrawOne,
} from '@weasel-js/core'
import type { LabelNodeData, LabelLayer, LabelPose } from './label'
import type { RgbaImage } from 'obwat'

interface LabelGeometry {
  /** Label length along the tape, in points (the paper's full width in App.tsx). */
  labelLengthPt: number
  /** Full tape width in points (the paper's full height in App.tsx, i.e. `TAPE_SIZES[...].width`). */
  tapeWidthPt: number
  printableDots: number
  dpi: number
}

interface RenderArgs extends LabelGeometry {
  scene: Scene<LabelNodeData, LabelLayer, LabelPose>
  /**
   * Per-node draw callback — pass the same one the on-screen canvas uses
   * (`drawLabelNode`) so print is pixel-for-pixel the screen's rendering.
   */
  drawOne: SceneViewDrawOne<LabelNodeData, LabelLayer, LabelPose>
  /** Caller-owned WebGL2 context to render with (weasel never disposes it).
   *  Lets repeat callers — the live print preview — reuse one context
   *  instead of churning one per render. Omit for one-shot renders. */
  gl?: WebGL2RenderingContext
}

/** The printable band's height and top offset in points: `printableDots` at
 *  `dpi`, centered in the full tape width. The printhead can't reach the
 *  tape's outer edges, so this is the only strip that prints. */
export function printableBandPt({ tapeWidthPt, printableDots, dpi }: {
  tapeWidthPt: number
  printableDots: number
  dpi: number
}): { y: number; height: number } {
  const height = printableDots * (72 / dpi)
  return { y: (tapeWidthPt - height) / 2, height }
}

/**
 * Unit math mapping label geometry onto `renderSceneToPixels` arguments.
 *
 * Uniform scale — points → printer dots at `dpi/72` on both axes, so print
 * preserves the screen's aspect ratio exactly. The source rect is the
 * centered printable band, not the full tape: content in the unprintable
 * margins is cropped, matching what the printhead physically does (the
 * on-screen overlay dims those margins so nothing crops silently). Output
 * height lands on exactly `printableDots`.
 */
export function labelRenderPlan({ labelLengthPt, tapeWidthPt, printableDots, dpi }: LabelGeometry) {
  const band = printableBandPt({ tapeWidthPt, printableDots, dpi })
  return {
    sourceRect: { x: 0, y: band.y, width: labelLengthPt, height: band.height },
    scale: { x: dpi / 72, y: dpi / 72 },
    background: '#ffffff',
  }
}

/**
 * Render the label scene to a clean monochrome-ready RGBA bitmap at print
 * resolution, via weasel's headless renderer — the same WebGL2 pipeline that
 * draws the screen. Output: width = labelLengthPt * dpi/72 (dots along the
 * tape), height = printableDots. rasterCore's luminance<128 threshold
 * downstream turns this into monochrome dots.
 */
export function renderLabelToRgba({ scene, drawOne, gl, ...geometry }: RenderArgs): RgbaImage {
  return renderSceneToPixels({ scene, drawOne, gl, ...labelRenderPlan(geometry) })
}
