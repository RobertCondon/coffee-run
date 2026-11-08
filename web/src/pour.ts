// The Add / Update button turns into a glass of coffee. It grows taller, coffee
// rises from the bottom, milk foam comes down from the top, and the letters of
// the word float up to settle where the two meet. Then it drains back to a
// button. The layers are made here and removed afterwards, so the button's
// React children are left alone.

const HEIGHT = 132
const COFFEE_SHARE = 0.58 // the bottom 58% is coffee, the top is foam

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const rand = (a: number, b: number) => a + Math.random() * (b - a)

export async function pour(button: HTMLElement, word: string) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const start = button.offsetHeight
  const coffee = layer('coffee'), foam = layer('foam'), float = layer('float')
  button.append(coffee, foam, float)
  button.classList.add('pouring')
  const all: Element[] = [button, coffee, foam, float]

  try {
    await button.animate([{ height: `${start}px` }, { height: `${HEIGHT}px` }],
      { duration: 380, easing: 'cubic-bezier(.2,1.3,.4,1)', fill: 'forwards' }).finished

    // Letters spread across the middle, each settling at its own depth.
    const step = Math.min(30, (button.clientWidth - 40) / word.length)
    const mid = button.clientWidth / 2
    const line = HEIGHT * (1 - COFFEE_SHARE)
    const letters = [...word].map((ch, i) => {
      const span = document.createElement('span')
      span.textContent = ch
      span.style.left = `${mid + (i - (word.length - 1) / 2) * step - 9}px`
      span.style.top = `${line - 15 + rand(-8, 8)}px`
      span.style.opacity = '0'
      float.append(span)
      return span
    })

    coffee.animate([{ height: '0%' }, { height: `${COFFEE_SHARE * 100}%` }],
      { duration: 650, easing: 'cubic-bezier(.3,.1,.3,1)', fill: 'forwards' })
    await wait(420)
    letters.forEach((span, i) => {
      span.animate([
        { transform: `translateY(${HEIGHT - line + 20}px) rotate(${rand(-14, 14)}deg)`, opacity: 0 },
        { transform: `translateY(0) rotate(${rand(-6, 6)}deg)`, opacity: 1 },
      ], { duration: 900, delay: i * 70, easing: 'cubic-bezier(.2,.8,.25,1)', fill: 'forwards' })
    })
    await wait(300)
    await foam.animate([{ height: '0%' }, { height: `${(1 - COFFEE_SHARE) * 100}%` }],
      { duration: 520, easing: 'cubic-bezier(.3,.1,.3,1)', fill: 'forwards' }).finished
    await wait(1100)

    // Drain back to a button.
    for (const el of [coffee, foam, float]) el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' })
    await wait(200)
    await button.animate([{ height: `${HEIGHT}px` }, { height: `${start}px` }],
      { duration: 300, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }).finished
  } finally {
    // Also runs if the button was unmounted mid-pour.
    for (const el of all) for (const a of el.getAnimations({ subtree: true })) a.cancel()
    coffee.remove(); foam.remove(); float.remove()
    button.classList.remove('pouring')
  }
}

function layer(name: string) {
  const span = document.createElement('span')
  span.className = `pour-${name}`
  span.setAttribute('aria-hidden', 'true')
  return span
}
