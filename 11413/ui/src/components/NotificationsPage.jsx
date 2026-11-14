import { useState } from 'react'
import { sendTestNotification } from '../api.js'
import { audioUrl } from '../notifyAudio.js'
import Icon from './Icon.jsx'
import ListenButton from './ListenButton.jsx'
import { fmtDate, fmtTime, t, weekday } from '../i18n.js'

const dmy = (iso) => fmtDate(iso.split('T')[0] + 'T00:00', { day: 'numeric', month: 'short' })
const clock = (iso) => fmtTime(iso, { hour: 'numeric', minute: '2-digit' })
const rel = (iso) => {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0)
  const diff = Math.round((new Date(iso + 'T00:00') - d0) / 86400000)
  return diff === 1 ? t('Tomorrow') : diff === 0 ? t('Today') : diff === -1 ? t('Yesterday') : ''
}

function Card({ n, active }) {
  const day = `${rel(n.for_date) ? rel(n.for_date) + ', ' : ''}${weekday(n.for_date)} ${dmy(n.for_date)}`
  return (
    <article className={'card notecard' + (active ? '' : ' past')}>
      <div className="rh">
        <div>
          <h3><Icon name={n.kind === 'alert' ? 'calendar' : 'bell'} size={18} /> {n.kind === 'alert' ? t('Alert for {0}', day) : active ? t('Make for {0}', day) : day}</h3>
          <p className="sub">{t('Received {0}, {1}', clock(n.created_at), dmy(n.created_at))}
            {active
              ? (n.until === 'event' && n.events.length
                ? <>{' '}{t('· stays here until {0} is over, the end of {1}', n.events.join(' and '), dmy(n.expires_at))}</>
                : <>{' '}{t('· stays here until your shop closes at {0} on {1}', clock(n.expires_at), dmy(n.expires_at))}</>)
              : <>{' '}{t('· this day is over')}</>}</p>
        </div>
        {active && !n.seen && <span className="pill peakpill">{t('New')}</span>}
      </div>
      <p className="notemsg">{n.message_local || n.message_en}</p>
      {n.message_local && <p className="notemsg en">{n.message_en}</p>}
      <div className="chipsrow">
        {n.items.map((i) => <span className="itemchip" key={i.name}><b>{i.make}</b> {i.name}</span>)}
      </div>
      <div className="noteactions">
        {n.audio ? <ListenButton id={'note-' + n.id} source={audioUrl(n.id)} /> : <small className="muted">{t('Speech was not available for this one.')}</small>}
      </div>
    </article>
  )
}

// Every notification, each with a Listen button. Active ones cannot be dismissed: they stay until the event is over.
export default function NotificationsPage({ data, refresh }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const supported = typeof Notification !== 'undefined'
  const [perm, setPerm] = useState(supported ? Notification.permission : 'denied')

  async function sendNow() {
    setBusy(true)
    setError('')
    try {
      await sendTestNotification()
      await refresh()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="saved">
      <section className="card notebar">
        <div className="noteactions">
          <button type="button" className="ghostbtn" disabled={busy} onClick={sendNow}>
            <Icon name="bell" size={16} /> {busy ? t('Preparing…') : t('Send tomorrow\'s notification now')}
          </button>
          {supported && perm === 'default' && (
            <button type="button" className="ghostbtn" onClick={() => Notification.requestPermission().then(setPerm)}>{t('Allow desktop alerts')}</button>
          )}
          {supported && perm === 'granted' && <span className="status st-ok">{t('Desktop alerts on')}</span>}
        </div>
        {error && <p className="err" role="alert">{error}</p>}
      </section>

      {data.active.length === 0 ? (
        <section className="card result empty">
          <div className="big"><Icon name="bell" size={40} /></div>
          <p>{t('No notifications right now. Tomorrow\'s plan will arrive here this evening.')}</p>
        </section>
      ) : (
        data.active.map((n) => <Card key={n.id} n={n} active />)
      )}

      {data.earlier.length > 0 && (
        <details className="earlier card">
          <summary>{t('Earlier notifications ({0})', data.earlier.length)}</summary>
          <div className="earlierlist">{data.earlier.map((n) => <Card key={n.id} n={n} active={false} />)}</div>
        </details>
      )}
    </div>
  )
}
