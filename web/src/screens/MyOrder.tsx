import { useEffect, useRef, useState, type FormEvent } from 'react'
import { db } from '../db/client'
import { useQuery } from '../db/useQuery'
import { tick } from '../haptics'
import { pour } from '../pour'
import { orderID, today } from '../today'
import type { Person, SyncOrder } from '../types'

const MILKS = ['', 'full cream', 'trim', 'oat', 'soy', 'almond']
// Flavours live on the drinks that take them now, so only these stay extras.
const EXTRAS = ['extra shot', 'decaf']
// The café's till says medium for regular.
const SIZE_WORDS: Record<string, string> = { small: 'small', regular: 'medium', large: 'large' }

// What kind of drink, picked first. Hot tea sits with coffee, iced tea with
// iced. Frappes, smoothies and shakes list just the flavour part of the name.
const KINDS: Kind[] = [
  { id: 'coffee', label: 'Coffee', sections: ['Coffee', 'Tea'] },
  { id: 'iced', label: 'Iced', sections: ['Iced coffee', 'Iced tea'] },
  { id: 'frappe', label: 'Frappe', sections: ['Frappes'], suffix: 'frappe' },
  { id: 'smoothie', label: 'Smoothie', sections: ['Smoothies'], suffix: 'smoothie' },
  { id: 'milkshake', label: 'Milkshake', sections: ['Milkshakes'], suffix: 'milkshake' },
]

type Kind = { id: string; label: string; sections: string[]; suffix?: string }
type Form = { menuItemID: string; size: string; milk: string; flavour: string; extras: string[]; note: string }
type MenuRow = { id: string; name: string; section: string; sizes: string; allows_milk: number | boolean; flavours: string }
type PastOrder = { label: string; menu_item_id: string; size: string; milk: string | null; flavour: string | null; extras: string; times: number }
// Which word of the order line has its choices open.
type Part = 'drink' | 'size' | 'flavour' | 'milk' | 'extras'

const empty: Form = { menuItemID: '', size: 'regular', milk: '', flavour: '', extras: [], note: '' }

// A JSON list of strings from a menu column, or the fallback if it isn't one.
function stringList(json: string, fallback: string[]): string[] {
  try {
    const parsed = JSON.parse(json) as unknown
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : fallback
  } catch {
    return fallback
  }
}

const offeredSizes = (item: MenuRow | undefined) => (item ? stringList(item.sizes, ['small', 'regular', 'large']) : [])
const offeredFlavours = (item: MenuRow | undefined) => (item ? stringList(item.flavours, []) : [])
const takesMilk = (item: MenuRow | undefined) => !!item && (item.allows_milk === 1 || item.allows_milk === true)

// Drop a size, milk, or flavour the newly chosen drink doesn't offer. A
// flavour is never guessed: the person picks one.
function fitDrink(item: MenuRow | undefined, size: string, milk: string, flavour: string) {
  const sizes = offeredSizes(item)
  const nextSize = sizes.length === 0
    ? 'regular'
    : sizes.includes(size) ? size : (sizes.includes('regular') ? 'regular' : sizes[0])
  return { size: nextSize, milk: takesMilk(item) ? milk : '', flavour: offeredFlavours(item).includes(flavour) ? flavour : '' }
}

function kindsFor(menu: MenuRow[]): Kind[] {
  const known = new Set(KINDS.flatMap((kind) => kind.sections))
  const extra = [...new Set(menu.map((item) => item.section || 'Other').filter((section) => !known.has(section)))]
  return extra.length ? [...KINDS, { id: 'other', label: 'Other', sections: extra }] : KINDS
}

const kindOf = (kinds: Kind[], item: MenuRow | undefined) =>
  kinds.find((kind) => kind.sections.includes(item?.section || 'Other')) ?? kinds[0]

// "Caramel frappe" reads as "Caramel" under the Frappe tab.
function shortName(kind: Kind, name: string) {
  return kind.suffix ? name.replace(new RegExp(`\\s+${kind.suffix}$`, 'i'), '') : name
}

function formFrom(past: Pick<PastOrder, 'menu_item_id' | 'size' | 'milk' | 'flavour' | 'extras'>, note = ''): Form {
  return { menuItemID: past.menu_item_id, size: past.size, milk: past.milk ?? '', flavour: past.flavour ?? '',
    extras: JSON.parse(past.extras), note }
}

// Same drink as far as the café is concerned. The note doesn't count.
function sameDrink(a: Form, b: Form) {
  return a.menuItemID === b.menuItemID && a.size === b.size && a.milk === b.milk && a.flavour === b.flavour
    && [...a.extras].sort().join() === [...b.extras].sort().join()
}

