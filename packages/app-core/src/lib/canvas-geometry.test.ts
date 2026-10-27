import { describe, expect, it } from 'vitest'
import { canvasSize, lockCanvasAxis, resizeCanvasRect, type ResizeHandle } from './canvas-geometry'
import { patchCanvasNode, serializeCanvas, type CanvasDocument } from './json-canvas'

const start = { x: 100, y: 200, width: 400, height: 260 }
describe('Canvas axis and resize geometry', () => {
  it('locks to the dominant axis and keeps it through later snapping/movement', () => {
    const horizontal = lockCanvasAxis(start, { x: 180, y: 230 })
    expect(horizontal).toEqual({ position: { x: 180, y: 200 }, axis: 'x' })
    expect(lockCanvasAxis(start, { x: 190, y: 400 }, horizontal.axis).position).toEqual({
      x: 190,
      y: 200
    })
    expect(lockCanvasAxis(start, { x: 120, y: 280 })).toEqual({
      position: { x: 100, y: 280 },
      axis: 'y'
    })
  })
  it('keeps a 400x260 card proportional using gesture-start dimensions', () => {
    const next = resizeCanvasRect(start, 'bottom-right', { x: 100, y: 10 }, true)
    expect(next).toEqual({ x: 100, y: 200, width: 500, height: 325 })
    // Zoom only changes screen-to-world conversion; the same world delta
    // must not be reapplied to intermediate boxes or uninitialized sizes.
    expect(resizeCanvasRect(start, 'bottom-right', { x: 100, y: 10 }, true)).toEqual(next)
    const topLeft = resizeCanvasRect(start, 'top-left', { x: -100, y: -10 }, true)
    expect(topLeft.x + topLeft.width).toBe(start.x + start.width)
    expect(topLeft.y + topLeft.height).toBe(start.y + start.height)
    expect(topLeft.width / topLeft.height).toBeCloseTo(start.width / start.height, 2)
  })
  it('clamps every edge/corner resize before it can cross or produce invalid size', () => {
    const handles: ResizeHandle[] = [
      'top',
      'right',
      'bottom',
      'left',
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right'
    ]
    for (const handle of handles)
      for (const aspect of [false, true])
        for (const delta of [
          { x: -10000, y: -10000 },
          { x: 10000, y: 10000 },
          { x: NaN, y: Infinity }
        ]) {
          const next = resizeCanvasRect(start, handle, delta, aspect)
          expect(Number.isFinite(next.width) && Number.isFinite(next.height)).toBe(true)
          expect(next.width).toBeGreaterThanOrEqual(80)
          expect(next.height).toBeGreaterThanOrEqual(60)
          if (aspect)
            expect(
              Math.abs(next.width - (next.height * start.width) / start.height)
            ).toBeLessThanOrEqual(1.3)
        }
  })
  it('enforces dimensions at both patch and serialization boundaries', () => {
    const doc: CanvasDocument = {
      extra: true,
      nodes: [{ ...start, id: 'card', type: 'text', text: 'kept', extension: { key: 1 } }],
      edges: []
    }
    expect(patchCanvasNode(doc, 'card', { width: 0, height: -60 }).nodes![0]).toMatchObject({
      width: 80,
      height: 60
    })
    expect(patchCanvasNode(doc, 'card', { width: NaN, height: Infinity }).nodes![0]).toMatchObject({
      width: 400,
      height: 260
    })
    const serialized = JSON.parse(
      serializeCanvas({ ...doc, nodes: [{ ...doc.nodes![0], width: NaN, height: -60 }] })
    )
    expect(serialized.nodes[0]).toMatchObject({
      width: 80,
      height: 60,
      text: 'kept',
      extension: { key: 1 }
    })
    expect(serialized.extra).toBe(true)
    expect(canvasSize(-Infinity, Infinity)).toEqual({ width: 80, height: 60 })
  })
})
