import { useEffect, useState } from 'react'
import { whoAmI } from './api'
import { db, startLiveSync } from './db/client'
import { useQuery } from './db/useQuery'
import type { Person } from './types'
import { SignIn } from './screens/SignIn'
import { MyOrder } from './screens/MyOrder'
import { Docket } from './screens/Docket'

type Tab = 'order' | 'docket'

export default function App() {
  // Who you are lives in the phone's database, so the app still knows offline.
  const saved = useQuery<{ value: string }>(`SELECT value FROM meta WHERE key = 'me'`)
  const me: Person | null = saved?.[0] ? JSON.parse(saved[0].value) : null
  const [tab, setTab] = useState<Tab>('order')

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

  if (saved === null) return null // the database is still opening
  if (!me) return <SignIn onSignedIn={saveMe} />

  return (
    <main>
      <header>
        <h1>Coffee Run</h1>
        <span className="who">{me.name}</span>
      </header>
      <nav>
        <button className={tab === 'order' ? 'active' : ''} onClick={() => setTab('order')}>My order</button>
        <button className={tab === 'docket' ? 'active' : ''} onClick={() => setTab('docket')}>Docket</button>
      </nav>
      <Notice />
      {tab === 'order' ? <MyOrder me={me} /> : <Docket />}
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
