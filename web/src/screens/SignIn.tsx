import { useState, type FormEvent } from 'react'
import { signIn } from '../api'
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
    <main className="sign-in">
      <h1>Coffee Run</h1>
      <p>What should we call you? You only do this once on this phone.</p>
      <form onSubmit={submit}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoFocus maxLength={40} />
        <button disabled={busy || !name.trim()}>Start</button>
      </form>
      {error && <p className="error">{error}</p>}
    </main>
  )
}
