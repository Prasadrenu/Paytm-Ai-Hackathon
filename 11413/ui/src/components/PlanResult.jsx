import useSpeaker from '../hooks/useSpeaker.js'
import Icon from './Icon.jsx'

const CAT = {
  hot_drink: 'Hot drink', cold_drink: 'Cold drink', fried_snack: 'Snack', meal: 'Meal', sweet: 'Sweet', other: 'Other',
}
export const ICON = { Morning: 'sunrise', Afternoon: 'sun', Evening: 'sunset', Night: 'moon', 'Whole day': 'calendar' }
const hour = (h) => `${(h % 12) || 12} ${h % 24 < 12 ? 'am' : 'pm'}`
const time12 = (t) => {
  const [h, m] = t.split(':').map(Number)
  return `${(h % 12) || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'am' : 'pm'}`
}

const PEAK_SRC = { payments: '(from your payment times)', mixed: '(partly from your payment times)', typical: '(typical pattern)' }
const BASIS = { payments: 'From payments', mixed: 'Payments + estimate', starter: 'Estimate' }

// "Based on": the signals behind this plan, so the merchant can see why the numbers are what they are.
function Basis({ b, onPayments }) {
  const evs = b.events || []
  const calText = !b.calendar_covered ? 'Festival calendar not loaded for this year'
    : evs.length ? evs.map((e) => `${e.name} (${e.when})`).join(', ') : 'No festival today or tomorrow'
  const p = b.payments
  const payText = p.used ? `${p.days} days of payments${p.source === 'demo' ? ' (sample data)' : ''}`
    : p.needed ? `Only ${p.days} ${p.days === 1 ? 'day' : 'days'} of payments, need 3`
    : 'No payments yet'
  return (
    <div className="basis">
      <b>This plan is based on</b>
      <ul>
        <li className="on"><Icon name="weather" /><span>Weather</span><small>{b.weather_live ? (b.weather_hourly ? 'Live forecast for each part of the day' : "Today's forecast") : 'Forecast unavailable, assumed normal'}</small></li>
        <li className="on"><Icon name="calendar" /><span>Calendar</span><small>{calText}</small></li>
        <li className={p.used ? 'on' : 'off'}><Icon name="payments" /><span>Payments</span><small>{payText}</small></li>
      </ul>
      {!p.used && onPayments && <button type="button" className="linkbtn" onClick={onPayments}>Add payments to make it sharper →</button>}
    </div>
  )
}

// The "sold 9 am to 11 am" reason is already the card's heading, so only show weather/weekend reasons.
const reasons = (i) => (i.why || '').split(', ').filter((x) => x && x !== 'normal day' && !x.startsWith('sold '))

// One card per part of the day (Morning, Evening, ...): its items, busiest time and message.
function Slot({ slot, lang }) {
  const { speak, loading } = useSpeaker()
  const total = slot.items.reduce((s, i) => s + i.make, 0)
  const text = slot.message_local || slot.message
  return (
    <div className={'card slot' + (slot.now ? ' now' : '')}>
      <div className="rh">
        <div>
          <h3><Icon name={ICON[slot.label] || 'clock'} /> {slot.label}</h3>
          <p className="sub">{slot.range}</p>
        </div>
        <div className="pills">
          {slot.now && <span className="pill live">Happening now</span>}
          <span className={'pill basis-' + slot.basis}>{BASIS[slot.basis]}</span>
          <span className="pill">{total} to make</span>
        </div>
      </div>

      <p className="busy">
        Busiest: <b>{hour(slot.peak.start)} – {hour(slot.peak.end)}</b>
        <em className="src">{PEAK_SRC[slot.peak_src]}</em>
        {slot.weather && <> · Weather: <b>{Math.round(slot.weather.max_c)}°C, {slot.weather.rain_pct}% rain</b></>}
      </p>

      <table>
        <thead><tr><th>Item</th><th className="num">Make</th></tr></thead>
        <tbody>
          {slot.items.map((i, n) => (
            <tr key={n}>
              <td>
                <b>{i.name}</b>
                <small>{[CAT[i.category], i.price ? `₹${i.price}` : null, ...reasons(i)].filter(Boolean).join(' · ')}</small>
              </td>
              <td className="num"><span className="qty">{i.make}</span></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="slotmsg">
        <p className="msg">{slot.message}</p>
        {slot.message_local && lang !== 'en-IN' && <p className="msg local">{slot.message_local}</p>}
        <button type="button" className="ghostbtn" disabled={loading} onClick={() => speak(text, slot.message_local ? lang : 'en-IN')}>
          <Icon name="volume" size={16} /> {loading ? 'Loading…' : 'Listen'}
        </button>
      </div>
    </div>
  )
}

// `only`: 'all' or one part-of-day label (Morning, Evening, ...) to show just that section.
export default function PlanResult({ plan, loading, error, only = 'all', onPayments }) {
  if (loading) {
    return (
      <section className="card result empty" aria-live="polite">
        <div className="spin" />
        <p>Reading your items and checking today's weather…</p>
      </section>
    )
  }
  if (error) {
    return (
      <section className="card result empty" role="alert">
        <p className="err">{error}</p>
      </section>
    )
  }
  if (!plan) {
    return (
      <section className="card result empty">
        <div className="big"><Icon name="plan" size={40} /></div>
        <p>Your plan for today will appear here.</p>
      </section>
    )
  }

  const count = plan.slots.reduce((s, x) => s + x.items.length, 0)
  return (
    <section className="result" aria-live="polite">
      <div className="card">
        <div className="rh">
          <div>
            <h2>{plan.weekday}'s plan</h2>
            <p className="sub">Open {time12(plan.open)} to {time12(plan.close)}</p>
          </div>
          <span className="pill">{count} {count === 1 ? 'item' : 'items'} · {plan.slots.length} {plan.slots.length === 1 ? 'part' : 'parts'} of the day</span>
        </div>
        <div className="stats">
          <div><small>Busiest time overall</small><b>{hour(plan.peak.start)} – {hour(plan.peak.end)}</b></div>
          <div><small>Weather</small><b>{Math.round(plan.weather.max_c)}°C · {plan.weather.rain_pct}% rain</b></div>
        </div>
        <Basis b={plan.basis} onPayments={onPayments} />
        <p className="note">{plan.note}</p>
      </div>

      {plan.slots.filter((s) => only === 'all' || s.label === only).map((s) => (
        <Slot key={s.label + s.range} slot={s} lang={plan.lang} />
      ))}
    </section>
  )
}
