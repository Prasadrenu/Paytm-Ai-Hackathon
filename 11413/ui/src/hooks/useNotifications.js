import { useCallback, useEffect, useRef, useState } from 'react'
import { getNotifications } from '../api.js'

const KEY = 'sp-announced'
const readTold = () => { try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')) } catch { return new Set() } }
const writeTold = (s) => { try { localStorage.setItem(KEY, JSON.stringify([...s].slice(-50))) } catch { /* storage blocked: fine */ } }

/** Polls the server for notifications. `onNew(n)` fires once per notification the first time this browser sees it. */
export default function useNotifications(onNew) {
  const [data, setData] = useState({ active: [], earlier: [], unseen: 0 })
  const cb = useRef(onNew)
  cb.current = onNew
  const busy = useRef(false)

  const refresh = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    try {
      const d = await getNotifications()
      setData(d)
      const told = readTold()
      const fresh = d.active.filter((n) => !told.has(n.id))
      if (fresh.length) {
        fresh.forEach((n) => told.add(n.id))
        writeTold(told)
        cb.current(fresh[fresh.length - 1])   // announce the newest one
      }
    } catch { /* offline or server restarting: the next check will catch up */ } finally {
      busy.current = false
    }
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 30000)
    const onVisible = () => { if (!document.hidden) refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [refresh])

  return { data, refresh }
}
