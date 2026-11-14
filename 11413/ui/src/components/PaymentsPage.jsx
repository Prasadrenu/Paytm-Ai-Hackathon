import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { clearPayments, demoPayments, getPayments, uploadPayments } from '../api.js'

const hour = (h) => `${(h % 12) || 12}${h < 12 ? 'a' : 'p'}`
const day = (iso) => new Date(iso + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

// Payment history: the "second time" signal. Upload a CSV (time, amount) or load demo data.
export default function PaymentsPage({ onPlan }) {
  const [s, setS] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)

  useEffect(() => { getPayments().then(setS).catch((e) => setError(e.message)) }, [])

  async function act(fn) {
    setBusy(true)
    setError('')
    try {
      setS(await fn())
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  const onFile = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (f.size > 8 * 1024 * 1024) return setError('That file is over 8 MB. Send a shorter period.')
    act(async () => uploadPayments(await f.text()))
  }

  const has = s?.count > 0
  const max = has ? Math.max(...s.hourly.map((h) => h.avg_revenue)) : 0
  return (
    <div className="saved">
      <section className="card">
        <h2>How the planner uses payments</h2>
        <ol className="how">
          <li><b>First time:</b> no payments yet, so the plan comes from <b>weather</b> and the <b>festival calendar</b>.</li>
          <li><b>After that:</b> it also learns from your <b>payments for each time of day</b>, so mornings and evenings are sized from what you really sell.</li>
          <li>A time of day with fewer than 3 days of payments still uses weather and calendar.</li>
        </ol>
      </section>

      <section className="card">
        <div className="rh">
          <div>
            <h2>Payment history</h2>
            <p className="sub">
              {has
                ? `${s.count.toLocaleString('en-IN')} payments over ${s.days} days (${day(s.first)} – ${day(s.last)}), ₹${s.total.toLocaleString('en-IN')} in total.`
                : 'No payments added yet.'}
            </p>
          </div>
          {has && <span className={'pill' + (s.source === 'demo' ? ' warn' : '')}>{s.source === 'demo' ? 'Sample data' : 'Your data'}</span>}
        </div>

        {has && !s.enough && <p className="warnmsg">Only {s.days} {s.days === 1 ? 'day' : 'days'} of payments. The planner needs at least 3 days before it uses them.</p>}
        {s?.source === 'demo' && <p className="warnmsg">This is made-up sample data for trying the app. Upload your real payments before relying on the plan.</p>}

        {has && (
          <div className="chart" role="img" aria-label="Average revenue by hour of day">
            {s.hourly.map((h) => (
              <div className="barcol" key={h.hour} title={`${hour(h.hour)}: ₹${h.avg_revenue} average, ${h.avg_txn} payments`}>
                <div className="bar" style={{ height: `${Math.max(4, (h.avg_revenue / max) * 100)}%` }} />
                <small>{hour(h.hour)}</small>
              </div>
            ))}
          </div>
        )}
        {has && <p className="note">Average revenue per hour, across all days.</p>}

        {error && <p className="err" role="alert">{error}</p>}
        <div className="footbar">
          <div className="btnrow">
            <button type="button" className="ghostbtn" disabled={busy} onClick={() => fileRef.current.click()}><Icon name="upload" size={16} /> Upload CSV</button>
            <button type="button" className="ghostbtn" disabled={busy} onClick={() => act(demoPayments)}>Load sample data</button>
            {has && <button type="button" className="ghostbtn danger" disabled={busy} onClick={() => confirm('Remove all stored payments?') && act(clearPayments)}>Clear</button>}
          </div>
          <button type="button" className="primary inline" onClick={onPlan}>See today's plan</button>
        </div>
        <p className="note">CSV needs two columns: a time and an amount, e.g. <code>timestamp,amount</code> then <code>2026-11-10 17:45,30</code>. Uploading replaces the current history.</p>
        <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" hidden onChange={onFile} />
      </section>
    </div>
  )
}
