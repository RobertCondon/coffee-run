import { useEffect, useState } from 'react'
import { db, onChange } from './client'

// Runs sql against the phone's database, and again whenever the data changes.
// Returns null until the first answer arrives.
export function useQuery<T>(sql: string, params: unknown[] = []): T[] | null {
  const [rows, setRows] = useState<T[] | null>(null)
  const key = JSON.stringify(params) // a new [day] each render isn't a change

  useEffect(() => {
    let live = true
    const run = () =>
      db.query<T>(sql, JSON.parse(key)).then((result) => {
        if (live) setRows(result)
      }, () => {}) // another tab has the database: App shows why, and changed re-runs this
    run()
    const stop = onChange(run)
    return () => {
      live = false
      stop()
    }
  }, [sql, key])

  return rows
}
