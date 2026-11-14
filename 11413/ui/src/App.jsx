import { useCallback, useEffect, useRef, useState } from 'react'
import { getSaved, getSettings, markNotificationsSeen, parseItems, saveDetails, saveLang } from './api.js'
import { TopBar, Sidebar } from './components/Header.jsx'
import PlannerForm from './components/PlannerForm.jsx'
import ReviewPage from './components/ReviewPage.jsx'
import SavedPage from './components/SavedPage.jsx'
import PlanPage from './components/PlanPage.jsx'
import PaymentsPage from './components/PaymentsPage.jsx'
import AnalyticsPage from './components/AnalyticsPage.jsx'
import Icon from './components/Icon.jsx'
import CountsPage from './components/CountsPage.jsx'
import HomePage from './components/HomePage.jsx'
import NotificationsPage from './components/NotificationsPage.jsx'
import NotificationToast from './components/NotificationToast.jsx'
import useNotifications from './hooks/useNotifications.js'
import { audioUrl, play, stop } from './notifyAudio.js'
import { T, setLang as i18nSetLang, t, useI18n } from './i18n.js'

const EMPTY = { items: '', open: '16:00', close: '22:00', images: [], location: null }
const greeting = () => { const h = new Date().getHours(); return t(h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening') }
const TITLES = {
  home: [T('Home'), T('Here is your stall today.')],
  details: [T('Menu'), T('Tell us what you sell and when you are open.')],
  review: [T('Review items'), T('Check what we found, fix anything wrong, then submit.')],
  saved: [T('Saved details'), T('Everything you have submitted so far.')],
  counts: [T('Daily counts'), T('Say what you made and what is left, so the next days are planned from what really sold.')],
  analytics: [T('Analytics'), T('Peak hours from your payments, checked against the calendar and the weather.')],
  payments: [T('Payments'), T('Your payment history teaches the planner how busy each hour is.')],
  plan: [T("Today's plan"), T('What to make, how much, and when you will be busiest.')],
  notifications: [T('Notifications'), T("Tomorrow's plan arrives here every evening, and you can listen to it any time.")],
}

export default function App() {
  const [view, setView] = useState('home')
  const [form, setForm] = useState(EMPTY)
  const [items, setItems] = useState(null) // [{name, price}] on the review page; null until Proceed
  const [records, setRecords] = useState(null)
  const [justSaved, setJustSaved] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState(null)   // { note, blocked }
  // One language for the whole app (messages, notifications, speech). Kept on the server so the 8 pm job uses it too.
  const [lang, setLang] = useState('en-IN')
  const langChosen = useRef(false)
  useEffect(() => { getSettings().then((s) => { if (s.lang) { langChosen.current = true; setLang(s.lang) } }).catch(() => {}) }, [])
  useI18n()   // redraw the whole screen when the language or its translations change
  useEffect(() => { i18nSetLang(lang) }, [lang])
  const changeLang = (code) => { langChosen.current = true; setLang(code); saveLang(code).catch(() => {}) }

  // A new notification: show the message, speak it, and (if allowed) raise a desktop alert.
  const announce = useCallback(async (n) => {
    setToast({ note: n, blocked: false })
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(n.kind === 'alert' ? t('Alert for your area') : t('Plan for tomorrow'), { body: n.message_local || n.message_en })
      }
    } catch { /* some browsers only allow this from a service worker: the on-screen message still shows */ }
    if (n.audio) {
      try { await play('note-' + n.id, audioUrl(n.id)) } catch { setToast((t) => (t && t.note.id === n.id ? { ...t, blocked: true } : t)) }
    }
  }, [])
  const { data: notes, refresh: refreshNotes } = useNotifications(announce)

  const refresh = useCallback(() =>
    getSaved().then((r) => {
      setRecords(r.records)
      // Until a language is picked, follow the one the last submission used.
      if (!langChosen.current && r.records[0]?.lang) setLang(r.records[0].lang)
      // Remember the stall location from the last submission, so it does not have to be set every time.
      const saved = r.records.find((x) => x.location)?.location
      if (saved) setForm((f) => (f.location ? f : { ...f, location: saved }))
    }).catch(() => setRecords([])), [])
  useEffect(() => { refresh() }, [refresh])

  const go = (v) => {
    setError('')
    if (v !== 'saved') setJustSaved(null)
    if (v === 'notifications') setToast(null)
    setView(v)
  }
  // Opening the tab marks everything as read (the badge clears) but never removes a notification.
  useEffect(() => { if (view === 'notifications') markNotificationsSeen().then(refreshNotes).catch(() => {}) }, [view, refreshNotes])

  async function proceed(data) {
    setBusy(true)
    setError('')
    try {
      setItems((await parseItems(data)).map((i) => ({ ...i, sel: false })))
      setForm(data)
      setView('review')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  // Saves only the ticked items for the chosen time. Returns the saved record, or null on failure.
  async function submit(selected, from, to) {
    setBusy(true)
    setError('')
    try {
      const whole = from === form.open && to === form.close
      const r = await saveDetails({
        items: selected.map((i) => ({ name: i.name, price: i.price, from: whole ? null : from, to: whole ? null : to })),
        open: form.open, close: form.close, lang, location: form.location,
      })
      setJustSaved(r.saved)
      await refresh()
      return r.saved
    } catch (e) {
      setError(e.message)
      return null
    } finally {
      setBusy(false)
    }
  }

  function again() {
    setForm((f) => ({ ...EMPTY, location: f.location }))   // a new entry keeps the stall's location
    setItems(null)
    setJustSaved(null)
    setError('')
    setView('details')
  }

  const crumb = t(TITLES[view][0])
  const head = records?.[0]
  const stall = head ? { location: records.find((r) => r.location)?.location || null, open: head.open, close: head.close } : null
  const [title, sub] = (view === 'home' ? [greeting(), TITLES.home[1]] : TITLES[view]).map((x, i) => (view === 'home' && i === 0 ? x : t(x)))
  return (
    <div className="shell">
      <Sidebar view={view} onNavigate={go} canReview={items !== null} savedCount={records?.length || 0} stall={stall} />
      <div className="mainwrap">
        <TopBar title={crumb} unseen={notes.unseen} onBell={() => go('notifications')} bellActive={view === 'notifications'} lang={lang} onLang={changeLang} />
        <main>
          {view !== 'home' && (
            <div className="pagehead">
              <div><h1>{title}</h1><p>{sub}</p></div>
            </div>
          )}
          <div className="column">
            {view === 'home' && <HomePage key="home" go={go} greeting={greeting()} stall={stall} />}
            {view === 'details' && (
              <div className="split">
                <PlannerForm key="form" value={form} onProceed={proceed} loading={busy} error={error} />
                <aside className="card guide" aria-label={t('How it works')}>
                  <h3>{t('How it works')}</h3>
                  <ol>
                    <li><Icon name="menu" size={18} /><div><b>{t('Add your menu')}</b><span>{t('Items, prices, opening hours and your stall location.')}</span></div></li>
                    <li><Icon name="counts" size={18} /><div><b>{t('Count each day')}</b><span>{t('Say what you made and what is left, by voice or text.')}</span></div></li>
                    <li><Icon name="plan" size={18} /><div><b>{t('Get your plan')}</b><span>{t('What to make and when it is busy, from your counts, payments, weather and festivals.')}</span></div></li>
                  </ol>
                </aside>
              </div>
            )}
            {view === 'review' && items && (
              <ReviewPage details={{ ...form, lang }} items={items} setItems={setItems} saving={busy} error={error}
                onBack={() => go('details')} onSubmit={submit} />
            )}
            {view === 'saved' && (
              <SavedPage records={records} justSaved={justSaved} onPlan={() => go('plan')} onNew={again} />
            )}
            {view === 'counts' && <CountsPage onPlan={() => go('plan')} />}
            {view === 'analytics' && <AnalyticsPage key="an" onPayments={() => go('payments')} />}
            {view === 'payments' && <PaymentsPage onPlan={() => go('plan')} />}
            {view === 'notifications' && <NotificationsPage data={notes} refresh={refreshNotes} lang={lang} />}
            {view === 'plan' && <PlanPage key={'plan-' + lang} lang={lang} onNew={again} onPayments={() => go('payments')} onMenu={() => go('details')} />}
          </div>
        </main>
      </div>
      {toast && <NotificationToast note={toast.note} blocked={toast.blocked} onClose={() => { stop(); setToast(null) }} onView={() => go('notifications')} />}
    </div>
  )
}
