import { Fragment, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { db } from '../db/client'
import { useQuery } from '../db/useQuery'
import { tick } from '../haptics'
import { orderID, today } from '../today'
import type { Person, SyncOrder } from '../types'

const MILKS = ['', 'full cream', 'trim', 'oat', 'soy', 'almond']
const EXTRAS = ['extra shot', 'decaf', 'vanilla', 'caramel', 'hazelnut']

// Hot and iced share a tab. The section headings underneath still separate them.
const CATEGORIES: { id: string; label: string; sections: string[] }[] = [
  { id: 'coffee', label: 'Coffee', sections: ['Coffee', 'Iced coffee'] },
  { id: 'tea', label: 'Tea', sections: ['Tea', 'Iced tea'] },
  { id: 'frappes', label: 'Frappes', sections: ['Frappes'] },
  { id: 'smoothies', label: 'Smoothies', sections: ['Smoothies'] },
  { id: 'milkshakes', label: 'Milkshakes', sections: ['Milkshakes'] },
  { id: 'fizzy', label: 'Fizzy', sections: ['Fizzy'] },
]

type Form = { menuItemID: string; size: string; milk: string; flavour: string; extras: string[]; note: string }
type MenuRow = { id: string; name: string; section: string; sizes: string; allows_milk: number | boolean; flavours: string }
type FlavourCard = { itemId: string; flavours: string[]; phase: 'in' | 'out' }

const empty: Form = { menuItemID: '', size: 'regular', milk: '', flavour: '', extras: [], note: '' }

// Board order, not alphabetical: sort_order keeps one section's drinks together.
function groupBySection(rows: MenuRow[]): { section: string; items: MenuRow[] }[] {
  const groups: { section: string; items: MenuRow[] }[] = []
  for (const row of rows) {
    const section = row.section || 'Other'
    const last = groups.at(-1)
    if (last?.section === section) last.items.push(row)
    else groups.push({ section, items: [row] })
  }
  return groups
}

function categoriesFor(menu: MenuRow[]) {
  const known = new Set(CATEGORIES.flatMap((category) => category.sections))
  const extra = [...new Set(menu.map((item) => item.section || 'Other').filter((section) => !known.has(section)))]
  if (extra.length === 0) return CATEGORIES
  return [...CATEGORIES, { id: 'other', label: 'Other', sections: extra }]
}

function categoryFor(categories: { id: string; sections: string[] }[], section: string | undefined) {
  return categories.find((category) => category.sections.includes(section || 'Other'))?.id ?? categories[0]?.id ?? 'coffee'
}

function offeredSizes(item: MenuRow | undefined): string[] {
  if (!item) return []
  try {
    const parsed = JSON.parse(item.sizes) as unknown
    if (!Array.isArray(parsed)) return ['small', 'regular', 'large']
    return parsed.filter((size): size is string => typeof size === 'string')
  } catch {
    return ['small', 'regular', 'large']
  }
}

function takesMilk(item: MenuRow | undefined): boolean {
  return !!item && (item.allows_milk === 1 || item.allows_milk === true)
}

function offeredFlavours(item: MenuRow | undefined): string[] {
  if (!item) return []
  try {
    const parsed = JSON.parse(item.flavours) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((flavour): flavour is string => typeof flavour === 'string')
  } catch {
    return []
  }
}

// Drop a size, milk, or flavour the newly chosen drink doesn't offer.
function fitDrink(item: MenuRow | undefined, size: string, milk: string, flavour: string) {
  const sizes = offeredSizes(item)
  const nextSize = sizes.length === 0
    ? 'regular'
    : sizes.includes(size) ? size : (sizes.includes('regular') ? 'regular' : sizes[0])
  const flavours = offeredFlavours(item)
  const nextFlavour = flavours.includes(flavour) ? flavour : (flavours[0] ?? '')
  return { size: nextSize, milk: takesMilk(item) ? milk : '', flavour: nextFlavour }
}

export function MyOrder({ me }: { me: Person }) {
  const day = today()
  const menu = useQuery<MenuRow>(
    `SELECT id, name, section, sizes, allows_milk, flavours FROM menu_item
     WHERE deleted_at IS NULL ORDER BY sort_order, name`)
  const orders = useQuery<SyncOrder & { label: string | null }>(
    `SELECT o.*, l.label FROM coffee_order o LEFT JOIN v_coffee_order_line l ON l.id = o.id
     WHERE o.id = ? AND o.deleted_at IS NULL`, [orderID(day, me.id)])
  const order = orders?.[0]

  // draft is what the person is editing; null means "show the saved order".
  const [draft, setDraft] = useState<Form | null>(null)
  // null until the person swipes or taps a category: until then, open on the drink they ordered.
  const [tabID, setTabID] = useState<string | null>(null)
  // Kept mounted through 'out' so the flavour card can ease closed.
  const [flavourCard, setFlavourCard] = useState<FlavourCard | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const underlineRef = useRef<HTMLSpanElement>(null)
  const indexRef = useRef(0)
  const placed = useRef(false)
  const form: Form = draft ?? (order
    ? { menuItemID: order.menu_item_id, size: order.size, milk: order.milk ?? '',
        flavour: order.flavour ?? '', extras: JSON.parse(order.extras), note: order.note ?? '' }
    : empty)

  function update(change: Partial<Form>) {
    setDraft({ ...form, ...change })
  }

  function toggleExtra(extra: string) {
    update({ extras: form.extras.includes(extra) ? form.extras.filter((e) => e !== extra) : [...form.extras, extra] })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const fitted = fitDrink(menu?.find((item) => item.id === form.menuItemID), form.size, form.milk, form.flavour)
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
  }

  const categories = menu ? categoriesFor(menu) : []
  const selected = menu?.find((item) => item.id === form.menuItemID)
  const activeID = tabID ?? (categories.length ? categoryFor(categories, selected?.section) : 'coffee')
  const activeIndex = Math.max(0, categories.findIndex((category) => category.id === activeID))
  const sizes = offeredSizes(selected)
  const flavours = offeredFlavours(selected)
  const showSize = sizes.length > 1
  const showMilk = takesMilk(selected)
  const showFlavour = flavours.length > 0

  // Same movement as My order / Who / Docket: the lists sit side by side and
  // the browser snaps a swipe onto one. The underline follows the finger.
  useEffect(() => {
    const el = stripRef.current
    if (!el) return
    const position = () => (el.clientWidth ? el.scrollLeft / el.clientWidth : 0)

    // While two lists are on screen the block under them stays at the taller
    // one, so nothing is clipped. Once the swipe has landed it eases to the
    // list that's showing — the same glide as before, started a little late.
    let shown = 0
    let raf = 0
    let applied = -1
    let shrinkFrom = 0
    let shrinkTo = 0
    let shrinkStart = 0
    // scrollHeight is the whole list. The strip's own height must not be used
    // here: once it is too short, a border-box measurement stays too short and
    // the drinks underneath stay clipped.
    const menuHeights = () => [...el.querySelectorAll<HTMLElement>('.cat-panel .menu')]
      .map((menu) => menu.scrollHeight)
    // A page still in view needs its full height. It slides sideways; it does
    // not get shorter until it has left. The extra pixel keeps the last border.
    const covered = (pos: number) => {
      const hs = menuHeights()
      if (hs.length === 0) return 0
      const max = hs.length - 1
      const clamped = Math.min(max, Math.max(0, pos))
      const a = Math.floor(clamped)
      const b = Math.min(max, a + 1)
      const t = clamped - a
      if (t <= 0.001) return 1 + hs[a]
      if (t >= 0.999) return 1 + hs[b]
      return 1 + Math.max(hs[a], hs[b])
    }
    const paint = (height: number) => {
      const px = Math.ceil(height)
      if (px === applied) return
      applied = px
      el.style.height = `${px}px`
    }
    const step = (now: number) => {
      const pos = position()
      const floor = covered(pos)
      const midSwipe = Math.abs(pos - Math.round(pos)) > 0.01
      // Grow as soon as a taller list slides in. Shrink only after the swipe
      // has landed, so the block stays put while anything tall is still visible.
      if (midSwipe || floor >= shown - 0.5) {
        if (floor > shown || !midSwipe) shown = floor
        shrinkStart = 0
      } else if (!shrinkStart) {
        shrinkFrom = shown
        shrinkTo = floor
        shrinkStart = now + 90
      } else if (now >= shrinkStart) {
        shrinkTo = floor
        const t = Math.min(1, (now - shrinkStart) / 320)
        const eased = 1 - (1 - t) ** 3
        shown = shrinkFrom + (shrinkTo - shrinkFrom) * eased
        if (t === 1) {
          shown = floor
          shrinkStart = 0
        }
      }
      paint(shown)
      raf = midSwipe || Math.abs(shown - floor) > 0.5 ? requestAnimationFrame(step) : 0
    }
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(step)
    }

    const follow = () => {
      const pos = position()
      const bar = tabsRef.current
      const mark = underlineRef.current
      if (bar && mark) {
        const buttons = [...bar.querySelectorAll<HTMLButtonElement>('button')]
        if (buttons.length > 0) {
          const max = buttons.length - 1
          const clamped = Math.min(max, Math.max(0, pos))
          const a = Math.floor(clamped)
          const b = Math.min(max, a + 1)
          const t = clamped - a
          const left = buttons[a].offsetLeft + (buttons[b].offsetLeft - buttons[a].offsetLeft) * t
          const width = buttons[a].offsetWidth + (buttons[b].offsetWidth - buttons[a].offsetWidth) * t
          // A short bar in the middle of the label, like the page tabs' underline.
          const markWidth = Math.max(16, width * 0.4)
          mark.style.width = `${markWidth}px`
          mark.style.transform = `translateX(${left + (width - markWidth) / 2}px)`
          bar.scrollLeft = Math.max(0, left - (bar.clientWidth - width) / 2)
        }
      }
      kick()
    }

    // Settled on a category. scrollend is new (Baseline since Dec 2025), so
    // older browsers get "no scroll for 150 ms" instead. Same as Tabs.tsx.
    const settle = () => {
      const i = Math.round(position())
      kick()
      if (i === indexRef.current) return
      indexRef.current = i
      const id = tabsRef.current?.querySelectorAll<HTMLButtonElement>('button')[i]?.dataset.category
      if (id) setTabID(id)
      tick()
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const onScroll = () => {
      follow()
      if (!('onscrollend' in window)) {
        clearTimeout(timer)
        timer = setTimeout(settle, 150)
      }
    }

    if (!placed.current && el.clientWidth > 0) {
      placed.current = true
      const buttons = [...(tabsRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      const i = Math.max(0, buttons.findIndex((button) => button.getAttribute('aria-selected') === 'true'))
      indexRef.current = i
      el.scrollLeft = i * el.clientWidth
    }
    shown = covered(position())
    paint(shown)
    follow()

    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('scrollend', settle)
    // Wrapping changes when the strip gets narrower, and that makes the list taller.
    // Ignore height-only changes: those are this effect setting the strip's height.
    let width = el.clientWidth
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return
      width = el.clientWidth
      applied = -1
      kick()
    })
    observer.observe(el)
    document.fonts?.ready.then(() => {
      if (!stripRef.current) return
      applied = -1
      kick()
    })
    return () => {
      clearTimeout(timer)
      if (raf) cancelAnimationFrame(raf)
      observer.disconnect()
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('scrollend', settle)
    }
  }, [menu, form.menuItemID, flavourCard?.itemId, flavourCard?.phase])

  // Open under the flavoured drink; when it loses flavour, play the close first.
  useLayoutEffect(() => {
    if (showFlavour && selected) {
      setFlavourCard({ itemId: selected.id, flavours: offeredFlavours(selected), phase: 'in' })
      return
    }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setFlavourCard(null)
      return
    }
    setFlavourCard((card) => (card && card.phase !== 'out' ? { ...card, phase: 'out' } : card))
  }, [showFlavour, form.menuItemID, selected?.id, selected?.flavours])

  // Point the flavour card's caret at the drink chip sitting just above it.
  useLayoutEffect(() => {
    if (!flavourCard) return
    const place = () => {
      const card = document.querySelector<HTMLElement>('[data-flavour-card]')
      const drink = card?.previousElementSibling
      if (!card || !(drink instanceof HTMLElement)) return
      const mid = drink.getBoundingClientRect().left + drink.offsetWidth / 2
      const left = mid - card.getBoundingClientRect().left
      const pad = 12
      card.style.setProperty('--arrow-left', `${Math.max(pad, Math.min(card.clientWidth - pad, left))}px`)
    }
    place()
    const observer = new ResizeObserver(place)
    const card = document.querySelector('[data-flavour-card]')
    if (card) observer.observe(card)
    window.addEventListener('resize', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [flavourCard?.itemId, flavourCard?.phase, activeIndex])

  // While the flavour card collapses, keep the strip height with it so no gap is left behind.
  useEffect(() => {
    if (flavourCard?.phase !== 'out') return
    const el = stripRef.current
    if (!el) return
    let raf = 0
    const follow = () => {
      const menus = [...el.querySelectorAll<HTMLElement>('.cat-panel .menu')]
      const i = Math.round(el.clientWidth ? el.scrollLeft / el.clientWidth : 0)
      const height = menus[i]?.scrollHeight
      if (height) el.style.height = `${1 + height}px`
      raf = requestAnimationFrame(follow)
    }
    raf = requestAnimationFrame(follow)
    return () => cancelAnimationFrame(raf)
  }, [flavourCard?.phase])

  if (menu === null || orders === null) return null // still loading
  if (menu.length === 0) {
    return <p className="body empty">No menu yet. It arrives with the first sync from the server.</p>
  }

  function showCategory(i: number) {
    const el = stripRef.current
    if (!el) return
    const instant = matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollTo({ left: i * el.clientWidth, behavior: instant ? 'instant' : 'smooth' })
    indexRef.current = i
    setTabID(categories[i]?.id ?? null)
  }

  return (
    <section className="body">
      <div className="cat-tabs" role="tablist" aria-label="Drink category" ref={tabsRef}>
        {categories.map((category, i) => (
          <button type="button" key={category.id} role="tab" id={`cat-${i}`} aria-controls={`cat-panel-${i}`}
            data-category={category.id} aria-selected={i === activeIndex}
            onClick={() => showCategory(i)}>{category.label}</button>
        ))}
        <span className="underline" ref={underlineRef} />
      </div>

      {order && (
        <div className={order.version === 0 ? 'current' : 'current sent'}>
          <p className="label">{order.label}</p>
          <p className="status">{order.version === 0 ? 'Saved on this phone, sending…' : 'Sent ✓'}</p>
        </div>
      )}

      <form onSubmit={submit} className="order-form">
        <div className="cat-strip" ref={stripRef}>
          {categories.map((category, i) => {
            const groups = groupBySection(menu.filter((item) => category.sections.includes(item.section || 'Other')))
            return (
              <div key={category.id} className="cat-panel" role="tabpanel" id={`cat-panel-${i}`}
                aria-labelledby={`cat-${i}`} inert={i !== activeIndex}>
                <div className="menu">
                  {groups.map((group) => (
                    <div key={group.section} className="menu-section">
                      {groups.length > 1 && <h2 className="menu-section-title">{group.section}</h2>}
                      <div className="chips">
                        {group.items.map((item) => {
                          const on = form.menuItemID === item.id
                          return (
                            <Fragment key={item.id}>
                              <button type="button" className={on ? 'on' : ''}
                                onClick={() => update({ menuItemID: item.id, ...fitDrink(item, form.size, form.milk, form.flavour) })}>
                                {item.name}
                              </button>
                              {flavourCard?.itemId === item.id && (
                                <div className="flavour-slot" data-flavour-card="" data-phase={flavourCard.phase}>
                                  <div className="flavour" onAnimationEnd={(event) => {
                                    if (event.target !== event.currentTarget) return
                                    if (flavourCard.phase === 'out') setFlavourCard(null)
                                  }}>
                                    <span className="lab">Flavour</span>
                                    <div className="chips">
                                      {flavourCard.flavours.map((flavour) => (
                                        <button type="button" key={flavour}
                                          className={form.flavour === flavour ? 'on' : ''}
                                          disabled={flavourCard.phase === 'out'}
                                          onClick={() => update({ flavour })}>{flavour}</button>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </Fragment>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        <div className="options">
        {showSize && (
          <div>
            <span className="lab">Size</span>
            <div className="chips">
              {sizes.map((size) => (
                <button type="button" key={size} className={form.size === size ? 'on' : ''}
                  onClick={() => update({ size })}>{size}</button>
              ))}
            </div>
          </div>
        )}

        {showMilk && (
          <div>
            <span className="lab">Milk</span>
            <div className="chips">
              {MILKS.map((milk) => (
                <button type="button" key={milk} className={form.milk === milk ? 'on' : ''}
                  onClick={() => update({ milk })}>{milk || 'regular'}</button>
              ))}
            </div>
          </div>
        )}

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
