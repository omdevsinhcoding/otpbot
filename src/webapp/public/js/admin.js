/**
 * Admin Analytics Dashboard — Client-Side Logic
 *
 * • Telegram WebApp SDK integration
 * • initData-authenticated API calls
 * • Animated counter rendering
 * • Auto-refresh every 30 seconds
 */

// ── Telegram WebApp SDK ──────────────────────────────────────────
const tg = window.Telegram?.WebApp;
let initData = '';
let adminUser = null;

function initTelegramApp() {
  if (!tg) {
    showBlocked();
    return false;
  }
  tg.ready();
  tg.expand();
  tg.setHeaderColor('#080b16');
  tg.setBackgroundColor('#080b16');

  initData = tg.initData;
  if (!initData) {
    showBlocked();
    return false;
  }

  try {
    adminUser = tg.initDataUnsafe?.user;
  } catch { /* will fetch from API */ }

  return true;
}

function showBlocked() {
  window.location.href = '/blocked.html';
}

// ── API Calls ────────────────────────────────────────────────────
async function apiGet(path) {
  const res = await fetch(path, {
    headers: { 'X-Telegram-Init-Data': initData },
  });
  if (res.status === 403) {
    showBlocked();
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ── Animated Counter ─────────────────────────────────────────────
function animateCounter(el, target, prefix = '', suffix = '', duration = 1200) {
  const start = 0;
  const startTime = performance.now();

  function update(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.floor(start + (target - start) * eased);
    el.textContent = prefix + formatNum(current) + suffix;
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

function formatNum(n) {
  if (n >= 10000000) return (n / 10000000).toFixed(1) + 'Cr';
  if (n >= 100000) return (n / 100000).toFixed(1) + 'L';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toLocaleString('en-IN');
}

function formatCurrency(n) {
  if (n >= 10000000) return '₹' + (n / 10000000).toFixed(2) + 'Cr';
  if (n >= 100000) return '₹' + (n / 100000).toFixed(2) + 'L';
  if (n >= 1000) return '₹' + (n / 1000).toFixed(1) + 'K';
  return '₹' + n.toLocaleString('en-IN');
}

// ── Render Stats ─────────────────────────────────────────────────
function renderStats(data) {
  // Header
  const nameEl = document.getElementById('admin-name');
  if (nameEl && adminUser) {
    nameEl.textContent = adminUser.first_name || 'Admin';
  }

  // Stat cards
  const cards = [
    { id: 'total-users',    value: data.totalUsers,       prefix: '' },
    { id: 'today-users',    value: data.todayUsers,       prefix: '' },
    { id: 'today-deposits', value: data.todayDeposits,    prefix: '₹' },
    { id: 'total-revenue',  value: data.totalRevenue,     prefix: '₹' },
    { id: 'active-users',   value: data.activeUsers,      prefix: '' },
    { id: 'total-referrals',value: data.totalReferrals,   prefix: '' },
  ];

  cards.forEach(({ id, value, prefix }) => {
    const el = document.getElementById(id);
    if (el) animateCounter(el, value, prefix);
  });

  // Today change badges
  setChange('today-users-change', data.todayUsersChange);
  setChange('today-deposits-change', data.todayDepositsChange);
}

function setChange(id, pct) {
  const el = document.getElementById(id);
  if (!el || pct === undefined) return;
  const isUp = pct >= 0;
  el.className = `stat-change ${isUp ? 'up' : 'down'}`;
  el.textContent = `${isUp ? '↑' : '↓'} ${Math.abs(pct).toFixed(0)}%`;
}

// ── Render Chart ─────────────────────────────────────────────────
function renderChart(data) {
  const container = document.getElementById('chart-bars');
  const totalEl = document.getElementById('chart-total');
  if (!container || !data.days) return;

  const maxVal = Math.max(...data.days.map(d => d.amount), 1);
  container.innerHTML = '';

  let total = 0;
  data.days.forEach(day => {
    total += day.amount;
    const pct = (day.amount / maxVal) * 100;
    const wrap = document.createElement('div');
    wrap.className = 'chart-bar-wrap';

    const bar = document.createElement('div');
    bar.className = 'chart-bar';
    bar.style.height = '0px';
    bar.title = `₹${day.amount.toLocaleString('en-IN')}`;

    const label = document.createElement('div');
    label.className = 'chart-bar-label';
    label.textContent = day.label;

    wrap.appendChild(bar);
    wrap.appendChild(label);
    container.appendChild(wrap);

    // Animate bar height
    requestAnimationFrame(() => {
      setTimeout(() => {
        bar.style.height = Math.max(pct, 5) + '%';
      }, 100);
    });
  });

  if (totalEl) animateCounter(totalEl, total, '₹');
}

// ── Render Activity ──────────────────────────────────────────────
function renderActivity(data) {
  const list = document.getElementById('activity-list');
  if (!list || !data.items) return;

  list.innerHTML = '';
  data.items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'activity-item animate-in';
    div.innerHTML = `
      <div class="activity-icon ${item.type}">
        <span>${item.icon}</span>
      </div>
      <div class="activity-info">
        <div class="activity-title">${item.title}</div>
        <div class="activity-sub">${item.subtitle}</div>
      </div>
      <div class="activity-value ${item.color}">${item.value}</div>
    `;
    list.appendChild(div);
  });
}

// ── Main ─────────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const [stats, chart] = await Promise.all([
      apiGet('/api/admin/stats'),
      apiGet('/api/admin/chart'),
    ]);

    // Hide loading, show content
    document.getElementById('loading')?.classList.add('hidden');
    document.getElementById('dashboard')?.classList.remove('hidden');

    renderStats(stats);
    renderChart(chart);
    renderActivity(stats.activity || { items: [] });
  } catch (err) {
    console.error('Dashboard load failed:', err);
  }
}

// Auto-refresh
let refreshInterval;
function startAutoRefresh(ms = 30000) {
  refreshInterval = setInterval(async () => {
    try {
      const stats = await apiGet('/api/admin/stats');
      renderStats(stats);
    } catch { /* silent */ }
  }, ms);
}

// ── Init ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!initTelegramApp()) return;
  loadDashboard().then(() => startAutoRefresh());
});

// Cleanup on close
window.addEventListener('beforeunload', () => {
  if (refreshInterval) clearInterval(refreshInterval);
});
