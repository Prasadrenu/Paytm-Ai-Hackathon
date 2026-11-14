import { useCallback, useEffect, useState } from 'react'
import { getSaved, makePlan } from '../api.js'
import PlanResult from './PlanResult.jsx'
import Icon, { PART_ICON } from './Icon.jsx'
import { T, t } from '../i18n.js'

const sameDay = (iso) => new Date(iso).toDateString() === new Date().toDateString()

// Items are submitted one time slot at a time, so the plan merges everything saved today
// (or, if nothing was saved today, the latest submission).
function source(records) {
  const today = records.filter((r) => sameDay(r.saved_at))
  const use = today.length ? today : [records[0]]
  const seen = new Set()
  const items = use.flatMap((r) => r.items).filter((i) => {
    const k = `${i.name.toLowerCase()}|${i.from}|${i.to}`
    return seen.has(k) ? false : (seen.add(k), true)
  })
  return { ...use[0], items }
}

// Today's plan, filtered by part of the day: All, Morning, Afternoon, Evening, Night...
export default function PlanPage({ onNew, onPayments, onMenu, lang }) {
  const [records, setRecords] = useState(null)
  const [plan, setPlan] = useState(null)
  const [part, setPart] = useState('all')
  const [when, setWhen] = useState('today')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const run = useCallback(async (recs, w = 'today') => {
    setLoading(true)
    setError('')
    setPlan(null)
    try {
      const rec = source(recs)
      const p = await makePlan({ items: rec.items, open: rec.open, close: rec.close, lang, when: w, location: rec.location })
      setPlan(p)
      // Start on the part of the day happening right now, if there is one.
      const now = w === 'today' && p.slots.find((s) => s.now && s.label !== 'Whole day')
      setPart(now ? now.label : 'all')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [lang])

  useEffect(() => {
    getSaved()
      .then((r) => {
        setRecords(r.records)
        if (r.records.length) run(r.records)
      })
      .catch((e) => {
        setRecords([])
        setError(e.message)
      })
  }, [run])

  if (records === null) return <section className="card result empty"><div className="spin" /></section>
  if (!records.length) {
    return (
      <section className="card result empty">
        <div className="big"><Icon name="plan" size={40} /></div>
        <p>{t('No stall details yet. Enter what you sell and your timings to get today\'s plan.')}</p>
        <button type="button" className="primary inline" onClick={onNew}>{t('Enter stall details')}</button>
      </section>
    )
  }

  const slots = plan?.slots || []
  const count = (s) => s.items.length
  return (
    <div className="saved">
      <section className="card planbar">
        <div className="partfilter">
          <div className="whenrow" role="group" aria-label={t('Which day')}>
            {[['today', T('Today')], ['tomorrow', T('Tomorrow')]].map(([k, label]) => (
              <button key={k} type="button" className={'whenbtn' + (when === k ? ' on' : '')} disabled={loading}
                onClick={() => { setWhen(k); run(records, k) }}>{t(label)}</button>
            ))}
          </div>
          <small>{t('Show')}</small>
          <div className="presets" role="group" aria-label={t('Part of the day')}>
            <button type="button" className={'chipbtn' + (part === 'all' ? ' on' : '')} onClick={() => setPart('all')} disabled={!plan}>{t('All day{0}', plan ? ` (${slots.reduce((n, s) => n + count(s), 0)})` : '')}
            </button>
            {slots.map((s) => (
              <button key={s.label + s.range} type="button" className={'chipbtn' + (part === s.label ? ' on' : '')} onClick={() => setPart(s.label)}>
                <Icon name={PART_ICON[s.label] || 'calendar'} size={15} /> {s.label} ({count(s)}){s.now && <span className="nowdot" aria-label={t('happening now')} />}
              </button>
            ))}
          </div>
        </div>
        <button type="button" className="ghostbtn" onClick={() => run(records, when)} disabled={loading}>{t('Refresh')}</button>
      </section>
      <PlanResult plan={plan} loading={loading} error={error} only={part} onPayments={onPayments} onMenu={onMenu} />
    </div>
  )
}
