import type { SceneNode } from '@weasel-js/core'
import { lineEndpoints, type LabelNodeData, type LabelLayer, type LabelPose } from '../label'
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
  /**
   * Resolve a decoded bitmap for an image node, reusing the editor's own
   * bitmap cache (keyed off the node, since the cache itself keys off
   * `data.src`/`data.mimeType` internally — this keeps `labelRender` decoupled
   * from that cache's implementation). Return undefined (bitmap not yet
   * decoded, or resolver omitted) to fall back to a filled box.
   */
  getImageBitmap?: (node: LabelNode) => ImageBitmap | undefined
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
  getImageBitmap,
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
      case 'image': {
        const bitmap = getImageBitmap?.(node)
        if (bitmap) {
          // rasterCore's luminance<128 threshold turns this into monochrome dots
          ctx.drawImage(bitmap, x, y, w, h)
        } else {
          // No-bitmap fallback (not yet decoded, or no resolver supplied): a
          // filled box so the printed label still shows something is there.
          ctx.fillRect(x, y, w, h)
        }
        break
      }
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
      case 'line': {
        const [p, q] = lineEndpoints({ x, y, width: w, height: h }, data.descending)
        ctx.lineWidth = Math.max(1, data.strokeWidth * dotsPerPt)
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(q.x, q.y)
        ctx.stroke()
        break
      }
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
