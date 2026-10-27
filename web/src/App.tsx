import { useEffect, useState } from 'react'
import { whoAmI } from './api'
import { db, isLocked, onChange, retryOpen, startLiveSync } from './db/client'
import { useQuery } from './db/useQuery'
import type { Person } from './types'
import { SignIn } from './screens/SignIn'
import { MyOrder } from './screens/MyOrder'
import { Docket } from './screens/Docket'
import { Who } from './screens/Who'
import { Tabs } from './Tabs'

export default function App() {
  // Who you are lives in the phone's database, so the app still knows offline.
  const saved = useQuery<{ value: string }>(`SELECT value FROM meta WHERE key = 'me'`)
  const me: Person | null = saved?.[0] ? JSON.parse(saved[0].value) : null
  const [locked, setLocked] = useState(isLocked())
  useEffect(() => onChange(() => setLocked(isLocked())), [])

  // When the server can be reached, check with it. undefined means it couldn't
  // be reached: keep what we have.
  useEffect(() => {
    whoAmI().then((person) => {
      if (person !== undefined) void saveMe(person)
    })
  }, [])

  // Live sync while signed in. React runs the function startLiveSync returns
  // when signedIn changes or the app goes away.
  const signedIn = me !== null
  useEffect(() => {
    if (signedIn) return startLiveSync()
  }, [signedIn])

  // Without this a locked tab would sit blank: its queries were rejected.
  if (locked) {
    return (
      <main className="locked">
        <div className="top"><span className="brand">Coffee Run</span></div>
        <div className="body">
          <p>Coffee Run is open in another tab. Switch back to it, or close it.</p>
          <button className="ghost" onClick={retryOpen}>Try again</button>
        </div>
      </main>
    )
  }
  if (saved === null) return null // the database is still opening
  if (!me) return <SignIn onSignedIn={saveMe} />

  return (
    <main className="app">
      <header className="top">
        <span className="brand">Coffee Run</span>
        <span className="me">Ordering as <b>{me.name}</b></span>
      </header>
      <Notice />
      <Tabs tabs={[
        { name: 'My order', panel: <MyOrder me={me} /> },
        { name: 'Who', panel: <Who me={me} /> },
        { name: 'Docket', panel: <Docket /> },
      ]} />
    </main>
  )
}

// The red bar for a change the server rejected. It's just a row in meta:
// tapping it deletes the row, and useQuery hides the bar.
function Notice() {
  const rows = useQuery<{ value: string }>(`SELECT value FROM meta WHERE key = 'notice'`)
  if (!rows?.[0]) return null
  return (
    <p className="notice" onClick={() => db.exec(`DELETE FROM meta WHERE key = 'notice'`)}>
      {rows[0].value} <span>✕</span>
    </p>
  )
}

// Save or forget who this phone belongs to. exec makes the worker say
// "changed", so the useQuery above re-runs and the screen switches.
function saveMe(person: Person | null) {
  if (!person) return db.exec(`DELETE FROM meta WHERE key = 'me'`)
  return db.exec(`INSERT INTO meta (key, value) VALUES ('me', ?)
                  ON CONFLICT (key) DO UPDATE SET value = excluded.value`, [JSON.stringify(person)])
}
