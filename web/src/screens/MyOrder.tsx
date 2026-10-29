import { useState, type FormEvent } from 'react'
import { db } from '../db/client'
import { useQuery } from '../db/useQuery'
import { orderID, today } from '../today'
import type { Person, SyncOrder } from '../types'

const SIZES = ['small', 'regular', 'large']
const MILKS = ['', 'full cream', 'trim', 'oat', 'soy', 'almond']
const EXTRAS = ['extra shot', 'decaf', 'vanilla', 'caramel', 'hazelnut']

type Form = { menuItemID: string; size: string; milk: string; extras: string[]; note: string }

const empty: Form = { menuItemID: '', size: 'regular', milk: '', extras: [], note: '' }

export function MyOrder({ me }: { me: Person }) {
  const day = today()
  const menu = useQuery<{ id: string; name: string }>(
    `SELECT id, name FROM menu_item WHERE deleted_at IS NULL ORDER BY name`)
  const orders = useQuery<SyncOrder & { label: string | null }>(
    `SELECT o.*, l.label FROM coffee_order o LEFT JOIN v_coffee_order_line l ON l.id = o.id
     WHERE o.id = ? AND o.deleted_at IS NULL`, [orderID(day, me.id)])
  const order = orders?.[0]

  // draft is what the person is editing; null means "show the saved order".
  const [draft, setDraft] = useState<Form | null>(null)
  const form: Form = draft ?? (order
    ? { menuItemID: order.menu_item_id, size: order.size, milk: order.milk ?? '',
        extras: JSON.parse(order.extras), note: order.note ?? '' }
    : empty)

  function update(change: Partial<Form>) {
    setDraft({ ...form, ...change })
  }

  function toggleExtra(extra: string) {
    update({ extras: form.extras.includes(extra) ? form.extras.filter((e) => e !== extra) : [...form.extras, extra] })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    await db.call('placeOrder', {
      day,
      menu_item_id: form.menuItemID,
      size: form.size,
      milk: form.milk || null,
      extras: form.extras,
      note: form.note.trim() || null,
    })
    setDraft(null)
  }

  if (menu === null || orders === null) return null // still loading
  if (menu.length === 0) {
    return <p className="body empty">No menu yet. It arrives with the first sync from the server.</p>
  }

  return (
    <section className="body">
      {order && (
        <div className={order.version === 0 ? 'current' : 'current sent'}>
          <p className="label">{order.label}</p>
          <p className="status">{order.version === 0 ? 'Saved on this phone, sending…' : 'Sent ✓'}</p>
        </div>
      )}

      <form onSubmit={submit} className="order-form">
        <div>
          <span className="lab">Drink</span>
          <div className="chips">
            {menu.map((item) => (
              <button type="button" key={item.id} className={form.menuItemID === item.id ? 'on' : ''}
                onClick={() => update({ menuItemID: item.id })}>{item.name}</button>
            ))}
          </div>
        </div>

        <div>
          <span className="lab">Size</span>
          <div className="chips">
            {SIZES.map((size) => (
              <button type="button" key={size} className={form.size === size ? 'on' : ''}
                onClick={() => update({ size })}>{size}</button>
            ))}
          </div>
        </div>

        <div>
          <span className="lab">Milk</span>
          <div className="chips">
            {MILKS.map((milk) => (
              <button type="button" key={milk} className={form.milk === milk ? 'on' : ''}
                onClick={() => update({ milk })}>{milk || 'none'}</button>
            ))}
          </div>
        </div>

        <div>
          <span className="lab">Extras</span>
          <div className="chips">
            {EXTRAS.map((extra) => (
              <button type="button" key={extra} className={form.extras.includes(extra) ? 'on' : ''}
                onClick={() => toggleExtra(extra)}>{extra}</button>
            ))}
          </div>
        </div>

        <div>
          <label className="lab" htmlFor="note">Note</label>
          <input id="note" value={form.note} maxLength={80} placeholder="e.g. half sugar"
            onChange={(e) => update({ note: e.target.value })} />
        </div>

        <div className="actions">
          <button className="primary" disabled={!form.menuItemID}>{order ? 'Update my order' : 'Add my order'}</button>
          {order && (
            <button type="button" className="ghost danger" onClick={() => { setDraft(null); void db.call('cancelOrder', day) }}>
              Cancel order
            </button>
          )}
        </div>
      </form>
    </section>
  )
}
