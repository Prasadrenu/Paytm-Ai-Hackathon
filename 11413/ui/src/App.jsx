import { useCallback, useEffect, useState } from 'react'
import { getSaved, parseItems, saveDetails } from './api.js'
import { TopBar, Sidebar } from './components/Header.jsx'
import PlannerForm from './components/PlannerForm.jsx'
import ReviewPage from './components/ReviewPage.jsx'
import SavedPage from './components/SavedPage.jsx'
import PlanPage from './components/PlanPage.jsx'
import PaymentsPage from './components/PaymentsPage.jsx'
import AnalyticsPage from './components/AnalyticsPage.jsx'

const EMPTY = { items: '', open: '16:00', close: '22:00', lang: 'en-IN', images: [] }
const TITLES = {
  details: ['Menu', 'Tell us what you sell and when you are open.'],
  review: ['Review items', 'Check what we found, fix anything wrong, then submit.'],
  saved: ['Saved details', 'Everything you have submitted so far.'],
  payments: ['Payments', 'Your payment history teaches the planner how busy each hour is.'],
  analytics: ['Analytics', 'Predicted busy hours, learned from your past payments.'],
  plan: ["Today's plan", 'What to make, how much, and when you will be busiest.'],
}

export default function App() {
  const [view, setView] = useState('details')
  const [form, setForm] = useState(EMPTY)
  const [items, setItems] = useState(null) // [{name, price}] on the review page; null until Proceed
  const [records, setRecords] = useState(null)
  const [file, setFile] = useState('data/stall_details.json')
  const [justSaved, setJustSaved] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(() =>
    getSaved().then((r) => { setRecords(r.records); setFile(r.file) }).catch(() => setRecords([])), [])
  useEffect(() => { refresh() }, [refresh])

  const go = (v) => { setError(''); if (v !== 'saved') setJustSaved(null); setView(v) }

  async function proceed(data) {
    setBusy(true)
    setError('')
    try {
      setItems((await parseItems(data)).map((i) => ({ ...i, sel: false })))
      setForm(data)
      setView('review')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  // Saves only the ticked items for the chosen time. Returns the saved record, or null on failure.
  async function submit(selected, from, to) {
    setBusy(true)
    setError('')
    try {
      const whole = from === form.open && to === form.close
      const r = await saveDetails({
        items: selected.map((i) => ({ name: i.name, price: i.price, from: whole ? null : from, to: whole ? null : to })),
        open: form.open, close: form.close, lang: form.lang,
      })
      setJustSaved(r.saved)
      await refresh()
      return r.saved
    } catch (e) {
      setError(e.message)
      return null
    } finally {
      setBusy(false)
    }
  }

  function again() {
    setForm(EMPTY)
    setItems(null)
    setJustSaved(null)
    setError('')
    setView('details')
  }

  const [title, sub] = TITLES[view]
  return (
    <div className="shell">
      <TopBar />
      <div className="body">
        <Sidebar view={view} onNavigate={go} canReview={items !== null} savedCount={records?.length || 0} />
        <main>
          <div className="pagehead">
            <h1>{title}</h1>
            <p>{sub}</p>
          </div>
          <div className="column">
            {view === 'details' && <PlannerForm key="form" value={form} onProceed={proceed} loading={busy} error={error} />}
            {view === 'review' && items && (
              <ReviewPage details={form} items={items} setItems={setItems} saving={busy} error={error}
                onBack={() => go('details')} onSubmit={submit} />
            )}
            {view === 'saved' && (
              <SavedPage records={records} file={file} justSaved={justSaved} onPlan={() => go('plan')} onNew={again} />
            )}
            {view === 'payments' && <PaymentsPage onPlan={() => go('plan')} />}
            {view === 'analytics' && <AnalyticsPage onPayments={() => go('payments')} />}
            {view === 'plan' && <PlanPage key="plan" onNew={again} onPayments={() => go('payments')} />}
          </div>
          <footer>Plans are estimates and Merchant AI can make mistakes. Check the numbers before you cook.</footer>
        </main>
      </div>
    </div>
  )
}
