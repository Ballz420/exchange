/* =========================================
   FASEM Market Admin — Application Logic
   ========================================= */

const API_BASE = 'http://localhost:8000';

// ========== STATE ==========
const state = {
  token: localStorage.getItem('admin_token') || null,
  userId: localStorage.getItem('admin_user_id') || null,
  username: localStorage.getItem('admin_username') || null,
  role: localStorage.getItem('admin_role') || null,
  users: [],
  instruments: [],
  orders: [],
  trades: [],
  holdings: [],
  profitHistory: [],
  selectedUserId: null,
  currentView: 'dashboard',
  refreshInterval: null,
  dashboardTimer: null,
  // Pagination
  page: {},
};

// View title mapping
const VIEW_TITLES = {
  dashboard: 'Dashboard',
  users: 'User Management',
  instruments: 'Instrument Management',
  funding: 'Funding Console',
  orders: 'Order Management',
  trades: 'Trade Surveillance',
  profit: 'Profit Distribution',
  reconciliation: 'Reconciliation Dashboard',
  dbexplorer: 'Database Explorer',
  auditlog: 'Audit Log',
  orderbook: 'Order Book',
  ppumath: 'PPU Math Calculator',
  compliance: 'Compliance Dashboard',
  companies: 'Company Management',
  charts: 'Price Charts',
};


// ========== SAFE DOM HELPERS ==========
// Use these instead of innerHTML for user-supplied content
function textEl(tag, text, attrs = {}) {
  const el = document.createElement(tag);
  el.textContent = text;
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function safeHTML(strings, ...values) {
  // Tagged template: escapes all values, keeps HTML in strings
  return strings.reduce((result, str, i) => {
    const val = values[i] !== undefined ? escapeHtml(String(values[i])) : '';
    return result + str + val;
  }, '');
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setSafeHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}



// ========== UI POLISH HELPERS ==========
function skeleton(lines = 3) {
  let html = '';
  for (let i = 0; i < lines; i++) {
    const w = 60 + Math.random() * 40;
    html += '<div style="height:16px;background:var(--bg-tertiary);border-radius:4px;margin-bottom:10px;width:' + w + '%;animation:pulse 1.5s ease-in-out infinite"></div>';
  }
  return '<div style="padding:16px">' + html + '</div>';
}

function exportCSV(headers, rows, filename) {
  const csv = [
    headers.join(','),
    ...rows.map(r => r.map(cell => {
      const s = String(cell).replace(/"/g, '""');
      return s.includes(',') ? '"' + s + '"' : s;
    }).join(','))
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename + '_' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

function emptyState(icon, message) {
  return '<div class="empty-state"><div style="font-size:48px;margin-bottom:8px;opacity:0.3">' + icon + '</div><p>' + escapeHtml(message) + '</p></div>';
}

function addFilterRow(placeholder, filterFn) {
  return '<div class="search-bar" style="margin-bottom:12px">' +
    '<input type="text" placeholder="' + placeholder + '" oninput="' + filterFn + '" style="flex:1">' +
    '</div>';
}

// ========== STORAGE HELPERS ==========
function saveAuth(token, userId, username, role) {
  state.token = token;
  state.userId = userId;
  state.username = username;
  state.role = role;
  localStorage.setItem('admin_token', token);
  localStorage.setItem('admin_user_id', userId);
  localStorage.setItem('admin_username', username);
  localStorage.setItem('admin_role', role);
}

function clearAuth() {
  state.token = null;
  state.userId = null;
  state.username = null;
  state.role = null;
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_user_id');
  localStorage.removeItem('admin_username');
  localStorage.removeItem('admin_role');
}

// ========== TOAST NOTIFICATIONS ==========
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ========== MODAL HELPERS ==========
function openModal(html, wide = false) {
  const overlay = document.getElementById('modalOverlay');
  const content = document.getElementById('modalContent');
  content.className = 'modal-card' + (wide ? ' modal-wide' : '');
  content.innerHTML = html;
  overlay.style.display = 'flex';
}

function closeModal() {
  document.getElementById('modalOverlay').style.display = 'none';
}

// Close modal on overlay click
document.addEventListener('click', function(e) {
  if (e.target.id === 'modalOverlay') closeModal();
});

// Close modal on Escape key
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeModal();
});

// ========== CONFIRMATION DIALOG ==========
function showConfirm(title, message, iconType = 'warning', confirmLabel = 'Confirm') {
  return new Promise((resolve) => {
    openModal(`
      <div class="confirm-dialog">
        <div class="confirm-icon ${iconType}">${iconType === 'danger' ? '&#9888;' : '&#9878;'}</div>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(message)}</p>
        <div class="modal-footer">
          <button class="btn btn-outline" onclick="closeModal(); this._resolve(false)">Cancel</button>
          <button class="btn ${iconType === 'danger' ? 'btn-danger' : 'btn-amber'}" onclick="closeModal(); this._resolve(true)">${confirmLabel}</button>
        </div>
      </div>
    `);
    const btns = document.querySelectorAll('.confirm-dialog button');
    btns.forEach(b => {
      b._resolve = resolve;
    });
  });
}

// ========== API CLIENT ==========
async function apiCall(method, path, body = null) {
  const url = `${API_BASE}${path}`;
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || data.message || `HTTP ${res.status}`);
  }
  return data;
}

async function apiLogin(username, password) { return apiCall("POST", "/api/auth/login", { username, password }); }

async function apiRegister(username, password) { return apiCall("POST", "/api/auth/register", { username, password, role: "admin" }); }

async function apiCallAuth(method, path, body = null) {
  if (!state.token) throw new Error('Not authenticated');
  return fetch(API_BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + state.token
    },
    body: body ? JSON.stringify(body) : null
  }).then(async res => {
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.message || `HTTP ${res.status}`);
    return data;
  });
}

// Post with token in body (for endpoints that use request body pattern)
function apiCallBody(method, path, body = {}) {
  return apiCall(method, path, { ...body });
}

async function apiGetCompany(companyId) {
  return apiCallAuth('GET', '/api/admin/companies/' + companyId);
}

async function apiCreateCompany(name, description, industry, country, founderNames, floatPct, retainedPct) {
  return apiCallBody('POST', '/api/admin/companies', {
    name, description, industry, country,
    founder_names: founderNames,
    total_float_pct: floatPct,
    retained_pct: retainedPct
  });
}

async function apiUpdateCompanyStatus(companyId, status) {
  return apiCallAuth('PUT', '/api/admin/companies/' + companyId + '/status?status=' + status);
}

async function apiUpdateCompanyKyc(companyId, kycStatus) {
  return apiCallAuth('PUT', '/api/admin/companies/' + companyId + '/kyc?kyc_status=' + kycStatus);
}

async function apiGetDashboardStats() {
  return apiCallAuth('GET', '/api/admin/dashboard/stats');
}

async function apiGetReconciliation() {
  return apiCallAuth('GET', '/api/reconcile');
}

async function apiGetRecentTrades(limit) {
  return apiCallAuth('GET', '/api/trades?limit=' + (limit || 10));
}

async function apiGetUsers() {
  return apiCallAuth('GET', '/api/admin/users');
}

async function apiSearchUsers(query) {
  return apiCallAuth('GET', '/api/admin/users/search?q=' + encodeURIComponent(query));
}

async function apiGetUserAccount(userId) {
  return apiCallAuth('GET', '/api/accounts/' + userId);
}

async function apiGetUserOrders(userId) {
  return apiCallAuth('GET', '/api/orders/user/' + userId);
}

async function apiGetUserLedger(userId) {
  return apiCallAuth('GET', '/api/ledger/' + userId);
}

async function apiGetUserPnl(userId) {
  return apiCallAuth('GET', '/api/accounts/' + userId + '/pnl');
}

async function apiGetUserTrades(userId) {
  return apiCallAuth('GET', '/api/trades?user_id=' + userId);
}

async function apiCreditCash(userId, amount) {
  return apiCallBody('POST', '/api/admin/cash/credit', { user_id: userId, amount: amount });
}

async function apiCreditPpu(userId, instrumentId, units) {
  return apiCallBody('POST', '/api/admin/ppu/credit', { user_id: userId, instrument_id: instrumentId, units: units });
}

async function apiChangeUserRole(userId, role) {
  return apiCallAuth('PUT', '/api/admin/users/' + userId + '/role?role=' + role);
}

async function apiChangeUserStatus(userId, status) {
  return apiCallAuth('PUT', '/api/admin/users/' + userId + '/status?status=' + status);
}

async function apiGetInstruments() {
  return apiCallAuth('GET', '/api/instruments');
}

async function apiCreateInstrument(name, description, totalFloat) {
  return apiCallBody('POST', '/api/admin/instruments', { name: name, description: description, total_float: totalFloat });
}

async function apiUpdateInstrumentStatus(instrumentId, status) {
  return apiCallAuth('PUT', '/api/admin/instruments/' + instrumentId + '?status=' + status);
}

async function apiAdjustFloat(instrumentId, additionalFloat) {
  return apiCallAuth('POST', '/api/admin/instruments/' + instrumentId + '/adjust-float?additional_float=' + additionalFloat);
}

async function apiGetInstrumentSummary(instrumentId) {
  return apiCallAuth('GET', '/api/instruments/' + instrumentId + '/summary');
}

async function apiGetOrderBook(instrumentId) {
  return apiCallAuth('GET', '/api/orderbook/' + instrumentId);
}

async function apiGetHoldings(instrumentId) {
  return apiCallAuth('GET', '/api/admin/holdings' + (instrumentId ? '?instrument_id=' + instrumentId : ''));
}

async function apiGetTransactions(type, userId) {
  let path = '/api/admin/transactions?limit=50';
  if (type) path += '&type=' + type;
  if (userId) path += '&user_id=' + userId;
  return apiCallAuth('GET', path);
}

async function apiGetAllOrders(status, instrumentId) {
  let path = '/api/admin/orders';
  const params = [];
  if (status) params.push('status=' + encodeURIComponent(status));
  if (instrumentId) params.push('instrument_id=' + instrumentId);
  if (params.length) path += '?' + params.join('&');
  return apiCallAuth('GET', path);
}

async function apiCancelOrder(orderId) {
  return apiCallAuth('POST', '/api/orders/cancel/' + orderId);
}

async function apiForceCancelOrder(orderId) {
  return apiCallAuth('POST', '/api/admin/orders/force-cancel/' + orderId);
}

async function apiGetTrades(instrumentId, userId) {
  let path = '/api/trades?limit=100';
  if (instrumentId) path += '&instrument_id=' + instrumentId;
  if (userId) path += '&user_id=' + userId;
  return apiCallAuth('GET', path);
}

async function apiDeclareProfit(instrumentId, periodLabel, totalProfit) {
  return apiCallBody('POST', '/api/profit/declare', { instrument_id: instrumentId, period_label: periodLabel, total_profit: totalProfit });
}

async function apiDistributeProfit(declarationId) {
  return apiCallAuth('POST', '/api/profit/distribute/' + declarationId);
}

async function apiGetProfitHistory(instrumentId) {
  return apiCallAuth('GET', '/api/profit/history/' + instrumentId);
}

async function apiGetDbTables() {
  return apiCallAuth('GET', '/api/db/tables');
}

async function apiGetDbTable(tableName, limit) {
  return apiCallAuth('GET', '/api/db/table/' + encodeURIComponent(tableName) + '?human=1&limit=' + (limit || 100));
}

async function apiGetDbSchema() {
  return apiCallAuth('GET', '/api/db/schema');
}

async function apiGetCompanies() {
  return apiCallAuth('GET', '/api/admin/companies');
}

async function apiGetCompany(companyId) {
  return apiCallAuth('GET', '/api/admin/companies/' + companyId);
}

async function apiCreateCompany(name, description, industry, country, founderNames, floatPct, retainedPct) {
  return apiCallBody('POST', '/api/admin/companies', { name, description, industry, country, founder_names: founderNames, total_float_pct: floatPct, retained_pct: retainedPct });
}

async function apiUpdateCompanyStatus(companyId, status) {
  return apiCallAuth('PUT', '/api/admin/companies/' + companyId + '/status?status=' + status);
}

async function apiUpdateCompanyKyc(companyId, kycStatus) {
  return apiCallAuth('PUT', '/api/admin/companies/' + companyId + '/kyc?kyc_status=' + kycStatus);
}

