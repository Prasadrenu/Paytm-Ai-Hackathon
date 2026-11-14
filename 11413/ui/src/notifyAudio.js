import { useSyncExternalStore } from 'react'

// One shared speaker for the whole app, so only one thing plays at a time. It also reports where the audio is:
//   loading = the speech is being made or buffered
//   playing = it is playing (with the position and the length)
const IDLE = { key: null, status: 'idle', current: 0, duration: 0 }
let state = IDLE
let audio = null
let seq = 0
const subs = new Set()
const set = (next) => { state = next; subs.forEach((f) => f()) }

export const audioUrl = (id) => `/api/notifications?audio=${id}`

export function stop() {
  seq += 1
  if (audio) audio.pause()
  audio = null
  set(IDLE)
}

// `source` is a URL, or an async function that returns one (for speech that has to be made first).
// Rejects if the browser blocks sound (it wants a click or tap on the page first); callers handle that.
export async function play(key, source) {
  stop()
  const mine = seq
  const live = () => mine === seq
  set({ key, status: 'loading', current: 0, duration: 0 })
  let url
  try {
    url = typeof source === 'function' ? await source() : source
  } catch (e) {
    if (live()) set(IDLE)
    throw e
  }
  if (!live()) return   // stopped or replaced while it was being made
  const a = new Audio(url)
  audio = a
  const length = () => (Number.isFinite(a.duration) ? a.duration : state.duration)
  a.addEventListener('loadedmetadata', () => live() && set({ ...state, duration: length() }))
  a.addEventListener('waiting', () => live() && set({ ...state, status: 'loading' }))
  a.addEventListener('playing', () => live() && set({ ...state, status: 'playing' }))
  a.addEventListener('timeupdate', () => live() && set({ ...state, current: a.currentTime, duration: length() }))
  a.addEventListener('ended', () => live() && stop())
  a.addEventListener('error', () => live() && stop())
  try {
    await a.play()
  } catch (e) {
    if (live()) { audio = null; set(IDLE) }
    throw e
  }
}

export const useAudio = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f) }, () => state)
