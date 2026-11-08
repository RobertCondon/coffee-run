import type { Database } from '@sqlite.org/sqlite-wasm'
import clientSql from '../../../db/client.sql?raw'
import viewsSql from '../../../db/views.sql?raw'

// Creates the tables (if they're missing) and recreates the views. Run it every
// time the database opens, like Migrate on the server.
export function initializeDb(db: Database): void {
  db.exec(clientSql)
  // CREATE TABLE IF NOT EXISTS leaves a phone that already has menu_item
  // on the old shape. Add the columns the order screen groups by.
  addColumnIfMissing(db, 'menu_item', 'section', `TEXT NOT NULL DEFAULT ''`)
  addColumnIfMissing(db, 'menu_item', 'sort_order', `INTEGER NOT NULL DEFAULT 0`)
  addColumnIfMissing(db, 'menu_item', 'sizes', `TEXT NOT NULL DEFAULT '["small","regular","large"]'`)
  addColumnIfMissing(db, 'menu_item', 'allows_milk', `INTEGER NOT NULL DEFAULT 1`)
  addColumnIfMissing(db, 'menu_item', 'flavours', `TEXT NOT NULL DEFAULT '[]'`)
  addColumnIfMissing(db, 'coffee_order', 'flavour', `TEXT`)
  resyncIfMenuChanged(db)
  db.exec(viewsSql)
}

// Bump when menu_item gains columns. A phone still running the old page when
// the server updated pulled the new drinks without those columns, kept the
// defaults (every drink under "Other", no flavours) and moved its cursor past
// them. Starting the cursor again pulls every row in full. Runs once per bump.
const MENU_SHAPE = '2'

function resyncIfMenuChanged(db: Database) {
  const shape = db.selectValue(`SELECT value FROM meta WHERE key = 'menu_shape'`)
  if (shape === MENU_SHAPE) return
  db.exec(`INSERT INTO meta (key, value) VALUES ('cursor', '0'), ('menu_shape', ?)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value`, { bind: [MENU_SHAPE] })
}

function addColumnIfMissing(db: Database, table: string, column: string, definition: string) {
  const columns = db.selectObjects(`PRAGMA table_info(${table})`) as { name: string }[]
  if (!columns.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}
