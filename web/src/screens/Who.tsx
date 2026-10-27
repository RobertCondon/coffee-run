import { useEffect, useRef, useState } from 'react'
import { db } from '../db/client'
import { useQuery } from '../db/useQuery'
import { SwipeRow } from '../SwipeRow'
import { formatDay, today } from '../today'
import type { Person } from '../types'

type Line = { id: string; person_id: string; person: string; label: string; note: string | null }

// Who ordered what today: name, a dotted leader, then the drink. Anyone can
// take anyone's order off, after an "are you sure": swipe the row left on a
// phone, or the ✕ with a mouse.
export function Who({ me }: { me: Person }) {
  const day = today()
  const lines = useQuery<Line>(
    `SELECT id, person_id, person, label, note FROM v_coffee_order_line WHERE day = ? ORDER BY person`, [day])
  // The id, not the line: the dialog then shows the order as it is now, and
  // closes if it disappears meanwhile.
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  // One row open at a time: touching anywhere outside it shuts it.
  useEffect(() => {
    if (!openId) return
    const shutIfOutside = (event: PointerEvent) => {
      const row = (event.target as Element).closest('[data-swipe-row]')
      if (row?.getAttribute('data-swipe-row') !== openId) setOpenId(null)
    }
    document.addEventListener('pointerdown', shutIfOutside)
    return () => document.removeEventListener('pointerdown', shutIfOutside)
  }, [openId])

  if (lines === null) return null // still loading
  const removing = lines.find((line) => line.id === removingId)

  return (
    <section className="body">
      <p className="count">Today · {formatDay(day)} · {lines.length} {lines.length === 1 ? 'order' : 'orders'}</p>
      {lines.length === 0 ? <p className="empty">No orders yet today</p> : (
        <ul className="rows">
          {lines.map((line) => (
            <SwipeRow key={line.id} id={line.id} className={line.person_id === me.id ? 'mine' : ''}
              open={openId === line.id} onOpenChange={(open) => setOpenId(open ? line.id : null)}
              action="Remove" actionLabel={`Remove ${line.person}'s order`} onAction={() => setRemovingId(line.id)}>
              <span className="nm">{line.person}</span>
              <span className="lead" />
              <span className="dr">{line.label}{line.note && <small>{line.note}</small>}</span>
              <button className="x" aria-label={`Remove ${line.person}'s order`} onClick={() => setRemovingId(line.id)}>✕</button>
            </SwipeRow>
          ))}
        </ul>
      )}
      {removing && (
        <ConfirmRemove
          line={removing}
          mine={removing.person_id === me.id}
          onClose={() => { setRemovingId(null); setOpenId(null) }}
          onRemove={() => { setRemovingId(null); setOpenId(null); void db.call('cancelOrder', day, removing.person_id) }}
        />
      )}
    </section>
  )
}

// showModal gives the dimmed backdrop, keeps focus inside, and closes on Esc
// or Android's back gesture (both fire onClose). Tapping the backdrop lands on
// the dialog itself; the padding sits on .inner so taps on the ticket don't.
function ConfirmRemove({ line, mine, onClose, onRemove }:
  { line: Line; mine: boolean; onClose: () => void; onRemove: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal() // StrictMode runs this twice in dev
  }, [])

  return (
    <dialog ref={dialog} className="confirm" onClose={onClose}
      onClick={(event) => { if (event.target === dialog.current) onClose() }}>
      <div className="inner">
        <p className="kicker">Remove order</p>
        <h1>{mine ? 'Remove your order?' : `Remove ${line.person}'s order?`}</h1>
        <p className="drink">{line.label}{line.note && <small>{line.note}</small>}</p>
        {!mine && <p className="hint">{line.person} won't get this coffee unless they order again.</p>}
        <div className="actions">
          <button className="primary danger" onClick={onRemove}>Remove</button>
          <button className="ghost" autoFocus onClick={onClose}>Keep it</button>
        </div>
      </div>
    </dialog>
  )
}
