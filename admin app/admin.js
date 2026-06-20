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
};

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

async function apiCallAuth(method, path, body = null) {
  if (!state.token) throw new Error('Not authenticated');
  const separator = path.includes('?') ? '&' : '?';
  const url = `${path}${separator}token=${encodeURIComponent(state.token)}`;
  return apiCall(method, url, body);
}

// Post with token in body (for endpoints that use request body pattern)
function apiCallBody(method, path, body = {}) {
  return apiCall(method, path, { token: state.token, ...body });
}

// ========== AUTH API ==========
async function apiRegister(username, password) {
  return apiCall('POST', '/api/auth/register', { username, password, role: 'admin' });
}

async function apiLogin(username, password) {
  return apiCall('POST', '/api/auth/login', { username, password });
}

// ========== DATA API FUNCTIONS ==========

// Dashboard
async function apiGetDashboardStats() {
  return apiCallAuth('GET', '/api/admin/dashboard/stats');
}

async function apiGetReconciliation() {
  return apiCallAuth('GET', '/api/reconcile');
}

async function apiGetRecentTrades(limit = 10) {
  return apiCallAuth('GET', `/api/trades?limit=${limit}`);
}

// Users
async function apiGetUsers() {
  return apiCallAuth('GET', '/api/admin/users');
}

async function apiSearchUsers(query) {
  return apiCallAuth('GET', `/api/admin/users/search?q=${encodeURIComponent(query)}`);
}

async function apiGetUserAccount(userId) {
  return apiCallAuth('GET', `/api/accounts/${userId}`);
}

async function apiGetUserOrders(userId) {
  return apiCallAuth('GET', `/api/orders/user/${userId}`);
}

async function apiGetUserLedger(userId) {
  return apiCallAuth('GET', `/api/ledger/${userId}`);
}

async function apiGetUserPnl(userId) {
  return apiCallAuth('GET', `/api/accounts/${userId}/pnl`);
}

async function apiGetUserTrades(userId) {
  return apiCallAuth('GET', `/api/trades?user_id=${userId}`);
}

async function apiCreditCash(userId, amount) {
  return apiCallBody('POST', '/api/admin/cash/credit', { user_id: userId, amount });
}

async function apiCreditPpu(userId, instrumentId, units) {
  return apiCallBody('POST', '/api/admin/ppu/credit', { user_id: userId, instrument_id: instrumentId, units });
}

async function apiChangeUserRole(userId, role) {
  return apiCallAuth('PUT', `/api/admin/users/${userId}/role?role=${role}`);
}

async function apiChangeUserStatus(userId, status) {
  return apiCallAuth('PUT', `/api/admin/users/${userId}/status?status=${status}`);
}

// Instruments
async function apiGetInstruments() {
  return apiCallAuth('GET', '/api/instruments');
}

async function apiCreateInstrument(name, description, totalFloat) {
  return apiCallBody('POST', '/api/admin/instruments', { name, description, total_float: totalFloat });
}

async function apiUpdateInstrumentStatus(instrumentId, status) {
  return apiCallAuth('PUT', `/api/admin/instruments/${instrumentId}?status=${status}`);
}

async function apiAdjustFloat(instrumentId, additionalFloat) {
  return apiCallAuth('POST', `/api/admin/instruments/${instrumentId}/adjust-float?additional_float=${additionalFloat}`);
}

async function apiGetInstrumentSummary(instrumentId) {
  return apiCallAuth('GET', `/api/instruments/${instrumentId}/summary`);
}

async function apiGetOrderBook(instrumentId) {
  return apiCallAuth('GET', `/api/orderbook/${instrumentId}`);
}

// Holdings
async function apiGetHoldings(instrumentId) {
  let path = '/api/admin/holdings';
  if (instrumentId) path += `?instrument_id=${instrumentId}`;
  return apiCallAuth('GET', path);
}

// Funding / Transactions
async function apiGetTransactions(type, userId) {
  let path = '/api/admin/transactions?limit=50';
  if (type) path += `&type=${type}`;
  if (userId) path += `&user_id=${userId}`;
  return apiCallAuth('GET', path);
}

