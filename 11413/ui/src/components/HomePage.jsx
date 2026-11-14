import { useEffect, useState } from 'react'
import { getHome } from '../api.js'
import { clock12, openStatus } from '../stall.js'
import Icon, { PART_ICON } from './Icon.jsx'
import SpecialEvents from './SpecialEvents.jsx'
import { T, fmtDate, plural, t, td, weekday } from '../i18n.js'

const hr = (h) => `${(h % 12) || 12} ${h % 24 < 12 ? 'am' : 'pm'}`
const BASIS = { learned: T('Learned from your own sales'), mixed: T('Partly learned from your sales'), starter: T('Typical pattern for a stall like yours') }

function Kpi({ tone, icon, label, value, sub, onClick }) {
  const body = (
    <>
      <span className="kpiicon"><Icon name={icon} size={22} /></span>
      <div><small>{label}</small><b>{value}</b>{sub && <em>{sub}</em>}</div>
    </>
  )
  return onClick
    ? <button type="button" className={'kpi click t-' + tone} onClick={onClick}>{body}</button>
    : <div className={'kpi t-' + tone}>{body}</div>
}

// A small picture of what the planner finds: busy hours rising to a peak (the dark bars), beside the weather.
function HeroArt() {
  const heights = [46, 74, 62, 98, 126, 112, 78, 52]
  const peak = new Set([3, 4, 5])
  const bars = heights.map((h, i) => ({ x: 14 + i * 40, h, peak: peak.has(i) }))
  const line = bars.map((b) => `${b.x + 14},${176 - b.h - 14}`).join(' ')
  return (
    <svg className="heroart" viewBox="0 0 340 190" aria-hidden="true" focusable="false">
      <circle cx="292" cy="40" r="46" fill="#00BAF2" opacity=".16" />
      <circle cx="292" cy="40" r="26" fill="#00BAF2" />
      {bars.map((b) => <rect key={b.x} x={b.x} y={176 - b.h} width="28" height={b.h} rx="9" fill={b.peak ? '#00BAF2' : '#FFFFFF'} opacity={b.peak ? 0.95 : 0.2} />)}
      <polyline points={line} fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity=".7" />
      {bars.map((b) => <circle key={'d' + b.x} cx={b.x + 14} cy={176 - b.h - 14} r="4.5" fill="#fff" />)}
      <rect x="6" y="178" width="328" height="3" rx="1.5" fill="#fff" opacity=".28" />
    </svg>
  )
}

function Hero({ greeting, stall }) {
    const today = fmtDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long' })
  const st = stall && openStatus(stall.open, stall.close)
  return (
    <section className="hero">
      <div className="herotext">
        <small>{today}</small>
        <h1>{greeting}</h1>
        <p>{t('Here is your stall today.')}</p>
        <div className="herochips">
          {stall?.location && <span className="hchip"><Icon name="pin" size={14} /> {stall.location.name}</span>}
          {st && <span className={'hchip ' + (st.isOpen ? 'open' : 'closed')}><i className="dot" /> {st.text}</span>}
        </div>
      </div>
      <HeroArt />
    </section>
  )
}

