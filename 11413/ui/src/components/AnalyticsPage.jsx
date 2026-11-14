import { useEffect, useState } from 'react'
import { getAnalytics } from '../api.js'
import Icon from './Icon.jsx'
import { T, fmtDate, plural, t, td, weekday } from '../i18n.js'

const hh = (h) => `${h % 12 || 12}${h % 24 < 12 ? 'am' : 'pm'}`         // 5pm, 12pm, 7am
const money = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`
const short = (iso) => fmtDate(`${iso}T00:00`, { day: 'numeric', month: 'short' })
const long = (iso) => fmtDate(`${iso}T00:00`, { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })
const TAG_ICON = { festival: 'star', holiday: 'calendar', eve: 'calendar', weekend: 'calendar', rain: 'rain', hot: 'thermo' }
const STATUS = { measured: [T('Measured'), 'ok'], weak: [T('No clear effect'), 'weak'], few: [T('Need more days'), 'few'] }

function factorText(f) {
  if (f.measured) return t('{0}{1}% on sales, measured on {2} past days', f.lift > 0 ? '+' : '', f.lift, f.days)
  if (f.status === 'weak') return t('no clear effect in your {0} past days, so no change applied', f.days)
  return t('not measured yet ({0}, needs 3), so no change applied', plural(f.days, '{0} past day', '{0} past days'))
}

// Expected payments per hour. Dark blue bars are the peak hours (within 25% of the busiest hour).
function HourChart({ hours }) {
  const max = Math.max(...hours.map((h) => h.payments), 1)
  return (
    <div className="hbars" role="img" aria-label={t('Expected payments per hour')}>
      {hours.map((h) => (
        <div className={'hbar' + (h.peak ? ' peak' : '')} key={h.hour} title={t('{0}: about {1} payments, {2}', hh(h.hour), Math.round(h.payments), money(h.revenue))}>
          <i style={{ height: `${Math.max(4, (h.payments / max) * 100)}%` }} />
          <small>{hh(h.hour)}</small>
        </div>
      ))}
    </div>
  )
}

// Predicted busiest hours for any date, from your payments, checked against the calendar and the weather.
export default function AnalyticsPage({ onPayments }) {
  const [a, setA] = useState(null)        // overview (festival days, effects) plus the first prediction
  const [pred, setPred] = useState(null)  // prediction for the chosen date
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getAnalytics().then((r) => { setA(r); if (r.has_data) { setPred(r.prediction); setDate(r.prediction.date) } }).catch((e) => setError(e.message))
  }, [])

  async function pick(v) {
    setDate(v)
    if (!v) return
    setBusy(true)
    setError('')
    try {
      setPred((await getAnalytics(v)).prediction)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (!a && error) return <section className="card result empty"><p className="err">{td(error)}</p></section>
  if (!a) return <section className="card result empty"><div className="spin" /><p>{t('Reading your payments and the weather…')}</p></section>
  if (!a.has_data) {
    return (
      <section className="card result empty">
        <div className="big"><Icon name="chart" size={40} /></div>
        <p>{t('Analytics learns from your payment history.{0}', a.days ? t(' You have {0} {1} so far; it needs at least 2.', a.days, a.days === 1 ? t('day') : t('days')) : t(' Add your payments first.'))}</p>
        <button type="button" className="primary inline" onClick={onPayments}>{t('Go to Payments')}</button>
      </section>
    )
  }

  const w = pred.weather
  const wet = w && ((w.rain_pct ?? 0) >= 60 || (w.rain_mm ?? 0) >= 2)
  return (
    <div className="saved">
      <section className="card">
        <div className="rh">
          <div>
            <h2>{t('Predicted busiest hours')}</h2>
            <p className="sub">{long(pred.date)}{pred.is_today ? t(' (today)') : ''}</p>
          </div>
          {a.source === 'demo' && <span className="pill warn">{t('Sample data')}</span>}
        </div>

        <label className="datepick">
          <span><Icon name="calendar" size={16} />{' '}{t('Choose a date')}</span>
          <input type="date" value={date} min={a.first} max={a.max_date} onChange={(e) => pick(e.target.value)} aria-label={t('Choose a date')} />
        </label>
        {error && <p className="err" role="alert">{td(error)}</p>}

        <div className="chiprow">
          {w ? (
            <span className="chip wxchip">
              <Icon name="thermo" size={14} />{' '}{t('{0}°C', Math.round(w.max_c))}<Icon name={wet ? 'rain' : 'cloud'} size={14} /> {w.rain_pct != null ? t('{0}% rain', w.rain_pct) : t('{0} mm rain', w.rain_mm)}
            </span>
          ) : <span className="chip muted">{t('Weather not available for this date')}</span>}
          {pred.events.map((e) => <span key={e.name} className="chip evgreen"><Icon name="star" size={13} /> {e.name}</span>)}
        </div>

        {busy ? <div className="chartbusy"><div className="spin" /></div> : pred.hours.length === 0 ? (
          <p className="sub">{t('Not enough payments to show an hourly pattern for this kind of day yet.')}</p>
        ) : (
          <>
            <p className="rushline">
              {pred.rush ? <>{t('Expect the rush at')}{' '}<b>{hh(pred.rush.start)} – {hh(pred.rush.end)}</b>.</> : t('No clear rush for this day.')}
            </p>
            <HourChart hours={pred.hours} />
            <p className="note">{t('Expected payments per hour. Dark blue bars are peak hours (within 25% of the busiest); light blue bars are quieter. Based on {0} of payments.', td(pred.pattern.text))}</p>
            {pred.runs.length > 0 && (
              <ul className="runs">
                {pred.runs.map((r) => <li key={r.start}><b>{hh(r.start)} – {hh(r.end)}</b>{t(': about {0} payments', r.payments)}</li>)}
              </ul>
            )}
            <details className="howdone">
              <summary>{t('How this was worked out')}</summary>
              <ul className="why">
                <li><Icon name="chart" size={16} /><span>{t('Hourly pattern from')}{' '}<b>{td(pred.pattern.text)}</b>{' '}{t('in your payments, skipping festival, holiday and rainy days.')}</span></li>
                {pred.factors.map((f) => (
                  <li key={f.tag} className={f.measured ? '' : 'dim'}><Icon name={TAG_ICON[f.tag]} size={16} /><span><b>{td(f.label)}:</b> {factorText(f)}.</span></li>
                ))}
                {pred.factors.length === 0 && <li className="dim"><Icon name="info" size={16} /><span>{t('A normal day: no festival, holiday or unusual weather expected, so the pattern is used as it is.')}</span></li>}
              </ul>
            </details>
          </>
        )}
        <p className="note foot">{t('Payment history covers {0} days ({1} to {2}). Weather: Open-Meteo {3}. This is an estimate, not a guarantee.', a.days, a.first, a.last, w?.recorded ? t('recorded') : t('forecast'))}</p>
      </section>

      <section className="card">
        <h2>{t('Sales on past festival days')}</h2>
        <p className="sub">{t('Each festival or public holiday in your history, against a normal weekday ({0}) or weekend ({1}) in your payments.', money(a.normal_day.weekday), money(a.normal_day.weekend))}</p>
        {a.festival_days.length === 0 ? (
          <p className="sub">{t('No festival or holiday falls in your payment history yet.')}</p>
        ) : (
          <table>
            <thead><tr><th>{t('Day')}</th><th>{t('Festival')}</th><th className="num">{t('Sales')}</th><th className="num">{t('Payments')}</th><th>{t('Busiest hour')}</th><th className="num">{t('vs normal day')}</th></tr></thead>
            <tbody>
              {a.festival_days.map((f) => (
                <tr key={f.date}>
                  <td><b>{weekday(f.date)}</b> {short(f.date)}</td>
                  <td>{f.events.map((e) => <span key={e} className="chip evgreen"><Icon name="star" size={12} /> {e}</span>)}</td>
                  <td className="num">{money(f.revenue)}</td>
                  <td className="num">{f.payments}</td>
                  <td>{hh(f.peak_hour)}</td>
                  <td className="num"><span className={'liftval' + (f.vs_normal < 0 ? ' neg' : '')}>{f.vs_normal > 0 ? '+' : ''}{f.vs_normal}%</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>{t('What moved your sales')}</h2>
        <p className="sub">{t('Each kind of day against a normal weekday or weekend, over your last {0} days. A change is only used in predictions when it is clearly bigger than normal day-to-day swings.', a.days)}</p>
        {!a.weather_history && <p className="warnmsg"><Icon name="alert" size={15} />{' '}{t('Past weather could not be loaded, so rain and heat are not measured.')}</p>}
        <table>
          <thead><tr><th>{t('Kind of day')}</th><th className="num">{t('Days')}</th><th>{t('Effect on sales')}</th><th>{t('Result')}</th></tr></thead>
          <tbody>
            {a.lifts.map((l) => (
              <tr key={l.tag}>
                <td><Icon name={TAG_ICON[l.tag]} size={15} /> <b>{td(l.label)}</b></td>
                <td className="num">{l.days}</td>
                <td>{l.days ? <span className={'liftval' + (l.status === 'measured' ? '' : ' dim')}>{l.lift > 0 ? '+' : ''}{l.lift}%</span> : <span className="muted">–</span>}</td>
                <td><span className={'status st-' + STATUS[l.status][1]}>{t(STATUS[l.status][0])}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
