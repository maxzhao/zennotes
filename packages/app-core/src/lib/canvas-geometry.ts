export interface CanvasPoint {
  x: number
  y: number
}
export interface CanvasRect extends CanvasPoint {
  width: number
  height: number
}
export type CanvasAxis = 'x' | 'y'
export type ResizeHandle =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
export const CANVAS_MIN_WIDTH = 80
export const CANVAS_MIN_HEIGHT = 60

export function canvasSize(
  width: number,
  height: number,
  fallback = { width: CANVAS_MIN_WIDTH, height: CANVAS_MIN_HEIGHT }
): { width: number; height: number } {
  const dimension = (value: number, previous: number, minimum: number): number =>
    Math.max(
      minimum,
      Math.round(Number.isFinite(value) ? value : Number.isFinite(previous) ? previous : minimum)
    )
  return {
    width: dimension(width, fallback.width, CANVAS_MIN_WIDTH),
    height: dimension(height, fallback.height, CANVAS_MIN_HEIGHT)
  }
}

// Apply after snapping: neither grid/object snaps nor a final XYDrag update
// may put movement back onto the locked axis.
export function lockCanvasAxis(
  start: CanvasPoint,
  proposed: CanvasPoint,
  axis?: CanvasAxis
): { position: CanvasPoint; axis: CanvasAxis } {
  const locked =
    axis ?? (Math.abs(proposed.x - start.x) >= Math.abs(proposed.y - start.y) ? 'x' : 'y')
  return {
    position: locked === 'x' ? { x: proposed.x, y: start.y } : { x: start.x, y: proposed.y },
    axis: locked
  }
}

// Delta is in canvas/world coordinates, independent of viewport zoom. Always
// derive from the gesture snapshot, never from a measured or intermediate box.
export function resizeCanvasRect(
  start: CanvasRect,
  handle: ResizeHandle,
  delta: CanvasPoint,
  aspect: boolean
): CanvasRect {
  const size = canvasSize(start.width, start.height)
  const dx = Number.isFinite(delta.x) ? delta.x : 0,
    dy = Number.isFinite(delta.y) ? delta.y : 0
  const horizontal = handle.includes('left') || handle.includes('right')
  const vertical = handle.includes('top') || handle.includes('bottom')
  let width = size.width + (handle.includes('left') ? -dx : horizontal ? dx : 0)
  let height = size.height + (handle.includes('top') ? -dy : vertical ? dy : 0)
  if (aspect) {
    const useWidth =
      horizontal &&
      (!vertical ||
        Math.abs((width - size.width) / size.width) >=
          Math.abs((height - size.height) / size.height))
    const scale = Math.max(
      useWidth ? width / size.width : height / size.height,
      CANVAS_MIN_WIDTH / size.width,
      CANVAS_MIN_HEIGHT / size.height
    )
    width = size.width * scale
    height = size.height * scale
  }
  const next = canvasSize(width, height, size)
  const x = handle.includes('left')
    ? start.x + size.width - next.width
    : aspect && !horizontal
      ? start.x + (size.width - next.width) / 2
      : start.x
  const y = handle.includes('top')
    ? start.y + size.height - next.height
    : aspect && !vertical
      ? start.y + (size.height - next.height) / 2
      : start.y
  return { x: Math.round(x), y: Math.round(y), ...next }
}
