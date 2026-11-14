import { useRef, useCallback, useState } from 'react'
import { speech } from '../api.js'

/** Plays text aloud through Bulbul; starting a new clip stops the previous one. */
export default function useSpeaker() {
  const audioRef = useRef(null)
  const [loading, setLoading] = useState(false)
  const speak = useCallback(async (text, lang) => {
    setLoading(true)
    try {
      const b64 = await speech(text, lang)
      audioRef.current?.pause()
      audioRef.current = new Audio('data:audio/wav;base64,' + b64)
      audioRef.current.play()
    } catch (e) {
      alert('Voice failed: ' + e.message)
    } finally {
      setLoading(false)
    }
  }, [])
  return { speak, loading }
}
