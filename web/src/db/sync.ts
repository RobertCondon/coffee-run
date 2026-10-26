import type { Database } from '@sqlite.org/sqlite-wasm'
import type { Person, SyncResponse } from '../types'
import { orderID } from '../today'

// This file runs inside the worker (worker.ts imports it), so it uses the
// database directly, with no messages.

function getMeta(db: Database, key: string): string | undefined {
  return db.selectValue(`SELECT value FROM meta WHERE key = ?`, [key]) as string | undefined
}

function setMeta(db: Database, key: string, value: string) {
  db.exec(`INSERT INTO meta (key, value) VALUES (?, ?)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value`, { bind: [key, value] })
}

function me(db: Database): Person {
  const value = getMeta(db, 'me')
  if (!value) throw new Error('not signed in')
  return JSON.parse(value)
}

// Fetch everything that changed since this phone's cursor and save it.
// Returns true if anything arrived, so the worker can tell the screens.
export async function pull(db: Database): Promise<boolean> {
  const cursor = Number(getMeta(db, 'cursor') ?? 0)
  const response = await fetch(`/api/sync?since=${cursor}`)
  if (!response.ok) throw new Error(`sync: ${response.status}`)
  const changes: SyncResponse = await response.json()

  // Orders still in the outbox were changed here and not sent yet: the
  // server's older copy mustn't overwrite them.
  const pending = new Set(
    (db.selectValues(`SELECT json_extract(op, '$.order.day') FROM outbox`) as string[])
      .map((day) => orderID(day, me(db).id)),
  )

  // Rows and cursor commit together, or not at all.
  db.transaction(() => {
    for (const person of changes.people) {
      db.exec(`INSERT INTO person (id, name, version) VALUES (?, ?, ?)
               ON CONFLICT (id) DO UPDATE SET name = excluded.name, version = excluded.version`,
        { bind: [person.id, person.name, person.version] })
    }
    for (const item of changes.menu_items) {
      db.exec(`INSERT INTO menu_item (id, name, version, deleted_at) VALUES (?, ?, ?, ?)
               ON CONFLICT (id) DO UPDATE SET name = excluded.name, version = excluded.version,
                                              deleted_at = excluded.deleted_at`,
        { bind: [item.id, item.name, item.version, item.deleted_at] })
    }
    for (const order of changes.orders) {
      if (pending.has(order.id)) continue
      db.exec(`INSERT OR REPLACE INTO coffee_order
                 (id, day, person_id, menu_item_id, size, milk, extras, note, status, updated_at, version, deleted_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        { bind: [order.id, order.day, order.person_id, order.menu_item_id, order.size, order.milk,
                 order.extras, order.note, order.status, order.updated_at, order.version, order.deleted_at] })
    }
    setMeta(db, 'cursor', String(changes.cursor))
  })
  return changes.people.length + changes.menu_items.length + changes.orders.length > 0
}
