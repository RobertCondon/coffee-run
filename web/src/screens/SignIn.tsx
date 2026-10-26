import { useState, type FormEvent } from 'react'
import { signIn } from '../api'
import { formatDay, today } from '../today'
import type { Person } from '../types'

export function SignIn({ onSignedIn }: { onSignedIn: (person: Person) => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      onSignedIn(await signIn(name))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main>
      <header className="top">
        <span className="brand">Coffee Run</span>
        <span className="when">{formatDay(today())}</span>
      </header>
      <form className="body" onSubmit={submit}>
        <p className="kicker">New phone</p>
        <h1>Who's getting coffee?</h1>
        <p className="hint">Type it once. This phone remembers you after that.</p>
        <div>
          <label className="lab" htmlFor="name">Your name</label>
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name"
            autoFocus maxLength={40} />
        </div>
        {error && <p className="error">{error}</p>}
        <button className="primary" style={{ marginTop: 'auto' }} disabled={busy || !name.trim()}>Continue</button>
      </form>
    </main>
  )
}
