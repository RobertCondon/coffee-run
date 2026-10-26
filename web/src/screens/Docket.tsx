import { useQuery } from '../db/useQuery'
import { formatDay, today } from '../today'

// The clerk's view: today's orders tallied by drink, to hold up at the counter.
// It comes straight from db/views.sql, the same view the server has.
export function Docket() {
  const day = today()
  const tally = useQuery<{ label: string; qty: number }>(
    `SELECT label, qty FROM v_tally WHERE day = ? ORDER BY qty DESC, label`, [day])
  if (tally === null) return null // still loading

  const total = tally.reduce((sum, row) => sum + row.qty, 0)
  const cups = `${total} ${total === 1 ? 'cup' : 'cups'}`

  return (
    <section className="body">
      <div className="dockethead"><strong>Docket</strong>{formatDay(day)} · {cups}</div>
      {total === 0 ? <p className="empty">No orders yet today</p> : (
        <>
          <ul className="tally">
            {tally.map((row) => (
              <li key={row.label}><span className="n">{row.qty}</span><span className="l">{row.label}</span></li>
            ))}
          </ul>
          <div className="total"><span>Total</span><span>{cups}</span></div>
        </>
      )}
    </section>
  )
}
