import type { CallName, Request, Response } from './worker'

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })

let nextId = 1
const waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()

const listeners = new Set<() => void>()

worker.onmessage = (event: MessageEvent<Response>): void => {
  const message = event.data
  if ('kind' in message) {
    listeners.forEach((listener) => listener())
    return
  }
  const pending = waiting.get(message.id)

  waiting.delete(message.id)
  if (message.ok) pending?.resolve(message.result)
  else pending?.reject(new Error(message.error))
}

type Unsent = Request extends infer R ? (R extends Request ? Omit<R, 'id'> : never ) : never

function send(request: Unsent): Promise<unknown> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    waiting.set(id, {resolve, reject})
    worker.postMessage({...request, id})
  })
}

export const db = {
  query: <T>(sql: string, params: unknown[] = []) => send({ kind: 'query', sql, params }) as Promise<T[]>,
  exec: (sql: string, params: unknown[] = []) => send({ kind: 'exec', sql, params }) as Promise<void>,
  call: (name: CallName, ...args: unknown[]) => send({ kind: 'call', name, args }),
}

declare global { interface Window { db: typeof db } }
if (import.meta.env.DEV) window.db = db

// Call listener whenever the data changes. Returns a function that stops it.
export function onChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Keep this phone in step with the server: sync on every ping from
// /api/events, whenever the stream (re)connects, when the phone comes back
// online or on screen, and once a minute just in case. Returns a function
// that stops it all.
export function startLiveSync(): () => void {
  let events: EventSource
  let retry: ReturnType<typeof setTimeout>
  let delay = 1_000
  const connect = () => {
    events = new EventSource('/api/events')
    events.addEventListener('changed', () => void db.call('sync'))
    events.onopen = () => { delay = 1_000; void db.call('sync') }
    events.onerror = () => {
      // EventSource retries a dropped connection itself, but gives up for
      // good on an error reply (a proxy's 502 while Go restarts).
      if (events.readyState !== EventSource.CLOSED) return
      retry = setTimeout(connect, delay)
      delay = Math.min(delay * 2, 30_000)
    }
  }
  connect()

  // A phone that slept often has a dead stream that never said so.
  const reconnect = () => {
    if (document.visibilityState !== 'visible') return
    events.close()
    clearTimeout(retry)
    delay = 1_000
    connect()
  }
  window.addEventListener('online', reconnect)
  document.addEventListener('visibilitychange', reconnect)
  const timer = setInterval(() => void db.call('sync'), 60_000)

  return () => {
    events.close()
    clearTimeout(retry)
    window.removeEventListener('online', reconnect)
    document.removeEventListener('visibilitychange', reconnect)
    clearInterval(timer)
  }
}
