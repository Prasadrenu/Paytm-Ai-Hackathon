import { useState } from 'react'
import Icon from './Icon.jsx'
import { play, stop, useAudio } from '../notifyAudio.js'
import { t } from '../i18n.js'

const mmss = (s) => {
  if (!Number.isFinite(s)) return '0:00'
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

// A Listen button that shows how the audio is going: preparing, then playing with a progress bar and the time.
// `id` identifies this audio; `source` is a URL, or an async function returning one.
export default function ListenButton({ id, source, label }) {
  label = label || t('Listen')
  const st = useAudio()
  const mine = st.key === id
  const status = mine ? st.status : 'idle'
  const pct = mine && st.duration ? Math.min(100, (st.current / st.duration) * 100) : 0
  const [err, setErr] = useState('')

  const click = () => {
    setErr('')
    if (status !== 'idle') return stop()
    play(id, source).catch((e) =>
      setErr(e.name === 'NotAllowedError' ? t('Your browser blocked the sound. Press Listen again.') : t('Could not load the audio. Try again.')))
  }
  const text = status === 'loading' ? (st.current > 0 ? t('Buffering…') : t('Loading audio…')) : status === 'playing' ? t('Stop') : label

  return (
    <div className={'listen ' + status}>
      <button type="button" className="primary inline listenbtn" onClick={click} aria-label={status === 'idle' ? label : t('Stop listening')}>
        {status === 'loading' ? <span className="spin-sm" aria-hidden="true" /> : <Icon name={status === 'playing' ? 'stop' : 'speaker'} size={16} />}
        <span>{text}</span>
      </button>
      {status !== 'idle' && (
        <div className="audiobar">
          <div className={'track' + (status === 'loading' && !pct ? ' indet' : '')} role="progressbar" aria-label={t('Audio progress')}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
            <i style={{ width: `${pct}%` }} />
          </div>
          <small>{pct ? `${mmss(st.current)} / ${mmss(st.duration)}` : status === 'playing' ? '0:00' : t('Preparing…')}</small>
        </div>
      )}
      {err && <small className="err" role="alert">{err}</small>}
    </div>
  )
}
