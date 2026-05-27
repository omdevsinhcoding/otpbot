import { useState, useEffect, useCallback, useRef } from 'react'
import './App.css'
import AuroraBackground from './components/AuroraBackground'
import Header from './components/Header'
import StatCard from './components/StatCard'
import DepositChart from './components/DepositChart'
import QuickOverview from './components/QuickOverview'
import LoadingScreen from './components/LoadingScreen'

// ── Icons ──
const icons = {
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  userPlus: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="8.5" cy="7" r="4"/>
      <line x1="20" y1="8" x2="20" y2="14"/>
      <line x1="23" y1="11" x2="17" y2="11"/>
    </svg>
  ),
  wallet: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/>
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/>
      <path d="M18 12a1 1 0 0 0 0 4h4v-4Z"/>
    </svg>
  ),
  trending: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
      <polyline points="16 7 22 7 22 13"/>
    </svg>
  ),
  zap: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  gift: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 12 20 22 4 22 4 12"/>
      <rect x="2" y="7" width="20" height="5"/>
      <line x1="12" y1="22" x2="12" y2="7"/>
      <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/>
      <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>
    </svg>
  ),
}

const STAT_CONFIG = [
  { key: 'totalUsers',    label: 'Total Users',      icon: icons.users,    color: 'indigo',  prefix: '' },
  { key: 'todayUsers',    label: 'Today Users',      icon: icons.userPlus, color: 'emerald', prefix: '', changeKey: 'todayUsersChange' },
  { key: 'todayDeposits', label: 'Today Deposits',   icon: icons.wallet,   color: 'amber',   prefix: '₹', changeKey: 'todayDepositsChange' },
  { key: 'totalRevenue',  label: 'Total Revenue',    icon: icons.trending, color: 'rose',    prefix: '₹' },
  { key: 'activeUsers',   label: 'Active Users',     icon: icons.zap,      color: 'sky',     prefix: '' },
  { key: 'totalReferrals',label: 'Total Referrals',  icon: icons.gift,     color: 'violet',  prefix: '' },
]

export default function App() {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState(null)
  const [chart, setChart] = useState(null)
  const [adminName, setAdminName] = useState('Admin')
  const [error, setError] = useState(null)
  const initDataRef = useRef('')
  const prevStatsRef = useRef({})

  // ── Telegram WebApp Init ──
  useEffect(() => {
    const tg = window.Telegram?.WebApp
    if (!tg || !tg.initData) {
      window.location.href = '/blocked.html'
      return
    }
    tg.ready()
    tg.expand()
    tg.setHeaderColor('#06080f')
    tg.setBackgroundColor('#06080f')
    initDataRef.current = tg.initData

    try {
      const user = tg.initDataUnsafe?.user
      if (user?.first_name) setAdminName(user.first_name)
    } catch {}

    loadData()
  }, [])

  // ── API Call ──
  const apiGet = useCallback(async (path) => {
    const res = await fetch(path, {
      headers: { 'X-Telegram-Init-Data': initDataRef.current },
    })
    if (res.status === 403) {
      window.location.href = '/blocked.html'
      throw new Error('Unauthorized')
    }
    if (!res.ok) throw new Error(`API ${res.status}`)
    return res.json()
  }, [])

  // ── Load Data ──
  const loadData = useCallback(async () => {
    try {
      const [statsData, chartData] = await Promise.all([
        apiGet('/api/admin/stats'),
        apiGet('/api/admin/chart'),
      ])
      // Store previous stats for smooth counter animation
      if (stats) {
        prevStatsRef.current = { ...stats }
      }
      setStats(statsData)
      setChart(chartData)
      setLoading(false)
      setError(null)
    } catch (err) {
      console.error('Load failed:', err)
      setError(err.message)
      setLoading(false)
    }
  }, [apiGet, stats])

  // ── Auto-refresh every 30s ──
  useEffect(() => {
    if (loading) return
    const interval = setInterval(async () => {
      try {
        const [statsData, chartData] = await Promise.all([
          apiGet('/api/admin/stats'),
          apiGet('/api/admin/chart'),
        ])
        prevStatsRef.current = stats ? { ...stats } : {}
        setStats(statsData)
        setChart(chartData)
      } catch {}
    }, 30000)
    return () => clearInterval(interval)
  }, [loading, apiGet, stats])

  if (loading) return <LoadingScreen />

  return (
    <>
      <AuroraBackground />
      <div className="app">
        <Header name={adminName} />

        <div className="stats-grid">
          {STAT_CONFIG.map((cfg, i) => (
            <StatCard
              key={cfg.key}
              icon={cfg.icon}
              label={cfg.label}
              value={stats?.[cfg.key] ?? 0}
              prevValue={prevStatsRef.current[cfg.key]}
              prefix={cfg.prefix}
              color={cfg.color}
              change={cfg.changeKey ? stats?.[cfg.changeKey] : undefined}
              delay={i * 80}
            />
          ))}
        </div>

        <DepositChart data={chart} />

        {stats?.activity && <QuickOverview items={stats.activity.items} />}

        <div className="footer">
          <div className="footer-dot" />
          Auto-refreshes every 30s · Powered by your Bot
        </div>
      </div>
    </>
  )
}
