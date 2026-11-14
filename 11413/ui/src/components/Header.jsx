import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import { LANGS } from '../languages.js'
import { clock12, openStatus } from '../stall.js'
import { fmtDate, t } from '../i18n.js'

// White utility bar: where you are, today's date, the language for everything spoken or written, and the bell.
export function TopBar({ title, unseen = 0, onBell, bellActive, lang, onLang }) {
  const today = fmtDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return (
    <header className="topbar">
      <nav className="crumb" aria-label={t('You are here')}>
        <span>{t('Paytm for Business')}</span><Icon name="right" size={12} /><span>{t('Smart Planner')}</span><Icon name="right" size={12} /><b>{title}</b>
      </nav>
      <span className="spacer" />
      <span className="today">{today}</span>
      <label className="langpick">
        <Icon name="globe" size={17} />
        <select value={lang} onChange={(e) => onLang(e.target.value)} aria-label={t('Language for messages, notifications and speech')}>
          {LANGS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
        </select>
      </label>
      <button type="button" className={'bell' + (bellActive ? ' on' : '')} onClick={onBell} aria-label={unseen ? t('Notifications, {0} new', unseen) : t('Notifications')}>
        <Icon name="bell" size={20} />
        {unseen > 0 && <em className="bellbadge">{unseen > 9 ? '9+' : unseen}</em>}
      </button>
    </header>
  )
}

function Item({ view, onNavigate, id, icon, label, disabled, count, sub }) {
  return (
    <button
      type="button"
      className={'navitem' + (sub ? ' subitem' : '') + (view === id ? ' active' : '')}
      aria-current={view === id ? 'page' : undefined}
      disabled={disabled}
      title={disabled ? t('Enter your details and press Proceed first') : undefined}
      onClick={() => onNavigate(id)}
    >
      <Icon name={icon} size={sub ? 16 : 18} />
      <span>{label}</span>
      {count > 0 && <em className="badge">{count}</em>}
    </button>
  )
}

function StallCard({ stall }) {
  const st = openStatus(stall.open, stall.close)
  const place = stall.location ? stall.location.name.split(',')[0] : t('Your stall')
  return (
    <div className="stallcard">
      <div className="stallhead">
        <span className="stallicon"><Icon name="pin" size={16} /></span>
        <div><b>{place}</b><small>{stall.location ? stall.location.name.split(',').slice(1).join(',').trim() || t('Stall location') : t('No location set')}</small></div>
      </div>
      <div className="stallrow"><Icon name="clock" size={14} /> {clock12(stall.open)} – {clock12(stall.close)}</div>
      <div className={'stallstatus ' + (st.isOpen ? 'open' : 'closed')}><i className="dot" /> {st.text}</div>
    </div>
  )
}

// Navy sidebar: brand, then Home | Menu > Review Items, Saved Details | Daily Counts | Payments | Analytics | Today's Plan.
// Review stays locked until there are items to review.
export function Sidebar({ view, onNavigate, canReview, savedCount, stall }) {
  const [open, setOpen] = useState(true)
  const inMenu = ['details', 'review', 'saved'].includes(view)
  const expanded = open
  // Landing on Review Items or Saved Details (Proceed, Submit) opens the group so the page is visible in the
  // menu; after that the merchant can still fold it away with the arrow.
  useEffect(() => { if (view === 'review' || view === 'saved') setOpen(true) }, [view])
  const it = { view, onNavigate }

  return (
    <aside className="side">
      <div className="brand">
        <div><b>{t('Smart Planner')}</b><small>{t('Stall planning')}</small></div>
      </div>
      <nav aria-label={t('Main menu')}>
        <Item {...it} id="home" icon="home" label={t('Home')} />
        <div className="navgroup">
          <div className={'grouphead' + (view === 'details' || (inMenu && !expanded) ? ' active' : '')}>
            <button
              type="button"
              className="navitem"
              aria-current={view === 'details' ? 'page' : undefined}
              onClick={() => { setOpen(true); onNavigate('details') }}
            >
              <Icon name="menu" />
              <span>{t('Menu')}</span>
            </button>
            <button
              type="button"
              className={'chev' + (expanded ? ' open' : '')}
              aria-label={expanded ? t('Collapse menu') : t('Expand menu')}
              aria-expanded={expanded}
              onClick={() => setOpen((o) => !o)}
            >
              <Icon name="down" size={16} />
            </button>
          </div>
          {expanded && (
            <div className="subnav">
              <Item {...it} sub id="review" icon="review" label={t('Review Items')} disabled={!canReview} />
              <Item {...it} sub id="saved" icon="folder" label={t('Saved Details')} count={savedCount} />
            </div>
          )}
        </div>
        <Item {...it} id="counts" icon="counts" label={t('Daily Counts')} />
        <Item {...it} id="payments" icon="card" label={t('Payments')} />
        <Item {...it} id="analytics" icon="chart" label={t('Analytics')} />
        <Item {...it} id="plan" icon="plan" label={t("Today's Plan")} />
      </nav>
      {stall ? <StallCard stall={stall} /> : (
        <button type="button" className="stallcard empty" onClick={() => onNavigate('details')}>
          <Icon name="pin" size={18} /><span><b>{t('Set up your stall')}</b><small>{t('Add your menu and location')}</small></span>
        </button>
      )}
    </aside>
  )
}
