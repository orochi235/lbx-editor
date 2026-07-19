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
}

/**
 * Unit math mapping label geometry onto `renderSceneToPixels` arguments.
 *
 * Horizontal: points → printer dots at full resolution (`dpi/72`).
 *
 * Vertical squeeze: node y/height are authored in points against the *full*
 * tape width (`tapeWidthPt`), but `printableDots` is the narrower printable
 * band (the printhead can't reach the tape's outer edges). For v1 we squeeze
 * the full tape height onto printableDots (`scale.y = printableDots /
 * tapeWidthPt`) rather than scaling by dpi and center-cropping — this keeps
 * every node visible instead of clipping ones near the tape edges, at the
 * cost of a slight vertical squeeze. Exact print-margin fidelity is a
 * follow-up. Output height rounds back to exactly `printableDots`.
 */
export function labelRenderPlan({ labelLengthPt, tapeWidthPt, printableDots, dpi }: LabelGeometry) {
  return {
    sourceRect: { x: 0, y: 0, width: labelLengthPt, height: tapeWidthPt },
    scale: {
      x: dpi / 72,
      y: tapeWidthPt > 0 ? printableDots / tapeWidthPt : 1,
    },
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
export function renderLabelToRgba({ scene, drawOne, ...geometry }: RenderArgs): RgbaImage {
  return renderSceneToPixels({ scene, drawOne, ...labelRenderPlan(geometry) })
}
