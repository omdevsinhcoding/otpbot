import { useEffect, useRef } from 'react'

function formatNum(n) {
  if (n >= 10000000) return (n / 10000000).toFixed(1) + 'Cr'
  if (n >= 100000) return (n / 100000).toFixed(1) + 'L'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return n.toLocaleString('en-IN')
}

export default function StatCard({ icon, label, value, prevValue, prefix = '', color, change, delay = 0 }) {
  const valueRef = useRef(null)
  const animRef = useRef(null)

  useEffect(() => {
    if (!valueRef.current) return
    const from = prevValue !== undefined ? prevValue : 0
    const to = value
    if (from === to) {
      valueRef.current.textContent = prefix + formatNum(to)
      return
    }

    const duration = from === 0 ? 1200 : 600
    const startTime = performance.now()

    if (animRef.current) cancelAnimationFrame(animRef.current)

    function update(now) {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      const current = Math.floor(from + (to - from) * eased)
      valueRef.current.textContent = prefix + formatNum(current)
      if (progress < 1) {
        animRef.current = requestAnimationFrame(update)
      }
    }
    animRef.current = requestAnimationFrame(update)

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current)
    }
  }, [value, prevValue, prefix])

  const isUp = change !== undefined && change >= 0
  const changeText = change !== undefined
    ? `${isUp ? '↑' : '↓'} ${Math.abs(change).toFixed(0)}%`
    : null

  return (
    <div className={`stat-card ${color}`} style={{ animationDelay: `${delay}ms` }}>
      <div className={`stat-icon-wrap ${color}`}>
        {icon}
      </div>
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${color}`} ref={valueRef}>—</div>
      {changeText && (
        <div className={`stat-change ${isUp ? 'up' : 'down'}`}>
          {changeText}
        </div>
      )}
    </div>
  )
}
