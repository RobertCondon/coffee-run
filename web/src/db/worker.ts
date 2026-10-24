import sqlite3InitModule, { type Database } from '@sqlite.org/sqlite-wasm'
import { initializeDb } from './initializeDb'

async function open(): Promise<Database> {
  const sqlite3 = await sqlite3InitModule()
  const pool = await sqlite3.installOpfsSAHPoolVfs({ name: "coffee-run" })
  const db = new pool.OpfsSAHPoolDb("./coffee-run.db")
  initializeDb(db)
  console.log('SQLite', sqlite3.version.libVersion, 'ready')
  return db
}

const ready = open()

export type Request =
  | { id: number, kind: 'query', sql: string, params?: unknown[] }
  | { id: number, kind: 'exec', sql: string, params?: unknown[] }

export type Response =
  | { id: number, ok: true, result: unknown }
  | { id: number, ok: false, error: string }

onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data
  try {
    const db = await ready
    let result: unknown
    if (request.kind === 'query') {
      result = db.selectObjects(request.sql, request.params as never)
    } else {
      db.exec(request.sql, { bind: request.params as never })
    }
    postMessage({ id: request.id, ok: true, result })
  } catch (error) {
    postMessage({ id: request.id, ok: false, error: String(error) })
  }
}
