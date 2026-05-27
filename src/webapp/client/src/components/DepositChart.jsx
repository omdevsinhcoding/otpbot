import { useEffect, useRef, useState } from 'react'

function formatCurrency(n) {
  if (n >= 10000000) return '₹' + (n / 10000000).toFixed(2) + 'Cr'
  if (n >= 100000) return '₹' + (n / 100000).toFixed(2) + 'L'
  if (n >= 1000) return '₹' + (n / 1000).toFixed(1) + 'K'
  return '₹' + n.toLocaleString('en-IN')
}

export default function DepositChart({ data }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 200)
    return () => clearTimeout(timer)
  }, [])

  if (!data?.days) return null

  const maxVal = Math.max(...data.days.map(d => d.amount), 1)
  const total = data.days.reduce((sum, d) => sum + d.amount, 0)

  return (
    <div className="section" style={{ animationDelay: '350ms' }}>
      <div className="section-header">
        <div className="section-title">
          <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
          Deposit Trend
        </div>
        <div className="section-badge">7 Days</div>
      </div>

      <div className="chart-card">
        <div className="chart-header">
          <div>
            <div className="chart-total">{formatCurrency(total)}</div>
            <div className="chart-label">Total 7-Day Deposits</div>
          </div>
        </div>

        <div className="chart-bars">
          {data.days.map((day, i) => {
            const pct = (day.amount / maxVal) * 100
            return (
              <div className="chart-bar-wrap" key={i}>
                <div className="chart-bar-amount">
                  {day.amount > 0 ? `₹${day.amount}` : ''}
                </div>
                <div
                  className="chart-bar"
                  style={{
                    height: mounted ? `${Math.max(pct, 5)}%` : '0%',
                    transitionDelay: `${i * 80}ms`,
                  }}
                  title={`₹${day.amount.toLocaleString('en-IN')}`}
                />
                <div className="chart-bar-label">{day.label}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
