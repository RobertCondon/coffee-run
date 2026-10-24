import type { Database } from '@sqlite.org/sqlite-wasm'
import clientSql from '../../../db/client.sql?raw'
import viewsSql from '../../../db/views.sql?raw'

// Creates the tables (if they're missing) and recreates the views. Run it every
// time the database opens, like Migrate on the server.
export function initializeDb(db: Database): void {
  db.exec(clientSql)
  db.exec(viewsSql)
}
