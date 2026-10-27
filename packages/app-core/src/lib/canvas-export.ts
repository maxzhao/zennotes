import type { CanvasDocument } from './json-canvas'
import { canvasColor } from './json-canvas'

// Rasterize SVG edges directly, not inside html-to-image's foreignObject.
// In particular, edge backgrounds and text must not depend on inherited SVG
// fill/CSS variables surviving a nested SVG -> HTML -> SVG image conversion.
export function paintCanvasEdges(
  context: CanvasRenderingContext2D,
  viewport: HTMLElement,
  doc: CanvasDocument,
  privacy: boolean,
  background: string,
  foreground: string
): void {
  for (const edge of doc.edges ?? []) {
    const host = Array.from(viewport.querySelectorAll<SVGGElement>('.react-flow__edge')).find(
      (element) => element.dataset.id === edge.id
    )
    const path = host?.querySelector<SVGPathElement>('.react-flow__edge-path')
    if (!path) continue
    context.save()
    context.strokeStyle = edge.color ? canvasColor(edge.color) : foreground
    context.fillStyle = context.strokeStyle
    context.lineWidth = 2
    context.stroke(new Path2D(path.getAttribute('d') ?? ''))
    const length = path.getTotalLength()
    const arrow = (atStart: boolean): void => {
      const tip = path.getPointAtLength(atStart ? 0 : length)
      const inner = path.getPointAtLength(atStart ? Math.min(10, length) : Math.max(0, length - 10))
      const angle = Math.atan2(tip.y - inner.y, tip.x - inner.x)
      context.beginPath()
      context.moveTo(tip.x, tip.y)
      context.lineTo(tip.x - 12 * Math.cos(angle - 0.4), tip.y - 12 * Math.sin(angle - 0.4))
      context.lineTo(tip.x - 12 * Math.cos(angle + 0.4), tip.y - 12 * Math.sin(angle + 0.4))
      context.closePath()
      context.fill()
    }
    if (edge.fromEnd === 'arrow') arrow(true)
    if (edge.toEnd !== 'none') arrow(false)
    if (!privacy && edge.label) {
      const text = host?.querySelector<SVGTextElement>('.react-flow__edge-text')
      const group = text?.parentElement as unknown as SVGGElement | null
      const matrix = group?.transform.baseVal.consolidate()?.matrix
      if (text && matrix) {
        context.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f)
        const bbox = text.getBBox(),
          style = getComputedStyle(text)
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
        context.fillStyle = background
        context.fillRect(bbox.x - 4, bbox.y - 3, bbox.width + 8, bbox.height + 6)
        context.fillStyle = foreground
        context.textBaseline = 'alphabetic'
        context.fillText(
          edge.label,
          0,
          Number(text.getAttribute('y') ?? 0) + parseFloat(style.fontSize) * 0.3
        )
      }
    }
    context.restore()
  }
}
