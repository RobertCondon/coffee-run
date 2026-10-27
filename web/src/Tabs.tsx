import { useEffect, useRef, useState, type ReactNode } from 'react'
import { tick } from './haptics'

// The tabs sit side by side in a strip that scrolls sideways, and CSS scroll
// snap makes every swipe settle on one of them. The browser does the
// dragging, momentum and settling, so it feels like the rest of the phone.
// The tab buttons scroll the strip too; the strip's position says which tab
// is current.
export function Tabs({ tabs }: { tabs: { name: string; panel: ReactNode }[] }) {
  const strip = useRef<HTMLDivElement>(null)
  const underline = useRef<HTMLSpanElement>(null)
  const [current, setCurrent] = useState(0)
  const currentRef = useRef(0)

  useEffect(() => {
    const el = strip.current
    if (!el) return
    const position = () => el.scrollLeft / el.clientWidth

    // Settled on a tab: make it current. scrollend is new (Baseline since
    // Dec 2025), so older browsers get "no scroll for 150 ms" instead.
    const settle = () => {
      const i = Math.round(position())
      if (i === currentRef.current) return
      currentRef.current = i
      setCurrent(i)
      tick()
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const onScroll = () => {
      // The underline follows the finger, not just the finished swipe.
      if (underline.current) underline.current.style.transform = `translateX(${position() * 100}%)`
      if (!('onscrollend' in window)) {
        clearTimeout(timer)
        timer = setTimeout(settle, 150)
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('scrollend', settle)
    return () => {
      clearTimeout(timer)
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('scrollend', settle)
    }
  }, [])

  function show(i: number) {
    const el = strip.current
    if (!el) return
    const instant = matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollTo({ left: i * el.clientWidth, behavior: instant ? 'instant' : 'smooth' })
    currentRef.current = i
    setCurrent(i)
  }

  return (
    <>
      <nav role="tablist">
        {tabs.map(({ name }, i) => (
          <button key={name} role="tab" id={`tab-${i}`} aria-controls={`panel-${i}`}
            aria-selected={current === i} onClick={() => show(i)}>{name}</button>
        ))}
        <span className="underline" ref={underline} style={{ width: `${100 / tabs.length}%` }} />
      </nav>
      <div className="strip" ref={strip}>
        {tabs.map(({ name, panel }, i) => (
          // inert: the tabs off screen are still in the page, so keep the Tab
          // key and screen readers out of them.
          <div key={name} className="panel" role="tabpanel" id={`panel-${i}`} aria-labelledby={`tab-${i}`}
            inert={current !== i}>
            {panel}
          </div>
        ))}
      </div>
    </>
  )
}
