import { useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { transcribe } from '../api.js'
import { fileToJpeg } from '../image.js'
import useRecorder from '../hooks/useRecorder.js'
import CameraModal from './CameraModal.jsx'

export const LANGS = [
  ['en-IN', 'English'], ['hi-IN', 'हिन्दी Hindi'], ['te-IN', 'తెలుగు Telugu'], ['ta-IN', 'தமிழ் Tamil'],
  ['kn-IN', 'ಕನ್ನಡ Kannada'], ['ml-IN', 'മലയാളം Malayalam'], ['mr-IN', 'मराठी Marathi'],
  ['bn-IN', 'বাংলা Bengali'], ['gu-IN', 'ગુજરાતી Gujarati'], ['pa-IN', 'ਪੰਜਾਬੀ Punjabi'],
]
const MAX_PHOTOS = 4

// Step 1: collect the details. `value` lets the merchant come back and edit after Back.
export default function PlannerForm({ value, onProceed, loading, error }) {
  const [items, setItems] = useState(value.items)
  const [open, setOpen] = useState(value.open)
  const [close, setClose] = useState(value.close)
  const [lang, setLang] = useState(value.lang)
  const [images, setImages] = useState(value.images)
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
        alert(`${f.name} could not be read as an image.`)
      }
    }
  }

  const ready = (items.trim() || images.length) && open && close && !loading
  const submit = (e) => {
    e.preventDefault()
    if (ready) onProceed({ items, open, close, lang, images })
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h2>Your stall details</h2>
      <p className="sub">Tell us what you sell and when you are open.</p>

      <label className="field">
        <span>What do you sell?</span>
        <div className="area">
          <textarea
            value={items}
            onChange={(e) => setItems(e.target.value)}
            rows={4}
            placeholder={'Samosa 15, Masala chai 10, Lassi 30\nType, speak, or add a photo of your menu'}
          />
          <button type="button" className={'mic' + (recording ? ' rec' : '')} onClick={toggle} aria-label={recording ? 'Stop recording' : 'Speak your items'} title="Speak your items">
            {heard ? '…' : <Icon name={recording ? 'stop' : 'mic'} size={18} />}
          </button>
        </div>
        <small>Prices are optional. You can type in any Indian language.</small>
      </label>

      <div className="row2">
        <label className="field">
          <span>Opens at</span>
          <input type="time" value={open} onChange={(e) => setOpen(e.target.value)} required />
        </label>
        <label className="field">
          <span>Closes at</span>
          <input type="time" value={close} onChange={(e) => setClose(e.target.value)} required />
        </label>
      </div>

      <div className="field">
        <span>Menu or stock photo <em>(optional)</em></span>
        <div className="photos">
          {images.map((src, i) => (
            <div className="thumb" key={i}>
              <img src={src} alt={`Photo ${i + 1}`} />
              <button type="button" onClick={() => setImages((p) => p.filter((_, j) => j !== i))} aria-label={`Remove photo ${i + 1}`}>×</button>
            </div>
          ))}
          {images.length < MAX_PHOTOS && (
            <>
              <button type="button" className="addphoto" onClick={() => fileRef.current.click()}><Icon name="image" size={22} /><b>Upload</b></button>
              <button type="button" className="addphoto" onClick={() => setCamera(true)}><Icon name="camera" size={22} /><b>Camera</b></button>
            </>
          )}
        </div>
        <small>Handwritten menu, price board, or the food on your counter. Up to {MAX_PHOTOS} photos.</small>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={upload} />
      </div>

      <label className="field">
        <span>Language for messages</span>
        <select value={lang} onChange={(e) => setLang(e.target.value)}>
          {LANGS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
        </select>
      </label>

      {error && <p className="err" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={!ready}>
        {loading ? 'Reading your items…' : 'Proceed →'}
      </button>

      {camera && <CameraModal onClose={() => setCamera(false)} onCapture={(u) => { addImage(u); setCamera(false) }} />}
    </form>
  )
}
