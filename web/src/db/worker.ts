import sqlite3InitModule, { type Database, type SAHPoolUtil } from '@sqlite.org/sqlite-wasm'
import { initializeDb } from './initializeDb'
import * as sync from './sync'
import type { OrderInput } from '../types'

// Only one tab can hold the database files at a time, so the tab on screen
// holds them and hidden tabs let go (pause) until they're shown again (resume).

const sqlite3Ready = sqlite3InitModule()
let pool: SAHPoolUtil | null = null
let openDb: Database | null = null

// preserveOnInitFailure: a failed setup mustn't delete the pool's files.
// forceReinitIfPreviouslyFailed: let a later try run instead of repeating the
// old failure. It's missing from the library's types, so it sits in a
// variable (TypeScript only rejects unknown keys written inline).
const poolOptions = { name: 'coffee-run', preserveOnInitFailure: true, forceReinitIfPreviouslyFailed: true }

// Open the database, or take the file handles back after a pause.
async function openDatabase(): Promise<Database> {
  if (openDb) return openDb
  const sqlite3 = await sqlite3Ready
  if (!pool) pool = await sqlite3.installOpfsSAHPoolVfs(poolOptions)
  else await pool.unpauseVfs()
  openDb = new pool.OpfsSAHPoolDb('./coffee-run.db')
  initializeDb(openDb)
  console.log('db: open')
  return openDb
}

let gaveUp = false

// The tab we're taking over from may not have let go yet, so retry with a
// growing wait (100 ms … 3.2 s, about six seconds in all), then give up and
// tell the page.
async function openWithRetry(): Promise<Database> {
  for (let waitMs = 100; waitMs <= 3_200; waitMs *= 2) {
    try {
      const db = await openDatabase()
      gaveUp = false
      return db
    } catch (error) {
      console.warn('db: busy, retrying in', waitMs, 'ms', error)
    }
    await new Promise((resolve) => setTimeout(resolve, waitMs))
  }
  gaveUp = true
  postMessage({ kind: 'locked' })
  throw new Error('Coffee Run is open in another tab')
}

// Close first (pauseVfs throws while a database is open), then release every
// file handle so another tab can take them.
function closeDatabase() {
  if (!openDb || !pool) return
  openDb.close()
  openDb = null
  pool.pauseVfs()
  console.log('db: paused')
}

// Every request starts with `await ready`. While paused, ready is a gate that
// only opens on resume, so requests in a hidden tab wait instead of grabbing
// the files back.
let ready = openWithRetry()
let paused = false
let releaseGate: () => void = () => {}

async function pause() {
  if (paused) return
  paused = true
  // Taken before the gate goes up: a sync that starts after it waits at the
  // gate, so waiting for it here would never finish.
  const syncing = running
  const previous = ready
  ready = new Promise((resolve) => {
    releaseGate = () => resolve(openWithRetry())
  })
  // Let an open, or a sync in progress, finish first. Resumed meanwhile?
  // Then don't close at all.
  await previous.catch(() => {})
  await syncing
  if (paused) closeDatabase()
}

function resume() {
  const wasLocked = gaveUp
  if (paused) {
    paused = false
    releaseGate()
  } else if (gaveUp) {
    ready = openWithRetry()
  } else {
    return
  }
  // Coming back from "open in another tab": tell the screens to run their
  // queries again once it's open.
  if (wasLocked) ready.then(changed, () => {})
}

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
  | { kind: 'pause' }
  | { kind: 'resume' }

export type Response =
  | { id: number, ok: true, result: unknown }
  | { id: number, ok: false, error: string }
  | { kind: 'changed' }
  | { kind: 'locked' }

// Tell the page "something changed", so every useQuery re-runs.
function changed() {
  postMessage({ kind: 'changed' })
}

onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data
  // Not questions, so nothing answers them. void: don't wait for the pause.
  if (request.kind === 'pause') return void pause()
  if (request.kind === 'resume') return resume()
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
