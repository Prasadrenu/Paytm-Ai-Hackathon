import { useState } from 'react'
import { geocode } from '../api.js'
import Icon from './Icon.jsx'
import { t, td } from '../i18n.js'

// Stall location: search an area or city, or use this device's location. Weather is looked up for it.
export default function LocationPicker({ value, onChange }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')

  async function search() {
    if (q.trim().length < 2) return
    setBusy('Searching…')
    setErr('')
    try {
      setResults(await geocode(q))
    } catch (e) {
      setResults(null)
      setErr(e.message)
    } finally {
      setBusy('')
    }
  }

  function here() {
    if (!navigator.geolocation) return setErr('This device cannot share its location. Search for your area instead.')
    setBusy('Finding you…')
    setErr('')
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setBusy('')
        pick({ name: t('My current location'), lat: +p.coords.latitude.toFixed(4), lon: +p.coords.longitude.toFixed(4) })
      },
      (e) => {
        setBusy('')
        setErr(e.code === 1 ? 'Location is blocked. Allow it in the browser, or search for your area.' : 'Could not get your location. Search for your area instead.')
      },
      { enableHighAccuracy: false, timeout: 10000 },
    )
  }

  const pick = (loc) => {
    onChange(loc)
    setResults(null)
    setQ('')
    setErr('')
  }

  return (
    <div className="field">
      <span>{t('Stall location')}{' '}<em>{t('(for local weather)')}</em></span>
      {value ? (
        <div className="locchip">
          <b><Icon name="pin" /> {value.name}</b>
          <button type="button" className="linkbtn" onClick={() => onChange(null)}>{t('Change')}</button>
        </div>
      ) : (
        <>
          <div className="typerow">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Area or city, like Madhapur, Hyderabad')} aria-label={t('Search for your stall location')}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), search())} />
            <button type="button" className="ghostbtn" disabled={q.trim().length < 2 || !!busy} onClick={search}>{t('Search')}</button>
          </div>
          <button type="button" className="linkbtn herebtn" disabled={!!busy} onClick={here}><Icon name="pin" size={16} />{' '}{t('Use my current location')}</button>
          {busy && <small>{t(busy)}</small>}
          {results && results.length === 0 && (
            <small className="assumed">{t('No place found for "{0}". Try the nearest bigger area, or use your current location.', q)}</small>
          )}
          {results?.length > 0 && (
            <ul className="places" role="listbox" aria-label={t('Matching places')}>
              {results.map((r) => (
                <li key={r.lat + ',' + r.lon}>
                  <button type="button" role="option" onClick={() => pick(r)}>{r.name}</button>
                </li>
              ))}
            </ul>
          )}
          {err && <small className="err" role="alert">{td(err)}</small>}
          {!busy && !results && !err && <small>{t('The weather plan will use this place. Without it, Hyderabad weather is used.')}</small>}
        </>
      )}
    </div>
  )
}
