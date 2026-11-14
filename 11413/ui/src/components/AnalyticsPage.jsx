import { useEffect, useState } from 'react'
import { getAnalytics } from '../api.js'
import Icon from './Icon.jsx'

const hour = (h) => `${(h % 12) || 12}${h < 12 || h === 24 ? 'a' : 'p'}`
const range = (w) => `${hour(w.start)} – ${hour(w.end)}`
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const pretty = (s) => new Date(s + 'T00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })

// Peak hours for a date chosen from the calendar: predicted for today/future, actual for past days.
export default function AnalyticsPage({ onPayments }) {
  const today = iso(new Date())
  const [date, setDate] = useState(today)
  const [a, setA] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setError('')
    getAnalytics(date).then(setA).catch((e) => setError(e.message))
  }, [date])

  const picker = (
    <label className="datepick">
      <Icon name="calendar" size={16} />
      <span>Choose a date</span>
      <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
    </label>
  )

  if (error) return <section className="card">{picker}<p className="err" role="alert">{error}</p></section>
  if (!a) return <p className="note">Loading…</p>

  const none = a.mode === 'none'
  const max = a.hours.length ? Math.max(...a.hours.map((h) => h.txn)) : 0
  const peak = new Set(a.windows.flatMap((w) => Array.from({ length: w.end - w.start }, (_, i) => w.start + i)))
  const actual = a.mode === 'actual'

  return (
    <div className="saved">
      <section className="card">
        <div className="rh">
          <div>
            <h2>{actual ? 'Busiest hours (actual)' : 'Predicted busiest hours'}</h2>
            <p className="sub">{pretty(a.date)}{a.date === today ? ' (today)' : ''}</p>
          </div>
          {a.count > 0 && <span className={'pill' + (a.source === 'demo' ? ' warn' : '')}>{a.source === 'demo' ? 'Sample data' : 'Your data'}</span>}
        </div>

        {picker}

        <div className="ctx">
          {a.weather
            ? <span className="pill"><Icon name="thermo" size={14} /> {Math.round(a.weather.max_c)}°C <Icon name="rain" size={14} /> {a.weather.rain_pct}% rain</span>
            : <span className="pill warn">Weather unavailable for this date</span>}
          {a.events.map((e) => (
            <span key={e.name + e.when} className="pill basis-payments">
              <Icon name="event" size={14} /> {e.when === 'tomorrow' ? `Eve of ${e.name}` : e.name}{e.kind === 'holiday' ? ' (holiday)' : ''}
            </span>
          ))}
          {!a.events.length && a.calendar_covered && <span className="pill">No festival or holiday</span>}
          {!a.calendar_covered && <span className="pill warn">Calendar not available for this year</span>}
        </div>

        {none && (
          <div className="nodata" role="status">
            <Icon name="analytics" size={28} />
            <p><b>No data</b></p>
            <p className="sub">{a.message}</p>
            {!a.count || !a.enough ? <button type="button" className="primary inline" onClick={onPayments}>Add payments</button> : null}
          </div>
        )}

        {!none && (
          <>
            <p className="sub">
              {actual ? 'Your busiest time was ' : 'Expect the rush at '}
              <b>{a.windows.map(range).join(' and ')}</b>.
            </p>
            {a.reasons.length > 0 && (
              <p className="note">
                Adjusted {a.factor > 1 ? 'up' : 'down'} to {Math.round(a.factor * 100)}% of a normal day: {a.reasons.join(', ')}.
                These adjustments are assumptions, not measured.
              </p>
            )}
            <div className="chart" role="img" aria-label="Payments by hour">
              {a.hours.map((h) => (
                <div className="barcol" key={h.hour} title={`${hour(h.hour)}: ${actual ? '' : 'about '}${h.txn} payments, ₹${h.revenue}`}>
                  <div className="bar" style={{ height: `${Math.max(4, (h.txn / max) * 100)}%`,
                    background: peak.has(h.hour) ? '#002e6e' : '#00baf2' }} />
                  <small>{hour(h.hour)}</small>
                </div>
              ))}
            </div>
            <p className="note">
              {actual ? 'Payments per hour on this day.' : 'Expected payments per hour.'} Dark blue bars are peak hours (within 25% of the busiest); light blue bars are quieter.
              {!actual && ` Based on ${a.basis_days} past ${a.samedow ? `${a.weekday}s` : 'days'} of payments.`}
            </p>
            <ul className="how">
              {a.windows.map((w) => (
                <li key={w.start}><b>{range(w)}</b>: {actual ? '' : 'about '}{Math.round(w.txn)} payments</li>
              ))}
            </ul>
          </>
        )}
        {a.count > 0 && <p className="note">Payment history covers {a.days} days{a.first ? ` (${a.first} to ${a.last})` : ''}.{a.mode === 'predicted' ? ` Weather: ${a.weather_live ? 'Open-Meteo forecast' : 'unavailable, so ignored'}. This is an estimate, not a guarantee.` : ''}</p>}
      </section>

      {a.past_events.length > 0 && (
        <section className="card">
          <h2>Sales on past festival days</h2>
          <p className="sub">Measured from your payments, against a normal day of the same weekday.</p>
          <table className="tbl">
            <thead><tr><th>Date</th><th>Event</th><th>Sales</th><th>Normal</th><th>Change</th></tr></thead>
            <tbody>
              {a.past_events.map((e) => (
                <tr key={e.date}>
                  <td>{new Date(e.date + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
                  <td>{e.event}</td><td>₹{e.revenue.toLocaleString('en-IN')}</td><td>₹{e.typical.toLocaleString('en-IN')}</td>
                  <td><b>{e.lift_pct > 0 ? '+' : ''}{e.lift_pct}%</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