export function MyOrder({ me }: { me: Person }) {
  const day = today()
  const menu = useQuery<MenuRow>(
    `SELECT id, name, section, sizes, allows_milk, flavours FROM menu_item
     WHERE deleted_at IS NULL ORDER BY sort_order, name`)
  const orders = useQuery<SyncOrder & { label: string | null }>(
    `SELECT o.*, l.label FROM coffee_order o LEFT JOIN v_coffee_order_line l ON l.id = o.id
     WHERE o.id = ? AND o.deleted_at IS NULL`, [orderID(day, me.id)])
  // Every different drink this person has ordered, newest first (db/views.sql).
  // Phones keep two weeks of orders, so "usual" means lately.
  const past = useQuery<PastOrder>(
    `SELECT label, menu_item_id, size, milk, flavour, extras, times
     FROM v_past_drinks WHERE person_id = ? ORDER BY last_day DESC`, [me.id])
  const order = orders?.[0]

  // draft is what the person is editing; null means "show the saved order", or their usual.
  const [draft, setDraft] = useState<Form | null>(null)
  // null: open the drink list if nothing is picked yet, otherwise nothing open.
  const [open, setOpen] = useState<Part | '' | null>(null)
  const [kindID, setKindID] = useState<string | null>(null)
  // The highlights draw in one after another on the first screen only.
  const [intro, setIntro] = useState(true)
  const loaded = menu !== null && orders !== null && past !== null
  useEffect(() => {
    if (!loaded) return
    const timer = setTimeout(() => setIntro(false), 1500)
    return () => clearTimeout(timer)
  }, [loaded])

  // Is the order line one line long? Then its spare second line says
  // "basic." The observer fires once on start and again whenever the line
  // changes height (a new drink, or the screen width changing).
  const lineRef = useRef<HTMLParagraphElement>(null)
  const submitRef = useRef<HTMLButtonElement>(null)
  const [pouring, setPouring] = useState(false)
  const [oneLine, setOneLine] = useState(false)
  useEffect(() => {
    const el = lineRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      const style = getComputedStyle(el)
      const fontSize = parseFloat(style.fontSize)
      const lineHeight = parseFloat(style.lineHeight) >= fontSize ? parseFloat(style.lineHeight) : fontSize * 1.9
      setOneLine(el.getBoundingClientRect().height < lineHeight * 1.5)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [loaded])

  if (menu === null || orders === null || past === null) return null // still loading
  if (menu.length === 0) {
    return <p className="body empty">No menu yet. It arrives with the first sync from the server.</p>
  }

  // The most-ordered drink, if it's been ordered more than once. Ties go to the newest.
  const usualRow = past.reduce<PastOrder | null>((best, row) => (row.times > (best?.times ?? 1) ? row : best), null)
  const usual = usualRow ? formFrom(usualRow) : null
  const recent = past.filter((row) => row !== usualRow).slice(0, 3)

  const saved = order ? formFrom(order, order.note ?? '') : null
  const form: Form = draft ?? saved ?? usual ?? empty
  const isUsual = !order && !!usual && sameDrink(form, usual)

  const kinds = kindsFor(menu)
  const selected = menu.find((item) => item.id === form.menuItemID)
  const sizes = offeredSizes(selected)
  const flavours = offeredFlavours(selected)
  const needsFlavour = flavours.length > 0 && !form.flavour
  const openPart = open ?? (selected ? '' : 'drink')
  const kind = kinds.find((k) => k.id === kindID) ?? kindOf(kinds, selected)

  function update(change: Partial<Form>) {
    setDraft({ ...form, ...change })
  }

  // A pick updates the order line and leaves the list open, so you can see
  // what you picked and change it. Tapping the word again closes it.
  function choose(change: Partial<Form>) {
    tick()
    update(change)
  }

  function chooseDrink(item: MenuRow) {
    choose({ menuItemID: item.id, ...fitDrink(item, form.size, form.milk, form.flavour) })
  }

  function toggleExtra(extra: string) {
    tick()
    update({ extras: form.extras.includes(extra) ? form.extras.filter((e) => e !== extra) : [...form.extras, extra] })
  }

  function toggle(part: Part) {
    if (part === 'drink') setKindID(null)
    setOpen(openPart === part ? '' : part)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pouring) return
    const fitted = fitDrink(selected, form.size, form.milk, form.flavour)
    // The glass pours while the order saves; the label underneath can change
    // to "Update my order" mid-pour without showing.
    setPouring(true)
    const poured = submitRef.current ? pour(submitRef.current, order ? 'UPDATED' : 'ORDERED') : Promise.resolve()
    void poured.finally(() => setPouring(false))
    await db.call('placeOrder', {
      day,
      menu_item_id: form.menuItemID,
      size: fitted.size,
      milk: fitted.milk || null,
      flavour: fitted.flavour || null,
      extras: form.extras,
      note: form.note.trim() || null,
    })
    setDraft(null)
    setOpen(null)
  }

  // One highlighted word of the order line. Its key holds the text, so a
  // changed word mounts fresh and its highlight draws in again; the others stay put.
  let nth = 0
  function word(part: Part, text: string, unset = false) {
    const i = nth++
    return (
      <button type="button" key={`${part}:${text}`} className={`mark${unset ? ' unset' : ''}`}
        aria-expanded={openPart === part} onClick={() => toggle(part)}
        style={intro ? { animationDelay: `${150 + i * 90}ms`, animationDuration: '420ms' } : undefined}>
        {text}
      </button>
    )
  }

  function line() {
    if (!selected) return <>I'd like {word('drink', 'something', true)}.</>
    const name = selected.name.toLowerCase()
    const parts = [
      sizes.length > 1 && word('size', SIZE_WORDS[form.size] ?? form.size),
      flavours.length > 0 && word('flavour', form.flavour || 'which flavour', !form.flavour),
      word('drink', flavours.length ? name.replace(/^flavoured /, '') : name),
    ].filter(Boolean)
    // "An" before a vowel: an iced latte, an espresso, an earl grey tea.
    const first = sizes.length > 1 ? SIZE_WORDS[form.size] ?? '' : flavours.length ? form.flavour || 'which' : name
    return (
      <>
        {/^[aeiou]/.test(first) ? 'An' : 'A'}
        {parts.map((part, i) => <span key={i}> {part}</span>)}
        {takesMilk(selected) && <> with {word('milk', form.milk ? `${form.milk} milk` : 'regular milk')}</>}
        {' '}{word('extras', form.extras.length ? `+ ${form.extras.join(', ')}` : '+ extras', !form.extras.length)}.
      </>
    )
  }

  function choices() {
    const words = (items: [string, string][], isOn: (value: string) => boolean, pick: (value: string) => void) => (
      <div className="words">
        {items.map(([value, label]) => (
          <button type="button" key={value} className={isOn(value) ? 'on' : ''} aria-pressed={isOn(value)} onClick={() => pick(value)}><span>{label}</span></button>
        ))}
      </div>
    )
    if (openPart === 'drink') {
      const items = menu!.filter((item) => kind.sections.includes(item.section || 'Other'))
      const sections = [...new Set(items.map((item) => item.section || 'Other'))]
      return (
        <>
          <div className="kinds" role="tablist" aria-label="Kind of drink">
            {kinds.map((k) => (
              <button type="button" key={k.id} role="tab" aria-selected={k.id === kind.id}
                onClick={() => setKindID(k.id)}>{k.label}</button>
            ))}
          </div>
          {sections.map((section) => (
            <div key={section}>
              {sections.length > 1 && <span className="lab">{section}</span>}
              {words(items.filter((item) => (item.section || 'Other') === section).map((item) => [item.id, shortName(kind, item.name)]),
                (id) => id === form.menuItemID, (id) => chooseDrink(menu!.find((item) => item.id === id)!))}
            </div>
          ))}
        </>
      )
    }
    if (openPart === 'size') return words(sizes.map((s) => [s, SIZE_WORDS[s] ?? s]), (s) => s === form.size, (size) => choose({ size }))
    if (openPart === 'flavour') return words(flavours.map((f) => [f, f]), (f) => f === form.flavour, (flavour) => choose({ flavour }))
    if (openPart === 'milk') return words(MILKS.map((m) => [m, m || 'regular']), (m) => m === form.milk, (milk) => choose({ milk }))
    if (openPart === 'extras') return words(EXTRAS.map((e) => [e, e]), (e) => form.extras.includes(e), toggleExtra)
    return null
  }

  const heading = order && !draft ? 'Your order today' : isUsual ? 'Your usual' : 'Your order'
  const undo = draft && (order ? 'undo changes' : usual ? 'back to your usual' : null)
  const others = recent.filter((row) => !sameDrink(formFrom(row), form))

  return (
    <section className="body">
      <form onSubmit={submit} className="order-form">
        <div>
          <span className={isUsual ? 'lab kicker' : 'lab'}>{heading}</span>
          <div className="order-slot">
            <p className="order-line" ref={lineRef}>{line()}</p>
            {oneLine && (
              <p className="basic" key={form.menuItemID} aria-hidden="true">
                <span className="lead" /><span className="say">basic.</span>
              </p>
            )}
          </div>
          <p className="hint">
            {selected ? 'Tap a highlighted word to change it' : 'Tap the highlighted word to pick a drink'}
            {undo && <> · <button type="button" className="link" onClick={() => { setDraft(null); setOpen(null) }}>{undo}</button></>}
          </p>
        </div>

        {openPart && <div className="picker" key={openPart}>{choices()}</div>}

        {order && !draft && (
          <p className={order.version === 0 ? 'order-status' : 'order-status sent'}>
            {order.version === 0 ? 'Saved on this phone, sending…' : 'Sent ✓'}
          </p>
        )}

        {!openPart && others.length > 0 && (
          <div>
            <span className="lab">Or one of your recent</span>
            <ul className="recent">
              {others.map((row) => (
                <li key={row.label}>
                  <button type="button" onClick={() => { tick(); setDraft(formFrom(row, form.note)); setOpen('') }}>{row.label}</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <label className="lab" htmlFor="note">Note</label>
          <input id="note" value={form.note} maxLength={80} placeholder="e.g. half sugar"
            onChange={(e) => update({ note: e.target.value })} />
        </div>

        <div className={pouring ? 'actions pouring' : 'actions'}>
          <button ref={submitRef} className="primary" disabled={!selected || needsFlavour || pouring}>
            <span className="label">{needsFlavour ? 'Pick a flavour' : order ? 'Update my order' : isUsual ? 'Same again' : 'Add my order'}</span>
          </button>
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
