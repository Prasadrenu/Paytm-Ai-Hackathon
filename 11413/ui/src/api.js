async function post(path, body, raw = false) {
  const r = await fetch(path, { method: 'POST', body: raw ? body : JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`)
  return j
}

// Step 1 -> 2. images: data URLs (JPEG); the server wants bare base64. Returns [{name, price}].
export const parseItems = ({ items, images }) =>
  post('/api/parse', { items, images: images.map((i) => i.split(',')[1]) }).then((j) => j.items)

// Place search for the stall location (areas and cities in India).
export const geocode = (q) => fetch(`/api/geocode?q=${encodeURIComponent(q)}`).then(async (r) => {
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Place search failed.')
  return j.places
})

// Step 2 -> 3. Writes the confirmed details to data/stall_details.json on the server.
export const saveDetails = (d) => post('/api/save', d)

// All saved submissions from data/stall_details.json, newest first.
export const getSaved = () => fetch('/api/saved').then((r) => r.json())

// Daily counts: what was made before a part of the day (start) and what is left after it (end).
export const getCounts = () => fetch('/api/counts').then((r) => r.json())
export const getMade = (date, part) => fetch(`/api/counts?made=${encodeURIComponent(part)}&date=${date}`).then((r) => r.json())
export const getMenu = (part) => fetch(`/api/counts?menu=${encodeURIComponent(part)}`).then((r) => r.json())
export const parseCounts = (text, kind) => post('/api/counts/parse', { text, kind }).then((j) => j.items)
export const saveCounts = (d) => post('/api/counts', d)

// Home: today's quantities and alert status in one call.
export const getHome = () => fetch('/api/home').then(async (r) => {
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Could not load your day.')
  return j
})

// The language chosen in the top bar. The server keeps it so the 8 pm notification uses it too.
export const getSettings = () => fetch('/api/settings').then((r) => r.json())
export const saveLang = (lang) => post('/api/settings', { lang })

// Notifications: tomorrow's plan, made at 8 pm each evening (the saved speech is played from /api/notifications?audio=id).
export const getNotifications = () => fetch('/api/notifications').then((r) => r.json())
export const markNotificationsSeen = () => post('/api/notifications/seen', {})
export const sendTestNotification = () => post('/api/notifications/test', {}).then((j) => j.notification)

// Peak hours, calendar and weather effects from the payment history.
export const getAnalytics = (date) => fetch('/api/analytics' + (date ? `?date=${date}` : '')).then(async (r) => {
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Could not load analytics.')
  return j
})

// Payment history (time + amount). Upload replaces what is stored; demo loads clearly-labelled sample data.
export const getPayments = () => fetch('/api/payments').then((r) => r.json())
export const uploadPayments = (csv) => post('/api/payments', { csv })
export const demoPayments = () => post('/api/payments/demo', {})
export const clearPayments = () => post('/api/payments/clear', {})

// Today's plan from the confirmed items.
export const makePlan = (d) => post('/api/plan', { ...d, confirmed: true })

export const transcribe = (blob) => post('/api/stt', blob, true).then((j) => j.text)
export const speech = (text, lang) => post('/api/tts', { text, lang }).then((j) => j.audio)

// Sudden events (bandh, strike, road closure): the ones in force, and news suggestions waiting for a yes or no.
const special = (act, body) => post('/api/special/' + act, body)
export const getSpecial = (refresh) => fetch('/api/special' + (refresh ? '?refresh=1' : '')).then((r) => r.json())
export const addSpecial = (d) => special('add', d)
export const acceptSpecial = (id) => special('accept', { id })
export const dismissSpecial = (id) => special('dismiss', { id })
export const removeSpecial = (id) => special('remove', { id })
