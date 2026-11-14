async function post(path, body, raw = false) {
  const r = await fetch(path, { method: 'POST', body: raw ? body : JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`)
  return j
}

// Step 1 -> 2. images: data URLs (JPEG); the server wants bare base64. Returns [{name, price}].
export const parseItems = ({ items, images }) =>
  post('/api/parse', { items, images: images.map((i) => i.split(',')[1]) }).then((j) => j.items)

// Step 2 -> 3. Writes the confirmed details to data/stall_details.json on the server.
export const saveDetails = (d) => post('/api/save', d)

// All saved submissions from data/stall_details.json, newest first.
export const getSaved = () => fetch('/api/saved').then((r) => r.json())

// Payment history (time + amount). Upload replaces what is stored; demo loads clearly-labelled sample data.
export const getPayments = () => fetch('/api/payments').then((r) => r.json())
export const getAnalytics = (date) =>
  fetch('/api/analytics' + (date ? `?date=${date}` : '')).then(async (r) => {
    const j = await r.json()
    if (!r.ok) throw new Error(j.error || 'Request failed')
    return j
  })
export const uploadPayments = (csv) => post('/api/payments', { csv })
export const demoPayments = () => post('/api/payments/demo', {})
export const clearPayments = () => post('/api/payments/clear', {})

// Today's plan from the confirmed items.
export const makePlan = (d) => post('/api/plan', { ...d, confirmed: true })

export const transcribe = (blob) => post('/api/stt', blob, true).then((j) => j.text)
export const speech = (text, lang) => post('/api/tts', { text, lang }).then((j) => j.audio)
