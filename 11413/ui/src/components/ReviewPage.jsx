import { useState } from 'react'
import Icon from './Icon.jsx'
import { LANGS } from './PlannerForm.jsx'

const time12 = (t) => {
  const [h, m] = t.split(':').map(Number)
  return `${(h % 12) || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'am' : 'pm'}`
}
const PRESETS = [
  ['Morning', '06:00', '11:00'],
  ['Afternoon', '11:00', '16:00'],
  ['Evening', '16:00', '21:00'],
  ['Night', '21:00', '00:00'],
]

// Step 2: 1) choose a time, 2) tick the items sold in that time, 3) submit just those.
// Items carry two UI-only fields: `sel` (ticked) and `done` (time label of their last submit).
export default function ReviewPage({ details, items, setItems, onBack, onSubmit, saving, error }) {
  const [draft, setDraft] = useState({ name: '', price: '' })
  const [dur, setDur] = useState({ from: details.open, to: details.close })
  const [notice, setNotice] = useState(null)
  const whole = dur.from === details.open && dur.to === details.close
  const label = whole ? 'your opening hours' : `${time12(dur.from)} – ${time12(dur.to)}`
  const timeOk = dur.from && dur.to && dur.from !== dur.to

  const set = (i, patch) => setItems((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const add = () => {
    if (!draft.name.trim()) return
    setItems((rows) => [...rows, { name: draft.name.trim(), price: draft.price === '' ? null : Number(draft.price), sel: false }])
    setDraft({ name: '', price: '' })
  }
  const chosen = items.filter((r) => r.sel)
  const allOn = items.length > 0 && chosen.length === items.length
  const bad = chosen.some((r) => !r.name.trim() || (r.price != null && (Number.isNaN(r.price) || r.price < 0)))

  async function submit() {
    setNotice(null)
    const saved = await onSubmit(chosen, dur.from, dur.to)
    if (!saved) return
    const tag = whole ? 'Whole day' : `${time12(dur.from)} – ${time12(dur.to)}`
    setItems((rows) => rows.map((r) => (r.sel ? { ...r, sel: false, done: tag } : r)))
    setNotice({ count: chosen.length, tag, id: saved.id })
  }

  const lang = LANGS.find(([v]) => v === details.lang)?.[1] || details.lang
  return (
    <section className="card review">
      <h2>Check your items</h2>
      <p className="sub">Choose a time, tick the items sold then, and submit them. Repeat for other times of the day.</p>

      <div className="summary">
        <div><small>Open</small><b>{time12(details.open)} – {time12(details.close)}</b></div>
        <div><small>Items</small><b>{items.length}</b></div>
        <div><small>Language</small><b>{lang}</b></div>
      </div>

      <div className="duration">
        <b><span className="stepno">1</span>Choose the time</b>
        <div className="durinputs">
          <input type="time" value={dur.from} onChange={(e) => setDur({ ...dur, from: e.target.value })} aria-label="From time" />
          <span>to</span>
          <input type="time" value={dur.to} onChange={(e) => setDur({ ...dur, to: e.target.value })} aria-label="To time" />
        </div>
        <div className="presets" role="group" aria-label="Quick times">
          <button type="button" className={'chipbtn' + (whole ? ' on' : '')} onClick={() => setDur({ from: details.open, to: details.close })}>Whole day</button>
          {PRESETS.map(([name, f, t]) => (
            <button key={name} type="button" className={'chipbtn' + (dur.from === f && dur.to === t ? ' on' : '')} onClick={() => setDur({ from: f, to: t })}>{name}</button>
          ))}
        </div>
      </div>

      <b className="steplabel"><span className="stepno">2</span>Tick the items sold {whole ? 'in your opening hours' : `from ${time12(dur.from)} to ${time12(dur.to)}`}</b>
      <table className="picktable">
        <thead>
          <tr>
            <th className="chk">
              <input type="checkbox" checked={allOn} disabled={!items.length}
                onChange={(e) => setItems((rows) => rows.map((r) => ({ ...r, sel: e.target.checked })))} aria-label="Select all items" />
            </th>
            <th>Item</th><th className="num">Price (₹)</th><th />
          </tr>
        </thead>
        <tbody>
          {items.map((r, i) => (
            <tr key={i} className={r.sel ? 'picked' : ''}>
              <td className="chk"><input type="checkbox" checked={!!r.sel} onChange={(e) => set(i, { sel: e.target.checked })} aria-label={`Select ${r.name}`} /></td>
              <td>
                <input className="cell" value={r.name} maxLength={40} aria-label={`Item ${i + 1} name`} onChange={(e) => set(i, { name: e.target.value })} />
                {r.done && <small className="done-tag"><Icon name="check" size={13} /> Submitted for {r.done}</small>}
              </td>
              <td className="num">
                <input className="cell price" type="number" min="0" step="any" inputMode="decimal" placeholder="–" aria-label={`Item ${i + 1} price`}
                  value={r.price ?? ''} onChange={(e) => set(i, { price: e.target.value === '' ? null : Number(e.target.value) })} />
              </td>
              <td className="num"><button type="button" className="del" onClick={() => setItems((rows) => rows.filter((_, j) => j !== i))} aria-label={`Remove ${r.name}`}>×</button></td>
            </tr>
          ))}
          <tr className="addrow">
            <td className="chk">+</td>
            <td><input className="cell" value={draft.name} maxLength={40} placeholder="Add another item" aria-label="New item name"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} /></td>
            <td className="num"><input className="cell price" type="number" min="0" step="any" inputMode="decimal" placeholder="–" aria-label="New item price"
              value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} /></td>
            <td className="num"><button type="button" className="addbtn" onClick={add} disabled={!draft.name.trim()}>Add</button></td>
          </tr>
        </tbody>
      </table>

      {notice && (
        <p className="okmsg" role="status">
          <Icon name="check" size={15} /> Saved {notice.count} {notice.count === 1 ? 'item' : 'items'} for {notice.tag}. Pick another time to submit more items.
        </p>
      )}
      {error && <p className="err" role="alert">{error}</p>}
      <div className="footbar">
        <button type="button" className="ghostbtn" onClick={onBack} disabled={saving}>← Back</button>
        <button type="button" className="primary inline" onClick={submit} disabled={saving || !chosen.length || bad || !timeOk}>
          {saving ? 'Saving…' : chosen.length ? `Submit ${chosen.length} ${chosen.length === 1 ? 'item' : 'items'} for ${label}` : 'Tick items to submit'}
        </button>
      </div>
    </section>
  )
}
