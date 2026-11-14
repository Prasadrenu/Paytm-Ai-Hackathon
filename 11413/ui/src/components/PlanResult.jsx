import { speech } from '../api.js'
import ListenButton from './ListenButton.jsx'
import Icon, { PART_ICON } from './Icon.jsx'
import { T, plural, t, td, weekday } from '../i18n.js'

const CAT = {
  hot_drink: T('Hot drink'), cold_drink: T('Cold drink'), fried_snack: T('Snack'), meal: T('Meal'), sweet: T('Sweet'), other: T('Other'),
}
const hour = (h) => `${(h % 12) || 12} ${h % 24 < 12 ? 'am' : 'pm'}`
const time12 = (t) => {
  const [h, m] = t.split(':').map(Number)
  return `${(h % 12) || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'am' : 'pm'}`
}

const PEAK_SRC = { payments: T('(from your payment times)'), mixed: T('(partly from your payment times)'), typical: T('(typical pattern)') }
const BASIS = { counts: ['counts', T('From your counts')], payments: ['card', T('From payments')], mixed: ['card', T('Payments + estimate')], starter: [null, T('Estimate')] }

// Daily counts line for the "Based on" panel: what is learned from, plus what was already logged today.
function countText(k) {
  const logged = (k.today || []).map((x) => (x.complete ? t(x.part) : t('{0} (start only)', t(x.part))))
  const learned = k.used
    ? t('{0} learned from {1} of made/left counts', plural(k.items, '{0} item', '{0} items'), plural(k.days, '{0} day', '{0} days'))
    : ''
  if (!logged.length) return learned || t('No counts yet')
  return `${learned ? learned + '. ' : ''}${t('Logged today: {0}', logged.join(', '))}${k.used ? '' : ' ' + t('(shown on its card)')}`
}

// "Based on": the signals behind this plan, so the merchant can see why the numbers are what they are.
function Basis({ b, onPayments, onMenu }) {
  const place = b.place || {}
  const evs = b.events || []
  const calText = !b.calendar_covered ? t('Festival calendar not loaded for this year')
    : evs.length ? evs.map((e) => t('{0} ({1})', e.name, td(e.when))).join(', ') : t('No festival today or tomorrow')
  const p = b.payments
  const k = b.counts || { days: 0, used: false }
  const payText = p.used ? t('{0} of payments{1}', plural(p.days, '{0} day', '{0} days'), p.source === 'demo' ? ' ' + t('(sample data)') : '')
    : p.needed ? t('Only {0} of payments, need 3', plural(p.days, '{0} day', '{0} days'))
    : t('No payments yet')
  return (
    <div className="basis">
      <b>{t('This plan is based on')}</b>
      <ul>
        <li className="on"><Icon name="cloud" /> <span>{t('Weather')}</span><small>{place.name ? t('{0}: ', place.default ? t('{0} (default)', place.name) : place.name) : ''}{b.weather_live ? b.weather_hourly ? t('live forecast for each part of the day') : t("today's forecast") : t('forecast unavailable, assumed normal')}</small></li>
        <li className="on"><Icon name="calendar" /> <span>{t('Calendar')}</span><small>{calText}</small></li>
        <li className={k.used || k.today?.length ? 'on' : 'off'}><Icon name="counts" /> <span>{t('Daily counts')}</span><small>{countText(k)}</small></li>
        <li className={p.used ? 'on' : 'off'}><Icon name="card" /> <span>{t('Payments')}</span><small>{payText}</small></li>
      </ul>
      {place.default && onMenu && <button type="button" className="linkbtn" onClick={onMenu}>{t('Set your stall location for local weather')}{' '}<Icon name="right" size={14} /></button>}
      {!k.used && !p.used && onPayments && <button type="button" className="linkbtn" onClick={onPayments}>{t('Add daily counts or payments to make it sharper')}{' '}<Icon name="right" size={14} /></button>}
    </div>
  )
}

// The "sold 9 am to 11 am" reason is already the card's heading, so only show weather/weekend reasons.
const reasons = (i) => (i.why || '').split(', ').filter((x) => x && x !== 'normal day' && !x.startsWith('sold ')).map(td)

