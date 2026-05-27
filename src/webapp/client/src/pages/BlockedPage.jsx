import './BlockedPage.css'

export default function BlockedPage() {
  return (
    <>
      {/* Aurora Background */}
      <div className="bp-aurora">
        <div className="bp-aurora-blob" />
        <div className="bp-aurora-blob" />
        <div className="bp-aurora-blob" />
      </div>
      <div className="bp-grid" />
      <div className="bp-scan" />

      {/* Content */}
      <div className="bp-container">
        <div className="bp-card">

          {/* Shield */}
          <div className="bp-shield-wrap">
            <div className="bp-ring" />
            <div className="bp-ring bp-ring-2" />
            <div className="bp-shield">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                <polyline points="9 12 11 14 15 10"/>
              </svg>
            </div>
          </div>

          {/* Badge */}
          <div className="bp-badge">
            <span className="bp-badge-dot" />
            Restricted Access
          </div>

          {/* Text */}
          <h1 className="bp-title">This Works Inside the Bot Only</h1>
          <p className="bp-desc">
            This service is exclusively accessible through our Telegram Bot.
            Open it from inside the bot to continue.
          </p>

          <div className="bp-divider" />

          <p className="bp-hint">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            Navigate to the bot and tap the menu button
          </p>

          {/* CTA */}
          <a className="bp-btn" href="https://t.me/" target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
              <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/>
            </svg>
            Open Telegram
          </a>

        </div>
        <div className="bp-footer">Protected Service · Unauthorized access is logged</div>
      </div>
    </>
  )
}
