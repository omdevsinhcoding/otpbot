const typeIcons = {
  deposit: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <rect x="2" y="5" width="20" height="14" rx="2"/>
      <line x1="2" y1="10" x2="22" y2="10"/>
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  ),
  referral: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <circle cx="18" cy="5" r="3"/>
      <circle cx="6" cy="12" r="3"/>
      <circle cx="18" cy="19" r="3"/>
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
    </svg>
  ),
  revenue: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <line x1="12" y1="1" x2="12" y2="23"/>
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    </svg>
  ),
}

export default function QuickOverview({ items }) {
  if (!items || items.length === 0) return null

  return (
    <div className="section" style={{ animationDelay: '450ms' }}>
      <div className="section-header">
        <div className="section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16, stroke: 'var(--indigo)' }}>
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
          Quick Overview
        </div>
      </div>

      <div className="activity-list">
        {items.map((item, i) => (
          <div className="activity-item" key={i}>
            <div className={`activity-icon ${item.type}`}>
              {typeIcons[item.type] || typeIcons.revenue}
            </div>
            <div className="activity-info">
              <div className="activity-title">{item.title}</div>
              <div className="activity-sub">{item.subtitle}</div>
            </div>
            <div className={`activity-value ${item.color}`}>{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
