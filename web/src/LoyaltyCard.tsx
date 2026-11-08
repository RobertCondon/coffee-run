import { useCallback, useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { loyaltyCard, type LoyaltyCard as Card } from './api'

// "GM687N" reads easier at the till as "GM6 87N".
const spaced = (code: string) => code.replace(/(.{3})(?=.)/g, '$1 ')

// The QR as one SVG path of square modules, drawn at one unit per module so
// it stays sharp at any size. Squares (not dots) keep scanners happy.
function QR({ text }: { text: string }) {
  const { size, path } = useMemo(() => {
    const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' })
    let d = ''
    for (let row = 0; row < modules.size; row++) {
      for (let col = 0; col < modules.size; col++) {
        if (modules.get(row, col)) d += `M${col} ${row}h1v1h-1z`
      }
    }
    return { size: modules.size, path: d }
  }, [text])

  // A 4-module quiet zone all round, which the QR spec asks for.
  return (
    <svg viewBox={`-4 -4 ${size + 8} ${size + 8}`} shapeRendering="crispEdges" role="img" aria-label="Loyalty card QR code">
      <rect x={-4} y={-4} width={size + 8} height={size + 8} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  )
}

// The loyalty card at the foot of the docket. Tap it to blow it up full
// screen on white, which is easier for the till's scanner to read.
// The card is fetched fresh every time the docket opens.
export function LoyaltyCard() {
  const [big, setBig] = useState(false)
  const [card, setCard] = useState<Card | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(() => loyaltyCard().then(setCard, () => setFailed(true)), [])
  useEffect(() => { load() }, [load])
  const retry = () => { setFailed(false); load() }

  useEffect(() => {
    if (!big) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setBig(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [big])

  if (!card) {
    return (
      <div className="loyalty" aria-live="polite">
        <span className="loyalty-lab">Loyalty card</span>
        <span className="loyalty-qr loyalty-qr-empty" />
        {failed ? (
          <>
            <span className="loyalty-hint">Couldn't load your card</span>
            <button className="loyalty-retry" onClick={retry}>Try again</button>
          </>
        ) : (
          <span className="loyalty-hint">Loading card…</span>
        )}
      </div>
    )
  }

  return (
    <>
      <button className="loyalty" onClick={() => setBig(true)}>
        <span className="loyalty-lab">Loyalty card</span>
        <span className="loyalty-qr"><QR text={card.token} /></span>
        <span className="loyalty-code">{spaced(card.code)}</span>
        <span className="loyalty-hint">Tap to enlarge</span>
      </button>
      {big && (
        <div className="loyalty-full" role="dialog" aria-label="Loyalty card" onClick={() => setBig(false)}>
          <span className="loyalty-qr"><QR text={card.token} /></span>
          <span className="loyalty-code">{spaced(card.code)}</span>
          <span className="loyalty-hint">Show this at the till · tap to close</span>
        </div>
      )}
    </>
  )
}
