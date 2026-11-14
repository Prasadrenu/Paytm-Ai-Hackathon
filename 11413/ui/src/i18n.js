import { useEffect, useState } from 'react'

// Screen text in the merchant's language.
//   t('Save details')            -> the translation, or the English until it arrives
//   t('Saved {0} items', n)      -> {0}, {1} ... are filled in after translating, so word order can change
//   td(serverText)               -> for English text that comes from the server (numbers become {0} first, so
//                                   "learned from 21 days" and "learned from 28 days" share one translation)
// English text is the key. Translations come from the server (Sarvam-105B), which keeps them on disk; this file
// keeps a copy in the browser so a reload shows the right language straight away.

let lang = 'en-IN'
let dict = {}
let inflight = 0
let timer = null
const subs = new Set()
const asked = new Set()
const pending = new Set()
const notify = () => subs.forEach((f) => f())
const store = (l) => `sp-i18n-${l}`
const readCache = (l) => { try { return JSON.parse(localStorage.getItem(store(l)) || '{}') } catch { return {} } }
const writeCache = (l, d) => { try { localStorage.setItem(store(l), JSON.stringify(d)) } catch { /* storage blocked: fine */ } }

async function call(l, init, url = '/api/i18n') {
  inflight += 1
  notify()
  try {
    const r = await fetch(url, init)
    const j = await r.json()
    if (lang === l && j.tr) { dict = { ...dict, ...j.tr }; writeCache(l, dict) }
  } catch { /* offline or server restarting: the screen stays in English and asks again next time */ } finally {
    inflight -= 1
    notify()
  }
}

export function setLang(code) {
  lang = code
  dict = code === 'en-IN' || code === 'pseudo' ? {} : readCache(code)
  asked.clear()
  pending.clear()
  document.documentElement.lang = code === 'pseudo' ? 'en' : code.split('-')[0]
  notify()
  if (code !== 'en-IN' && code !== 'pseudo') call(code, undefined, `/api/i18n?lang=${code}`)   // everything the server already has
}

function ask(key) {
  if (asked.has(key)) return
  asked.add(key)
  pending.add(key)
  clearTimeout(timer)
  timer = setTimeout(() => {
    const l = lang
    const keys = [...pending]
    pending.clear()
    if (keys.length && l !== 'en-IN' && l !== 'pseudo') call(l, { method: 'POST', body: JSON.stringify({ lang: l, keys }) })
  }, 150)
}

export function t(key, ...vars) {
  let s = key
  if (lang === 'pseudo') s = `‹${key}›`
  else if (lang !== 'en-IN') {
    if (key in dict) s = dict[key]
    else if (/[A-Za-z]{2}/.test(key.replace(/\{\d+\}/g, ''))) ask(key)
  }
  return vars.length ? s.replace(/\{(\d+)\}/g, (_, i) => (vars[+i] ?? '')) : s
}

// English text from the server: numbers are lifted out so one translation serves every number.
export function td(text) {
  if (!text || typeof text !== 'string') return text
  const nums = []
  const key = text.replace(/\d+(?:[.,:]\d+)*/g, (m) => { nums.push(m); return `{${nums.length - 1}}` })
  return t(key, ...nums)
}

// T('Hot drink') marks a text where it is DEFINED (in a constant). The constant still holds English; show it with t().
export const T = (s) => s

// "1 item" / "5 items": each form is a whole translatable sentence, so grammar is never glued together from pieces.
export const plural = (n, one, many) => t(n === 1 ? one : many, n)

// Dates in the chosen language (month and weekday names), e.g. "శనివారం, 14 నవంబర్".
export const locale = () => (lang === 'pseudo' ? 'en-IN' : lang)
export const fmtDate = (d, opts) => new Date(d).toLocaleDateString(locale(), opts)
export const fmtTime = (d, opts) => new Date(d).toLocaleTimeString(locale(), opts)

// Re-render the component that calls this whenever the language or its translations change.
export function useI18n() {
  const [, bump] = useState(0)
  useEffect(() => {
    const f = () => bump((x) => x + 1)
    subs.add(f)
    return () => subs.delete(f)
  }, [])
  return { busy: inflight > 0, lang }
}

// For testing: ?i18n-test in the address bar exposes a marker language that wraps every translated text in ‹ ›,
// so any text that was missed stands out.
if (typeof window !== 'undefined' && window.location.search.includes('i18n-test')) window.__i18n = { setLang }

// Weekday name from an ISO date ("2026-11-14" -> Saturday, in the chosen language).
export const weekday = (iso) => fmtDate(`${iso}T00:00`, { weekday: 'long' })
