import { useQuery } from '../db/useQuery'
import { formatDay, today } from '../today'
import type { Person } from '../types'

// Who ordered what today: name, a dotted leader, then the drink.
export function Who({ me }: { me: Person }) {
  const day = today()
  const lines = useQuery<{ id: string; person_id: string; person: string; label: string; note: string | null }>(
    `SELECT id, person_id, person, label, note FROM v_coffee_order_line WHERE day = ? ORDER BY person`, [day])
  if (lines === null) return null // still loading

  return (
    <section className="body">
      <p className="count">Today · {formatDay(day)} · {lines.length} {lines.length === 1 ? 'order' : 'orders'}</p>
      {lines.length === 0 ? <p className="empty">No orders yet today</p> : (
        <ul className="rows">
          {lines.map((line) => (
            <li key={line.id} className={line.person_id === me.id ? 'mine' : ''}>
              <span className="nm">{line.person}</span>
              <span className="lead" />
              <span className="dr">{line.label}{line.note && <small>{line.note}</small>}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
