import sqlite3InitModule, { type Database } from '@sqlite.org/sqlite-wasm'
import { initializeDb } from './initializeDb'
import * as sync from './sync'
import type { OrderInput } from '../types'

async function open(): Promise<Database> {
  const sqlite3 = await sqlite3InitModule()
  const pool = await sqlite3.installOpfsSAHPoolVfs({ name: "coffee-run" })
  const db = new pool.OpfsSAHPoolDb("./coffee-run.db")
  initializeDb(db)
  console.log('SQLite', sqlite3.version.libVersion, 'ready')
  return db
}

const ready = open()

let running: Promise<void> | null = null
let again = false

// Push, then pull, telling the screens after each if anything changed.
// Offline? Log it and carry on: the next sync retries. One sync at a time:
// asking while one runs makes it go round once more, and everyone who asked
// waits on the same promise.
async function syncNow(): Promise<void> {
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    const db = await ready
    do {
      again = false
      try {
        if (await sync.push(db)) changed()
        if (await sync.pull(db)) changed()
      } catch (error) {
        console.warn('sync failed, will retry', error)
      }
    } while (again)
    running = null
  })()
  return running
}

// Named functions the page can run inside the worker, with db.call(name).
const calls = {
  sync: () => syncNow(),
  // Save, show it, then try to send without making the button wait.
  placeOrder: async (order: OrderInput) => { sync.placeOrder(await ready, order); changed(); void syncNow() },
  cancelOrder: async (day: string) => { sync.cancelOrder(await ready, day); changed(); void syncNow() },
}
export type CallName = keyof typeof calls

export type Request =
  | { id: number, kind: 'query', sql: string, params?: unknown[] }
  | { id: number, kind: 'exec', sql: string, params?: unknown[] }
  | { id: number, kind: 'call', name: CallName, args: unknown[] }

export type Response =
  | { id: number, ok: true, result: unknown }
  | { id: number, ok: false, error: string }
  | { kind: 'changed' }

// Tell the page "something changed", so every useQuery re-runs.
function changed() {
  postMessage({ kind: 'changed' })
}

onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data
  try {
    const db = await ready
    let result: unknown
    if (request.kind === 'query') {
      result = db.selectObjects(request.sql, request.params as never)
    } else if (request.kind === 'exec') {
      db.exec(request.sql, { bind: request.params as never })
      changed()
    } else {
      const call = calls[request.name] as (...args: unknown[]) => Promise<unknown>
      result = await call(...request.args)
    }
    postMessage({ id: request.id, ok: true, result })
  } catch (error) {
    postMessage({ id: request.id, ok: false, error: String(error) })
  }
}
