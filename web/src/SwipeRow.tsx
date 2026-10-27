import { useEffect, useRef, type ReactNode } from 'react'
import { tick } from './haptics'

const ACTION = 96 // width of the button behind the row
const DECIDE = 8 // px before deciding between a swipe and a scroll

// A list row you swipe left to show a button behind it, like iOS Mail.
// The row says touch-action: pan-y, so the browser still scrolls up and down
// from it but leaves sideways moves to us, and the tab strip never moves from
// here. Whether it's open belongs to the list (one open at a time); while a
// finger is down the row moves itself, without a React render per move.
export function SwipeRow({ id, open, onOpenChange, action, actionLabel, onAction, className, children }: {
  id: string
  open: boolean
  onOpenChange: (open: boolean) => void
  action: string
  actionLabel: string
  onAction: () => void
  className?: string
  children: ReactNode
}) {
  const front = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; from: number; offset: number; mode: 'swipe' | null } | null>(null)

  const place = (offset: number) => {
    if (front.current) front.current.style.transform = offset ? `translateX(${offset}px)` : ''
  }
  useEffect(() => place(open ? -ACTION : 0), [open])

  function onPointerDown(event: React.PointerEvent) {
    if (event.button !== 0) return
    const from = open ? -ACTION : 0
    drag.current = { x: event.clientX, y: event.clientY, from, offset: from, mode: null }
  }

  function onPointerMove(event: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    const dx = event.clientX - d.x
    const dy = event.clientY - d.y
    if (d.mode === null) {
      if (Math.hypot(dx, dy) < DECIDE) return
      if (Math.abs(dy) >= Math.abs(dx)) {
        drag.current = null // mostly up or down: the browser is scrolling the list
        return
      }
      d.mode = 'swipe'
      front.current?.setPointerCapture(event.pointerId)
      front.current?.classList.add('dragging')
    }
    // Follow the finger. Past fully open, rubber-band at a third of the speed.
    const raw = Math.min(0, d.from + dx)
    d.offset = raw < -ACTION ? -ACTION + (raw + ACTION) / 3 : raw
    place(d.offset)
  }

  function onPointerUp(event: React.PointerEvent) {
    const d = drag.current
    drag.current = null
    front.current?.classList.remove('dragging')
    if (!d) return
    if (d.mode === null) {
      if (open) onOpenChange(false) // a tap on an open row shuts it
      return
    }
    // Past halfway snaps open, otherwise shut. Placed here as well as by the
    // effect, since open may not change (an open row dragged a little).
    const next = event.type !== 'pointercancel' && -d.offset > ACTION / 2
    place(next ? -ACTION : 0)
    if (next && !open) tick()
    if (next !== open) onOpenChange(next)
  }

  return (
    <li className={className} data-swipe-row={id}>
      <button className="act" tabIndex={open ? 0 : -1} aria-label={actionLabel} onClick={onAction}>{action}</button>
      <div className="front" ref={front}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        {children}
      </div>
    </li>
  )
}