// Orders
async function apiGetAllOrders(status, instrumentId) {
  let path = '/api/admin/orders';
  const params = [];
  if (status) params.push(`status=${encodeURIComponent(status)}`);
  if (instrumentId) params.push(`instrument_id=${instrumentId}`);
  if (params.length) path += '?' + params.join('&');
  return apiCallAuth('GET', path);
}

async function apiCancelOrder(orderId) {
  return apiCallAuth('POST', `/api/orders/cancel/${orderId}`);
}

async function apiForceCancelOrder(orderId) {
  return apiCallAuth('POST', `/api/admin/orders/force-cancel/${orderId}`);
}

// Trades
async function apiGetTrades(instrumentId, userId) {
  let path = '/api/trades?limit=100';
  if (instrumentId) path += `&instrument_id=${instrumentId}`;
  if (userId) path += `&user_id=${userId}`;
  return apiCallAuth('GET', path);
}

// Profit
async function apiDeclareProfit(instrumentId, periodLabel, totalProfit) {
  return apiCallBody('POST', '/api/profit/declare', { instrument_id: instrumentId, period_label: periodLabel, total_profit: totalProfit });
}

async function apiDistributeProfit(declarationId) {
  return apiCallAuth('POST', `/api/profit/distribute/${declarationId}`);
}

async function apiGetProfitHistory(instrumentId) {
  return apiCallAuth('GET', `/api/profit/history/${instrumentId}`);
}

// DB Explorer
async function apiGetDbTables() {
  return apiCallAuth('GET', '/api/db/tables');
}

async function apiGetDbTable(tableName, limit = 100) {
  return apiCallAuth('GET', `/api/db/table/${encodeURIComponent(tableName)}?human=1&limit=${limit}`);
}

async function apiGetDbSchema() {
  return apiCallAuth('GET', '/api/db/schema');
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
  // Update header title
  document.getElementById('viewTitle').textContent = VIEW_TITLES[view] || view;
  document.getElementById('headerActions').innerHTML = '';
  // Render
  renderView(view);
}

function renderView(view) {
  switch (view) {
    case 'dashboard': renderDashboard(); break;
    case 'users': renderUsers(); break;
    case 'instruments': renderInstruments(); break;
    case 'funding': renderFunding(); break;
    case 'orders': renderOrders(); break;
    case 'trades': renderTrades(); break;
    case 'profit': renderProfit(); break;
    case 'reconciliation': renderReconciliation(); break;
    case 'dbexplorer': renderDbExplorer(); break;
  }
}

// ========== VIEW RENDERERS ==========

