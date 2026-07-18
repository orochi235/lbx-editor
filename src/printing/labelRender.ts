import type { SceneNode } from '@weasel-js/core'
import type { LabelNodeData, LabelLayer, LabelPose } from '../label'
import type { RgbaImage } from './types'

type LabelNode = SceneNode<LabelNodeData, LabelLayer, LabelPose>

interface RenderArgs {
  nodes: LabelNode[]
  /** Label length along the tape, in points (the paper's full width in App.tsx). */
  labelLengthPt: number
  /** Full tape width in points (the paper's full height in App.tsx, i.e. `TAPE_SIZES[...].width`). */
  tapeWidthPt: number
  printableDots: number
  dpi: number
}

/**
 * Render label nodes to a clean monochrome-ready RGBA bitmap at print resolution.
 * Output: width = labelLengthPt * dpi/72 (dots along the tape), height = printableDots.
 *
 * Vertical scale: node y/height are authored in points against the *full* tape
 * width (`tapeWidthPt`), but `printableDots` is the narrower printable band
 * (the printhead can't reach the tape's outer edges). For v1 we squeeze the
 * full tape height onto printableDots with a single scale factor
 * (`printableDots / (tapeWidthPt * dotsPerPt)`) rather than scaling by dpi and
 * center-cropping — this keeps every node visible instead of clipping ones
 * near the tape edges, at the cost of a slight vertical squeeze. Exact
 * print-margin fidelity is a follow-up.
 */
export function renderLabelToRgba({
  nodes,
  labelLengthPt,
  tapeWidthPt,
  printableDots,
  dpi,
}: RenderArgs): RgbaImage {
  const dotsPerPt = dpi / 72
  const widthDots = Math.max(1, Math.round(labelLengthPt * dotsPerPt))
  const fullHeightDots = tapeWidthPt * dotsPerPt
  const verticalScale = fullHeightDots > 0 ? printableDots / fullHeightDots : 1

  const canvas = document.createElement('canvas')
  canvas.width = widthDots
  canvas.height = printableDots
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('could not get 2d context')

  // white background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, widthDots, printableDots)
  ctx.fillStyle = '#000000'
  ctx.strokeStyle = '#000000'

  for (const node of nodes) {
    const { pose, data } = node
    const x = pose.x * dotsPerPt
    const y = pose.y * dotsPerPt * verticalScale
    const w = pose.width * dotsPerPt
    const h = pose.height * dotsPerPt * verticalScale

    switch (data.kind) {
      case 'image':
        // images: drawn opaque-black as a filled box for v1 (bitmap compositing comes later)
        ctx.fillRect(x, y, w, h)
        break
      case 'rect':
        if (data.fillColor && data.fillColor !== 'transparent') {
          // Use the rect's actual fill color (not the default black) so a
          // light fill (e.g. white/yellow) doesn't print as a solid black
          // box; rasterCore's luminance<128 threshold decides what ends up
          // black on the printed tape.
          ctx.fillStyle = data.fillColor
          ctx.fillRect(x, y, w, h)
          ctx.fillStyle = '#000000'
        }
        ctx.lineWidth = Math.max(1, data.strokeWidth * dotsPerPt)
        ctx.strokeRect(x, y, w, h)
        break
      case 'line':
        ctx.lineWidth = Math.max(1, data.strokeWidth * dotsPerPt)
        ctx.beginPath()
        ctx.moveTo(x, y + h / 2)
        ctx.lineTo(x + w, y + h / 2)
        ctx.stroke()
        break
      case 'text':
        // text-as-box (current editor behavior): outline the bounds
        ctx.lineWidth = 1
        ctx.strokeRect(x, y, w, h)
        break
    }
  }

  const imageData = ctx.getImageData(0, 0, widthDots, printableDots)
  return { width: widthDots, height: printableDots, data: imageData.data }
}
