import Icon from './Icon.jsx'
const time12 = (t) => {
  const [h, m] = t.split(':').map(Number)
  return `${(h % 12) || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'am' : 'pm'}`
}
const when = (iso) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

// Everything in data/stall_details.json, newest first. `justSaved` shows the success banner.
export default function SavedPage({ records, file, justSaved, onPlan, onNew }) {
  return (
    <div className="saved">
      {justSaved && (
        <section className="card done" role="status">
          <div className="tick" aria-hidden="true"><Icon name="check" size={28} /></div>
          <h2>Details saved</h2>
          <p className="sub">
            {justSaved.items.length} items, {time12(justSaved.open)} to {time12(justSaved.close)}.
          </p>
          <div className="footbar center">
            <button type="button" className="ghostbtn" onClick={onNew}>Enter new details</button>
            <button type="button" className="primary inline" onClick={onPlan}>See today's plan</button>
          </div>
        </section>
      )}

      <section className="card">
        <h2>Saved details</h2>
        <p className="sub">Everything you have submitted, newest first.</p>
        {records === null && <p className="sub">Loading…</p>}
        {records?.length === 0 && (
          <div className="emptyrow">
            <p>Nothing saved yet.</p>
            <button type="button" className="ghostbtn" onClick={onNew}>Enter stall details</button>
          </div>
        )}
        <ul className="records">
          {records?.map((r) => (
            <li key={r.id} className={r.id === justSaved?.id ? 'fresh' : ''}>
              <div className="rec-head">
                <b>{time12(r.open)} – {time12(r.close)}</b>
                <small>{when(r.saved_at)}</small>
              </div>
              <div className="chipsrow">
                {r.items.map((i) => (
                  <span className="itemchip" key={i.name}>{i.name}{i.price != null ? ` · ₹${i.price}` : ''}{i.from ? ` · ${time12(i.from)}–${time12(i.to)}` : ''}</span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
