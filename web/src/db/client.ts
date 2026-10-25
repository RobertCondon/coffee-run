import type { Request, Response } from './worker'

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })

let nextId = 1
const waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()

worker.onmessage = (event: MessageEvent<Response>): void => {
  const message = event.data
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
}

declare global { interface Window { db: typeof db } }
if (import.meta.env.DEV) window.db = db