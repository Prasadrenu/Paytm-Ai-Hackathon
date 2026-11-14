import { useEffect, useRef, useState } from 'react'
import { transcribe } from '../api.js'
import { fileToJpeg } from '../image.js'
import useRecorder from '../hooks/useRecorder.js'
import CameraModal from './CameraModal.jsx'
import LocationPicker from './LocationPicker.jsx'
import Icon from './Icon.jsx'
import { t, td } from '../i18n.js'

const MAX_PHOTOS = 4

// Step 1: collect the details. `value` lets the merchant come back and edit after Back.
export default function PlannerForm({ value, onProceed, loading, error }) {
  const [items, setItems] = useState(value.items)
  const [open, setOpen] = useState(value.open)
  const [close, setClose] = useState(value.close)
  const [images, setImages] = useState(value.images)
  const [location, setLocation] = useState(value.location || null)
  // The saved location arrives after the page opens; fill it in unless the merchant already chose one.
  useEffect(() => { if (value.location) setLocation((cur) => cur || value.location) }, [value.location])
  const [camera, setCamera] = useState(false)
  const [heard, setHeard] = useState(false)
  const fileRef = useRef(null)

  const { recording, toggle } = useRecorder(async (blob) => {
    setHeard(true)
    try {
      const t = await transcribe(blob)
      setItems((cur) => (cur.trim() ? cur.trim() + ', ' : '') + t)
    } catch (e) {
      alert('Could not transcribe: ' + e.message)
    } finally {
      setHeard(false)
    }
  })

  const addImage = (url) => setImages((p) => (p.length < MAX_PHOTOS ? [...p, url] : p))
  const upload = async (e) => {
    const files = [...(e.target.files || [])].slice(0, MAX_PHOTOS - images.length)
    e.target.value = ''
    for (const f of files) {
      try {
        addImage(await fileToJpeg(f))
      } catch {
        alert(t('{0} could not be read as an image.', f.name))
      }
    }
  }

  const ready = (items.trim() || images.length) && open && close && !loading
  const submit = (e) => {
    e.preventDefault()
    if (ready) onProceed({ items, open, close, images, location })
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h2>{t('Your stall details')}</h2>
      <p className="sub">{t('Add your items, opening hours and location.')}</p>

      <label className="field">
        <span>{t('What do you sell?')}</span>
        <div className="area">
          <textarea
            value={items}
            onChange={(e) => setItems(e.target.value)}
            rows={4}
            placeholder={t('Samosa 15, Masala chai 10, Lassi 30\nType, speak, or add a photo of your menu')}
          />
          <button type="button" className={'mic' + (recording ? ' rec' : '')} onClick={toggle} aria-label={recording ? t('Stop recording') : t('Speak your items')} title={t('Speak your items')}>
            {heard ? '…' : <Icon name={recording ? 'stop' : 'mic'} size={18} />}
          </button>
        </div>
        <small>{t('Prices are optional. You can type in any Indian language.')}</small>
      </label>

      <div className="row2">
        <label className="field">
          <span>{t('Opens at')}</span>
          <input type="time" value={open} onChange={(e) => setOpen(e.target.value)} required />
        </label>
        <label className="field">
          <span>{t('Closes at')}</span>
          <input type="time" value={close} onChange={(e) => setClose(e.target.value)} required />
        </label>
      </div>

      <LocationPicker value={location} onChange={setLocation} />

      <div className="field">
        <span>{t('Menu or stock photo')}{' '}<em>{t('(optional)')}</em></span>
        <div className="photos">
          {images.map((src, i) => (
            <div className="thumb" key={i}>
              <img src={src} alt={t('Photo {0}', i + 1)} />
              <button type="button" onClick={() => setImages((p) => p.filter((_, j) => j !== i))} aria-label={t('Remove photo {0}', i + 1)}><Icon name="x" size={14} /></button>
            </div>
          ))}
          {images.length < MAX_PHOTOS && (
            <>
              <button type="button" className="addphoto" onClick={() => fileRef.current.click()}><Icon name="image" size={22} /><b>{t('Upload')}</b></button>
              <button type="button" className="addphoto" onClick={() => setCamera(true)}><Icon name="camera" size={22} /><b>{t('Camera')}</b></button>
            </>
          )}
        </div>
        <small>{t('Handwritten menu, price board, or the food on your counter. Up to {0} photos.', MAX_PHOTOS)}</small>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={upload} />
      </div>

      {error && <p className="err" role="alert">{td(error)}</p>}
      <button className="primary" type="submit" disabled={!ready}>
        {loading ? t('Reading your items…') : <>{t('Proceed')}{' '}<Icon name="right" size={16} /></>}
      </button>

      {camera && <CameraModal onClose={() => setCamera(false)} onCapture={(u) => { addImage(u); setCamera(false) }} />}
    </form>
  )
}
