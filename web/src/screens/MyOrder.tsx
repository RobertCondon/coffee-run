import { useState, type FormEvent } from 'react'
import { today } from '../today'
import type { Person, SyncOrder } from '../types'

const SIZES = ['small', 'regular', 'large']
const MILKS = ['', 'full cream', 'trim', 'oat', 'soy', 'almond']
const EXTRAS = ['extra shot', 'decaf', 'vanilla', 'caramel', 'hazelnut', 'extra hot']

type Form = { menuItemID: string; size: string; milk: string; extras: string[]; note: string }

const empty: Form = { menuItemID: '', size: 'regular', milk: '', extras: [], note: '' }

export function MyOrder({ me }: { me: Person }) {
  void me // STEP 6 uses this to find your order: orderID(day, me.id)
  const day = today()
  // STEP 6: read these from the phone's database with useQuery.
  const menu: { id: string; name: string }[] = []
  const order = undefined as (SyncOrder & { label: string | null }) | undefined

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
    // STEP 8: save it on the phone instead: await db.call('placeOrder', { ... })
    console.log('placeOrder', {
      day,
      menu_item_id: form.menuItemID,
      size: form.size,
      milk: form.milk || null,
      extras: form.extras,
      note: form.note.trim() || null,
    })
    setDraft(null)
  }

  if (menu.length === 0) {
    return <p className="empty">No menu yet. It arrives with the first sync from the server.</p>
  }

  return (
    <section>
      {order && (
        <div className="current">
          <p className="label">{order.label}</p>
          <p className="status">{order.version === 0 ? 'Saved on this phone, sending…' : 'Sent ✓'}</p>
        </div>
      )}

      <form onSubmit={submit} className="order-form">
        <label>Drink</label>
        <div className="chips">
          {menu.map((item) => (
            <button type="button" key={item.id} className={form.menuItemID === item.id ? 'on' : ''}
              onClick={() => update({ menuItemID: item.id })}>{item.name}</button>
          ))}
        </div>

        <label>Size</label>
        <div className="chips">
          {SIZES.map((size) => (
            <button type="button" key={size} className={form.size === size ? 'on' : ''}
              onClick={() => update({ size })}>{size}</button>
          ))}
        </div>

        <label>Milk</label>
        <div className="chips">
          {MILKS.map((milk) => (
            <button type="button" key={milk} className={form.milk === milk ? 'on' : ''}
              onClick={() => update({ milk })}>{milk || 'none'}</button>
          ))}
        </div>

        <label>Extras</label>
        <div className="chips">
          {EXTRAS.map((extra) => (
            <button type="button" key={extra} className={form.extras.includes(extra) ? 'on' : ''}
              onClick={() => toggleExtra(extra)}>{extra}</button>
          ))}
        </div>

        <label htmlFor="note">Note</label>
        <input id="note" value={form.note} maxLength={80} placeholder="e.g. extra hot, half sugar"
          onChange={(e) => update({ note: e.target.value })} />

        <div className="actions">
          <button className="primary" disabled={!form.menuItemID}>{order ? 'Update order' : 'Place order'}</button>
          {order && (
            <button type="button" className="danger" onClick={() => { setDraft(null); console.log('cancelOrder', day) /* STEP 8 */ }}>
              Cancel order
            </button>
          )}
        </div>
      </form>
    </section>
  )
}
