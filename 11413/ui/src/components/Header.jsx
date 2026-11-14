import { useState } from 'react'
import Icon from './Icon.jsx'

export function TopBar() {
  return (
    <header className="topbar">
      <span className="logo">Smart Planner</span>
    </header>
  )
}

// Left sidebar:  Menu (stall details) > Review Items, Saved Details   |   Today's Plan
// Review stays locked until there are items to review.
export function Sidebar({ view, onNavigate, canReview, savedCount }) {
  const [open, setOpen] = useState(true)
  const inMenu = ['details', 'review', 'saved'].includes(view)
  const expanded = open || inMenu // never hide the page you are on

  const Item = ({ id, icon, label, disabled, count, sub }) => (
    <button
      type="button"
      className={'navitem' + (sub ? ' sub' : '') + (view === id ? ' active' : '')}
      aria-current={view === id ? 'page' : undefined}
      disabled={disabled}
      title={disabled ? 'Enter your details and press Proceed first' : undefined}
      onClick={() => onNavigate(id)}
    >
      <i><Icon name={icon} /></i>
      <span>{label}</span>
      {count > 0 && <em className="badge">{count}</em>}
    </button>
  )

  return (
    <nav className="side" aria-label="Main menu">
      <div className="navgroup">
        <div className={'grouphead' + (view === 'details' ? ' active' : '')}>
          <button
            type="button"
            className="navitem"
            aria-current={view === 'details' ? 'page' : undefined}
            onClick={() => { setOpen(true); onNavigate('details') }}
          >
            <i><Icon name="menu" /></i>
            <span>Menu</span>
          </button>
          <button
            type="button"
            className={'chev' + (expanded ? ' open' : '')}
            aria-label={expanded ? 'Collapse menu' : 'Expand menu'}
            aria-expanded={expanded}
            disabled={inMenu}
            onClick={() => setOpen((o) => !o)}
          >
            <Icon name="chevron" size={16} />
          </button>
        </div>
        {expanded && (
          <div className="subnav">
            <Item sub id="review" icon="review" label="Review Items" disabled={!canReview} />
            <Item sub id="saved" icon="saved" label="Saved Details" count={savedCount} />
          </div>
        )}
      </div>
      <Item id="payments" icon="payments" label="Payments" />
      <Item id="analytics" icon="analytics" label="Analytics" />
      <Item id="plan" icon="plan" label="Today's Plan" />
    </nav>
  )
}
