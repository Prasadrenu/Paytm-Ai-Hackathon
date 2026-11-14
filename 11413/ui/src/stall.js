import { t } from './i18n.js'

// "6 am", "9:30 pm" from "06:00", "21:30".
export const clock12 = (t) => {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'am' : 'pm'}`
}

const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }

// Is the stall open right now? Handles a closing time after midnight.
export function openStatus(open, close, now = new Date()) {
  const n = now.getHours() * 60 + now.getMinutes()
  const o = mins(open)
  const c = mins(close)
  const isOpen = c <= o ? n >= o || n < c : n >= o && n < c
  return { isOpen, text: isOpen ? t('Open now, closes {0}', clock12(close)) : t('Closed, opens {0}', clock12(open)) }
}
