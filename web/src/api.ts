import type { Person } from './types'

// Sign-in is the one thing that needs the network: the server makes the person.

export async function signIn(name: string): Promise<Person> {
  const response = await fetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!response.ok) throw new Error((await response.text()).trim() || 'could not sign in')
  return response.json()
}

// Who the server thinks this device is: a Person, null if signed out, or
// undefined if the server can't be reached (then the phone uses its saved copy).
export async function whoAmI(): Promise<Person | null | undefined> {
  try {
    const response = await fetch('/api/session')
    if (response.status === 401) return null
    if (!response.ok) return undefined
    return response.json()
  } catch {
    return undefined
  }
}
