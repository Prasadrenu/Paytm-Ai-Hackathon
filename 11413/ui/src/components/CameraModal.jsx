import { useEffect, useRef, useState } from 'react'
import { videoToJpeg } from '../image.js'
import { t } from '../i18n.js'

export default function CameraModal({ onCapture, onClose }) {
  const videoRef = useRef(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let stream
    let cancelled = false
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop())
        stream = s
        videoRef.current.srcObject = s
      })
      .catch((e) => setError(t('Camera unavailable: {0}', e.message)))
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const snap = () => {
    if (!videoRef.current?.videoWidth) return
    onCapture(videoToJpeg(videoRef.current))
  }

  return (
    <div className="modal" role="dialog" aria-label={t('Take a photo')} onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        {error ? <p className="cam-error">{error}</p> : <video ref={videoRef} autoPlay playsInline muted />}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>{t('Cancel')}</button>
          {!error && <button className="btn" onClick={snap}>{t('Capture')}</button>}
        </div>
      </div>
    </div>
  )
}