// ========== NAVIGATION ==========
function navigateTo(view) {
  // Clear any refresh timers
  if (state.dashboardTimer) {
    clearInterval(state.dashboardTimer);
    state.dashboardTimer = null;
  }

  state.currentView = view;
  // Update sidebar buttons
  document.querySelectorAll('.sidebar-nav .nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  // Show active view
  document.querySelectorAll('.view').forEach(v => {
    v.classList.toggle('active', v.id === `view-${view}`);
  });
  // Update header title + page title
  const title = VIEW_TITLES[view] || view;
  document.getElementById('viewTitle').textContent = title;
  document.title = `FASEM Admin — ${title}`;
  document.getElementById('headerActions').innerHTML = '';
    const settingsPanel = `
    <button class="settings-btn" onclick="toggleSettings()" title="Settings">&#9881;</button>
  `;
  // Render
  renderView(view);
}

function renderView(view) {
    try {
    switch (view) {
      case 'dashboard': renderDashboard(); break;
      case 'users': renderUsers(); break;
      case 'instruments': renderInstruments(); break;
      case 'companies': renderCompanies(); break;
      case 'orderbook': renderOrderBook(); break;
      case 'funding': renderFunding(); break;
      case 'orders': renderOrders(); break;
      case 'trades': renderTrades(); break;
      case 'charts': renderCharts(); break;
      case 'compliance': renderCompliance(); break;
    case 'ppumath': renderPpuMath(); break;
      case 'profit': renderProfit(); break;
      case 'reconciliation': renderReconciliation(); break;
      case 'auditlog': renderAuditLog(); break;
    case 'dbexplorer': renderDbExplorer(); break;
    }
  } catch (err) {
    console.error('Render error:', err);
    const container = document.getElementById('view-' + view);
    if (container) {
      container.innerHTML = '<div class="error-state" style="padding:40px;text-align:center">' +
        '<div style="font-size:40px;margin-bottom:8px">&#9888;</div>' +
        '<h3 style="color:var(--accent-red);margin-bottom:8px">Something went wrong</h3>' +
        '<p style="color:var(--text-muted);margin-bottom:16px">' + escapeHtml(err.message) + '</p>' +
        '<button class="btn btn-sm btn-outline" onclick="navigateTo(\'' + view + '\')">Retry</button></div>';
    }
  }
}

// ========== VIEW RENDERERS ==========

// --- DASHBOARD ---
async function renderDashboard() {
  const container = document.getElementById('view-dashboard');
  container.innerHTML = skeleton(4);

  try {
    // Redirect if not admin
    if (state.role !== 'admin') {
      container.innerHTML = '<div class="empty-state"><p>Admin access required. You are logged in as a trader.</p></div>';
      return;
    }

    const [stats, trades] = await Promise.all([
      apiGetDashboardStats(),
      apiGetRecentTrades(10),
    ]);

    const balCls = stats.all_balanced ? 'positive' : 'negative';
    const balIcon = stats.all_balanced ? '&#10003;' : '&#10007;';

    const hourGlass = stats.all_balanced ? '&#9989;' : '&#9203;';

    const now = new Date().toLocaleTimeString();
    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h2>System Overview</h2>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:11px;color:var(--text-muted)">Last: ${now}</span>
            <button class="btn btn-sm btn-outline" onclick="renderDashboard()">&#8635; Refresh</button>
          </div>
        </div>
        <div class="card-row">
          <div class="card-stat">
            <div class="label">Total Users</div>
            <div class="value neutral">${stats.total_users}</div>
          </div>
          <div class="card-stat">
            <div class="label">Active Instruments</div>
            <div class="value neutral">${stats.total_active_instruments}</div>
          </div>
          <div class="card-stat">
            <div class="label">Open Orders</div>
            <div class="value neutral">${stats.total_open_orders}</div>
          </div>
          <div class="card-stat">
            <div class="label">Trades Today</div>
            <div class="value neutral">${stats.total_trades_today}</div>
          </div>
          <div class="card-stat">
            <div class="label">Volume Today</div>
            <div class="value neutral">${safeCurrency(stats.total_volume_today)}</div>
          </div>
          <div class="card-stat">
            <div class="label">PPU Float</div>
            <div class="value neutral">${safeNum(stats.total_ppu_float)}</div>
          </div>
          <div class="card-stat">
            <div class="label">Cash in Circulation</div>
            <div class="value neutral">${safeCurrency(stats.cash_in_circulation)}</div>
          </div>
          <div class="card-stat">
            <div class="label">All Balanced</div>
            <div class="value ${balCls}">${hourGlass}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h2>Recent Trades</h2>
        </div>
        ${trades.length === 0
          ? '<div class="empty-state"><p>No trades yet</p></div>'
          : renderTable(['ID', 'Instrument', 'Price', 'Qty', 'Total', 'Buyer', 'Seller', 'Time'], trades, t => [
            t.id,
            t.instrument_name || `#${t.instrument_id}`,
            safeCurrency(t.price),
            safeNum(t.quantity),
            safeCurrency(t.total_value),
            t.buyer_name || t.buyer_id,
            t.seller_name || t.seller_id,
            formatTime(t.created_at),
          ])}
      </div>
    `;

    // Auto-refresh every 30 seconds (only if still on dashboard)
    state.dashboardTimer = setInterval(() => {
      if (state.currentView === 'dashboard') renderDashboard();
      else { clearInterval(state.dashboardTimer); state.dashboardTimer = null; }
    }, 30000);

  } catch (err) {
    container.innerHTML = `<div class="error-state"><p>Error loading dashboard: ${escapeHtml(err.message)}</p><button class="btn btn-sm btn-outline" onclick="renderDashboard()">Retry</button></div>`;
  }
}

// --- USERS ---
let usersTab = 'list';
let selectedUserDetail = null;

async function renderUsers() {
  const container = document.getElementById('view-users');
  container.innerHTML = skeleton(4);

  try {
    const users = await apiGetUsers();
    state.users = users;

    container.innerHTML = `
      <div class="tab-bar">
        <button class="tab-btn ${usersTab === 'list' ? 'active' : ''}" onclick="switchUsersTab('list')">All Users</button>
        <button class="tab-btn ${usersTab === 'search' ? 'active' : ''}" onclick="switchUsersTab('search')">Search</button>
        ${selectedUserDetail ? `<button class="tab-btn active" style="color:var(--accent-amber)">User #${selectedUserDetail.id}</button>` : ''}
      </div>
      <div id="users-content"></div>
    `;

    renderUsersTab(usersTab);
  } catch (err) {
    container.innerHTML = `<div class="error-state"><p>Error: ${escapeHtml(err.message)}</p><button class="btn btn-sm btn-outline" onclick="renderUsers()">Retry</button></div>`;
  }
}

function switchUsersTab(tab) {
  usersTab = tab;
  renderUsersTab(tab);
  // Update tab buttons
  document.querySelectorAll('#view-users .tab-btn').forEach(b => b.classList.remove('active'));
  const btns = document.querySelectorAll('#view-users .tab-btn');
  if (tab === 'list' && btns[0]) btns[0].classList.add('active');
  else if (tab === 'search' && btns[1]) btns[1].classList.add('active');
}

async function renderUsersTab(tab) {
  const el = document.getElementById('users-content');
  if (!el) return;
  el.innerHTML = '<div class="loading">Loading</div>';

  try {
    if (tab === 'list') {
      const users = state.users;
      el.innerHTML = `
        <div class="card">
          <div class="card-header">
            <h3>All Users (${users.length})</h3>
            <button class="btn btn-sm btn-primary" onclick="renderUsers()">Refresh</button>
          </div>
          ${users.length === 0
            ? '<div class="empty-state"><p>No users found</p></div>'
            : renderTableWithPagination(['ID', 'Username', 'Role', 'Status', 'Cash Balance', 'Holdings', 'Created', 'Actions'], users, u => [
              `<span class="clickable" onclick="showUserDetail(${u.id})">${u.id}</span>`,
              escapeHtml(u.username),
              `<span class="badge badge-${u.role}">${u.role}</span>`,
              `<span class="badge badge-${u.status || 'active'}">${u.status || 'active'}</span>`,
              safeCurrency(u.cash_balance),
              (u.ppu_holdings || []).map(h => `${h.instrument_name}: ${h.units}`).join('<br>') || '&mdash;',
              formatDate(u.created_at),
              `<button class="btn btn-sm btn-outline" onclick="showUserDetail(${u.id})">View</button>`,
            ], 'users', `renderUsersTab('list')`)}
        </div>
      `;
    } else if (tab === 'search') {
      el.innerHTML = `
        <div class="card">
          <div class="card-header">
            <h3>Search Users</h3>
          </div>
          <div class="search-bar">
            <input type="text" id="userSearchInput" placeholder="Search by username..." onkeyup="if(event.key==='Enter') doUserSearch()">
            <button class="btn btn-sm btn-primary" onclick="doUserSearch()">Search</button>
          </div>
          <div id="userSearchResults"></div>
        </div>
      `;
    } else if (tab === 'detail' && selectedUserDetail) {
      await renderUserDetail(selectedUserDetail.id);
    }
  } catch (err) {
    el.innerHTML = `<div class="error-state"><p>Error: ${escapeHtml(err.message)}</p></div>`;
  }
}

async function doUserSearch() {
  const q = document.getElementById('userSearchInput').value.trim();
  if (!q) return;
  const el = document.getElementById('userSearchResults');
  if (!el) return;
  el.innerHTML = '<div class="loading">Searching...</div>';
  try {
    const results = await apiSearchUsers(q);
    el.innerHTML = results.length === 0
      ? '<div class="empty-state"><p>No users found matching "' + escapeHtml(q) + '"</p></div>'
      : renderTable(['ID', 'Username', 'Role', 'Status', 'Cash Balance', 'Actions'], results, u => [
        u.id,
        escapeHtml(u.username),
        `<span class="badge badge-${u.role}">${u.role}</span>`,
        `<span class="badge badge-${u.status || 'active'}">${u.status || 'active'}</span>`,
        `$${Number(u.cash_balance || 0).toFixed(2)}`,
        `<button class="btn btn-sm btn-outline" onclick="showUserDetail(${u.id})">View</button>`,
      ]);
  } catch (err) {
    el.innerHTML = `<div class="error-state"><p>Error: ${escapeHtml(err.message)}</p></div>`;
  }
}

async function showUserDetail(userId) {
  usersTab = 'detail';
  const users = state.users;
  selectedUserDetail = users.find(u => u.id === userId) || { id: userId, username: `User #${userId}` };
  renderUsersTab('detail');
  // Update tab display
  const tabBar = document.querySelector('#view-users .tab-bar');
  if (tabBar) {
    tabBar.innerHTML = `
      <button class="tab-btn" onclick="switchUsersTab('list')">All Users</button>
      <button class="tab-btn" onclick="switchUsersTab('search')">Search</button>
      <button class="tab-btn active" style="color:var(--accent-amber)">${escapeHtml(selectedUserDetail.username)} (ID: ${userId})</button>
    `;
  }
}

async function renderUserDetail(userId) {
  const el = document.getElementById('users-content');
  if (!el) return;
  el.innerHTML = '<div class="loading">Loading user details</div>';

  try {
    const [account, orders, trades, ledger, pnl] = await Promise.all([
      apiGetUserAccount(userId),
      apiGetUserOrders(userId),
      apiGetUserTrades(userId),
      apiGetUserLedger(userId),
      apiGetUserPnl(userId),
    ]);

    const user = state.users.find(u => u.id === userId) || { username: `User #${userId}`, role: 'trader', status: 'active' };
    const cashBal = account.cash_balance || 0;

    el.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h2>${escapeHtml(user.username)} <span class="subtitle">ID: ${userId}</span></h2>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <span class="badge badge-${user.role}">${user.role}</span>
            <span class="badge badge-${user.status || 'active'}">${user.status || 'active'}</span>
          </div>
        </div>
      </div>

      <div class="card-row" style="margin-bottom:16px">
        <div class="card-stat">
          <div class="label">Cash Balance</div>
          <div class="value neutral">${safeCurrency(cashBal)}</div>
        </div>
        <div class="card-stat">
          <div class="label">Realized P&L</div>
          <div class="value ${Number(pnl.total_realized_pnl || 0) >= 0 ? 'positive' : 'negative'}">${Number(pnl.total_realized_pnl || 0) >= 0 ? '+' : ''}${safeCurrency(pnl.total_realized_pnl)}</div>
        </div>
        <div class="card-stat">
          <div class="label">Unrealized P&L</div>
          <div class="value ${Number(pnl.total_unrealized_pnl || 0) >= 0 ? 'positive' : 'negative'}">${Number(pnl.total_unrealized_pnl || 0) >= 0 ? '+' : ''}${safeCurrency(pnl.total_unrealized_pnl)}</div>
        </div>
        <div class="card-stat">
          <div class="label">Total P&L</div>
          <div class="value ${Number(pnl.total_pnl || 0) >= 0 ? 'positive' : 'negative'}">${Number(pnl.total_pnl || 0) >= 0 ? '+' : ''}${safeCurrency(pnl.total_pnl)}</div>
        </div>
        <div class="card-stat">
          <div class="label">Orders</div>
          <div class="value neutral">${orders.length}</div>
        </div>
        <div class="card-stat">
          <div class="label">Trades</div>
          <div class="value neutral">${trades.length}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Actions</h3>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm btn-success" onclick="showCreditCashModal(${userId}, '${escapeHtml(user.username)}', ${cashBal})">Credit Cash</button>
          <button class="btn btn-sm btn-amber" onclick="showCreditPpuModal(${userId}, '${escapeHtml(user.username)}')">Credit PPU</button>
          ${user.role === 'admin'
            ? `<button class="btn btn-sm btn-outline" onclick="changeUserRole(${userId}, 'trader')">Demote to Trader</button>`
            : `<button class="btn btn-sm btn-amber" onclick="changeUserRole(${userId}, 'admin')">Promote to Admin</button>`
          }
          ${(user.status || 'active') === 'active'
            ? `<button class="btn btn-sm btn-danger" onclick="changeUserStatus(${userId}, 'suspended')">Suspend User</button>`
            : `<button class="btn btn-sm btn-success" onclick="changeUserStatus(${userId}, 'active')">Reactivate User</button>`
          }
          <button class="btn btn-sm btn-outline" onclick="renderUsers()">Back to Users</button>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>PPU Holdings</h3></div>
        ${(account.ppu_holdings || []).length === 0
          ? '<div class="empty-state"><p>No holdings</p></div>'
          : renderTable(['Instrument', 'Units'], account.ppu_holdings, h => [
            h.name || `#${h.holding_id}`,
            Number(h.units || 0).toFixed(2),
          ])}
      </div>

      <div class="card">
        <div class="card-header"><h3>Orders (${orders.length})</h3></div>
        ${orders.length === 0
          ? '<div class="empty-state"><p>No orders</p></div>'
          : renderTable(['ID', 'Side', 'Instrument', 'Price', 'Qty', 'Filled', 'Status', 'Time'], orders, o => [
            o.id,
            `<span class="side-${o.side}">${o.side.toUpperCase()}</span>`,
            o.instrument_id || '-',
            `$${Number(o.price).toFixed(2)}`,
            Number(o.quantity).toFixed(2),
            Number(o.filled_quantity || 0).toFixed(2),
            `<span class="badge badge-${o.status}">${o.status.replace('_', ' ')}</span>`,
            formatTime(o.created_at),
          ])}
      </div>

      <div class="card">
        <div class="card-header"><h3>Recent Trades (${trades.length})</h3></div>
        ${trades.length === 0
          ? '<div class="empty-state"><p>No trades</p></div>'
          : renderTable(['ID', 'Instrument', 'Side', 'Price', 'Qty', 'Total', 'Counterparty', 'Time'], trades, t => {
            const isBuyer = Number(t.buyer_id) === Number(userId);
            return [
              t.id,
              t.instrument_name || `#${t.instrument_id}`,
              `<span class="side-${isBuyer ? 'buy' : 'sell'}">${isBuyer ? 'BUY' : 'SELL'}</span>`,
              `$${Number(t.price).toFixed(2)}`,
              Number(t.quantity).toFixed(2),
              `$${Number(t.total_value).toFixed(2)}`,
              isBuyer ? (t.seller_name || t.seller_id) : (t.buyer_name || t.buyer_id),
              formatTime(t.created_at),
            ];
          })}
      </div>

      <div class="card">
        <div class="card-header"><h3>Ledger Entries (${ledger.length})</h3></div>
        ${ledger.length === 0
          ? '<div class="empty-state"><p>No ledger entries</p></div>'
          : renderTable(['ID', 'Type', 'Debit', 'Credit', 'Instrument', 'Description', 'Time'], ledger.slice(0, 50), e => [
            e.id,
            e.ledger_type,
            e.debit > 0 ? `$${Number(e.debit).toFixed(2)}` : '&mdash;',
            e.credit > 0 ? `$${Number(e.credit).toFixed(2)}` : '&mdash;',
            e.instrument_id || '&mdash;',
            escapeHtml((e.description || '').substring(0, 50)),
            formatTime(e.created_at),
          ])}
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<div class="error-state"><p>Error: ${escapeHtml(err.message)}</p><button class="btn btn-sm btn-outline" onclick="showUserDetail(${userId})">Retry</button></div>`;
  }
}

// --- USER ACTIONS ---
function showCreditCashModal(userId, username, currentBalance) {
  openModal(`
    <button class="modal-close" onclick="closeModal()">&times;</button>
    <h2>Credit Cash to ${escapeHtml(username)}</h2>
    <div class="preview-panel">
      <div class="preview-row">
        <span class="preview-label">Current Balance</span>
        <span class="preview-value">$${currentBalance.toFixed(2)}</span>
      </div>
      <div class="preview-row" id="previewAfter">
        <span class="preview-label">After Credit</span>
        <span class="preview-value neutral">$${currentBalance.toFixed(2)}</span>
      </div>
    </div>
    <form onsubmit="submitCreditCash(event, ${userId})">
      <div class="form-group">
        <label>Amount ($)</label>
        <input type="number" id="cashAmount" step="0.01" min="0.01" placeholder="1000.00" required
               oninput="updateCashPreview(${currentBalance})">
      </div>
      <button type="submit" class="btn btn-success" style="width:100%">Credit Cash</button>
    </form>
  `);
}

function updateCashPreview(currentBalance) {
  const input = document.getElementById('cashAmount');
  const preview = document.getElementById('previewAfter');
  if (input && preview) {
    const amt = parseFloat(input.value) || 0;
    const newBal = currentBalance + amt;
    preview.innerHTML = `<span class="preview-label">After Credit</span><span class="preview-value neutral">$${newBal.toFixed(2)}</span>`;
  }
}

async function submitCreditCash(event, userId) {
  event.preventDefault();
  const amount = parseFloat(document.getElementById('cashAmount').value);
  if (!amount || amount <= 0) { showToast('Invalid amount', 'error'); return; }
  try {
    const result = await apiCreditCash(userId, amount);
    showToast(`Credited $${amount.toFixed(2)}. New balance: $${result.new_balance.toFixed(2)}`, 'success');
    closeModal();
    showUserDetail(userId);
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

function showCreditPpuModal(userId, username) {
  const instruments = state.instruments.filter(i => i.status === 'active');
  const instrOptions = instruments.map(i =>
    `<option value="${i.id}">${escapeHtml(i.name)} (ID: ${i.id})</option>`
  ).join('');

  openModal(`
    <button class="modal-close" onclick="closeModal()">&times;</button>
    <h2>Credit PPUs to ${escapeHtml(username)}</h2>
    <form onsubmit="submitCreditPpu(event, ${userId})">
      <div class="form-group">
        <label>Instrument</label>
        <select id="ppuInstrumentId">${instrOptions}</select>
      </div>
      <div class="form-group">
        <label>Units</label>
        <input type="number" id="ppuUnits" step="0.01" min="0.01" placeholder="100" required>
      </div>
      <button type="submit" class="btn btn-amber" style="width:100%">Credit PPUs</button>
    </form>
  `);
}

async function submitCreditPpu(event, userId) {
  event.preventDefault();
  const instrumentId = parseInt(document.getElementById('ppuInstrumentId').value);
  const units = parseFloat(document.getElementById('ppuUnits').value);
  if (!units || units <= 0) { showToast('Invalid units', 'error'); return; }
  try {
    const result = await apiCreditPpu(userId, instrumentId, units);
    showToast(`Credited ${units} PPUs. New balance: ${result.new_balance.toFixed(2)}`, 'success');
    closeModal();
    showUserDetail(userId);
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function changeUserRole(userId, newRole) {
  const confirmed = await showConfirm(
    `Change Role to '${newRole}'`,
    `Are you sure you want to change user #${userId}'s role to ${newRole}?`,
    'warning',
    'Change Role'
  );
  if (!confirmed) return;
  try {
    await apiChangeUserRole(userId, newRole);
    showToast(`User #${userId} role changed to '${newRole}'`, 'success');
    showUserDetail(userId);
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function changeUserStatus(userId, newStatus) {
  const action = newStatus === 'suspended' ? 'Suspend' : 'Reactivate';
  const confirmed = await showConfirm(
    `${action} User #${userId}`,
    `Are you sure you want to ${action.toLowerCase()} user #${userId}? ${newStatus === 'suspended' ? 'This will prevent them from logging in and trading.' : 'This will restore their access.'}`,
    newStatus === 'suspended' ? 'danger' : 'warning',
    action
  );
  if (!confirmed) return;
  try {
    await apiChangeUserStatus(userId, newStatus);
    showToast(`User #${userId} ${newStatus === 'suspended' ? 'suspended' : 'reactivated'}`, 'success');
    showUserDetail(userId);
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// --- INSTRUMENTS ---
async function renderInstruments() {
  const container = document.getElementById('view-instruments');
  container.innerHTML = skeleton(4);

  try {
    const instruments = await apiGetInstruments();
    state.instruments = instruments;

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h2>All Instruments (${instruments.length})</h2>
          <button class="btn btn-sm btn-success" onclick="showCreateInstrumentModal()">+ New IPO</button>
        </div>
        ${instruments.length === 0
          ? '<div class="empty-state"><p>No instruments defined</p></div>'
          : renderTable(['ID', 'Name', 'Description', 'Total Float', 'Status', 'Created By', 'Created', 'Actions'], instruments, i => [
            i.id,
            escapeHtml(i.name),
            escapeHtml((i.description || '').substring(0, 40)),
            Number(i.total_float || 0).toFixed(2),
            `<span class="badge badge-${i.status}">${i.status}</span>`,
            i.created_by || 'system',
            formatDate(i.created_at),
            `<div style="display:flex;gap:4px">
              <button class="btn btn-sm btn-outline" onclick="showInstrumentDetail(${i.id})">View</button>
              <button class="btn btn-sm btn-amber" onclick="showAdjustFloatModal(${i.id}, '${escapeHtml(i.name)}', ${i.total_float})">Float</button>
            </div>`,
          ])}
      </div>
      <div id="instrument-detail"></div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="error-state"><p>Error: ${escapeHtml(err.message)}</p><button class="btn btn-sm btn-outline" onclick="renderInstruments()">Retry</button></div>`;
  }
}

async function showInstrumentDetail(instrumentId) {
  const el = document.getElementById('instrument-detail');
  if (!el) return;
  el.innerHTML = '<div class="loading">Loading details</div>';

  try {
    const [summary, orders, holdings, profitHistory] = await Promise.all([
      apiGetInstrumentSummary(instrumentId),
      apiGetAllOrders(null, instrumentId),
      apiGetHoldings(instrumentId),
      apiGetProfitHistory(instrumentId),
    ]);

    const instr = state.instruments.find(i => i.id === instrumentId);
    if (!instr) return;

    el.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>${escapeHtml(instr.name)} <span class="subtitle">ID: ${instrumentId}</span></h3>
          <div style="display:flex;gap:6px">
            <button class="btn btn-sm ${instr.status === 'active' ? 'btn-danger' : 'btn-success'}"
                    onclick="toggleInstrumentStatus(${instrumentId}, '${instr.status === 'active' ? 'delisted' : 'active'}')">
              ${instr.status === 'active' ? 'Delist' : 'Activate'}
            </button>
          </div>
        </div>
        <div class="card-row">
          <div class="card-stat">
            <div class="label">Total Float</div>
            <div class="value neutral">${Number(instr.total_float).toFixed(2)}</div>
          </div>
          <div class="card-stat">
            <div class="label">Last Trade</div>
            <div class="value neutral">${summary.last_trade_price ? '$' + Number(summary.last_trade_price).toFixed(2) : '&mdash;'}</div>
          </div>
          <div class="card-stat">
            <div class="label">Volume Today</div>
            <div class="value neutral">${Number(summary.daily_volume || 0).toFixed(2)}</div>
          </div>
          <div class="card-stat">
            <div class="label">Open Orders</div>
            <div class="value neutral">${orders.length}</div>
          </div>
          <div class="card-stat">
            <div class="label">Holders</div>
            <div class="value neutral">${holdings.length}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>Open Orders</h3></div>
        ${orders.length === 0
          ? '<div class="empty-state"><p>No open orders</p></div>'
          : renderTable(['ID', 'User', 'Side', 'Price', 'Qty', 'Filled', 'Status', 'Time'], orders, o => [
            o.id,
            o.username || o.user_id,
            `<span class="side-${o.side}">${o.side.toUpperCase()}</span>`,
            `$${Number(o.price).toFixed(2)}`,
            Number(o.quantity).toFixed(2),
            Number(o.filled_quantity || 0).toFixed(2),
            `<span class="badge badge-${o.status}">${o.status.replace('_', ' ')}</span>`,
            formatTime(o.created_at),
          ])}
      </div>

      <div class="card">
        <div class="card-header"><h3>Holdings</h3></div>
        ${holdings.length === 0
          ? '<div class="empty-state"><p>No holdings</p></div>'
          : renderTable(['User', 'Units', 'Avg Cost Basis'], holdings, h => [
            h.username || `#${h.user_id}`,
            Number(h.units).toFixed(2),
            `$${Number(h.avg_cost_basis || 0).toFixed(2)}`,
          ])}
      </div>

      <div class="card">
        <div class="card-header"><h3>Profit Declarations</h3></div>
        ${profitHistory.length === 0
          ? '<div class="empty-state"><p>No profit declarations yet</p></div>'
          : renderTable(['ID', 'Period', 'Total Profit', 'Profit/PPU', 'Status', 'Declared', 'Distributed'], profitHistory, d => [
            d.id,
            escapeHtml(d.period_label),
            `$${Number(d.total_profit).toFixed(2)}`,
            `$${Number(d.profit_per_ppu).toFixed(4)}`,
            `<span class="badge badge-${d.status}">${d.status}</span>`,
            formatDate(d.declared_at),
            d.distributed_at ? formatDate(d.distributed_at) : '&mdash;',
          ])}
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<div class="error-state"><p>Error: ${escapeHtml(err.message)}</p></div>`;
  }
}

async function toggleInstrumentStatus(instrumentId, newStatus) {
  const action = newStatus === 'delisted' ? 'Delist' : 'Activate';
  const confirmed = await showConfirm(
    `${action} Instrument`,
    `Are you sure you want to ${action.toLowerCase()} instrument #${instrumentId}?`,
    'warning',
    action
  );
  if (!confirmed) return;
  try {
    await apiUpdateInstrumentStatus(instrumentId, newStatus);
    showToast(`Instrument #${instrumentId} ${newStatus}`, 'success');
    renderInstruments();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

function showCreateInstrumentModal() {
  openModal(`
    <h2>Create New Instrument</h2>
    <form onsubmit="submitCreateInstrument(event)">
      <div class="form-group">
        <label>Instrument Name *</label>
        <input type="text" id="instrName" required placeholder="e.g. SomaliAgri PPU">
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea id="instrDesc" rows="2" placeholder="Instrument description"></textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Total Float *</label>
          <input type="number" id="instrFloat" step="1" min="1" required placeholder="Total PPU units">
        </div>
        <div class="form-group">
          <label>Raise Target ($)</label>
          <input type="number" id="instrTarget" step="0.01" min="0" placeholder="Capital to raise">
        </div>
      </div>
      <div class="form-group">
        <label>Company (optional)</label>
        <select id="instrCompany">
          <option value="">-- No company --</option>
          ${(state.companies || []).map(c => '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>').join('')}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Series Label</label>
          <input type="text" id="instrSeriesLabel" placeholder="e.g. Series A">
        </div>
        <div class="form-group">
          <label>Price per PPU ($)</label>
          <input type="number" id="instrPrice" step="0.01" min="0.01" placeholder="Issuance price">
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-success">Create Instrument</button>
      </div>
    </form>
  `);
}

async function submitCreateInstrument(event) {
  event.preventDefault();
  const name = document.getElementById('instrName').value.trim();
  const desc = document.getElementById('instrDesc').value.trim();
  const float = parseFloat(document.getElementById('instrFloat').value) || 0;
  const target = parseFloat(document.getElementById('instrTarget').value) || 0;
  const companySel = document.getElementById('instrCompany');
  const companyId = companySel ? parseInt(companySel.value) || null : null;
  const seriesLabel = document.getElementById('instrSeriesLabel') ? document.getElementById('instrSeriesLabel').value.trim() : '';
  const price = parseFloat(document.getElementById('instrPrice')?.value) || null;

  if (!name) { showToast('Instrument name is required', 'error'); return; }
  if (float <= 0) { showToast('Float must be greater than 0', 'error'); return; }

  try {
    const result = await apiCallBody('POST', '/api/admin/instruments', {
      name: name,
      description: desc,
      total_float: float,
      company_id: companyId,
      series_label: seriesLabel,
      raise_target: target,
      price_per_ppu: price
    });
    showToast('Instrument created: ' + result.name, 'success');
    closeModal();
    renderInstruments();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

function showAdjustFloatModal(instrumentId, name, currentFloat) {
  openModal(`
    <button class="modal-close" onclick="closeModal()">&times;</button>
    <h2>Adjust Float: ${escapeHtml(name)}</h2>
    <div class="preview-panel">
      <div class="preview-row">
        <span class="preview-label">Current Float</span>
        <span class="preview-value">${currentFloat.toFixed(2)}</span>
      </div>
      <div class="preview-row" id="floatPreview">
        <span class="preview-label">New Float</span>
        <span class="preview-value neutral">${currentFloat.toFixed(2)}</span>
      </div>
    </div>
    <form onsubmit="submitAdjustFloat(event, ${instrumentId}, ${currentFloat})">
      <div class="form-group">
        <label>Additional Float</label>
        <input type="number" id="additionalFloat" step="0.01" min="0.01" placeholder="5000" required
               oninput="updateFloatPreview(${currentFloat})">
      </div>
      <button type="submit" class="btn btn-amber" style="width:100%">Adjust Float</button>
    </form>
  `);
}

function updateFloatPreview(currentFloat) {
  const input = document.getElementById('additionalFloat');
  const preview = document.getElementById('floatPreview');
  if (input && preview) {
    const amt = parseFloat(input.value) || 0;
    preview.innerHTML = `<span class="preview-label">New Float</span><span class="preview-value neutral">${(currentFloat + amt).toFixed(2)}</span>`;
  }
}

async function submitAdjustFloat(event, instrumentId, currentFloat) {
  event.preventDefault();
  const additional = parseFloat(document.getElementById('additionalFloat').value);
  if (!additional || additional <= 0) { showToast('Invalid amount', 'error'); return; }
  try {
    const result = await apiAdjustFloat(instrumentId, additional);
    showToast(`Float adjusted: ${result.previous_total_float} → ${result.new_total_float}`, 'success');
    closeModal();
    renderInstruments();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// --- FUNDING ---
async function renderFunding() {
  const container = document.getElementById('view-funding');
  container.innerHTML = skeleton(4);

  try {
    const instruments = await apiGetInstruments();
    state.instruments = instruments;
    const users = await apiGetUsers();
    state.users = users;

    const userOptions = users.map(u =>
      `<option value="${u.id}">${escapeHtml(u.username)} (ID: ${u.id}) - $${Number(u.cash_balance || 0).toFixed(2)}</option>`
    ).join('');

    const activeInstruments = instruments.filter(i => i.status === 'active');
    const instrOptions = activeInstruments.map(i =>
      `<option value="${i.id}">${escapeHtml(i.name)} (Float: ${i.total_float})</option>`
    ).join('');

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="card">
          <div class="card-header"><h3>Credit Cash</h3></div>
          <form onsubmit="submitFundingCash(event)">
            <div class="form-group">
              <label>User</label>
              <select id="fundUserCash">${userOptions}</select>
            </div>
            <div class="form-group">
              <label>Amount ($)</label>
              <input type="number" id="fundCashAmount" step="0.01" min="0.01" placeholder="5000.00" required>
            </div>
            <button type="submit" class="btn btn-success" style="width:100%">Credit Cash</button>
          </form>
        </div>

        <div class="card">
          <div class="card-header"><h3>Credit PPUs</h3></div>
          <form onsubmit="submitFundingPpu(event)">
            <div class="form-group">
              <label>User</label>
              <select id="fundUserPpu">${userOptions}</select>
            </div>
            <div class="form-group">
              <label>Instrument</label>
              <select id="fundInstrument">${instrOptions}</select>
            </div>
            <div class="form-group">
              <label>Units</label>
              <input type="number" id="fundPpuUnits" step="0.01" min="0.01" placeholder="100" required>
            </div>
            <button type="submit" class="btn btn-amber" style="width:100%">Credit PPUs</button>
          </form>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Recent Transactions</h3>
          <button class="btn btn-sm btn-outline" onclick="renderFundingTransactions()">Refresh</button>
        </div>
        <div id="funding-transactions"><div class="loading">Loading transactions...</div></div>
      </div>
    `;

    renderFundingTransactions();
  } catch (err) {
    container.innerHTML = `<div class="error-state"><p>Error: ${escapeHtml(err.message)}</p><button class="btn btn-sm btn-outline" onclick="renderFunding()">Retry</button></div>`;
  }
}

async function renderFundingTransactions() {
  const el = document.getElementById('funding-transactions');
  if (!el) return;
  try {
    const transactions = await apiGetTransactions();
    el.innerHTML = transactions.length === 0
      ? '<div class="empty-state"><p>No transactions yet</p></div>'
      : renderTable(['ID', 'Type', 'Admin', 'User', 'Amount', 'Instrument', 'Description', 'Time'], transactions, t => [
        t.id,
        `<span class="badge badge-${t.type === 'cash_credit' ? 'active' : 'admin'}">${t.type.replace('_', ' ')}</span>`,
        escapeHtml(t.admin_username || `#${t.admin_id}`),
        escapeHtml(t.username || `#${t.user_id}`),
        t.type === 'cash_credit' ? `$${Number(t.amount).toFixed(2)}` : `${Number(t.amount).toFixed(2)} units`,
        t.instrument_id || '&mdash;',
        escapeHtml((t.description || '').substring(0, 60)),
        formatTime(t.created_at),
      ]);
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>Could not load transactions (new feature)</p></div>`;
  }
}

async function submitFundingCash(event) {
  event.preventDefault();
  const userId = parseInt(document.getElementById('fundUserCash').value);
  const amount = parseFloat(document.getElementById('fundCashAmount').value);
  if (!amount || amount <= 0) { showToast('Invalid amount', 'error'); return; }
  try {
    const result = await apiCreditCash(userId, amount);
    showToast(`Credited $${amount.toFixed(2)}. New balance: $${result.new_balance.toFixed(2)}`, 'success');
    document.getElementById('fundCashAmount').value = '';
    renderFundingTransactions();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function submitFundingPpu(event) {
  event.preventDefault();
  const userId = parseInt(document.getElementById('fundUserPpu').value);
  const instrumentId = parseInt(document.getElementById('fundInstrument').value);
  const units = parseFloat(document.getElementById('fundPpuUnits').value);
  if (!units || units <= 0) { showToast('Invalid units', 'error'); return; }
  try {
    const result = await apiCreditPpu(userId, instrumentId, units);
    showToast(`Credited ${units} PPUs. New balance: ${result.new_balance.toFixed(2)}`, 'success');
    document.getElementById('fundPpuUnits').value = '';
    renderFundingTransactions();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// --- ORDERS ---
async function renderOrders() {
  const container = document.getElementById('view-orders');
  container.innerHTML = skeleton(4);

  try {
    // Get instruments for filter
    const instruments = await apiGetInstruments();
    state.instruments = instruments;

    const instrOptions = '<option value="">All Instruments</option>' +
      instruments.map(i => `<option value="${i.id}">${escapeHtml(i.name)}</option>`).join('');

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h2>All Orders</h2>
          <div class="search-bar">
            <select id="orderStatusFilter" onchange="filterOrders()">
              <option value="">All Status</option>
              <option value="open">Open</option>
              <option value="partially_filled">Partial</option>
              <option value="filled">Filled</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select id="orderInstrumentFilter" onchange="filterOrders()">
              ${instrOptions}
            </select>
            <button class="btn btn-sm btn-primary" onclick="loadFilteredOrders()">Filter</button>
            <button class="btn btn-sm btn-outline" onclick="document.getElementById('orderStatusFilter').value='';document.getElementById('orderInstrumentFilter').value='';loadFilteredOrders()">Clear</button>
          </div>
        </div>
        <div id="orders-content"><div class="loading">Loading orders...</div></div>
      </div>
    `;

    loadFilteredOrders();
  } catch (err) {
    container.innerHTML = `<div class="error-state"><p>Error: ${escapeHtml(err.message)}</p><button class="btn btn-sm btn-outline" onclick="renderOrders()">Retry</button></div>`;
  }
}

function filterOrders() {
  loadFilteredOrders();
}

async function loadFilteredOrders() {
  const el = document.getElementById('orders-content');
  if (!el) return;
  el.innerHTML = '<div class="loading">Loading...</div>';
  try {
    const status = document.getElementById('orderStatusFilter').value || null;
    const instrumentId = document.getElementById('orderInstrumentFilter').value || null;
    const orders = await apiGetAllOrders(status, instrumentId);
    state.orders = orders;

    el.innerHTML = orders.length === 0
      ? '<div class="empty-state"><p>No orders found</p></div>'
      : renderTableWithPagination(['ID', 'User', 'Instrument', 'Side', 'Price', 'Qty', 'Filled', 'Status', 'Time', 'Actions'], orders, o => [
        o.id,
        o.username || `#${o.user_id}`,
        o.instrument_name || `#${o.instrument_id}`,
        `<span class="side-${o.side}">${o.side.toUpperCase()}</span>`,
        safeCurrency(o.price),
        safeNum(o.quantity),
        safeNum(o.filled_quantity),
        `<span class="badge badge-${o.status}">${o.status.replace('_', ' ')}</span>`,
        formatTime(o.created_at),
        `<div style="display:flex;gap:4px">
          ${(o.status === 'open' || o.status === 'partially_filled')
            ? `<button class="btn btn-sm btn-danger" onclick="adminCancelOrder(${o.id})">Cancel</button>`
            : ''}
          <button class="btn btn-sm btn-outline" onclick="adminForceCancelOrder(${o.id})">Force</button>
        </div>`,
      ], 'orders', 'loadFilteredOrders()');
  } catch (err) {
    el.innerHTML = `<div class="error-state"><p>Error: ${escapeHtml(err.message)}</p></div>`;
  }
}

async function adminCancelOrder(orderId) {
  const confirmed = await showConfirm(
    'Cancel Order',
    `Are you sure you want to cancel order #${orderId}?`,
    'warning',
    'Cancel Order'
  );
  if (!confirmed) return;
  try {
    await apiCancelOrder(orderId);
    showToast(`Order #${orderId} cancelled`, 'success');
    loadFilteredOrders();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function adminForceCancelOrder(orderId) {
  const confirmed = await showConfirm(
    'Force-Cancel Order',
    `This will force-cancel order #${orderId} and reverse any associated trades. This action CANNOT be undone.`,
    'danger',
    'Force Cancel'
  );
  if (!confirmed) return;
  try {
    const result = await apiForceCancelOrder(orderId);
    showToast(`Order #${orderId} force-cancelled. ${result.trades_reversed} trades reversed.`, 'success');
    loadFilteredOrders();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// --- TRADES ---
async function renderTrades() {
  const container = document.getElementById('view-trades');
  container.innerHTML = skeleton(4);

  try {
    const instruments = await apiGetInstruments();
    state.instruments = instruments;

    const instrOptions = '<option value="">All Instruments</option>' +
      instruments.map(i => `<option value="${i.id}">${escapeHtml(i.name)}</option>`).join('');

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h2>Trade Surveillance</h2>
          <div class="search-bar">
            <select id="tradeInstrumentFilter">
              ${instrOptions}
            </select>
            <button class="btn btn-sm btn-primary" onclick="loadFilteredTrades()">Filter</button>
            <button class="btn btn-sm btn-outline" onclick="document.getElementById('tradeInstrumentFilter').value='';loadFilteredTrades()">All</button>
          </div>
        </div>
        <div id="trades-content"><div class="loading">Loading trades...</div></div>
      </div>
    `;

    loadFilteredTrades();
  } catch (err) {
    container.innerHTML = `<div class="error-state"><p>Error: ${escapeHtml(err.message)}</p><button class="btn btn-sm btn-outline" onclick="renderTrades()">Retry</button></div>`;
  }
}

async function loadFilteredTrades() {
  const el = document.getElementById('trades-content');
  if (!el) return;
  el.innerHTML = '<div class="loading">Loading...</div>';
  try {
    const instFilter = document.getElementById('tradeInstrumentFilter');
    const instrumentId = instFilter ? instFilter.value || null : null;
    const trades = await apiGetTrades(instrumentId);
    state.trades = trades;

    el.innerHTML = trades.length === 0
      ? '<div class="empty-state"><p>No trades found</p></div>'
      : renderTableWithPagination(['ID', 'Instrument', 'Price', 'Qty', 'Total', 'Buyer', 'Seller', 'Time'], trades, t => [
        t.id,
        t.instrument_name || `#${t.instrument_id}`,
        safeCurrency(t.price),
        safeNum(t.quantity),
        safeCurrency(t.total_value),
        t.buyer_name || t.buyer_id,
        t.seller_name || t.seller_id,
        formatTime(t.created_at),
      ], 'trades', 'loadFilteredTrades()');
  } catch (err) {
    el.innerHTML = `<div class="error-state"><p>Error: ${escapeHtml(err.message)}</p></div>`;
  }
}

// --- PROFIT ---
async function renderProfit() {
  const container = document.getElementById('view-profit');
  container.innerHTML = skeleton(4);

  try {
    const instruments = await apiGetInstruments();
    state.instruments = instruments;
    const activeInstruments = instruments.filter(i => i.status === 'active');
    const instrOptions = activeInstruments.map(i =>
      `<option value="${i.id}">${escapeHtml(i.name)} (Float: ${i.total_float})</option>`
    ).join('');

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="card">
          <div class="card-header"><h3>Declare Profit</h3></div>
          <form onsubmit="submitDeclareProfit(event)">
            <div class="form-group">
              <label>Instrument</label>
              <select id="profitInstrument">${instrOptions}</select>
            </div>
            <div class="form-group">
              <label>Period Label</label>
              <input type="text" id="profitPeriod" placeholder="e.g. Q2-2026" required>
            </div>
            <div class="form-group">
              <label>Total Profit ($)</label>
              <input type="number" id="profitAmount" step="0.01" min="0.01" placeholder="50000.00" required
                     oninput="updateProfitPreview()">
            </div>
            <div class="preview-panel" id="profitPreview" style="display:none">
              <div class="preview-row">
                <span class="preview-label">Profit per PPU</span>
                <span class="preview-value" id="profitPerPpu">$0.0000</span>
              </div>
            </div>
            <button type="submit" class="btn btn-success" style="width:100%">Declare Profit</button>
          </form>
        </div>

        <div class="card">
          <div class="card-header"><h3>Distribute Profit</h3></div>
          <div style="font-size:13px;color:var(--text-muted);margin-bottom:12px">
            Select an instrument below to see its declared profits, then distribute.
          </div>
          <div class="form-group">
            <label>Instrument</label>
            <select id="distributeInstrument" onchange="loadProfitHistory()">
              ${'<option value="">Select...</option>' + instrOptions}
            </select>
          </div>
          <div id="profit-distribution-content"></div>
        </div>
      </div>

      <div class="card" id="profit-history-section" style="display:none">
        <div class="card-header">
          <h3>Profit Declaration History</h3>
          <button class="btn btn-sm btn-outline" onclick="loadProfitHistory()">Refresh</button>
        </div>
        <div id="profit-history-content"><div class="loading">Loading...</div></div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="error-state"><p>Error: ${escapeHtml(err.message)}</p><button class="btn btn-sm btn-outline" onclick="renderProfit()">Retry</button></div>`;
  }
}

async function submitDeclareProfit(event) {
  event.preventDefault();
  const instrumentId = parseInt(document.getElementById('profitInstrument').value);
  const periodLabel = document.getElementById('profitPeriod').value.trim();
  const totalProfit = parseFloat(document.getElementById('profitAmount').value);
  if (!periodLabel) { showToast('Period label required', 'error'); return; }
  if (!totalProfit || totalProfit <= 0) { showToast('Invalid profit amount', 'error'); return; }
  try {
    const result = await apiDeclareProfit(instrumentId, periodLabel, totalProfit);
    showToast(`Profit declared: $${totalProfit.toFixed(2)} (${result.profit_per_ppu}/PPU)`, 'success');
    document.getElementById('profitPeriod').value = '';
    document.getElementById('profitAmount').value = '';
    document.getElementById('profitPreview').style.display = 'none';
    loadProfitHistory();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

function updateProfitPreview() {
  const instrumentId = document.getElementById('profitInstrument').value;
  const amount = parseFloat(document.getElementById('profitAmount').value) || 0;
  const preview = document.getElementById('profitPreview');
  const perPpu = document.getElementById('profitPerPpu');

  if (!instrumentId || !amount) {
    preview.style.display = 'none';
    return;
  }
  const instr = state.instruments.find(i => i.id === parseInt(instrumentId));
  if (!instr || instr.total_float <= 0) return;
  const ppu = amount / instr.total_float;
  perPpu.textContent = `$${ppu.toFixed(4)}`;
  preview.style.display = 'block';
}

async function loadProfitHistory() {
  const instrumentId = document.getElementById('distributeInstrument').value;
  if (!instrumentId) {
    document.getElementById('profit-history-section').style.display = 'none';
    return;
  }
  document.getElementById('profit-history-section').style.display = 'block';
  const el = document.getElementById('profit-history-content');
  if (!el) return;
  el.innerHTML = '<div class="loading">Loading...</div>';

  try {
    const history = await apiGetProfitHistory(instrumentId);
    state.profitHistory = history;

    el.innerHTML = history.length === 0
      ? '<div class="empty-state"><p>No declarations yet</p></div>'
      : renderTable(['ID', 'Period', 'Total Profit', 'Profit/PPU', 'Total PPUs', 'Status', 'Declared', 'Distributed', 'Actions'], history, d => [
        d.id,
        escapeHtml(d.period_label),
        `$${Number(d.total_profit).toFixed(2)}`,
        `$${Number(d.profit_per_ppu).toFixed(4)}`,
        Number(d.total_ppus).toFixed(2),
        `<span class="badge badge-${d.status}">${d.status}</span>`,
        formatDate(d.declared_at),
        d.distributed_at ? formatDate(d.distributed_at) : '&mdash;',
        d.status === 'declared'
          ? `<button class="btn btn-sm btn-success" onclick="distributeProfit(${d.id}, '${escapeHtml(d.period_label)}')">Distribute</button>`
          : '<span style="color:var(--text-muted)">Done</span>',
      ]);
  } catch (err) {
    el.innerHTML = `<div class="error-state"><p>Error: ${escapeHtml(err.message)}</p></div>`;
  }
}

async function distributeProfit(declarationId, periodLabel) {
  const confirmed = await showConfirm(
    'Distribute Profit',
    `Are you sure you want to distribute profit for period "${periodLabel}"? This will credit cash to all PPU holders.`,
    'warning',
    'Distribute'
  );
  if (!confirmed) return;
  try {
    const result = await apiDistributeProfit(declarationId);
    showToast(`Profit distributed to ${result.message}`, 'success');
    loadProfitHistory();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// --- RECONCILIATION ---
async function renderReconciliation() {
  const container = document.getElementById('view-reconciliation');
  container.innerHTML = '<div class="loading">Checking reconciliation...</div>';

  try {
    const recon = await apiGetReconciliation();

    const allOk = recon.all_balanced;

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h2>System Reconciliation</h2>
          <button class="btn btn-sm btn-primary" onclick="renderReconciliation()">Refresh Now</button>
        </div>

        <div class="recon-grid">
          <div class="card status-card ${recon.cash_net_zero ? 'ok' : 'fail'}">
            <div class="status-icon">${recon.cash_net_zero ? '&#10003;' : '&#10007;'}</div>
            <div class="status-label">Cash Net Zero</div>
            <div class="status-value">${recon.cash_net_zero ? 'OK' : 'FAIL'}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px;font-family:var(--font-mono)">Total: ${safeCurrency(recon.cash_total)}</div>
          </div>

          <div class="card status-card ${recon.ppu_matches_float ? 'ok' : 'fail'}">
            <div class="status-icon">${recon.ppu_matches_float ? '&#10003;' : '&#10007;'}</div>
            <div class="status-label">PPU Matches Float</div>
            <div class="status-value">${recon.ppu_matches_float ? 'OK' : 'FAIL'}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px;font-family:var(--font-mono)">Total: ${safeNum(recon.ppu_total)}</div>
          </div>

          <div class="card status-card ${allOk ? 'ok' : 'fail'}">
            <div class="status-icon">${allOk ? '&#10003;' : '&#9888;'}</div>
            <div class="status-label">All Balanced</div>
            <div class="status-value">${allOk ? 'YES' : 'NO'}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px;font-family:var(--font-mono)">Float: ${safeNum(recon.instrument_float)}</div>
          </div>
        </div>

        <div class="recon-timestamp">Auto-refresh every 30 seconds</div>
      </div>
    `;

    // Auto-refresh (only if still on reconciliation)
    state.dashboardTimer = setInterval(() => {
      if (state.currentView === 'reconciliation') renderReconciliation();
      else { clearInterval(state.dashboardTimer); state.dashboardTimer = null; }
    }, 30000);

  } catch (err) {
    container.innerHTML = `<div class="error-state"><p>Error: ${escapeHtml(err.message)}</p><button class="btn btn-sm btn-outline" onclick="renderReconciliation()">Retry</button></div>`;
  }
}

// --- DB EXPLORER ---
let dbTable = 'users';
let dbSchemaVisible = false;
// ========== ORDER BOOK & CHART HELPERS ==========
let selectedChartInstrumentId = null;
let orderBookRefreshTimer = null;

async function fetchInstruments() {
  const instrs = await apiGetInstruments();
  state.instruments = instrs;
  return instrs;
}

function buildInstrumentSelector(selectedId, onChangeFn) {
  const instrs = state.instruments;
  if (!instrs || instrs.length === 0) return '<div class="empty-state"><p>No instruments available</p></div>';
  let opts = instrs.map(i => '<option value="' + i.id + '"' + (i.id === selectedId ? ' selected' : '') + '>' + escapeHtml(i.name) + '</option>').join('');
  return '<div class="search-bar" style="margin-bottom:16px">' +
    '<select id="instrSelect" style="min-width:250px;padding:8px 12px" onchange="handleInstrChange()" data-fn="' + onChangeFn + '">' + opts + '</select></div>';
}async function handleInstrChange() {
  const sel = document.getElementById('instrSelect');
  if (!sel) return;
  selectedChartInstrumentId = Number(sel.value);
  const fnName = sel.getAttribute('data-fn') || 'orderbook';
  if (fnName === 'orderbook') await renderOrderBookContent(selectedChartInstrumentId);
  else if (fnName === 'charts') await renderChartContent(selectedChartInstrumentId);
}function formatPrice(p) { return '$' + Number(p).toFixed(2); }

async function renderDbExplorer() {
  const container = document.getElementById('view-dbexplorer');
  container.innerHTML = skeleton(4);

  try {
    const tables = await apiGetDbTables();
    const tblBtns = tables.map(t =>
      `<button class="instr-btn ${t.name === dbTable ? 'active' : ''}" onclick="switchDbTable('${t.name}')">${t.name} (${t.rows})</button>`
    ).join('');

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h2>Database Explorer</h2>
          <button class="btn btn-sm btn-outline" onclick="toggleDbSchema()">View Schema</button>
        </div>
        <div class="instrument-selector">
          ${tblBtns}
        </div>
        <div id="db-schema" style="display:none"></div>
        <div id="db-content"><div class="loading">Loading table data...</div></div>
      </div>
    `;

    loadDbTable(dbTable);
  } catch (err) {
    container.innerHTML = `<div class="error-state"><p>Error: ${escapeHtml(err.message)}</p><button class="btn btn-sm btn-outline" onclick="renderDbExplorer()">Retry</button></div>`;
  }
}

function switchDbTable(tableName) {
  dbTable = tableName;
  document.querySelectorAll('#view-dbexplorer .instr-btn').forEach(b => {
    b.classList.toggle('active', b.textContent.startsWith(tableName));
  });
  loadDbTable(tableName);
}

async function loadDbTable(tableName) {
  const el = document.getElementById('db-content');
  if (!el) return;
  el.innerHTML = '<div class="loading">Loading...</div>';
  try {
    const data = await apiGetDbTable(tableName, 200);
    if (data.length === 0) {
      el.innerHTML = '<div class="empty-state"><p>Table is empty</p></div>';
      return;
    }
    const cols = Object.keys(data[0]);
    el.innerHTML = renderTable(cols, data, row =>
      cols.map(c => {
        let v = row[c];
        if (v === null || v === undefined) return '<span style="color:var(--text-muted)">NULL</span>';
        if (typeof v === 'number') {
          const cl = v > 0 ? 'positive' : v < 0 ? 'negative' : '';
          return `<span class="value ${cl}" style="font-size:inherit">${v.toFixed(2)}</span>`;
        }
        return escapeHtml(String(v));
      })
    );
    el.innerHTML += '<div style="text-align:center;margin-top:8px;font-size:11px;color:var(--text-muted)">Showing up to 200 rows</div>';
  } catch (err) {
    el.innerHTML = `<div class="error-state"><p>Error: ${escapeHtml(err.message)}</p></div>`;
  }
}

async function toggleDbSchema() {
  const el = document.getElementById('db-schema');
  if (!el) return;
  dbSchemaVisible = !dbSchemaVisible;
  if (dbSchemaVisible) {
    el.style.display = 'block';
    el.innerHTML = '<div class="loading">Loading schema...</div>';
    try {
      const schema = await apiGetDbSchema();
      el.innerHTML = '<pre style="font-family:var(--font-mono);font-size:11px;color:var(--text-secondary);overflow-x:auto;padding:12px;background:var(--bg-tertiary);border-radius:var(--radius-sm)">' +
        escapeHtml(schema.tables.join('\n\n')) + '</pre>';
    } catch (err) {
      el.innerHTML = `<div class="error-state"><p>Error: ${escapeHtml(err.message)}</p></div>`;
    }
  } else {
    el.style.display = 'none';
  }
}

// ========== TABLE HELPER ==========
function renderTable(headers, rows, rowFn) {
  return `
    <div class="table-container">
      <table>
        <thead>
          <tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${rows.map(r => `<tr>${rowFn(r).map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ========== UTILITY ==========
function safeNum(n, decimals = 2) {
  const val = Number(n);
  return isNaN(val) ? '0.00' : val.toFixed(decimals);
}

function safeCurrency(n) {
  const val = Number(n);
  return isNaN(val) ? '$0.00' : (val < 0 ? `-$${Math.abs(val).toFixed(2)}` : `$${val.toFixed(2)}`);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

// ========== PAGINATION ==========
const PAGE_SIZE = 25;
let pageState = {};

function paginate(data, pageKey = 'default') {
  if (!pageState[pageKey]) pageState[pageKey] = 0;
  const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
  pageState[pageKey] = Math.min(pageState[pageKey], totalPages - 1);
  const start = pageState[pageKey] * PAGE_SIZE;
  const page = data.slice(start, start + PAGE_SIZE);
  return { page, totalPages, current: pageState[pageKey], start, end: Math.min(start + PAGE_SIZE, data.length), total: data.length };
}

function renderPagination(pageKey, totalPages, current, total, renderFn) {
  if (totalPages <= 1) return '';
  let html = '<div class="pagination">';
  html += `<button onclick="pageState['${pageKey}']=0;${renderFn}" ${current === 0 ? 'disabled' : ''}>&#171;</button>`;
  html += `<button onclick="pageState['${pageKey}']=${Math.max(0, current - 1)};${renderFn}" ${current === 0 ? 'disabled' : ''}>&#8249;</button>`;
  // Show page numbers
  const startP = Math.max(0, current - 2);
  const endP = Math.min(totalPages - 1, current + 2);
  for (let i = startP; i <= endP; i++) {
    html += `<button class="${i === current ? 'active' : ''}" onclick="pageState['${pageKey}']=${i};${renderFn}">${i + 1}</button>`;
  }
  html += `<button onclick="pageState['${pageKey}']=${Math.min(totalPages - 1, current + 1)};${renderFn}" ${current === totalPages - 1 ? 'disabled' : ''}>&#8250;</button>`;
  html += `<button onclick="pageState['${pageKey}']=${totalPages - 1};${renderFn}" ${current === totalPages - 1 ? 'disabled' : ''}>&#187;</button>`;
  html += ` <span style="font-size:11px;color:var(--text-muted);padding:4px 8px">${current * PAGE_SIZE + 1}-${Math.min((current + 1) * PAGE_SIZE, total)} of ${total}</span>`;
  html += '</div>';
  return html;
}

// ========== CSV EXPORT ==========
function exportCSV(headers, rows, filename = 'export.csv') {
  const escapeCSV = s => `"${String(s == null ? '' : s).replace(/"/g, '""')}"`;
  const csv = [headers.join(','), ...rows.map(r => r.map(cell => {
    const plain = cell.replace(/<[^>]*>/g, '').trim();
    return escapeCSV(plain);
  }).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function renderTableWithPagination(headers, allData, rowFn, pageKey, renderFnName) {
  const p = paginate(allData, pageKey);
  let html = `<div class="table-container">${renderTable(headers, p.page, rowFn)}</div>`;
  html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">`;
  html += `<span style="font-size:11px;color:var(--text-muted)">Showing ${p.start + 1}-${p.end} of ${p.total}</span>`;
  html += `<button class="btn btn-sm btn-outline" onclick="exportCSV(${JSON.stringify(headers)}, ${JSON.stringify(allData.map(r => rowFn(r).map(c => c.replace(/<[^>]*>/g, '').trim())))}, '${pageKey}.csv')">Export CSV</button>`;
  html += `</div>`;
  html += renderPagination(pageKey, p.totalPages, p.current, p.total, renderFnName);
  return html;
}

function formatTime(isoStr) {
  if (!isoStr) return '-';
  try {
    const d = new Date(isoStr);
    return d.toLocaleString();
  } catch {
    return isoStr;
  }
}

function formatDate(isoStr) {
  if (!isoStr) return '-';
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString();
  } catch {
    return isoStr;
  }
}

// ========== AUTH SCREENS ==========
function showLoginForm() {
  const container = document.getElementById('authContainer');
  container.innerHTML = `
    <div class="auth-card">
      <div class="auth-logo">
        <h1>FASEM</h1>
        <small>Market Admin</small>
      </div>
      <p class="auth-subtitle">Sign in to the admin panel</p>
      <form onsubmit="handleLogin(event)">
        <div class="form-group">
          <label>Username</label>
          <input type="text" id="loginUsername" placeholder="Enter username" required autocomplete="username">
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" id="loginPassword" placeholder="Enter password" required autocomplete="current-password">
        </div>
        <button type="submit" class="btn btn-primary" style="width:100%">Sign In</button>
      </form>
      <div class="auth-toggle">
        No admin account? <a onclick="showRegisterForm()">Register</a>
      </div>
    </div>
  `;
}

function showRegisterForm() {
  const container = document.getElementById('authContainer');
  container.innerHTML = `
    <div class="auth-card">
      <div class="auth-logo">
        <h1>FASEM</h1>
        <small>Market Admin</small>
      </div>
      <p class="auth-subtitle">Create admin account</p>
      <form onsubmit="handleRegister(event)">
        <div class="form-group">
          <label>Username</label>
          <input type="text" id="regUsername" placeholder="Choose a username" required autocomplete="username">
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" id="regPassword" placeholder="Choose a password" required autocomplete="new-password" minlength="4">
        </div>
        <button type="submit" class="btn btn-success" style="width:100%">Create Account</button>
      </form>
      <div class="auth-toggle">
        Already have an account? <a onclick="showLoginForm()">Sign in</a>
      </div>
    </div>
  `;
}

// ========== EVENT HANDLERS ==========
async function handleLogin(event) {
  event.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!username || !password) {
    showToast('Please enter username and password', 'error');
    return;
  }

  try {
    const result = await apiLogin(username, password);
    if (result.role !== 'admin') {
      showToast('Access denied: Admin role required', 'error');
      return;
    }
    saveAuth(result.token, result.user_id, result.username, result.role);
    showToast(`Welcome, ${result.username}!`, 'success');
    initApp();
  } catch (err) {
    showToast(`Login failed: ${err.message}`, 'error');
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const username = document.getElementById('regUsername').value.trim();
  const password = document.getElementById('regPassword').value;

  if (!username || !password) {
    showToast('Please fill in all fields', 'error');
    return;
  }

  if (password.length < 4) {
    showToast('Password must be at least 4 characters', 'error');
    return;
  }

  try {
    await apiRegister(username, password);
    showToast('Admin account created! Please sign in.', 'success');
    showLoginForm();
  } catch (err) {
    showToast(`Registration failed: ${err.message}`, 'error');
  }
}

function handleLogout() {
  clearAuth();
  showToast('Logged out', 'info');
  showAuthScreen();
}

function showAuthScreen() {
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('authContainer').style.display = 'flex';
  showLoginForm();
}

// ========== ORDER BOOK VIEW ==========
async function renderOrderBook() {
  const container = document.getElementById('view-orderbook');
  container.innerHTML = skeleton(4);
  try {
    if (!state.instruments || state.instruments.length === 0) await fetchInstruments();
    if (!state.instruments || state.instruments.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No instruments available</p></div>';
      return;
    }
    if (!selectedChartInstrumentId) selectedChartInstrumentId = state.instruments[0].id;

    container.innerHTML = buildInstrumentSelector(selectedChartInstrumentId, 'orderbook') +
      '<div id="obInstrumentInfo"></div>' +
      '<div id="obContent" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:12px">' +
        '<div class="card" id="obBidsPanel"><div class="loading">Loading bids</div></div>' +
        '<div class="card" id="obAsksPanel"><div class="loading">Loading asks</div></div>' +
      '</div>' +
      '<div class="card" id="obSpreadPanel" style="margin-top:0"><div class="loading">Loading spread</div></div>';

    await renderOrderBookContent(selectedChartInstrumentId);

    if (orderBookRefreshTimer) clearInterval(orderBookRefreshTimer);
    orderBookRefreshTimer = setInterval(async () => {
      if (state.currentView === 'orderbook' && selectedChartInstrumentId) {
        await renderOrderBookContent(selectedChartInstrumentId);
      } else {
        clearInterval(orderBookRefreshTimer);
        orderBookRefreshTimer = null;
      }
    }, 10000);
  } catch (err) {
    container.innerHTML = '<div class="error-state"><p>Error: ' + escapeHtml(err.message) + '</p></div>';
  }
}

async function renderOrderBookContent(instrumentId) {
  try {
    const [ob, summary] = await Promise.all([
      apiGetOrderBook(instrumentId),
      apiGetInstrumentSummary(instrumentId),
    ]);

    const instr = state.instruments.find(i => i.id === instrumentId);
    const instrName = instr ? instr.name : 'Instrument #' + instrumentId;

    const infoEl = document.getElementById('obInstrumentInfo');
    if (infoEl) {
      infoEl.innerHTML = '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center">' +
        '<h2 style="font-size:18px">' + escapeHtml(instrName) + '</h2>' +
        '<span style="font-size:13px;color:var(--text-muted)"><span class="badge badge-active">' + (instr ? instr.status : '') + '</span> Float: ' + safeNum(instr ? instr.total_float : 0) + '</span>' +
        '</div></div>';
    }

    const bids = (ob.bids || []).sort((a, b) => b.price - a.price).slice(0, 15);
    const asks = (ob.asks || []).sort((a, b) => a.price - b.price).slice(0, 15);
    const maxQty = Math.max(
      ...bids.map(b => Number(b.remaining || b.quantity || 0)),
      ...asks.map(a => Number(a.remaining || a.quantity || 0)), 1
    );

    const spread = ob.spread !== undefined ? ob.spread : (ob.best_ask && ob.best_bid ? ob.best_ask - ob.best_bid : null);
    const mid = ob.mid_price !== undefined ? ob.mid_price : (ob.best_ask && ob.best_bid ? (ob.best_ask + ob.best_bid) / 2 : null);
    const spreadPct = mid && spread ? (spread / mid * 100) : null;

    const bidsEl = document.getElementById('obBidsPanel');
    if (bidsEl) {
      bidsEl.innerHTML = '<h3 style="color:var(--accent-green);margin-bottom:8px;font-size:14px;text-transform:uppercase;letter-spacing:0.5px">Bids (Buy)</h3>' +
        (bids.length === 0 ? '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px">No bids</div>'
          : '<div style="display:flex;flex-direction:column;gap:2px">' +
            bids.map(b => {
              const qty = Number(b.remaining || b.quantity || 0);
              const pct = (qty / maxQty * 100);
              return '<div class="ob-row">' +
                '<div class="ob-bar ob-bid-bar" style="width:' + pct + '%"></div>' +
                '<span class="ob-price" style="color:var(--accent-green)">' + formatPrice(b.price) + '</span>' +
                '<span class="ob-qty">' + safeNum(qty) + '</span></div>';
            }).join('') + '</div>');
    }

    const asksEl = document.getElementById('obAsksPanel');
    if (asksEl) {
      asksEl.innerHTML = '<h3 style="color:var(--accent-red);margin-bottom:8px;font-size:14px;text-transform:uppercase;letter-spacing:0.5px">Asks (Sell)</h3>' +
        (asks.length === 0 ? '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px">No asks</div>'
          : '<div style="display:flex;flex-direction:column;gap:2px">' +
            asks.map(a => {
              const qty = Number(a.remaining || a.quantity || 0);
              const pct = (qty / maxQty * 100);
              return '<div class="ob-row">' +
                '<div class="ob-bar ob-ask-bar" style="width:' + pct + '%"></div>' +
                '<span class="ob-price" style="color:var(--accent-red)">' + formatPrice(a.price) + '</span>' +
                '<span class="ob-qty">' + safeNum(qty) + '</span></div>';
            }).join('') + '</div>');
    }

    const spreadEl = document.getElementById('obSpreadPanel');
    if (spreadEl) {
      const spreadColor = spread !== null && spreadPct !== null
        ? (spreadPct < 0.5 ? 'var(--accent-green)' : spreadPct < 2 ? 'var(--accent-amber)' : 'var(--accent-red)')
        : 'var(--text-muted)';
      const spreadLabel = spreadPct !== null
        ? (spreadPct < 0.5 ? 'Tight' : spreadPct < 2 ? 'Moderate' : 'Wide') : 'N/A';
      spreadEl.innerHTML = '<div style="display:flex;gap:24px;flex-wrap:wrap;justify-content:center;padding:4px 0">' +
        '<div class="spread-stat"><div class="label">Best Bid</div><div class="value" style="color:var(--accent-green)">' + (ob.best_bid ? formatPrice(ob.best_bid) : '--') + '</div></div>' +
        '<div class="spread-stat"><div class="label">Best Ask</div><div class="value" style="color:var(--accent-red)">' + (ob.best_ask ? formatPrice(ob.best_ask) : '--') + '</div></div>' +
        '<div class="spread-stat"><div class="label">Spread</div><div class="value" style="color:' + spreadColor + '">' + (spread !== null ? formatPrice(spread) : '--') + '</div></div>' +
        '<div class="spread-stat"><div class="label">Spread %</div><div class="value" style="color:' + spreadColor + '">' + (spreadPct !== null ? spreadPct.toFixed(3) + '%' : '--') + '</div></div>' +
        '<div class="spread-stat"><div class="label">Mid Price</div><div class="value neutral">' + (mid !== null ? formatPrice(mid) : '--') + '</div></div>' +
        '<div class="spread-stat"><div class="label">Liquidity</div><div class="value" style="color:' + spreadColor + '">' + spreadLabel + '</div></div></div>';
    }
  } catch (err) { console.error('Order book error:', err); }
}


// ========== PRICE CHART VIEW ==========
async function renderCharts() {
  const container = document.getElementById('view-charts');
  container.innerHTML = skeleton(4);
  try {
    if (!state.instruments || state.instruments.length === 0) await fetchInstruments();
    if (!state.instruments || state.instruments.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No instruments available</p></div>';
      return;
    }
    if (!selectedChartInstrumentId) selectedChartInstrumentId = state.instruments[0].id;
    container.innerHTML = buildInstrumentSelector(selectedChartInstrumentId, 'charts') +
      '<div id="chartOHLC" class="card"></div>' +
      '<div id="chartArea" class="card"><div class="loading">Loading chart data...</div></div>';
    await renderChartContent(selectedChartInstrumentId);
  } catch (err) {
    container.innerHTML = '<div class="error-state"><p>Error: ' + escapeHtml(err.message) + '</p></div>';
  }
}

async function renderChartContent(instrumentId) {
  try {
    const trades = await fetchPriceData(instrumentId);
    const ohlc = calcOHLC(trades);
    const ohlcEl = document.getElementById('chartOHLC');
    if (ohlcEl) {
      if (!ohlc) { ohlcEl.innerHTML = '<div class="empty-state"><p>No trade data yet to chart</p></div>'; }
      else {
        ohlcEl.innerHTML = '<div style="display:flex;gap:20px;flex-wrap:wrap;justify-content:center">' +
          '<div class="spread-stat"><div class="label">Open</div><div class="value neutral">' + formatPrice(ohlc.open) + '</div></div>' +
          '<div class="spread-stat"><div class="label">High</div><div class="value" style="color:var(--accent-green)">' + formatPrice(ohlc.high) + '</div></div>' +
          '<div class="spread-stat"><div class="label">Low</div><div class="value" style="color:var(--accent-red)">' + formatPrice(ohlc.low) + '</div></div>' +
          '<div class="spread-stat"><div class="label">Close</div><div class="value neutral">' + formatPrice(ohlc.close) + '</div></div>' +
          '<div class="spread-stat"><div class="label">Volume</div><div class="value neutral">' + safeNum(ohlc.volume) + ' PPUs</div></div>' +
          '<div class="spread-stat"><div class="label">Trades</div><div class="value neutral">' + trades.length + '</div></div></div>';
      }
    }
    const chartEl = document.getElementById('chartArea');
    if (!chartEl) return;
    if (trades.length < 2) {
      chartEl.innerHTML = '<div class="empty-state"><p>Need at least 2 trades to draw a chart</p></div>';
      return;
    }
    const W = 900, H = 400, PAD = {top: 30, right: 30, bottom: 60, left: 70};
    const prices = trades.map(t => Number(t.price));
    const volumes = trades.map(t => Number(t.quantity || 0));
    const minPrice = Math.min(...prices) * 0.995;
    const maxPrice = Math.max(...prices) * 1.005;
    const maxVol = Math.max(...volumes, 1);
    const cw = W - PAD.left - PAD.right;
    const priceH = H - PAD.top - PAD.bottom - 40;
    const volH = 60;

    function xPos(i) { return PAD.left + (i / (trades.length - 1)) * cw; }
    function yPrice(p) { return PAD.top + priceH - ((p - minPrice) / (maxPrice - minPrice)) * priceH; }
    function yVol(v) { return PAD.top + priceH + 10 + volH - ((v / maxVol) * volH); }

    let svg = '<svg width="100%" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" style="font-family:Consolas,monospace;font-size:11px">';
    const gridLines = 6;
    for (let i = 0; i <= gridLines; i++) {
      const p = minPrice + (maxPrice - minPrice) * (1 - i / gridLines);
      const y = yPrice(p);
      svg += '<line x1="' + PAD.left + '" y1="' + y + '" x2="' + (W - PAD.right) + '" y2="' + y + '" stroke="#1e2d45" stroke-width="1"/>';
      svg += '<text x="' + (PAD.left - 8) + '" y="' + (y + 4) + '" text-anchor="end" fill="#64748b">' + p.toFixed(2) + '</text>';
    }
    let lineD = '';
    for (let i = 0; i < trades.length; i++) {
      const x = xPos(i);
      const y = yPrice(prices[i]);
      lineD += (i === 0 ? 'M' : ' L') + x + ',' + y;
    }
    svg += '<path d="' + lineD + '" stroke="#58a6ff" stroke-width="2" fill="none"/>';
    svg += '<path d="' + lineD + ' L' + xPos(trades.length - 1) + ',' + (PAD.top + priceH) + ' L' + xPos(0) + ',' + (PAD.top + priceH) + ' Z" fill="url(#priceGrad)" opacity="0.2"/>';
    svg += '<defs><linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#58a6ff"/><stop offset="100%" stop-color="#58a6ff" stop-opacity="0"/></linearGradient></defs>';
    for (let i = 0; i < trades.length; i++) {
      const x = xPos(i);
      const bw = Math.max(2, cw / trades.length - 1);
      const y1 = yVol(volumes[i]);
      const y2 = PAD.top + priceH + 10 + volH;
      svg += '<rect x="' + (x - bw/2) + '" y="' + y1 + '" width="' + bw + '" height="' + (y2 - y1) + '" fill="#58a6ff" opacity="0.4" rx="1"/>';
    }
    const labelCount = Math.min(6, trades.length);
    for (let i = 0; i < labelCount; i++) {
      const idx = Math.floor(i * (trades.length - 1) / (labelCount - 1));
      const x = xPos(idx);
      const t = new Date(trades[idx].created_at);
      const label = t.toLocaleDateString() + ' ' + t.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
      svg += '<text x="' + x + '" y="' + (H - 10) + '" text-anchor="middle" fill="#64748b" transform="rotate(-20,' + x + ',' + (H - 10) + ')">' + label + '</text>';
    }
    const instr = state.instruments.find(i => i.id === instrumentId);
    svg += '<text x="' + (W/2) + '" y="18" text-anchor="middle" fill="#94a3b8" font-size="13" font-family="sans-serif">Price Action</text>';
    svg += '</svg>';
    chartEl.innerHTML = '<h3 style="margin-bottom:8px;font-size:14px;color:var(--text-secondary)">Price History (' + trades.length + ' trades)</h3>' + svg;
  } catch (err) {
    const chartEl = document.getElementById('chartArea');
    if (chartEl) chartEl.innerHTML = '<div class="error-state"><p>Chart error: ' + escapeHtml(err.message) + '</p></div>';
  }
}


// ========== COMPANIES VIEW ==========
let companiesTab = 'list';
let selectedCompanyId = null;

async function renderCompanies() {
  const container = document.getElementById('view-companies');
  container.innerHTML = skeleton(4);
  try {
    const companies = await apiGetCompanies();
    state.companies = companies;
    container.innerHTML = '<div class="tab-bar">' +
      '<button class="tab-btn ' + (companiesTab === 'list' ? 'active' : '') + '" onclick="switchCompaniesTab(&#39;list&#39;)">All Companies</button>' +
      (selectedCompanyId ? '<button class="tab-btn active" style="color:var(--accent-amber)">Company #' + selectedCompanyId + '</button>' : '') +
      '<button style="margin-left:auto" class="btn btn-sm btn-success" onclick="showCreateCompanyModal()">+ New Company</button></div>' +
      '<div id="companies-content"></div>';
    renderCompaniesTab(companiesTab);
  } catch (err) {
    container.innerHTML = '<div class="error-state"><p>Error: ' + escapeHtml(err.message) + '</p></div>';
  }
}

function switchCompaniesTab(tab) {
  companiesTab = tab;
  renderCompaniesTab(tab);
}

async function renderCompaniesTab(tab) {
  const el = document.getElementById('companies-content');
  if (!el) return;
  el.innerHTML = '<div class="loading">Loading</div>';
  try {
    if (tab === 'list') {
      const companies = state.companies || [];
      el.innerHTML = '<div class="card"><div class="card-header"><h3>All Companies (' + companies.length + ')</h3>' +
        '<button class="btn btn-sm btn-primary" onclick="renderCompanies()">Refresh</button></div>' +
        (companies.length === 0 ? '<div class="empty-state"><p>No companies registered yet</p></div>'
          : renderTable(['ID', 'Name', 'Industry', 'Country', 'Float %', 'Series', 'Status', 'KYC', 'Created', 'Actions'], companies, function(c) {
              return [
                '<span class="clickable" onclick="showCompanyDetail(' + c.id + ')">' + c.id + '</span>',
                escapeHtml(c.name),
                escapeHtml(c.industry || '-'),
                c.country || '-',
                c.total_float_pct + '%',
                c.series_count || 0,
                '<span class="badge badge-' + c.status + '">' + c.status + '</span>',
                '<span class="badge badge-' + c.kyc_status + '">' + c.kyc_status + '</span>',
                formatDate(c.created_at),
                '<button class="btn btn-sm btn-outline" onclick="showCompanyDetail(' + c.id + ')">View</button>'
              ];
            })) + '</div>';
    } else if (tab === 'detail' && selectedCompanyId) {
      await renderCompanyDetail(selectedCompanyId);
    }
  } catch (err) {
    el.innerHTML = '<div class="error-state"><p>Error: ' + escapeHtml(err.message) + '</p></div>';
  }
}

function showCreateCompanyModal() {
  openModal('<h2>Register New Company</h2>' +
    '<form onsubmit="submitCreateCompany(event)">' +
    '<div class="form-row"><div class="form-group"><label>Company Name *</label><input type="text" id="compName" required placeholder="e.g. SomaliAgri Ltd"></div>' +
    '<div class="form-group"><label>Industry</label><input type="text" id="compIndustry" placeholder="e.g. Agriculture"></div></div>' +
    '<div class="form-group"><label>Description</label><textarea id="compDesc" rows="3" placeholder="Brief company description"></textarea></div>' +
    '<div class="form-row"><div class="form-group"><label>Country</label><input type="text" id="compCountry" placeholder="e.g. Somalia"></div>' +
    '<div class="form-group"><label>Founder(s)</label><input type="text" id="compFounders" placeholder="Founder names"></div></div>' +
    '<div class="form-row"><div class="form-group"><label>Profit Participation Float % *</label><input type="number" id="compFloatPct" value="25" min="1" max="99" required></div>' +
    '<div class="form-group"><label>Founder Retained %</label><input type="number" id="compRetainedPct" value="75" min="1" max="99"></div></div>' +
    '<p class="form-hint">Float % + Retained % should equal 100. This is permanent.</p>' +
    '<div class="modal-footer"><button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>' +
    '<button type="submit" class="btn btn-success">Create Company</button></div></form>');
}

async function submitCreateCompany(event) {
  event.preventDefault();
  const name = document.getElementById('compName').value.trim();
  const desc = document.getElementById('compDesc').value.trim();
  const industry = document.getElementById('compIndustry').value.trim();
  const country = document.getElementById('compCountry').value.trim();
  const founders = document.getElementById('compFounders').value.trim();
  const floatPct = parseFloat(document.getElementById('compFloatPct').value) || 25;
  const retainedPct = parseFloat(document.getElementById('compRetainedPct').value) || 75;
  if (floatPct + retainedPct > 100) { showToast('Float % + Retained % cannot exceed 100', 'error'); return; }
  try {
    const result = await apiCreateCompany(name, desc, industry, country, founders, floatPct, retainedPct);
    showToast('Company created: ' + result.name, 'success');
    closeModal();
    renderCompanies();
  } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

async function showCompanyDetail(companyId) {
  selectedCompanyId = companyId;
  companiesTab = 'detail';
  renderCompaniesTab('detail');
}

async function renderCompanyDetail(companyId) {
  const el = document.getElementById('companies-content');
  if (!el) return;
  el.innerHTML = '<div class="loading">Loading company details</div>';
  try {
    const company = await apiGetCompany(companyId);
    const series = company.series || [];
    el.innerHTML = '<div class="card"><div class="card-header"><div><h2>' + escapeHtml(company.name) + '</h2>' +
      '<span class="subtitle">ID: ' + company.id + (company.industry ? ' &middot; ' + escapeHtml(company.industry) : '') + '</span></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap"><span class="badge badge-' + company.status + '">' + company.status + '</span>' +
      '<span class="badge badge-' + company.kyc_status + '">KYC: ' + company.kyc_status + '</span></div></div></div>' +
      '<div class="card-row" style="margin-bottom:16px">' +
      '<div class="card-stat"><div class="label">Profit Float</div><div class="value neutral">' + company.total_float_pct + '%</div></div>' +
      '<div class="card-stat"><div class="label">Founder Retained</div><div class="value neutral">' + company.retained_pct + '%</div></div>' +
      '<div class="card-stat"><div class="label">Country</div><div class="value neutral">' + (company.country || '-') + '</div></div>' +
      '<div class="card-stat"><div class="label">Founder(s)</div><div class="value neutral">' + escapeHtml(company.founder_names || '-') + '</div></div>' +
      '<div class="card-stat"><div class="label">Total Float</div><div class="value neutral">' + safeNum(company.total_float) + '</div></div>' +
      '<div class="card-stat"><div class="label">Created By</div><div class="value neutral">' + escapeHtml(company.created_by_name || '') + '</div></div></div>' +
      (company.description ? '<div class="card"><p style="color:var(--text-secondary)">' + escapeHtml(company.description) + '</p></div>' : '') +
      '<div class="card"><div class="card-header"><h3>Issuance Series (' + series.length + ')</h3>' +
      '<button class="btn btn-sm btn-success" onclick="showCreateSeriesModal(' + company.id + ')">+ New Series</button></div>' +
      (series.length === 0 ? '<div class="empty-state"><p>No issuance series yet.</p></div>'
        : renderTable(['ID', 'Series', 'Name', 'Float', 'Raise Target', 'Price/PPU', 'Status', 'Created'], series, function(s) {
            return [s.id, s.series_label || '-', escapeHtml(s.name), safeNum(s.total_float),
              s.raise_target ? safeCurrency(s.raise_target) : '-',
              s.price_per_ppu ? safeCurrency(s.price_per_ppu) : '-',
              '<span class="badge badge-' + s.status + '">' + s.status + '</span>', formatDate(s.created_at)];
          })) + '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="btn btn-sm btn-amber" onclick="updateCompanyStatus(' + company.id + ',\'active\')">Set Active</button>' +
      '<button class="btn btn-sm btn-outline" onclick="updateCompanyStatus(' + company.id + ',\'suspended\')">Suspend</button>' +
      '<button class="btn btn-sm btn-success" onclick="updateCompanyKyc(' + company.id + ',\'verified\')">Verify KYC</button>' +
      '<button class="btn btn-sm btn-danger" onclick="updateCompanyKyc(' + company.id + ',\'rejected\')">Reject KYC</button>' +
      '<button class="btn btn-sm btn-outline" onclick="selectedCompanyId=null;switchCompaniesTab(\'list\')">Back to List</button></div>';
  } catch (err) {
    el.innerHTML = '<div class="error-state"><p>Error: ' + escapeHtml(err.message) + '</p></div>';
  }
}

async function updateCompanyStatus(companyId, newStatus) {
  try { await apiUpdateCompanyStatus(companyId, newStatus); showToast('Company status updated', 'success'); renderCompanyDetail(companyId); }
  catch (err) { showToast('Error: ' + err.message, 'error'); }
}

async function updateCompanyKyc(companyId, kycStatus) {
  try { await apiUpdateCompanyKyc(companyId, kycStatus); showToast('KYC status updated', 'success'); renderCompanyDetail(companyId); }
  catch (err) { showToast('Error: ' + err.message, 'error'); }
}

function showCreateSeriesModal(companyId) {
  openModal('<h2>Create Issuance Series</h2>' +
    '<form onsubmit="submitCreateSeries(event, ' + companyId + ')">' +
    '<div class="form-row"><div class="form-group"><label>Series Label *</label><input type="text" id="seriesLabel" required placeholder="e.g. Series A"></div>' +
    '<div class="form-group"><label>Instrument Name *</label><input type="text" id="seriesName" required placeholder="e.g. SomaliAgri PPU"></div></div>' +
    '<div class="form-group"><label>Description</label><textarea id="seriesDesc" rows="2" placeholder="Use of proceeds, terms..."></textarea></div>' +
    '<div class="form-row"><div class="form-group"><label>Total Float (PPU units) *</label><input type="number" id="seriesFloat" step="1" min="1" required placeholder="e.g. 10000"></div>' +
    '<div class="form-group"><label>Raise Target ($)</label><input type="number" id="seriesTarget" step="0.01" min="0" placeholder="Total capital to raise"></div></div>' +
    '<div class="form-row"><div class="form-group"><label>Price per PPU ($)</label><input type="number" id="seriesPrice" step="0.01" min="0.01" placeholder="Optional issuance price"></div></div>' +
    '<div class="modal-footer"><button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>' +
    '<button type="submit" class="btn btn-success">Create Series</button></div></form>');
}

async function submitCreateSeries(event, companyId) {
  event.preventDefault();
  const label = document.getElementById('seriesLabel').value.trim();
  const name = document.getElementById('seriesName').value.trim();
  const desc = document.getElementById('seriesDesc').value.trim();
  const float = parseFloat(document.getElementById('seriesFloat').value) || 0;
  const target = parseFloat(document.getElementById('seriesTarget').value) || 0;
  const price = parseFloat(document.getElementById('seriesPrice').value) || null;
  try {
    const result = await apiCallBody('POST', '/api/admin/instruments', {
      name: name, description: desc, total_float: float,
      company_id: companyId, series_label: label, raise_target: target, price_per_ppu: price
    });
    showToast('Series created: ' + result.name, 'success');
    closeModal();
    renderCompanyDetail(companyId);
  } catch (err) { showToast('Error: ' + err.message, 'error'); }
}



// ========== INIT ==========
function initApp() {
  // Hide auth, show app
  document.getElementById('authContainer').style.display = 'none';
  document.getElementById('appShell').style.display = 'flex';

  // Set sidebar user
  document.getElementById('sidebarUser').textContent = `${state.username} (${state.role})`;

  // Navigate to dashboard

  // Session keep-alive: ping every 15 min
  if (window._keepAlive) clearInterval(window._keepAlive);
  window._keepAlive = setInterval(() => {
    apiCallAuth("GET", "/api/health").catch(() => {});
  }, 900000);
  navigateTo('dashboard');
}

function toggleSettings() {
  let p = document.getElementById('settingsPanel');
  if (p) { p.classList.toggle('open'); return; }
  p = document.createElement('div');
  p.id = 'settingsPanel';
  p.className = 'settings-panel';
  const t = localStorage.getItem('ui_theme') || 'dark';
  const sb = localStorage.getItem('ui_sidebar') || 'default';
  p.innerHTML = '<h2>UI Settings <button class="settings-btn" style="float:right" onclick="this.closest(\'#settingsPanel\').classList.toggle(\'open\')">&#10005;</button></h2>' +
    '<div class="setting-group"><label>Theme</label><select onchange="setTheme(this.value)">' +
    '<option value="dark"' + (t==='dark'?' selected':'') + '>Dark</option>' +
    '<option value="light"' + (t==='light'?' selected':'') + '>Light</option></select></div>' +
    '<div class="setting-group"><label>Sidebar</label><select onchange="setSidebar(this.value)">' +
    '<option value="default"' + (sb==='default'?' selected':'') + '>Default</option>' +
    '<option value="compact"' + (sb==='compact'?' selected':'') + '>Compact</option></select></div>';
  document.body.appendChild(p);
  setTimeout(() => p.classList.add('open'), 10);
}

function setTheme(t) {
  localStorage.setItem('ui_theme', t);
  document.documentElement.setAttribute('data-theme', t);
  showToast('Theme set to ' + t, 'info');
}

function setSidebar(s) {
  localStorage.setItem('ui_sidebar', s);
  document.documentElement.setAttribute('data-sidebar', s);
  showToast('Sidebar set to ' + s, 'info');
}

// Apply saved settings on load
(function() {
  const t = localStorage.getItem('ui_theme') || 'dark';
  const s = localStorage.getItem('ui_sidebar') || 'default';
  document.documentElement.setAttribute('data-theme', t);
  document.documentElement.setAttribute('data-sidebar', s);
})();

// ========== BOOTSTRAP ==========
(function() {
  if (state.token && state.role === 'admin') {
    // Try to validate token by navigating to dashboard
    initApp();
  } else {
    showAuthScreen();
  }
})();



// ========== AUDIT LOG VIEW ==========
async function apiGetAuditLog(limit = 100) {
  return apiCallAuth('GET', '/api/db/table/audit_log?human=1&limit=' + limit);
}

async function renderAuditLog() {
  const container = document.getElementById('view-auditlog');
  container.innerHTML = skeleton(4);
  try {
    const entries = await apiGetAuditLog(200);
    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Admin Audit Trail (${entries.length} entries)</h3>
          <button class="btn btn-sm btn-primary" onclick="renderAuditLog()">Refresh</button>
        </div>
        ${entries.length === 0
          ? '<div class="empty-state"><p>No audit entries yet</p></div>'
          : renderTable(['ID', 'Admin', 'Action', 'Target', 'Details', 'IP', 'Time'], entries, e => [
              e.id,
              e.admin_id_name || e.admin_id || '-',
              '<span class="badge badge-active">' + escapeHtml(e.action) + '</span>',
              (e.target_type || '') + ' #' + (e.target_id || ''),
              escapeHtml((e.details || '').substring(0, 60)),
              e.ip_address || '-',
              formatTime(e.created_at)
            ])}
      </div>
    `;
  } catch (err) {
    container.innerHTML = '<div class="error-state"><p>Error: ' + escapeHtml(err.message) + '</p></div>';
  }
}



// ========== COMPLIANCE DASHBOARD ==========
async function renderCompliance() {
  const container = document.getElementById('view-compliance');
  container.innerHTML = skeleton(4);
  try {
    const [kycPending, alerts, sanctions] = await Promise.all([
      apiCallAuth('GET', '/api/admin/kyc/pending'),
      apiCallAuth('GET', '/api/admin/compliance/alerts?status=open'),
      apiCallAuth('GET', '/api/admin/sanctions/hits?status=open'),
    ]);
    
    container.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px">
        <div class="card" style="text-align:center;padding:16px;border-left:4px solid var(--accent-amber)">
          <div style="font-size:28px;font-weight:700">${kycPending.length}</div>
          <div style="font-size:12px;color:var(--text-muted);text-transform:uppercase">Pending KYC</div>
        </div>
        <div class="card" style="text-align:center;padding:16px;border-left:4px solid var(--accent-red)">
          <div style="font-size:28px;font-weight:700">${alerts.length}</div>
          <div style="font-size:12px;color:var(--text-muted);text-transform:uppercase">Open Alerts</div>
        </div>
        <div class="card" style="text-align:center;padding:16px;border-left:4px solid var(--accent-purple)">
          <div style="font-size:28px;font-weight:700">${sanctions.length}</div>
          <div style="font-size:12px;color:var(--text-muted);text-transform:uppercase">Sanctions Hits</div>
        </div>
      </div>

      <div class="tab-bar">
        <button class="tab-btn active" onclick="switchComplianceTab('kyc')">KYC Review (${kycPending.length})</button>
        <button class="tab-btn" onclick="switchComplianceTab('alerts')">Alerts (${alerts.length})</button>
        <button class="tab-btn" onclick="switchComplianceTab('sanctions')">Sanctions (${sanctions.length})</button>
      </div>
      <div id="complianceContent"></div>
    `;
    
    renderKycQueue(kycPending);
  } catch (err) {
    container.innerHTML = '<div class="error-state"><p>Error: ' + escapeHtml(err.message) + '</p></div>';
  }
}

let compTab = 'kyc';

function switchComplianceTab(tab) {
  compTab = tab;
  document.querySelectorAll('#view-compliance .tab-btn').forEach(b => b.classList.remove('active'));
  const btns = document.querySelectorAll('#view-compliance .tab-btn');
  const idx = tab === 'kyc' ? 0 : tab === 'alerts' ? 1 : 2;
  if (btns[idx]) btns[idx].classList.add('active');
  
  if (tab === 'kyc') renderKycQueue();
  else if (tab === 'alerts') renderAlertList();
  else if (tab === 'sanctions') renderSanctionsList();
}

async function renderKycQueue(data) {
  const el = document.getElementById('complianceContent');
  if (!el) return;
  const items = data || await apiCallAuth('GET', '/api/admin/kyc/pending');
  
  if (items.length === 0) {
    el.innerHTML = emptyState('&#10003;', 'No pending KYC reviews');
    return;
  }
  
  el.innerHTML = `
    <div class="card">
      <div class="card-header"><h3>Pending KYC Submissions (${items.length})</h3></div>
      ${items.map(k => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid var(--border)">
          <div>
            <div style="font-weight:600">${escapeHtml(k.full_name || k.username)}</div>
            <div style="font-size:12px;color:var(--text-muted)">@${k.username} &middot; ${k.nationality || 'N/A'} &middot; ${k.document_type}</div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-sm btn-success" onclick="approveKyc(${k.user_id})">Verify</button>
            <button class="btn btn-sm btn-danger" onclick="rejectKyc(${k.user_id})">Reject</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

async function approveKyc(userId) {
  try {
    await apiCallAuth('PUT', '/api/admin/kyc/' + userId + '/verify?action=verified');
    showToast('KYC verified for user ' + userId, 'success');
    renderKycQueue();
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

async function rejectKyc(userId) {
  try {
    await apiCallAuth('PUT', '/api/admin/kyc/' + userId + '/verify?action=rejected');
    showToast('KYC rejected for user ' + userId, 'info');
    renderKycQueue();
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

async function renderAlertList() {
  const el = document.getElementById('complianceContent');
  if (!el) return;
  el.innerHTML = '<div class="loading">Loading alerts</div>';
  try {
    const alerts = await apiCallAuth('GET', '/api/admin/compliance/alerts?status=open');
    if (alerts.length === 0) {
      el.innerHTML = emptyState('&#10003;', 'No open alerts');
      return;
    }
    el.innerHTML = renderTable(['ID', 'Type', 'User', 'Severity', 'Description', 'Time', 'Actions'], alerts, a => [
      a.id,
      '<span class="badge badge-' + a.alert_type + '">' + a.alert_type.replace('_',' ') + '</span>',
      a.username || '#' + a.user_id,
      '<span class="badge badge-' + a.severity + '">' + a.severity + '</span>',
      escapeHtml((a.description || '').substring(0, 50)),
      formatTime(a.created_at),
      '<button class="btn btn-sm btn-outline" onclick="dismissAlert(' + a.id + ')">Dismiss</button>'
    ]);
  } catch(e) { el.innerHTML = '<div class="error-state"><p>' + escapeHtml(e.message) + '</p></div>'; }
}

async function dismissAlert(alertId) {
  try {
    await apiCallAuth('POST', '/api/admin/compliance/clear-alert?alert_id=' + alertId);
    showToast('Alert dismissed', 'success');
    renderAlertList();
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

async function renderSanctionsList() {
  const el = document.getElementById('complianceContent');
  if (!el) return;
  el.innerHTML = '<div class="loading">Loading sanctions hits</div>';
  try {
    const hits = await apiCallAuth('GET', '/api/admin/sanctions/hits?status=open');
    if (hits.length === 0) {
      el.innerHTML = emptyState('&#10003;', 'No sanctions hits');
      return;
    }
    el.innerHTML = renderTable(['ID', 'User', 'Matched Name', 'List', 'Severity', 'Time', 'Actions'], hits, h => [
      h.id,
      h.username || '#' + h.user_id,
      escapeHtml(h.matched_name),
      h.list_name,
      '<span class="badge badge-' + h.severity + '">' + h.severity + '</span>',
      formatTime(h.created_at),
      '<button class="btn btn-sm btn-success" onclick="resolveSanctionsHit(' + h.id + ')">FP</button>'
    ]);
  } catch(e) { el.innerHTML = '<div class="error-state"><p>' + escapeHtml(e.message) + '</p></div>'; }
}

async function resolveSanctionsHit(hitId) {
  try {
    await apiCallAuth('POST', '/api/admin/sanctions/resolve?hit_id=' + hitId + '&resolution=false_positive');
    showToast('Hit resolved', 'success');
    renderSanctionsList();
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

// ========== PPU MATH CALCULATOR ==========
// All formulas hard-coded — works client-side, no API needed for basic math

function renderPpuMath() {
  const container = document.getElementById('view-ppumath');
  
  container.innerHTML = `
    <div class="card" style="border-left:4px solid var(--accent-amber)">
      <div style="text-align:center;padding:8px 0">
        <h2 style="font-size:22px;color:var(--accent-amber);font-family:var(--font-mono)">D = f &times; &Pi; / N</h2>
        <p style="color:var(--text-muted);font-size:13px;margin-top:4px">
          Distribution per PPU = Float Ratio &times; Distributable Profit / Outstanding PPUs
        </p>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="card">
        <h3 style="margin-bottom:12px;font-size:14px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px">Inputs</h3>
        <div class="form-group">
          <label>Net Profit ($)</label>
          <input type="number" id="ppuNetProfit" value="1000000" step="10000" min="0" oninput="calcPpuMath()">
        </div>
        <div class="form-group">
          <label>Tax ($)</label>
          <input type="number" id="ppuTax" value="0" step="1000" min="0" oninput="calcPpuMath()">
        </div>
        <div class="form-group">
          <label>PPU Float % (f)</label>
          <input type="number" id="ppuFloatPct" value="25" step="1" min="1" max="100" oninput="calcPpuMath()">
        </div>
        <div class="form-group">
          <label>Outstanding PPUs (N)</label>
          <input type="number" id="ppuOutstanding" value="1000000" step="10000" min="1" oninput="calcPpuMath()">
        </div>
        <div class="form-group">
          <label>Your PPU Holdings (optional)</label>
          <input type="number" id="ppuHoldings" value="50000" step="100" min="0" oninput="calcPpuMath()">
        </div>
        <div class="form-group">
          <label>Required Yield %</label>
          <input type="number" id="ppuYield" value="10" step="0.5" min="0.1" oninput="calcPpuMath()">
        </div>
      </div>

      <div class="card">
        <h3 style="margin-bottom:12px;font-size:14px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px">Quick Reference</h3>
        <div id="ppuQuickRef">
          <div style="text-align:center;padding:10px;color:var(--text-muted)">Adjust inputs to see live results</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-bottom:12px;font-size:14px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px">Step-by-Step Math</h3>
      <div id="ppuSteps"></div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="card">
        <h3 style="margin-bottom:12px;font-size:14px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px">Dilution Simulator</h3>
        <div class="form-group">
          <label>New PPUs to Issue</label>
          <input type="number" id="ppuNewIssuance" value="0" step="10000" min="0" oninput="calcPpuMath()">
        </div>
        <div id="ppuDilution" style="margin-top:8px"></div>
      </div>

      <div class="card">
        <h3 style="margin-bottom:12px;font-size:14px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px">Growth Scenario</h3>
        <div class="form-group">
          <label>Profit Multiple</label>
          <input type="number" id="ppuGrowthMultiplier" value="2" step="0.5" min="1" oninput="calcPpuMath()">
        </div>
        <div id="ppuGrowth" style="margin-top:8px"></div>
      </div>
    </div>
  `;

  calcPpuMath();
}

// ========== CORE MATH ENGINE (all hard-coded) ==========
function calcPpuMath() {
  const netProfit = parseFloat(document.getElementById('ppuNetProfit')?.value) || 0;
  const tax = parseFloat(document.getElementById('ppuTax')?.value) || 0;
  const floatPct = parseFloat(document.getElementById('ppuFloatPct')?.value) || 25;
  const outstanding = parseFloat(document.getElementById('ppuOutstanding')?.value) || 1;
  const holdings = parseFloat(document.getElementById('ppuHoldings')?.value) || 0;
  const yieldPct = parseFloat(document.getElementById('ppuYield')?.value) || 10;
  const newIssuance = parseFloat(document.getElementById('ppuNewIssuance')?.value) || 0;
  const growthMult = parseFloat(document.getElementById('ppuGrowthMultiplier')?.value) || 1;

  if (netProfit <= 0 || outstanding <= 0) return;

  // === STEP 1: Distributable Profit ===
  const Pi = netProfit - tax;
  // === STEP 2: Float Ratio ===
  const f = floatPct / 100;
  // === STEP 3: PPU Pool ===
  const P = f * Pi;
  // === STEP 4: Per-Unit Distribution ===
  const D = P / outstanding;
  // === STEP 5: Investor Cashflow ===
  const CF = D * holdings;
  // === STEP 6: Valuation ===
  const yieldDecimal = yieldPct / 100;
  const price = yieldDecimal > 0 ? D / yieldDecimal : 0;
  
  // === DILUTION ===
  const newTotal = outstanding + newIssuance;
  const D_diluted = newTotal > 0 ? P / newTotal : D;
  const CF_diluted = D_diluted * holdings;
  const price_diluted = yieldDecimal > 0 ? D_diluted / yieldDecimal : 0;
  const dilutionPct = newIssuance > 0 ? ((D - D_diluted) / D * 100) : 0;

  // === GROWTH ===
  const Pi_growth = Pi * growthMult;
  const P_growth = f * Pi_growth;
  const D_growth = P_growth / outstanding;
  const price_growth = yieldDecimal > 0 ? D_growth / yieldDecimal : 0;

  // === RENDER RESULTS ===

  // Quick Reference
  document.getElementById('ppuQuickRef').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="card-stat"><div class="label">Per-Unit Distribution</div><div class="value neutral">${numfmt(D)}</div></div>
      <div class="card-stat"><div class="label">Implied Price (at ${yieldPct}% yield)</div><div class="value neutral">${numfmt(price)}</div></div>
      <div class="card-stat"><div class="label">PPU Pool Total</div><div class="value neutral">${numfmt(P)}</div></div>
      <div class="card-stat"><div class="label">Your Est. Cashflow</div><div class="value ${CF >= 0 ? 'positive' : 'negative'}">${holdings > 0 ? numfmt(CF) : '--'}</div></div>
    </div>
  `;

  // Step-by-step
  const steps = [
    { n: 1, label: 'Distributable Profit (\u03a0)', formula: '\u03a0 = Net Profit - Tax', calc: netProfit + ' - ' + tax, result: Pi },
    { n: 2, label: 'Float Ratio (f)', formula: 'f = Float% / 100', calc: floatPct + '% / 100', result: f },
    { n: 3, label: 'PPU Payout Pool (P)', formula: 'P = f \u00d7 \u03a0', calc: f + ' \u00d7 ' + Pi, result: P },
    { n: 4, label: 'Distribution Per Unit (D)', formula: 'D = P / N', calc: P + ' / ' + outstanding, result: D },
    { n: 5, label: 'Investor Cashflow (CF)', formula: 'CF = D \u00d7 Holdings', calc: D + ' \u00d7 ' + holdings, result: holdings > 0 ? CF : 'N/A' },
    { n: 6, label: 'Market Price', formula: 'Price = D / Yield', calc: D + ' / ' + yieldDecimal, result: price },
  ];

  document.getElementById('ppuSteps').innerHTML = `
    <table>
      <tr><th>Step</th><th>Label</th><th>Formula</th><th>Calculation</th><th style="text-align:right">Result</th></tr>
      ${steps.map(s => `
        <tr>
          <td>${s.n}</td>
          <td><strong>${s.label}</strong></td>
          <td style="font-family:var(--font-mono);font-size:12px;color:var(--text-secondary)">${s.formula}</td>
          <td style="font-family:var(--font-mono);font-size:12px;color:var(--text-muted)">${s.calc}</td>
          <td style="text-align:right;font-weight:700;font-family:var(--font-mono)">${typeof s.result === 'number' ? numfmt(s.result) : s.result}</td>
        </tr>
      `).join('')}
    </table>
    <div style="margin-top:12px;padding:12px;background:var(--bg-tertiary);border-radius:4px;text-align:center;font-size:13px;color:var(--text-secondary)">
      <strong>Core Formula:</strong> 
      <span style="font-family:var(--font-mono);color:var(--accent-amber);font-size:15px">
        D = ${numfmt(P)} / ${outstanding} = ${numfmt(D)}
      </span>
    </div>
  `;

  // Dilution
  document.getElementById('ppuDilution').innerHTML = newIssuance > 0 ? `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div class="card-stat"><div class="label">Current PPUs</div><div class="value neutral">${numfmt(outstanding)}</div></div>
      <div class="card-stat"><div class="label">New Total</div><div class="value neutral">${numfmt(newTotal)}</div></div>
      <div class="card-stat"><div class="label">Current D</div><div class="value positive">${numfmt(D)}</div></div>
      <div class="card-stat"><div class="label">Diluted D</div><div class="value" style="color:var(--accent-red)">${numfmt(D_diluted)}</div></div>
      <div class="card-stat"><div class="label">Dilution Impact</div><div class="value" style="color:var(--accent-red)">-${dilutionPct.toFixed(1)}%</div></div>
      <div class="card-stat"><div class="label">Price Change</div><div class="value" style="color:var(--accent-red)">${numfmt(price)} \u2192 ${numfmt(price_diluted)}</div></div>
    </div>
    <p style="margin-top:8px;font-size:12px;color:var(--text-muted);text-align:center">
      Issuing ${numfmt(newIssuance)} new PPUs dilutes per-unit payout by ${dilutionPct.toFixed(1)}%
    </p>
  ` : '<div class="empty-state"><p style="padding:8px">Enter new PPUs above to see dilution impact</p></div>';

  // Growth
  document.getElementById('ppuGrowth').innerHTML = growthMult > 1 ? `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div class="card-stat"><div class="label">Current \u03a0</div><div class="value neutral">${numfmt(Pi)}</div></div>
      <div class="card-stat"><div class="label">\u03a0 at \u00d7${growthMult}</div><div class="value positive">${numfmt(Pi_growth)}</div></div>
      <div class="card-stat"><div class="label">Current D</div><div class="value neutral">${numfmt(D)}</div></div>
      <div class="card-stat"><div class="label">D at \u00d7${growthMult}</div><div class="value positive">${numfmt(D_growth)}</div></div>
      <div class="card-stat"><div class="label">Current Price</div><div class="value neutral">${numfmt(price)}</div></div>
      <div class="card-stat"><div class="label">Price at \u00d7${growthMult}</div><div class="value positive">${numfmt(price_growth)}</div></div>
    </div>
    <p style="margin-top:8px;font-size:12px;color:var(--text-muted);text-align:center">
      If profit \u00d7${growthMult}, per-unit payout goes from ${numfmt(D)} \u2192 ${numfmt(D_growth)}
    </p>
  ` : '<div class="empty-state"><p style="padding:8px">Increase the multiplier above to see growth impact</p></div>';
}

function numfmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '--';
  if (Math.abs(n) >= 1000000) return '$' + (n / 1000000).toFixed(2) + 'M';
  if (Math.abs(n) >= 1000) return '$' + n.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
  if (Math.abs(n) < 0.01) return '$' + n.toFixed(4);
  return '$' + n.toFixed(2);
}
