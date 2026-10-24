import { useEffect, useState } from 'react'
import { whoAmI } from './api'
import type { Person } from './types'
import { SignIn } from './screens/SignIn'
import { MyOrder } from './screens/MyOrder'
import { Docket } from './screens/Docket'

type Tab = 'order' | 'docket'

export default function App() {
  // STEP 6 moves "who am I" into the phone's database, so the app still knows
  // offline. Until then it lives in React state and needs the server.
  const [me, setMe] = useState<Person | null | undefined>(undefined)
  const [tab, setTab] = useState<Tab>('order')

  useEffect(() => {
    whoAmI().then((person) => setMe(person ?? null))
  }, [])

  // STEP 10 starts live sync here.

  if (me === undefined) return null
  if (!me) return <SignIn onSignedIn={setMe} />

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
