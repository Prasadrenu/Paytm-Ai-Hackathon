import { useEffect, useState } from 'react'
import { acceptSpecial, dismissSpecial, getSpecial, removeSpecial } from '../api.js'
import Icon from './Icon.jsx'
import { fmtDate, t, td } from '../i18n.js'

const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)

function when(dateS) {
  const diff = Math.round((new Date(dateS + 'T00:00') - new Date(iso(new Date()) + 'T00:00')) / 86400000)
  if (diff === 0) return t('Today')
  if (diff === 1) return t('Tomorrow')
  return fmtDate(dateS + 'T00:00', { weekday: 'short', day: 'numeric', month: 'short' })
}
const effect = (p) => (p < 0 ? t('About {0}% fewer customers', -p) : t('About {0}% more customers', p))

// News about the stall's area (a bandh, strike, road closure). Nothing is shown unless something was found.
export default function SpecialEvents({ onChange }) {
  const [s, setS] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    getSpecial().then((j) => {
      if (!live) return
      setS(j)
      if (j.news?.stale) getSpecial(true).then((k) => live && setS(k)).catch(() => {})   // look at the news without making the page wait
    }).catch(() => {})
    return () => { live = false }
  }, [])

  async function run(fn) {
    setBusy(true)
    try { setS(await fn()); onChange?.() } catch { /* the list stays as it was */ } finally { setBusy(false) }
  }

  if (!s || !s.news.enabled) return null
  const quiet = !s.suggestions.length && !s.events.length
  return (
    <section className="card specials" aria-label={t('News for your area')}>
      {quiet && (
        <div className="evrow">
          <span className="evicon"><Icon name="pin" size={16} /></span>
          <div className="evtext">
            <b>{s.news.error ? td(s.news.error) : t('No bandh, strike or road closure found near {0}', s.news.place || t('your stall'))}</b>
            <small>{t('Local news is checked every few hours')}</small>
          </div>
        </div>
      )}
      {s.suggestions.map((x) => (
        <div key={x.id} className="evrow news">
          <span className="evicon"><Icon name="bell" size={16} /></span>
          <div className="evtext"><b>{x.title}</b><small>{when(x.date)} · {effect(x.effect_pct)}{s.news.place ? ` · ${s.news.place}` : ''}</small></div>
          <button type="button" className="primary inline small" disabled={busy} onClick={() => run(() => acceptSpecial(x.id))}>{t('Use in plan')}</button>
          <button type="button" className="ghostbtn" disabled={busy} onClick={() => run(() => dismissSpecial(x.id))}>{t('Ignore')}</button>
        </div>
      ))}
      {s.events.map((e) => (
        <div key={e.id} className="evrow">
          <span className="evicon on"><Icon name="calendar" size={16} /></span>
          <div className="evtext"><b>{e.title}</b><small>{when(e.date)} · {effect(e.effect_pct)} · {t('In your plan')}</small></div>
          <button type="button" className="ghostbtn" disabled={busy} onClick={() => run(() => removeSpecial(e.id))}>{t('Remove')}</button>
        </div>
      ))}
    </section>
  )
}