// --- DASHBOARD ---
async function renderDashboard() {
  const container = document.getElementById('view-dashboard');
  container.innerHTML = '<div class="loading">Loading dashboard</div>';

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

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h2>System Overview</h2>
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
            <div class="value neutral">$${Number(stats.total_volume_today).toFixed(2)}</div>
          </div>
          <div class="card-stat">
            <div class="label">PPU Float</div>
            <div class="value neutral">${Number(stats.total_ppu_float).toFixed(2)}</div>
          </div>
          <div class="card-stat">
            <div class="label">Cash in Circulation</div>
            <div class="value neutral">$${Number(stats.cash_in_circulation).toFixed(2)}</div>
          </div>
          <div class="card-stat">
            <div class="label">All Balanced</div>
            <div class="value ${balCls}">${balIcon} ${stats.all_balanced ? 'YES' : 'NO'}</div>
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
            `$${Number(t.price).toFixed(2)}`,
            Number(t.quantity).toFixed(2),
            `$${Number(t.total_value).toFixed(2)}`,
            t.buyer_name || t.buyer_id,
            t.seller_name || t.seller_id,
            formatTime(t.created_at),
          ])}
      </div>
    `;

    // Auto-refresh every 30 seconds
    state.dashboardTimer = setInterval(() => renderDashboard(), 30000);

  } catch (err) {
    container.innerHTML = `<div class="error-state"><p>Error loading dashboard: ${escapeHtml(err.message)}</p><button class="btn btn-sm btn-outline" onclick="renderDashboard()">Retry</button></div>`;
  }
}

// --- USERS ---
let usersTab = 'list';
let selectedUserDetail = null;

async function renderUsers() {
  const container = document.getElementById('view-users');
  container.innerHTML = '<div class="loading">Loading users</div>';

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
            : renderTable(['ID', 'Username', 'Role', 'Status', 'Cash Balance', 'Holdings', 'Created', 'Actions'], users, u => [
              `<span class="clickable" onclick="showUserDetail(${u.id})">${u.id}</span>`,
              escapeHtml(u.username),
              `<span class="badge badge-${u.role}">${u.role}</span>`,
              `<span class="badge badge-${u.status || 'active'}">${u.status || 'active'}</span>`,
              `$${Number(u.cash_balance || 0).toFixed(2)}`,
              (u.ppu_holdings || []).map(h => `${h.instrument_name}: ${h.units}`).join('<br>') || '&mdash;',
              formatDate(u.created_at),
              `<button class="btn btn-sm btn-outline" onclick="showUserDetail(${u.id})">View</button>`,
            ])}
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
          <div class="value neutral">$${cashBal.toFixed(2)}</div>
        </div>
        <div class="card-stat">
          <div class="label">Realized P&L</div>
          <div class="value ${(pnl.total_realized_pnl || 0) >= 0 ? 'positive' : 'negative'}">${(pnl.total_realized_pnl || 0) >= 0 ? '+' : ''}$${Number(pnl.total_realized_pnl || 0).toFixed(2)}</div>
        </div>
        <div class="card-stat">
          <div class="label">Unrealized P&L</div>
          <div class="value ${(pnl.total_unrealized_pnl || 0) >= 0 ? 'positive' : 'negative'}">${(pnl.total_unrealized_pnl || 0) >= 0 ? '+' : ''}$${Number(pnl.total_unrealized_pnl || 0).toFixed(2)}</div>
        </div>
        <div class="card-stat">
          <div class="label">Total P&L</div>
          <div class="value ${(pnl.total_pnl || 0) >= 0 ? 'positive' : 'negative'}">${(pnl.total_pnl || 0) >= 0 ? '+' : ''}$${Number(pnl.total_pnl || 0).toFixed(2)}</div>
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
  container.innerHTML = '<div class="loading">Loading instruments</div>';

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
    <button class="modal-close" onclick="closeModal()">&times;</button>
    <h2>Create New Instrument (IPO)</h2>
    <form onsubmit="submitCreateInstrument(event)">
      <div class="form-group">
        <label>Name</label>
        <input type="text" id="newInstrName" placeholder="e.g. Tesla PPU" required>
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea id="newInstrDesc" placeholder="Optional description"></textarea>
      </div>
      <div class="form-group">
        <label>Total Float</label>
        <input type="number" id="newInstrFloat" step="0.01" min="0.01" placeholder="10000" required>
        <div class="form-hint">Total number of PPU units to be issued</div>
      </div>
      <button type="submit" class="btn btn-success" style="width:100%">Create Instrument</button>
    </form>
  `);
}

