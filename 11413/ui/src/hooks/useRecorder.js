import { useRef, useState, useCallback } from 'react'
import { t } from '../i18n.js'

/** Mic recording. toggle() starts/stops; onDone(blob) fires with the finished clip. */
export default function useRecorder(onDone) {
  const [recording, setRecording] = useState(false)
  const recRef = useRef(null)

  const toggle = useCallback(async () => {
    if (recRef.current?.state === 'recording') {
      recRef.current.stop()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      const chunks = []
      rec.ondataavailable = (e) => chunks.push(e.data)
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        setRecording(false)
        onDone(new Blob(chunks))
      }
      recRef.current = rec
      rec.start()
      setRecording(true)
    } catch (e) {
      alert(t('Microphone blocked: {0}', e.message))
    }
  }, [onDone])

  return { recording, toggle }
}
