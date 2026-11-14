import { useCallback, useEffect, useState } from 'react'
import { getCounts, getMade, getMenu, parseCounts, saveCounts, transcribe } from '../api.js'
import useRecorder from '../hooks/useRecorder.js'
import Icon, { PART_ICON } from './Icon.jsx'
import { T, fmtDate, t, td } from '../i18n.js'

const PARTS = [T('Morning'), T('Afternoon'), T('Evening'), T('Night'), T('Whole day')]
const todayIso = () => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}
const partNow = () => {
  const h = new Date().getHours()
  return h < 11 ? 'Morning' : h < 16 ? 'Afternoon' : h < 21 ? 'Evening' : 'Night'
}
const nice = (iso) => fmtDate(iso + 'T00:00', { weekday: 'short', day: 'numeric', month: 'short' })
const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase()
const blank = (r) => r.qty === '' || r.qty == null

// Put spoken or typed numbers into the item list. Names that are not in the list are added as extra rows.
function fill(rows, parsed) {
  const out = rows.map((r) => ({ ...r }))
  for (const p of parsed) {
    const hit = out.find((r) => same(r.name, p.name))
    if (hit) hit.qty = p.qty
    else out.push({ name: p.name, qty: p.qty, made: null, extra: true })
  }
  return out
}

