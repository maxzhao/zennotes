import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react'

interface Drag {
  id: string
  pointer: number
  x: number
  y: number
  active: boolean
  moved: boolean
  slot: number
  target: HTMLElement
  timer?: ReturnType<typeof setTimeout>
}

/** Capture stays on the original button so a no-movement gesture still clicks it.
 * Touch retains native scrolling until a stationary 400 ms press claims the gesture. */
export function useActivityDrag(
  group: RefObject<HTMLDivElement>,
  ids: string[],
  enabled: boolean,
  save: (ids: string[]) => void,
) {
  const drag = useRef<Drag | null>(null)
  const idsRef = useRef(ids)
  idsRef.current = ids
  const saveRef = useRef(save)
  saveRef.current = save
  const suppressClick = useRef(false)
  const [active, setActive] = useState<string | null>(null)
  const [position, setPosition] = useState<number | null>(null)

  useEffect(() => {
    const element = group.current
    if (!element || !enabled) return
    let frame = 0
    let lastY = 0
    const slotAt = (state: Drag, x: number, y: number): boolean => {
      const rect = element.getBoundingClientRect()
      const bottom = Math.min(
        rect.bottom,
        element
          .querySelector<HTMLElement>('[data-activity-invalid]')
          ?.getBoundingClientRect().top ?? rect.bottom,
      )
      if (x < rect.left || x > rect.right || y < rect.top || y > bottom) {
        setPosition(null)
        return false
      }
      const rows = [
        ...element.querySelectorAll<HTMLElement>('[data-activity-id]'),
      ].filter((row) => row.dataset.activityId !== state.id)
      const slot = rows.findIndex(
        (row) => y < row.getBoundingClientRect().top + row.offsetHeight / 2,
      )
      state.slot = slot < 0 ? rows.length : slot
      setPosition(state.slot)
      return true
    }
    const scroll = () => {
      const state = drag.current
      if (!state?.active || !state.moved) return
      const rect = element.getBoundingClientRect()
      const speed =
        lastY < rect.top + 28 ? -7 : lastY > rect.bottom - 28 ? 7 : 0
      if (speed) {
        element.scrollTop += speed
        slotAt(state, state.x, lastY)
      }
      frame = requestAnimationFrame(scroll)
    }
    const move = (event: globalThis.PointerEvent) => {
      const state = drag.current
      if (!state || event.pointerId !== state.pointer) return
      const distance = Math.hypot(
        event.clientX - state.x,
        event.clientY - state.y,
      )
      if (!state.active && distance > 8) {
        // Movement before the long press belongs to native scrolling.
        clearTimeout(state.timer)
        drag.current = null
        return
      }
      if (!state.active) return
      if (distance > 6) state.moved = true
      if (!state.moved) return
      event.preventDefault()
      slotAt(state, event.clientX, event.clientY)
      state.x = event.clientX
      lastY = event.clientY
      if (!frame) frame = requestAnimationFrame(scroll)
    }
    const end = (event: globalThis.PointerEvent, cancelled: boolean) => {
      const state = drag.current
      if (!state || event.pointerId !== state.pointer) return
      clearTimeout(state.timer)
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      drag.current = null
      setActive(null)
      setPosition(null)
      if (!cancelled && state.active && state.moved) {
        suppressClick.current = true
        if (slotAt(state, event.clientX, event.clientY)) {
          const next = idsRef.current.filter((id) => id !== state.id)
          next.splice(state.slot, 0, state.id)
          if (next.some((id, i) => id !== idsRef.current[i]))
            saveRef.current(next)
        }
        setPosition(null)
      }
      if (state.target.hasPointerCapture(state.pointer))
        state.target.releasePointerCapture(state.pointer)
    }
    const up = (event: globalThis.PointerEvent) => end(event, false)
    const cancel = (event: globalThis.PointerEvent) => end(event, true)
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !drag.current) return
      clearTimeout(drag.current.timer)
      if (drag.current.target.hasPointerCapture(drag.current.pointer))
        drag.current.target.releasePointerCapture(drag.current.pointer)
      drag.current = null
      setActive(null)
      setPosition(null)
      if (frame) cancelAnimationFrame(frame)
      frame = 0
    }
    element.addEventListener('pointermove', move, { passive: false })
    element.addEventListener('pointerup', up)
    element.addEventListener('pointercancel', cancel)
    element.addEventListener('lostpointercapture', cancel)
    // Dynamic touch-action alone cannot reclaim a gesture already begun with pan-y.
    const touch = (event: TouchEvent) => {
      if (drag.current?.active) event.preventDefault()
    }
    element.addEventListener('touchmove', touch, { passive: false })
    window.addEventListener('keydown', key)
    return () => {
      clearTimeout(drag.current?.timer)
      drag.current = null
      if (frame) cancelAnimationFrame(frame)
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', up)
      element.removeEventListener('pointercancel', cancel)
      element.removeEventListener('lostpointercapture', cancel)
      element.removeEventListener('touchmove', touch)
      window.removeEventListener('keydown', key)
      setActive(null)
      setPosition(null)
    }
  }, [enabled, group, ids.join('|')])

  const onPointerDown = (event: PointerEvent<HTMLElement>, id: string) => {
    suppressClick.current = false
    if (!enabled || !event.isPrimary || event.button !== 0) return
    const state: Drag = {
      id,
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      active: false,
      moved: false,
      slot: ids.indexOf(id),
      target: event.currentTarget,
    }
    drag.current = state
    const activate = () => {
      if (drag.current !== state) return
      state.active = true
      state.target.setPointerCapture(state.pointer)
      setActive(id)
      setPosition(state.slot)
    }
    if (event.pointerType === 'mouse') activate()
    else state.timer = setTimeout(activate, 400)
  }
  const onClickCapture = (event: MouseEvent) => {
    if (suppressClick.current && event.detail !== 0) {
      suppressClick.current = false
      event.preventDefault()
      event.stopPropagation()
    }
  }
  return { active, position, onPointerDown, onClickCapture }
}