function PlanTable({ items }) {
  return (
    <table>
      <thead><tr><th>{t('Item')}</th><th className="num">{t('Make')}</th></tr></thead>
      <tbody>
        {items.map((i, n) => (
          <tr key={n}>
            <td>
              <b>{i.name}</b>
              <small>{[t(CAT[i.category]), i.price ? `₹${i.price}` : null, ...reasons(i)].filter(Boolean).join(' · ')}</small>
            </td>
            <td className="num"><span className="qty">{i.make}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// One card per part of the day (Morning, Evening, ...): its items, busiest time and message.
function Slot({ slot, lang }) {
  const total = slot.items.reduce((s, i) => s + i.make, 0)
  const text = slot.message_local || slot.message
  return (
    <div className={'card slot' + (slot.now ? ' now' : '')}>
      <div className="rh">
        <div>
          <h3><Icon name={PART_ICON[slot.label] || 'calendar'} size={18} /> {t(slot.label)}</h3>
          <p className="sub">{slot.range}</p>
        </div>
        <div className="pills">
          {slot.now && <span className="pill live">{t('Happening now')}</span>}
          <span className={'pill basis-' + slot.basis}>{BASIS[slot.basis][0] && <Icon name={BASIS[slot.basis][0]} size={13} />} {t(BASIS[slot.basis][1])}</span>
          <span className="pill">{t('{0} to make', total)}</span>
        </div>
      </div>

      <p className="busy">{t('Busiest:')}{' '}<b>{hour(slot.peak.start)} – {hour(slot.peak.end)}</b>
        <em className="src">{t(PEAK_SRC[slot.peak_src])}</em>
        {slot.weather && <>{' '}{t('· Weather:')}{' '}<b>{t('{0}°C, {1}% rain', Math.round(slot.weather.max_c), slot.weather.rain_pct)}</b></>}
      </p>

      {slot.actual && (
        <div className="actual">
          <div className="rh">
            <b><Icon name="counts" size={16} />{' '}{t('Your count today')}</b>
            <span className={'pill' + (slot.actual.complete ? ' basis-payments' : ' warn')}>{slot.actual.complete ? t('Counted') : t('Waiting for end count')}</span>
          </div>
          <table>
            <thead><tr><th>{t('Item')}</th><th className="num">{t('Made')}</th><th className="num">{t('Left')}</th><th className="num">{t('Sold')}</th></tr></thead>
            <tbody>
              {slot.actual.items.map((i) => (
                <tr key={i.name}>
                  <td><b>{i.name}</b>{i.stockout && <small className="assumed">{t('Sold out')}</small>}</td>
                  <td className="num">{i.made ?? '–'}</td><td className="num">{i.left ?? '–'}</td><td className="num"><b>{i.sold ?? '–'}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
          <small className="note">{t('This is what actually happened. It teaches the later parts of today and tomorrow\'s plan.')}</small>
        </div>
      )}

      {/* Once the part is counted, what really happened matters more than the plan, so fold the plan away. */}
      {slot.actual?.complete ? (
        <details className="planfold">
          <summary>{t('Amounts the plan suggested for {0} (before your count)', t(slot.label))}</summary>
          <PlanTable items={slot.items} />
        </details>
      ) : (
        <PlanTable items={slot.items} />
      )}

      <div className="slotmsg">
        <p className="msg">{slot.message}</p>
        {slot.message_local && lang !== 'en-IN' && <p className="msg local">{slot.message_local}</p>}
        <ListenButton id={`plan-${slot.label}-${slot.range}-${lang}`}
          source={() => speech(text, slot.message_local ? lang : 'en-IN').then((b64) => 'data:audio/wav;base64,' + b64)} />
      </div>
    </div>
  )
}

// `only`: 'all' or one part-of-day label (Morning, Evening, ...) to show just that section.
export default function PlanResult({ plan, loading, error, only = 'all', onPayments, onMenu }) {
  if (loading) {
    return (
      <section className="card result empty" aria-live="polite">
        <div className="spin" />
        <p>{t('Reading your items and checking today\'s weather…')}</p>
      </section>
    )
  }
  if (error) {
    return (
      <section className="card result empty" role="alert">
        <p className="err">{td(error)}</p>
      </section>
    )
  }
  if (!plan) {
    return (
      <section className="card result empty">
        <div className="big"><Icon name="plan" size={40} /></div>
        <p>{t('Your plan for today will appear here.')}</p>
      </section>
    )
  }

  const count = plan.slots.reduce((s, x) => s + x.items.length, 0)
  return (
    <section className="result" aria-live="polite">
      <div className="card">
        <div className="rh">
          <div>
            <h2>{plan.when === 'tomorrow' ? t('Plan for tomorrow ({0})', weekday(plan.date)) : t("{0}'s plan", weekday(plan.date))}</h2>
            <p className="sub">{t('Open from {0} to {1}', time12(plan.open), time12(plan.close))}</p>
          </div>
          <span className="pill">{t('{0} · {1} of the day', plural(count, '{0} item', '{0} items'), plural(plan.slots.length, '{0} part', '{0} parts'))}</span>
        </div>
        <div className="stats">
          <div><small>{t('Busiest time overall')}</small><b>{hour(plan.peak.start)} – {hour(plan.peak.end)}</b></div>
          <div><small>{t('Weather')}</small><b>{t('{0}°C · {1}% rain', Math.round(plan.weather.max_c), plan.weather.rain_pct)}</b></div>
        </div>
        <Basis b={plan.basis} onPayments={onPayments} onMenu={onMenu} />
        <p className="note">{td(plan.note)}</p>
      </div>

      {plan.slots.filter((s) => only === 'all' || s.label === only).map((s) => (
        <Slot key={s.label + s.range} slot={s} lang={plan.lang} />
      ))}
    </section>
  )
}