// Daily counts by voice: say what you MADE before a time of day, and what is LEFT at its end.
// The items for that time of day are listed for you, so nothing has to be remembered.
export default function CountsPage({ onPlan }) {
  const [date, setDate] = useState(todayIso())
  const [part, setPart] = useState(partNow())
  const [kind, setKind] = useState('start')
  const [text, setText] = useState('')
  const [rows, setRows] = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [fallback, setFallback] = useState(false)
  const [log, setLog] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(null)
  const [draft, setDraft] = useState({ name: '', qty: '' })

  const reload = useCallback(() => getCounts().then((r) => setLog(r.records)).catch(() => setLog([])), [])
  useEffect(() => { reload() }, [reload])

  // The list for this day, time of day and count type: start = the items sold then, end = what was made.
  const loadList = useCallback(async (cancelled = () => false) => {
    setLoadingList(true)
    try {
      if (kind === 'start') {
        const r = await getMenu(part)
        if (!cancelled()) { setRows(r.items.map((i) => ({ name: i.name, qty: '', made: null }))); setFallback(r.fallback) }
      } else {
        const r = await getMade(date, part)
        if (!cancelled()) { setRows(r.items.map((i) => ({ name: i.name, qty: '', made: i.made }))); setFallback(false) }
      }
    } catch {
      if (!cancelled()) setRows([])
    } finally {
      if (!cancelled()) setLoadingList(false)
    }
  }, [kind, part, date])

  useEffect(() => {
    let dead = false
    setText(''); setError(''); setNotice(null)
    loadList(() => dead)
    return () => { dead = true }
  }, [loadList])

  async function read(t) {
    setBusy('Reading your counts…')
    setError('')
    try {
      setRows((rs) => fill(rs, []))
      const items = await parseCounts(t, kind)
      setRows((rs) => fill(rs, items))
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  const { recording, toggle } = useRecorder(async (blob) => {
    setBusy('Listening…')
    setError('')
    try {
      const t = await transcribe(blob)
      setText(t)
      await read(t)
    } catch (e) {
      setError(e.message)
      setBusy('')
    }
  })

  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const addRow = () => {
    if (!draft.name.trim() || draft.qty === '') return
    setRows((rs) => [...rs, { name: draft.name.trim(), qty: Number(draft.qty), made: null, extra: true }])
    setDraft({ name: '', qty: '' })
  }
  const filled = rows.filter((r) => !blank(r))
  const bad = filled.some((r) => !Number.isInteger(r.qty) || r.qty < 0)
  const missing = rows.length - filled.length
  const okToSave = filled.length > 0 && !bad && !busy && (kind === 'start' || rows.some((r) => r.made != null))

  async function save() {
    setBusy('Saving…')
    setError('')
    try {
      const r = await saveCounts({ date, part, kind, items: filled.map((x) => ({ name: x.name, qty: x.qty })) })
      setNotice({ kind, part, rec: r.record })
      setText('')
      await reload()
      loadList()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  const day = log?.filter((r) => r.date === date) || []
  const earlier = log?.filter((r) => r.date !== date) || []
  const colLabel = kind === 'start' ? t('Made') : t('Left')
  return (
    <div className="saved">
      <section className="card">
        <h2>{t('Two counts, every time of day')}</h2>
        <ol className="how">
          <li><b>{t('Before it starts:')}</b>{' '}{t('the items for that time are listed. Say or type how many you made.')}</li>
          <li><b>{t('When it ends:')}</b>{' '}{t('say or type how many are left. Made minus left is what sold, cash sales included.')}</li>
          <li>{t('The planner learns from these, with that day\'s weather and festival, to size the next days.')}</li>
        </ol>
      </section>

      <section className="card">
        <div className="row2 countctl">
          <label className="field">
            <span>{t('Day')}</span>
            <input type="date" value={date} max={todayIso()} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
          <div className="field">
            <span>{t('Time of day')}</span>
            <div className="presets" role="group" aria-label={t('Time of day')}>
              {PARTS.map((p) => (
                <button key={p} type="button" className={'chipbtn' + (part === p ? ' on' : '')} onClick={() => setPart(p)}><Icon name={PART_ICON[p]} size={15} /> {t(p)}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="seg" role="tablist" aria-label={t('Count type')}>
          <button type="button" role="tab" aria-selected={kind === 'start'} className={kind === 'start' ? 'on' : ''} onClick={() => setKind('start')}>
            <b>{t('1 · Start')}</b><small>{t('What I made')}</small>
          </button>
          <button type="button" role="tab" aria-selected={kind === 'end'} className={kind === 'end' ? 'on' : ''} onClick={() => setKind('end')}>
            <b>{t('2 · End')}</b><small>{t('What is left')}</small>
          </button>
        </div>

        <b className="steplabel">{kind === 'start' ? t('Items for {0}', part) : t('What you made for {0}', part)}</b>
        {loadingList && <p className="sub">{t('Loading your items…')}</p>}
        {!loadingList && kind === 'end' && !rows.some((r) => r.made != null) && (
          <p className="warnmsg">{t('No start count saved for {0} on {1}. Save the start count first, then come back for the end count.', t(part), nice(date))}</p>
        )}
        {!loadingList && kind === 'start' && rows.length === 0 && (
          <p className="warnmsg">{t('You have no saved items yet. Add them under Menu, or type an item below.')}</p>
        )}
        {!loadingList && fallback && (
          <p className="sub">{t('No items were set for {0}, so all your items are shown. Leave blank the ones you did not make.', part)}</p>
        )}

        <div className="voicebox">
          <button type="button" className={'micbig' + (recording ? ' rec' : '')} onClick={toggle} disabled={!!busy && !recording}
            aria-label={recording ? t('Stop recording') : t('Speak your counts')}>
            <Icon name={recording ? 'stop' : 'mic'} size={24} />
          </button>
          <div className="voicetext">
            <b>{recording ? t('Listening… tap to stop') : kind === 'start' ? t('Tap and say how many you made') : t('Tap and say how many are left')}</b>
            <small>{busy ? t(busy) : t('Say the item and the number, like "samosa 100, chai 80". Any Indian language.')}</small>
          </div>
        </div>
        <div className="typerow">
          <input value={text} onChange={(e) => setText(e.target.value)} aria-label={t('Counts as text')}
            placeholder={kind === 'start' ? t('Or type: samosa 100, chai 80') : t('Or type: samosa 15, chai 0')}
            onKeyDown={(e) => e.key === 'Enter' && text.trim() && (e.preventDefault(), read(text))} />
          <button type="button" className="ghostbtn" disabled={!text.trim() || !!busy} onClick={() => read(text)}>{t('Fill in')}</button>
        </div>

        {(rows.length > 0 || !loadingList) && (
          <table className="picktable counttable">
            <thead>
              <tr><th>{t('Item')}</th>{kind === 'end' && <th className="num">{t('Made')}</th>}<th className="num">{colLabel}</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.name + i} className={blank(r) ? '' : 'picked'}>
                  <td>
                    <b>{r.name}</b>
                    {r.extra && <small className="assumed">{t('Not on your list for {0}', part)}</small>}
                  </td>
                  {kind === 'end' && <td className="num muted">{r.made ?? '–'}</td>}
                  <td className="num">
                    <input className="cell price" type="number" min="0" step="1" inputMode="numeric" placeholder="–" value={r.qty}
                      onChange={(e) => setRow(i, { qty: e.target.value === '' ? '' : Number(e.target.value) })} aria-label={`${r.name} ${colLabel.toLowerCase()}`} />
                  </td>
                  <td className="num">
                    {r.extra && <button type="button" className="del" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label={t('Remove {0}', r.name)}><Icon name="x" size={16} /></button>}
                  </td>
                </tr>
              ))}
              <tr className="addrow">
                <td><input className="cell" value={draft.name} maxLength={40} placeholder={t('Add another item')} aria-label={t('New item')} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></td>
                {kind === 'end' && <td />}
                <td className="num"><input className="cell price" type="number" min="0" placeholder="0" aria-label={t('New quantity')} value={draft.qty}
                  onChange={(e) => setDraft({ ...draft, qty: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addRow())} /></td>
                <td className="num"><button type="button" className="addbtn" onClick={addRow} disabled={!draft.name.trim() || draft.qty === ''}>{t('Add')}</button></td>
              </tr>
            </tbody>
          </table>
        )}
        {rows.length > 0 && (
          <div className="tablehint">
            <small>
              {kind === 'start' ? t('Leave an item blank if you did not make it.') : missing ? t('{0} {1} no number yet and will be skipped.', missing, missing === 1 ? t('item has') : t('items have')) : t('All items counted.')}
            </small>
            {kind === 'end' && missing > 0 && (
              <button type="button" className="linkbtn" onClick={() => setRows((rs) => rs.map((r) => (blank(r) ? { ...r, qty: 0 } : r)))}>{t('Mark the rest as 0 left (sold out)')}</button>
            )}
          </div>
        )}

        {notice && (
          <div className="okmsg" role="status">
            {notice.kind === 'start'
              ? <><Icon name="check" size={15} />{' '}{t('Saved what you made for {0}. When it ends, come back and say what is left.', t(notice.part))}</>
              : <><Icon name="check" size={15} />{' '}{t('Saved. Sold in {0}: {1}.{2}', t(notice.part), notice.rec.items.filter((i) => i.sold != null).map((i) => `${i.name} ${i.sold}`).join(', '), notice.rec.items.some((i) => i.stockout) && t(' You sold out of some items, so the planner will make more next time.'))}</>}
          </div>
        )}
        {error && <p className="err" role="alert">{td(error)}</p>}

        <div className="footbar">
          <button type="button" className="ghostbtn" onClick={onPlan}>{t('See the plan')}</button>
          <button type="button" className="primary inline" disabled={!okToSave} onClick={save}>
            {busy === 'Saving…' ? t('Saving…') : t('Save {0} count for {1}', kind === 'start' ? t('start') : t('end'), t(part))}
          </button>
        </div>
      </section>

      <section className="card">
        <h2>{nice(date)}</h2>
        {log === null && <p className="sub">{t('Loading…')}</p>}
        {log && !day.length && <p className="sub">{t('Nothing logged for this day yet.')}</p>}
        {day.map((r) => (
          <div className="logblock" key={r.part}>
            <div className="rh">
              <b><Icon name={PART_ICON[r.part]} size={16} /> {t(r.part)}</b>
              <span className={'pill' + (r.complete ? ' basis-payments' : ' warn')}>{r.complete ? t('Complete') : t('Waiting for end count')}</span>
            </div>
            <table>
              <thead><tr><th>{t('Item')}</th><th className="num">{t('Made')}</th><th className="num">{t('Left')}</th><th className="num">{t('Sold')}</th></tr></thead>
              <tbody>
                {r.items.map((i) => (
                  <tr key={i.name}>
                    <td><b>{i.name}</b>{i.stockout && <small className="assumed">{t('Sold out')}</small>}</td>
                    <td className="num">{i.made ?? '–'}</td><td className="num">{i.left ?? '–'}</td><td className="num"><b>{i.sold ?? '–'}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {earlier.length > 0 && (
          <details className="earlier">
            <summary>{t('Earlier days ({0})', earlier.length)}</summary>
            <ul>
              {earlier.map((r) => {
                const m = r.items.reduce((s, i) => s + (i.made || 0), 0)
                const sold = r.items.reduce((s, i) => s + (i.sold || 0), 0)
                return <li key={r.date + r.part}><b>{nice(r.date)} · {t(r.part)}</b> <span>{t('made {0}{1}', m, r.complete ? t(', sold {0}, left {1}', sold, m - sold) : t(', no end count'))}</span></li>
              })}
            </ul>
          </details>
        )}
      </section>
    </div>
  )
}
