import { today } from '../today'

// The clerk's view: today's orders tallied by drink, then who wants what.
// Both come straight from db/views.sql, the same views the server has.
export function Docket() {
  const day = today()
  // STEP 6: read these from the views in db/views.sql with useQuery.
  const tally: { label: string; qty: number }[] = []
  const lines: { id: string; person: string; label: string; note: string | null }[] = []
  void day
  if (lines.length === 0) return <p className="empty">No orders yet today.</p>

  const total = tally.reduce((sum, row) => sum + row.qty, 0)

  return (
    <section>
      <h2>{total} {total === 1 ? 'drink' : 'drinks'}</h2>
      <ul className="tally">
        {tally.map((row) => (
          <li key={row.label}><span className="qty">{row.qty}×</span> {row.label}</li>
        ))}
      </ul>
      <h2>By person</h2>
      <ul className="lines">
        {lines.map((line) => (
          <li key={line.id}>
            <b>{line.person}</b> {line.label}
            {line.note && <span className="note"> · {line.note}</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}
