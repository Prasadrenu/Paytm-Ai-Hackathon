import { useEffect, useRef, useState } from 'react'
import { clearPayments, demoPayments, getPayments, uploadPayments } from '../api.js'
import Icon from './Icon.jsx'
import { fmtDate, t, td } from '../i18n.js'

const hour = (h) => `${(h % 12) || 12}${h < 12 ? 'a' : 'p'}`
const day = (iso) => fmtDate(iso + 'T00:00', { day: 'numeric', month: 'short' })

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
        <h2>{t('How the planner uses payments')}</h2>
        <ol className="how">
          <li><b>{t('First time:')}</b>{' '}{t('no payments yet, so the plan comes from')}{' '}<b>{t('weather')}</b>{' '}{t('and the')}{' '}<b>{t('festival calendar')}</b>.</li>
          <li><b>{t('After that:')}</b>{' '}{t('it also learns from your')}{' '}<b>{t('payments for each time of day')}</b>{t(', so mornings and evenings are sized from what you really sell.')}</li>
          <li>{t('A time of day with fewer than 3 days of payments still uses weather and calendar.')}</li>
        </ol>
      </section>

      <section className="card">
        <div className="rh">
          <div>
            <h2>{t('Payment history')}</h2>
            <p className="sub">
              {has ? t('{0} payments over {1} days ({2} – {3}), ₹{4} in total.', s.count.toLocaleString('en-IN'), s.days, day(s.first), day(s.last), s.total.toLocaleString('en-IN')) : t('No payments added yet.')}
            </p>
          </div>
          {has && <span className={'pill' + (s.source === 'demo' ? ' warn' : '')}>{s.source === 'demo' ? t('Sample data') : t('Your data')}</span>}
        </div>

        {has && !s.enough && <p className="warnmsg">{t('Only {0} {1} of payments. The planner needs at least 3 days before it uses them.', s.days, s.days === 1 ? t('day') : t('days'))}</p>}
        {s?.source === 'demo' && <p className="warnmsg">{t('This is made-up sample data for trying the app. Upload your real payments before relying on the plan.')}</p>}

        {has && (
          <div className="chart" role="img" aria-label={t('Average revenue by hour of day')}>
            {s.hourly.map((h) => (
              <div className="barcol" key={h.hour} title={t('{0}: ₹{1} average, {2} payments', hour(h.hour), h.avg_revenue, h.avg_txn)}>
                <div className="bar" style={{ height: `${Math.max(4, (h.avg_revenue / max) * 100)}%` }} />
                <small>{hour(h.hour)}</small>
              </div>
            ))}
          </div>
        )}
        {has && <p className="note">{t('Average revenue per hour, across all days.')}</p>}

        {error && <p className="err" role="alert">{td(error)}</p>}
        <div className="footbar">
          <div className="btnrow">
            <button type="button" className="ghostbtn" disabled={busy} onClick={() => fileRef.current.click()}><Icon name="upload" size={16} />{' '}{t('Upload CSV')}</button>
            <button type="button" className="ghostbtn" disabled={busy} onClick={() => act(demoPayments)}>{t('Load sample data')}</button>
            {has && <button type="button" className="ghostbtn danger" disabled={busy} onClick={() => confirm(t('Remove all stored payments?')) && act(clearPayments)}>{t('Clear')}</button>}
          </div>
          <button type="button" className="primary inline" onClick={onPlan}>{t('See today\'s plan')}</button>
        </div>
        <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" hidden onChange={onFile} />
      </section>
    </div>
  )
}
