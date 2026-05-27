export default function Header({ name }) {
  return (
    <header className="header">
      <div className="header-left">
        <div className="header-avatar">
          <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1"/>
            <rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="14" y="14" width="7" height="7" rx="1"/>
            <rect x="3" y="14" width="7" height="7" rx="1"/>
          </svg>
        </div>
        <div>
          <div className="header-title">{name}</div>
          <div className="header-subtitle">Analytics Dashboard</div>
        </div>
      </div>
      <div className="header-right">
        <div className="live-dot" />
        <div className="live-badge">LIVE</div>
      </div>
    </header>
  )
}