// Home: today at a glance. Quantities come from today's plan, so nothing here differs from the Plan page.
export default function HomePage({ go, greeting, stall }) {
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const load = () => getHome().then(setD).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  if (error) return <><Hero greeting={greeting} stall={stall} /><section className="card result empty"><p className="err">{td(error)}</p></section></>
  if (!d) {
    return (
      <div className="saved" aria-busy="true" aria-label={t('Loading your day')}>
        <Hero greeting={greeting} stall={stall} />
        <div className="kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="kpi skeleton" />)}</div>
        <div className="card skeleton tall" />
      </div>
    )
  }
  if (!d.menu) {
    return (
      <div className="saved">
        <Hero greeting={greeting} stall={stall} />
        <section className="card onboard">
          <div className="onboardtext">
            <h2>{t('Set up your stall')}</h2>
            <p className="sub">{t('Tell us what you sell and when you open. We will plan what to make, when it gets busy, and remind you each evening.')}</p>
            <ol className="steps3">
              <li><span>1</span>{' '}{t('Add your menu, timings and location')}</li>
              <li><span>2</span>{' '}{t('Count what you make and what is left each day')}</li>
              <li><span>3</span>{' '}{t('Get your plan and an alert every evening at {0}', `${d.notifications.hour % 12 || 12} ${d.notifications.hour < 12 ? 'am' : 'pm'}`)}</li>
            </ol>
            <button type="button" className="primary inline" onClick={() => go('details')}>{t('Add your menu')}{' '}<Icon name="right" size={16} /></button>
          </div>
        </section>
      </div>
    )
  }

  const p = d.plan
  const units = p.slots.reduce((s, x) => s + x.items.reduce((a, i) => a + i.make, 0), 0)
  const count = p.slots.reduce((s, x) => s + x.items.length, 0)
  const n = d.notifications
  return (
    <div className="saved">
      <Hero greeting={greeting} stall={stall} />
      <div className="kpis">
        <Kpi tone="blue" icon="trend" label={t('Busiest time today')} value={`${hr(p.peak.start)} – ${hr(p.peak.end)}`} sub={t(BASIS[p.basis.mode])} onClick={() => go('analytics')} />
        <Kpi tone="cyan" icon="cloud" label={t('Weather')} value={`${Math.round(p.weather.max_c)}°C`} sub={t('{0}% chance of rain · {1}', p.weather.rain_pct, p.basis.place.name)} />
        <Kpi tone="green" icon="counts" label={t('To make today')} value={t('{0} units', units)} sub={t('{0} across {1} of the day', plural(count, '{0} item', '{0} items'), plural(p.slots.length, '{0} part', '{0} parts'))} onClick={() => go('plan')} />
        <Kpi tone="amber" icon="bell" label={t('Evening alert')} value={n.active ? t('Ready to listen') : t('Daily at {0}', `${n.hour % 12 || 12} ${n.hour < 12 ? 'am' : 'pm'}`)}
          sub={n.active ? t("Tomorrow's plan is waiting") : t("Tomorrow's plan arrives by itself")} onClick={() => go('notifications')} />
      </div>

      <SpecialEvents onChange={load} />

      <section className="card">
        <div className="rh">
          <div><h2>{t('Today at a glance')}</h2><p className="sub">{t('{0}. Open from {1} to {2}.', weekday(p.date), clock12(p.open), clock12(p.close))}</p></div>
          <button type="button" className="ghostbtn" onClick={() => go('plan')}>{t('Full plan')}{' '}<Icon name="right" size={14} /></button>
        </div>
        <div className="glance">
          {p.slots.map((s) => (
            <article key={s.label + s.range} className={'gcard' + (s.now ? ' now' : '')}>
              <header>
                <span className="gicon"><Icon name={PART_ICON[s.label] || 'calendar'} size={18} /></span>
                <div><b>{t(s.label)}</b><small>{s.range}</small></div>
                {s.now && <span className="pill live">{t('Now')}</span>}
              </header>
              <ul>
                {s.items.map((i, k) => <li key={k}><span>{i.name}</span><b>{i.make}</b></li>)}
              </ul>
              <footer><Icon name="trend" size={14} />{' '}{t('Busiest {0} – {1}', hr(s.peak.start), hr(s.peak.end))}</footer>
            </article>
          ))}
        </div>
      </section>

      <section className="quick" aria-label={t('Quick actions')}>
        <button type="button" onClick={() => go('counts')}><span className="qicon"><Icon name="mic" size={18} /></span><span><b>{t('Count today\'s items')}</b><small>{t('Say what you made or what is left')}</small></span></button>
        <button type="button" onClick={() => go('analytics')}><span className="qicon"><Icon name="chart" size={18} /></span><span><b>{t('See peak hours')}</b><small>{t('From your payments, any date')}</small></span></button>
        <button type="button" onClick={() => go('notifications')}><span className="qicon"><Icon name="bell" size={18} /></span><span><b>{t('Notifications')}</b><small>{t('Listen to tomorrow\'s plan')}</small></span></button>
      </section>
    </div>
  )
}
