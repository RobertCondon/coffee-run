import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'

// Hard-coded for now to check the café's scanner reads it off a phone.
// Later this comes from the signed-in person.
const CARD = { payload: '6037a0fdfce5636be6a5e80dece70763', code: '8BJ HZM' }

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
export function LoyaltyCard() {
  const [big, setBig] = useState(false)

  useEffect(() => {
    if (!big) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setBig(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [big])

  return (
    <>
      <button className="loyalty" onClick={() => setBig(true)}>
        <span className="loyalty-lab">Loyalty card</span>
        <span className="loyalty-qr"><QR text={CARD.payload} /></span>
        <span className="loyalty-code">{CARD.code}</span>
        <span className="loyalty-hint">Tap to enlarge</span>
      </button>
      {big && (
        <div className="loyalty-full" role="dialog" aria-label="Loyalty card" onClick={() => setBig(false)}>
          <span className="loyalty-qr"><QR text={CARD.payload} /></span>
          <span className="loyalty-code">{CARD.code}</span>
          <span className="loyalty-hint">Show this at the till · tap to close</span>
        </div>
      )}
    </>
  )
}
