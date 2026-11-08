import { useQuery } from '../db/useQuery'
import { formatDay, today } from '../today'
import { LoyaltyCard } from '../LoyaltyCard'

// What the café's till calls each size.
const SIZE_NAMES: Record<string, string> = { small: 'Small', regular: 'Medium', large: 'Large' }

type Cup = { id: string; drink: string; size: string; sizes: string; milk: string | null; flavour: string | null; extras: string; note: string | null }

// A drink with no size choice, or only one, doesn't get a size on the receipt.
function sizeLabel(cup: Cup): string {
  let offered: unknown
  try {
    offered = JSON.parse(cup.sizes)
  } catch {
    offered = []
  }
  if (!Array.isArray(offered) || offered.length <= 1) return ''
  return ' ' + (SIZE_NAMES[cup.size] ?? titleCase(cup.size))
}

// "flat white" → "Flat White", as the head line of a receipt item.
function titleCase(text: string): string {
  return text.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

// "oat" → "Oat", as a "->" line under it.
function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// The changes to one cup in the order the till takes them: milk, extras, note.
function changes(cup: Cup): string[] {
  const extras: string[] = JSON.parse(cup.extras)
  return [
    ...(cup.milk ? [sentenceCase(cup.milk)] : []),
    ...extras.map(sentenceCase),
    ...(cup.note ? [`“${cup.note}”`] : []),
  ]
}

// The runner's view: today's orders laid out like the café's receipt, one
// cup per line with its changes under it, so it can be read out top to
// bottom. Identical cups sit together. It comes from db/views.sql, the same
// view the server has.
export function Docket() {
  const day = today()
  const cups = useQuery<Cup>(
    `SELECT id, drink, size, sizes, milk, flavour, extras, note FROM v_docket WHERE day = ?
     ORDER BY drink, flavour, CASE size WHEN 'small' THEN 1 WHEN 'regular' THEN 2 ELSE 3 END, milk, extras, note`, [day])
  if (cups === null) return null // still loading

  const total = cups.length

  return (
    <section className="body">
      <div className="dockethead"><strong>Docket</strong>{formatDay(day)} · {total} {total === 1 ? 'cup' : 'cups'}</div>
      {total === 0 ? <p className="empty">No orders yet today</p> : (
        <>
          <ul className="receipt">
            {cups.map((cup) => (
              <li key={cup.id}>
                <span className="item">{titleCase(cup.flavour ? `${cup.flavour} ${cup.drink}` : cup.drink)}{sizeLabel(cup)}</span>
                {changes(cup).map((change) => <span key={change} className="change">-&gt; {change}</span>)}
              </li>
            ))}
          </ul>
          <div className="total"><span>Total items</span><span>{total}</span></div>
        </>
      )}
      <LoyaltyCard />
    </section>
  )
}
