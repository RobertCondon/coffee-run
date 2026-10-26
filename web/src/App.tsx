import { useEffect, useState } from 'react'
import { whoAmI } from './api'
import { db } from './db/client'
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

  // STEP 10 starts live sync here.

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
      {/* STEP 9 adds <Notice /> here: the red bar for rejected changes. */}
      {tab === 'order' ? <MyOrder me={me} /> : <Docket />}
    </main>
  )
}

// Save or forget who this phone belongs to. exec makes the worker say
// "changed", so the useQuery above re-runs and the screen switches.
function saveMe(person: Person | null) {
  if (!person) return db.exec(`DELETE FROM meta WHERE key = 'me'`)
  return db.exec(`INSERT INTO meta (key, value) VALUES ('me', ?)
                  ON CONFLICT (key) DO UPDATE SET value = excluded.value`, [JSON.stringify(person)])
}