async function submitCreateInstrument(event) {
  event.preventDefault();
  const name = document.getElementById('newInstrName').value.trim();
  const description = document.getElementById('newInstrDesc').value.trim();
  const totalFloat = parseFloat(document.getElementById('newInstrFloat').value);
  if (!name) { showToast('Name is required', 'error'); return; }
  if (!totalFloat || totalFloat <= 0) { showToast('Total float must be positive', 'error'); return; }
  try {
    const result = await apiCreateInstrument(name, description, totalFloat);
    showToast(`Instrument "${name}" created! ID: ${result.instrument_id}`, 'success');
    closeModal();
    renderInstruments();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
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
  container.innerHTML = '<div class="loading">Loading funding console</div>';

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
  container.innerHTML = '<div class="loading">Loading orders</div>';

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
      : renderTable(['ID', 'User', 'Instrument', 'Side', 'Price', 'Qty', 'Filled', 'Status', 'Time', 'Actions'], orders, o => [
        o.id,
        o.username || `#${o.user_id}`,
        o.instrument_name || `#${o.instrument_id}`,
        `<span class="side-${o.side}">${o.side.toUpperCase()}</span>`,
        `$${Number(o.price).toFixed(2)}`,
        Number(o.quantity).toFixed(2),
        Number(o.filled_quantity || 0).toFixed(2),
        `<span class="badge badge-${o.status}">${o.status.replace('_', ' ')}</span>`,
        formatTime(o.created_at),
        `<div style="display:flex;gap:4px">
          ${(o.status === 'open' || o.status === 'partially_filled')
            ? `<button class="btn btn-sm btn-danger" onclick="adminCancelOrder(${o.id})">Cancel</button>`
            : ''}
          <button class="btn btn-sm btn-outline" onclick="adminForceCancelOrder(${o.id})">Force</button>
        </div>`,
      ]);
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
  container.innerHTML = '<div class="loading">Loading trades</div>';

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
      : renderTable(['ID', 'Instrument', 'Price', 'Qty', 'Total', 'Buyer', 'Seller', 'Time'], trades, t => [
        t.id,
        t.instrument_name || `#${t.instrument_id}`,
        `$${Number(t.price).toFixed(2)}`,
        Number(t.quantity).toFixed(2),
        `$${Number(t.total_value).toFixed(2)}`,
        t.buyer_name || t.buyer_id,
        t.seller_name || t.seller_id,
        formatTime(t.created_at),
      ]);
  } catch (err) {
    el.innerHTML = `<div class="error-state"><p>Error: ${escapeHtml(err.message)}</p></div>`;
  }
}

// --- PROFIT ---
async function renderProfit() {
  const container = document.getElementById('view-profit');
  container.innerHTML = '<div class="loading">Loading profit management</div>';

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
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px;font-family:var(--font-mono)">Total: $${Number(recon.cash_total || 0).toFixed(2)}</div>
          </div>

          <div class="card status-card ${recon.ppu_matches_float ? 'ok' : 'fail'}">
            <div class="status-icon">${recon.ppu_matches_float ? '&#10003;' : '&#10007;'}</div>
            <div class="status-label">PPU Matches Float</div>
            <div class="status-value">${recon.ppu_matches_float ? 'OK' : 'FAIL'}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px;font-family:var(--font-mono)">Total: ${Number(recon.ppu_total || 0).toFixed(2)}</div>
          </div>

          <div class="card status-card ${allOk ? 'ok' : 'fail'}">
            <div class="status-icon">${allOk ? '&#10003;' : '&#9888;'}</div>
            <div class="status-label">All Balanced</div>
            <div class="status-value">${allOk ? 'YES' : 'NO'}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px;font-family:var(--font-mono)">Float: ${Number(recon.instrument_float || 0).toFixed(2)}</div>
          </div>
        </div>

        <div class="recon-timestamp">Auto-refresh every 30 seconds</div>
      </div>
    `;

    // Auto-refresh
    state.dashboardTimer = setInterval(() => renderReconciliation(), 30000);

  } catch (err) {
    container.innerHTML = `<div class="error-state"><p>Error: ${escapeHtml(err.message)}</p><button class="btn btn-sm btn-outline" onclick="renderReconciliation()">Retry</button></div>`;
  }
}

// --- DB EXPLORER ---
let dbTable = 'users';
let dbSchemaVisible = false;

async function renderDbExplorer() {
  const container = document.getElementById('view-dbexplorer');
  container.innerHTML = '<div class="loading">Loading database tables</div>';

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
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
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

// ========== INIT ==========
function initApp() {
  // Hide auth, show app
  document.getElementById('authContainer').style.display = 'none';
  document.getElementById('appShell').style.display = 'flex';

  // Set sidebar user
  document.getElementById('sidebarUser').textContent = `${state.username} (${state.role})`;

  // Navigate to dashboard
  navigateTo('dashboard');
}

// ========== BOOTSTRAP ==========
(function() {
  if (state.token && state.role === 'admin') {
    // Try to validate token by navigating to dashboard
    initApp();
  } else {
    showAuthScreen();
  }
})();