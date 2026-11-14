import Icon from './Icon.jsx'
import ListenButton from './ListenButton.jsx'
import { audioUrl } from '../notifyAudio.js'
import { t } from '../i18n.js'

// The message shown on screen the moment tomorrow's plan arrives. Closing it does not remove the notification.
export default function NotificationToast({ note, blocked, onClose, onView }) {
  const text = note.message_local || note.message_en
  return (
    <div className="toast" role="alert">
      <div className="toasthead">
        <span className="toasticon"><Icon name="bell" size={18} /></span>
        <b>{note.kind === 'alert' ? t('Alert for your area') : t('Plan for tomorrow')}</b>
        <button type="button" onClick={onClose} aria-label={t('Close this message')}><Icon name="x" size={16} /></button>
      </div>
      <p className="toastmsg">{text}</p>
      {blocked && <small className="toastnote">{t('Your browser needs a tap before it will speak aloud. Press Listen.')}</small>}
      <div className="toastactions">
        {note.audio && <ListenButton id={'note-' + note.id} source={audioUrl(note.id)} />}
        <button type="button" className="ghostbtn" onClick={onView}>{t('Open notifications')}</button>
      </div>
    </div>
  )
}
