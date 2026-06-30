/* =========================================
   Basic-broker — Application Logic
   ========================================= */

const API_BASE = 'http://localhost:8000';

// ========== STATE ==========
const state = {
  token: localStorage.getItem('broker_token') || null,
  userId: localStorage.getItem('broker_user_id') || null,
  username: localStorage.getItem('broker_username') || null,
  role: localStorage.getItem('broker_role') || null,
  instruments: [],
  selectedInstrumentId: null,
  orderBook: null,
  accountSummary: null,
  userPnl: null,
  marketSummary: null,
  orders: [],
  trades: [],
  adminUsers: [],
  adminOrders: [],
  adminHoldings: [],
  currentView: 'dashboard',
  refreshInterval: null,
};


// ========== SAFE DOM HELPERS ==========
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showError(containerId, message, retryFn) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '<div style="padding:40px;text-align:center">' +
    '<div style="font-size:40px;margin-bottom:8px;color:var(--accent-red)">&#9888;</div>' +
    '<p style="color:var(--text-muted);margin-bottom:16px">' + escapeHtml(message) + '</p>' +
    (retryFn ? '<button class="btn btn-sm btn-outline" onclick="' + retryFn + '">Retry</button>' : '') +
    '</div>';
}


function skeleton(lines = 3) {
  let html = '';
  for (let i = 0; i < lines; i++) {
    const w = 60 + Math.random() * 40;
    html += '<div style="height:16px;background:var(--bg-tertiary);border-radius:4px;margin-bottom:10px;width:' + w + '%;animation:pulse 1.5s ease-in-out infinite"></div>';
  }
  return '<div style="padding:16px">' + html + '</div>';
}

// ========== BROKER SETTINGS
(function() {
  if (localStorage.getItem('broker_compact') === 'true') document.body.classList.add('compact');
})();


async function checkKycStatus() {
  try {
    const status = await apiGetKycStatus();
    const badge = document.getElementById('kycBadge');
    if (badge) {
      badge.style.display = 'inline-block';
      badge.textContent = 'KYC: ' + (status.kyc_level || 'unverified').toUpperCase();
      badge.style.borderColor = status.kyc_level === 'verified' ? 'var(--accent-green)' : 
                                status.kyc_level === 'rejected' ? 'var(--accent-red)' : 'var(--accent-amber)';
      badge.style.color = status.kyc_level === 'verified' ? 'var(--accent-green)' : 
                          status.kyc_level === 'rejected' ? 'var(--accent-red)' : 'var(--accent-amber)';
    }
    state.kycLevel = status.kyc_level || 'unverified';
  } catch(e) {}
}

// ========== STORAGE HELPERS ==========
function saveAuth(token, userId, username, role) {
  state.token = token;
  state.userId = userId;
  state.username = username;
  state.role = role;
  localStorage.setItem('broker_token', token);
  localStorage.setItem('broker_user_id', userId);
  localStorage.setItem('broker_username', username);
  localStorage.setItem('broker_role', role);
}

function clearAuth() {
  state.token = null;
  state.userId = null;
  state.username = null;
  state.role = null;
  localStorage.removeItem('broker_token');
  localStorage.removeItem('broker_user_id');
  localStorage.removeItem('broker_username');
  localStorage.removeItem('broker_role');
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


// Session keep-alive
setInterval(() => {
  if (state.token) {
    fetch(API_BASE + "/api/health", {
      headers: { "Authorization": "Bearer " + state.token }
    }).catch(() => {});
  }
}, 900000);

// Add settings gear to header
(function() {
  const header = document.querySelector('.app-header .app-user');
  if (header) {
    const gear = document.createElement('button');
    gear.className = 'settings-btn';
    gear.innerHTML = '&#9881;';
    gear.onclick = function() {
      const t = localStorage.getItem('broker_compact') === 'true' ? 'false' : 'true';
      localStorage.setItem('broker_compact', t);
      document.body.classList.toggle('compact', t === 'true');
    };
    // Also add refresh rate setting
    gear.title = 'Toggle compact mode';
    header.insertBefore(gear, header.firstChild);
  }
})();

// ========== AUTH API ==========
async function apiRegister(username, password, role = 'trader') {
  return apiCall('POST', '/api/auth/register', { username, password, role });
}

async function apiLogin(username, password) {
  return apiCall('POST', '/api/auth/login', { username, password });
}


async function apiGetKycStatus() {
  return apiCallAuth('GET', '/api/kyc/status');
}

async function apiSubmitKyc(data) {
  return apiCall('POST', '/api/kyc/submit', { ...data, token: state.token });
}

// ========== DATA API ==========
async function apiGetInstruments() {
  return apiCallAuth('GET', '/api/instruments');
}

async function apiGetOrderBook(instrumentId) {
  return apiCallAuth('GET', `/api/orderbook/${instrumentId}`);
}

async function apiGetMarketSummary(instrumentId) {
  return apiCallAuth('GET', `/api/instruments/${instrumentId}/summary`);
}

async function apiPlaceOrder(instrumentId, side, price, quantity) {
  return apiCall('POST', '/api/orders/place', {
    
    instrument_id: instrumentId,
    side,
    price,
    quantity,
  });
}

async function apiPlaceMarketOrder(instrumentId, side, quantity) {
  return apiCall('POST', '/api/orders/market', {
    token: state.token,
    instrument_id: instrumentId,
    side,
    quantity,
  });
}

async function apiCancelOrder(orderId) {
  return apiCall('POST', `/api/orders/cancel/${orderId}?token=${encodeURIComponent(state.token)}`, { token: state.token });
}

async function apiGetUserOrders(userId) {
  return apiCallAuth('GET', `/api/orders/user/${userId}`);
}

async function apiGetTrades(userId) {
  return apiCallAuth('GET', `/api/trades?user_id=${userId}`);
}

async function apiGetAccount(userId) {
  return apiCallAuth('GET', `/api/accounts/${userId}`);
}

async function apiGetPnl(userId) {
  return apiCallAuth('GET', `/api/accounts/${userId}/pnl`);
}

// ========== ADMIN API ==========
async function apiAdminGetUsers() {
  return apiCallAuth('GET', '/api/admin/users');
}

async function apiAdminGetOrders(status, instrumentId) {
  let path = '/api/admin/orders';
  const params = [];
  if (status) params.push(`status=${encodeURIComponent(status)}`);
  if (instrumentId) params.push(`instrument_id=${instrumentId}`);
  if (params.length) path += '?' + params.join('&');
  return apiCallAuth('GET', path);
}

async function apiAdminGetHoldings(instrumentId) {
  let path = '/api/admin/holdings';
  if (instrumentId) path += `?instrument_id=${instrumentId}`;
  return apiCallAuth('GET', path);
}

// ========== NAVIGATION ==========
function navigateTo(view) {
  state.currentView = view;
  // Update nav buttons
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  // Show active view
  document.querySelectorAll('.view').forEach(v => {
    v.classList.toggle('active', v.id === `view-${view}`);
  });
  // Render
  renderView(view);
}

// ========== RENDER VIEWS ==========
function renderView(view) {
  switch (view) {
    case 'dashboard': try { renderDashboard(); } catch(err) { console.error(err); showError('view-dashboard', err.message); } break;
    case 'market': try { renderMarket(); } catch(err) { console.error(err); showError('view-market', err.message); } break;
    case 'trade': try { renderTrade(); } catch(err) { console.error(err); showError('view-trade', err.message); } break;
    case 'orders': try { renderOrders(); } catch(err) { console.error(err); showError('view-orders', err.message); } break;
    case 'history': try { renderHistory(); } catch(err) { console.error(err); showError('view-history', err.message); } break;
    case 'admin': try { renderAdmin(); } catch(err) { console.error(err); showError('view-admin', err.message); } break;
  }
}

// --- DASHBOARD ---
async function renderDashboard() {
  const container = document.getElementById('view-dashboard');
  container.innerHTML = skeleton(3);
  try {
    const [account, orders, pnl] = await Promise.all([
      apiGetAccount(state.userId),
      apiGetUserOrders(state.userId),
      apiGetPnl(state.userId),
    ]);
    state.accountSummary = account;
    state.orders = orders;
    state.userPnl = pnl;

    const cashBalance = account.cash_balance || 0;
    const holdings = account.ppu_holdings || [];
    const totalPpuUnits = holdings.reduce((sum, h) => sum + (h.units || 0), 0);

    const totalUnrealizedPnl = pnl.total_unrealized_pnl || 0;
    const totalRealizedPnl = pnl.total_realized_pnl || 0;
    const totalPnl = pnl.total_pnl || 0;

    let estimatedValue = cashBalance;
    holdings.forEach(h => estimatedValue += h.units * (h.current_mid_price || 0));

    const openOrders = orders.filter(o => o.status === 'open' || o.status === 'partially_filled');

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h2>Account Overview</h2>
          <span style="font-size:13px;color:var(--text-muted)">${state.username}</span>
        </div>
        <div class="card-row">
          <div class="card-stat">
            <div class="label">Cash Balance</div>
            <div class="value neutral">$${cashBalance.toFixed(2)}</div>
          </div>
          <div class="card-stat">
            <div class="label">Total PPU Holdings</div>
            <div class="value neutral">${totalPpuUnits.toFixed(2)} units</div>
          </div>
          <div class="card-stat">
            <div class="label">Realized P&L</div>
            <div class="value ${totalRealizedPnl >= 0 ? 'positive' : 'negative'}">${totalRealizedPnl >= 0 ? '+' : ''}$${totalRealizedPnl.toFixed(2)}</div>
          </div>
          <div class="card-stat">
            <div class="label">Unrealized P&L</div>
            <div class="value ${totalUnrealizedPnl >= 0 ? 'positive' : 'negative'}">${totalUnrealizedPnl >= 0 ? '+' : ''}$${totalUnrealizedPnl.toFixed(2)}</div>
          </div>
          <div class="card-stat">
            <div class="label">Total P&L</div>
            <div class="value ${totalPnl >= 0 ? 'positive' : 'negative'}">${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>PPU Holdings</h3>
        </div>
        ${holdings.length === 0
          ? '<div class="empty-state"><p>No PPU holdings yet</p></div>'
          : `<div>${holdings.map(h => `
            <div class="holding-item">
              <div>
                <div class="holding-name">${escapeHtml(h.name || `Instrument #${h.instrument_id || h.holding_id}`)}</div>
                <div style="font-size:12px;color:var(--text-muted)">${h.instrument_id ? `ID: ${h.instrument_id}` : ''}</div>
              </div>
              <div style="text-align:right">
                <div class="holding-units">${(h.units || 0).toFixed(2)}</div>
              </div>
            </div>
          `).join('')}</div>`
        }
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Open Orders (${openOrders.length})</h3>
        </div>
        ${openOrders.length === 0
          ? '<div class="empty-state"><p>No open orders</p></div>'
          : renderTable(['ID', 'Side', 'Instrument', 'Price', 'Qty', 'Filled', 'Status'], openOrders, o => [
            o.id,
            `<span class="side-${o.side}">${o.side.toUpperCase()}</span>`,
            o.instrument_id || '-',
            `$${Number(o.price).toFixed(2)}`,
            Number(o.quantity).toFixed(2),
            Number(o.filled_quantity || 0).toFixed(2),
            `<span class="status-${o.status}">${o.status.replace('_', ' ')}</span>`,
          ])}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>Error loading dashboard: ${escapeHtml(err.message)}</p></div>`;
  }
}

// --- MARKET ---
async function renderMarket() {
  const container = document.getElementById('view-market');
  container.innerHTML = skeleton(3);
  try {
    const instruments = state.instruments;

    if (instruments.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No instruments available</p></div>';
      return;
    }

    const instrHtml = `
      <div class="instrument-selector">
        ${instruments.map(instr => `
          <button class="instr-btn ${instr.id === state.selectedInstrumentId ? 'active' : ''}"
                  onclick="selectInstrument(${instr.id})">
            ${escapeHtml(instr.name)}
          </button>
        `).join('')}
      </div>
      <div id="market-summary"></div>
      <div id="market-orderbook" style="margin-top:16px"></div>
      <div id="market-trades" style="margin-top:16px"></div>
    `;
    container.innerHTML = instrHtml;

    if (state.selectedInstrumentId) {
      renderMarketSummary(state.selectedInstrumentId);
      renderOrderBook(state.selectedInstrumentId);
      renderRecentTrades(state.selectedInstrumentId);
    }
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>Error: ${escapeHtml(err.message)}</p></div>`;
  }
}

async function renderMarketSummary(instrumentId) {
  const el = document.getElementById('market-summary');
  if (!el) return;
  el.innerHTML = '<div class="loading">Loading summary</div>';
  try {
    const summary = await apiGetMarketSummary(instrumentId);
    state.marketSummary = summary;

    el.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>${escapeHtml(summary.name)} — Market Summary</h3>
        </div>
        <div class="card-row">
          <div class="card-stat">
            <div class="label">Last Trade</div>
            <div class="value neutral">$${summary.last_trade_price ? Number(summary.last_trade_price).toFixed(2) : '—'}</div>
          </div>
          <div class="card-stat">
            <div class="label">Daily Change</div>
            <div class="value ${summary.daily_change >= 0 ? 'positive' : 'negative'}">
              ${summary.last_trade_price
                ? `${summary.daily_change >= 0 ? '+' : ''}$${Number(summary.daily_change).toFixed(2)} (${summary.daily_change_pct >= 0 ? '+' : ''}${Number(summary.daily_change_pct).toFixed(2)}%)`
                : '—'}
            </div>
          </div>
          <div class="card-stat">
            <div class="label">Daily Volume</div>
            <div class="value neutral">${Number(summary.daily_volume || 0).toFixed(2)}</div>
          </div>
          <div class="card-stat">
            <div class="label">Trades Today</div>
            <div class="value neutral">${summary.total_trades_today || 0}</div>
          </div>
          <div class="card-stat">
            <div class="label">Spread</div>
            <div class="value neutral">${summary.spread !== null ? '$' + Number(summary.spread).toFixed(2) : '—'}</div>
          </div>
          <div class="card-stat">
            <div class="label">Mid Price</div>
            <div class="value neutral">${summary.mid_price !== null ? '$' + Number(summary.mid_price).toFixed(2) : '—'}</div>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    if (el) el.innerHTML = `<div class="empty-state"><p>Error loading summary: ${escapeHtml(err.message)}</p></div>`;
  }
}

async function renderOrderBook(instrumentId) {
  const el = document.getElementById('market-orderbook');
  if (!el) return;
  el.innerHTML = '<div class="loading">Loading order book</div>';
  try {
    const ob = await apiGetOrderBook(instrumentId);
    state.orderBook = ob;
    const bids = (ob.bids || []).sort((a, b) => b.price - a.price).slice(0, 10);
    const asks = (ob.asks || []).sort((a, b) => a.price - b.price).slice(0, 10);
    const spread = ob.spread !== undefined ? ob.spread : (ob.best_ask && ob.best_bid ? ob.best_ask - ob.best_bid : 0);
    const mid = ob.mid_price !== undefined ? ob.mid_price : (ob.best_ask && ob.best_bid ? (ob.best_ask + ob.best_bid) / 2 : 0);

    const instr = state.instruments.find(i => i.id === instrumentId);
    const instrName = instr ? instr.name : `Instrument #${instrumentId}`;

    el.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Order Book — ${escapeHtml(instrName)}</h3>
        </div>
        <div class="orderbook">
          <div class="orderbook-side">
            <h3 class="asks-title">Asks (Sell)</h3>
            ${asks.length === 0
              ? '<div style="text-align:center;padding:8px;color:var(--text-muted);font-size:13px">No asks</div>'
              : asks.map(a => `
                <div class="orderbook-row">
                  <span class="price" style="color:var(--accent-red)">$${Number(a.price).toFixed(2)}</span>
                  <span class="qty">${Number(a.remaining !== undefined ? a.remaining : a.quantity).toFixed(2)}</span>
                </div>
              `).join('')}
          </div>
          <div class="orderbook-side">
            <h3 class="bids-title">Bids (Buy)</h3>
            ${bids.length === 0
              ? '<div style="text-align:center;padding:8px;color:var(--text-muted);font-size:13px">No bids</div>'
              : bids.map(b => `
                <div class="orderbook-row">
                  <span class="price" style="color:var(--accent-green)">$${Number(b.price).toFixed(2)}</span>
                  <span class="qty">${Number(b.remaining !== undefined ? b.remaining : b.quantity).toFixed(2)}</span>
                </div>
              `).join('')}
          </div>
          <div class="spread-info">
            Spread: $${Number(spread).toFixed(2)} &middot; Mid: $${Number(mid).toFixed(2)} &middot;
            Best Bid: $${ob.best_bid ? Number(ob.best_bid).toFixed(2) : '-'} &middot;
            Best Ask: $${ob.best_ask ? Number(ob.best_ask).toFixed(2) : '-'}
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    if (el) el.innerHTML = `<div class="empty-state"><p>Error: ${escapeHtml(err.message)}</p></div>`;
  }
}

async function renderRecentTrades(instrumentId) {
  const el = document.getElementById('market-trades');
  if (!el) return;
  el.innerHTML = '<div class="loading">Loading trades</div>';
  try {
    const trades = await apiCallAuth('GET', `/api/trades?instrument_id=${instrumentId}&limit=20`);
    el.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Recent Trades</h3>
        </div>
        ${trades.length === 0
          ? '<div class="empty-state"><p>No trades yet</p></div>'
          : renderTable(['Price', 'Qty', 'Total', 'Buyer', 'Seller', 'Time'], trades, t => [
            `$${Number(t.price).toFixed(2)}`,
            Number(t.quantity).toFixed(2),
            `$${Number(t.total_value || t.quantity * t.price).toFixed(2)}`,
            t.buyer_name || t.buyer_id || '-',
            t.seller_name || t.seller_id || '-',
            formatTime(t.created_at),
          ])}
      </div>
    `;
  } catch (err) {
    if (el) el.innerHTML = `<div class="empty-state"><p>Error: ${escapeHtml(err.message)}</p></div>`;
  }
}

// --- TRADE ---
let tradeOrderType = 'limit';
let tradeSide = 'buy';

function renderTrade() {
  const container = document.getElementById('view-trade');
  const instruments = state.instruments;

  if (instruments.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No instruments available to trade</p></div>';
    return;
  }

  const selected = state.selectedInstrumentId || (instruments.length > 0 ? instruments[0].id : null);

  const instrOptions = instruments.map(i =>
    `<option value="${i.id}" ${i.id === selected ? 'selected' : ''}>${escapeHtml(i.name)} (ID: ${i.id})</option>`
  ).join('');

  const isMarket = tradeOrderType === 'market';

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h2>Place Order</h2>
      </div>
      <form id="tradeForm" onsubmit="submitOrder(event)">
        <div class="form-group">
          <label>Instrument</label>
          <select id="tradeInstrument" onchange="updateSelectedInstrument(this.value)">
            ${instrOptions}
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Side</label>
            <div style="display:flex;gap:8px">
              <button type="button" class="btn btn-buy active" id="sideBuy" onclick="setSide('buy')">Buy</button>
              <button type="button" class="btn btn-sell" id="sideSell" onclick="setSide('sell')">Sell</button>
            </div>
          </div>
          <div class="form-group">
            <label>Order Type</label>
            <select id="orderType" onchange="setOrderType(this.value)">
              <option value="limit">Limit Order</option>
              <option value="market" ${isMarket ? 'selected' : ''}>Market Order</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group" id="priceGroup" style="${isMarket ? 'display:none' : ''}">
            <label>Price ($)</label>
            <input type="number" id="tradePrice" step="0.01" min="0.01" placeholder="0.00" ${isMarket ? '' : 'required'}>
          </div>
          <div class="form-group">
            <label>Quantity (units)</label>
            <input type="number" id="tradeQuantity" step="0.01" min="0.01" placeholder="0.00" required>
          </div>
        </div>
        ${isMarket ? '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">Market order fills immediately at best available price. Price field is not needed.</div>' : ''}
        <button type="submit" class="btn btn-primary" style="margin-top:8px;width:100%">Submit ${isMarket ? 'Market' : 'Limit'} Order</button>
      </form>
    </div>

    <div id="tradeOrderBook"></div>
  `;

  if (selected) {
    state.selectedInstrumentId = Number(selected);
    renderOrderBookTrade(selected);
  }
}

function setSide(side) {
  tradeSide = side;
  document.getElementById('sideBuy').classList.toggle('active', side === 'buy');
  document.getElementById('sideSell').classList.toggle('active', side === 'sell');
}

function setOrderType(type) {
  tradeOrderType = type;
  renderTrade();
}

function updateSelectedInstrument(value) {
  state.selectedInstrumentId = Number(value);
  renderOrderBookTrade(state.selectedInstrumentId);
}

async function renderOrderBookTrade(instrumentId) {
  const el = document.getElementById('tradeOrderBook');
  if (!el) return;
  el.innerHTML = '<div class="loading">Loading order book</div>';
  try {
    const ob = await apiGetOrderBook(instrumentId);
    const bids = (ob.bids || []).sort((a, b) => b.price - a.price).slice(0, 5);
    const asks = (ob.asks || []).sort((a, b) => a.price - b.price).slice(0, 5);
    el.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Order Book Preview</h3>
        </div>
        <div class="orderbook">
          <div class="orderbook-side">
            <h3 class="asks-title">Asks</h3>
            ${asks.length === 0
              ? '<div style="text-align:center;padding:8px;color:var(--text-muted);font-size:13px">No asks</div>'
              : asks.map(a => `
                <div class="orderbook-row" style="cursor:pointer" onclick="fillPrice(${a.price})">
                  <span class="price" style="color:var(--accent-red)">$${Number(a.price).toFixed(2)}</span>
                  <span class="qty">${Number(a.remaining !== undefined ? a.remaining : a.quantity).toFixed(2)}</span>
                </div>
              `).join('')}
          </div>
          <div class="orderbook-side">
            <h3 class="bids-title">Bids</h3>
            ${bids.length === 0
              ? '<div style="text-align:center;padding:8px;color:var(--text-muted);font-size:13px">No bids</div>'
              : bids.map(b => `
                <div class="orderbook-row" style="cursor:pointer" onclick="fillPrice(${b.price})">
                  <span class="price" style="color:var(--accent-green)">$${Number(b.price).toFixed(2)}</span>
                  <span class="qty">${Number(b.remaining !== undefined ? b.remaining : b.quantity).toFixed(2)}</span>
                </div>
              `).join('')}
          </div>
          <div class="spread-info">
            Best Bid: $${ob.best_bid ? Number(ob.best_bid).toFixed(2) : '-'} &middot;
            Best Ask: $${ob.best_ask ? Number(ob.best_ask).toFixed(2) : '-'} &middot;
            Mid: $${ob.mid_price ? Number(ob.mid_price).toFixed(2) : '-'}
          </div>
        </div>
        <div style="margin-top:8px;font-size:12px;color:var(--text-muted)">Click a price to auto-fill</div>
      </div>
    `;
  } catch (err) {
    if (el) el.innerHTML = `<div class="empty-state"><p>Error: ${escapeHtml(err.message)}</p></div>`;
  }
}

function fillPrice(price) {
  const input = document.getElementById('tradePrice');
  if (input) input.value = Number(price).toFixed(2);
}

// --- ORDERS ---
async function renderOrders() {
  const container = document.getElementById('view-orders');
  container.innerHTML = skeleton(3);
  try {
    const orders = await apiGetUserOrders(state.userId);
    state.orders = orders;

    const allOrders = orders || [];

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h2>My Orders</h2>
          <button class="btn btn-sm btn-primary" onclick="refreshOrders()">Refresh</button>
        </div>
        ${allOrders.length === 0
          ? '<div class="empty-state"><p>No orders yet</p></div>'
          : renderTable(['ID', 'Side', 'Instrument', 'Price', 'Qty', 'Filled', 'Remaining', 'Status', 'Time', 'Action'], allOrders, o => [
            o.id,
            `<span class="side-${o.side}">${o.side.toUpperCase()}</span>`,
            o.instrument_id || '-',
            `$${Number(o.price).toFixed(2)}`,
            Number(o.quantity).toFixed(2),
            Number(o.filled_quantity || 0).toFixed(2),
            Number(o.quantity - (o.filled_quantity || 0)).toFixed(2),
            `<span class="status-${o.status}">${o.status.replace('_', ' ')}</span>`,
            formatTime(o.created_at),
            (o.status === 'open' || o.status === 'partially_filled')
              ? `<button class="btn btn-sm btn-danger" onclick="cancelOrder(${o.id})">Cancel</button>`
              : '<span style="color:var(--text-muted);font-size:12px">—</span>',
          ])}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>Error: ${escapeHtml(err.message)}</p></div>`;
  }
}

async function refreshOrders() {
  renderOrders();
}

// --- HISTORY ---
async function renderHistory() {
  const container = document.getElementById('view-history');
  container.innerHTML = skeleton(3);
  try {
    const trades = await apiGetTrades(state.userId);
    state.trades = trades;

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h2>Trade History</h2>
        </div>
        ${trades.length === 0
          ? '<div class="empty-state"><p>No trades yet</p></div>'
          : renderTable(['ID', 'Instrument', 'Side', 'Price', 'Qty', 'Total', 'Counterparty', 'Time'], trades, t => {
            const isBuyer = Number(t.buyer_id) === Number(state.userId);
            return [
              t.id,
              t.instrument_name || t.instrument_id || '-',
              `<span class="side-${isBuyer ? 'buy' : 'sell'}">${isBuyer ? 'BUY' : 'SELL'}</span>`,
              `$${Number(t.price).toFixed(2)}`,
              Number(t.quantity).toFixed(2),
              `$${Number(t.total_value || t.quantity * t.price).toFixed(2)}`,
              isBuyer ? (t.seller_name || t.seller_id || '-') : (t.buyer_name || t.buyer_id || '-'),
              formatTime(t.created_at),
            ];
          })}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>Error: ${escapeHtml(err.message)}</p></div>`;
  }
}

// --- ADMIN ---
let adminTab = 'users';

async function renderAdmin() {
  const container = document.getElementById('view-admin');
  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h2>Admin Panel</h2>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-sm ${adminTab === 'users' ? 'btn-primary' : ''}" style="background:${adminTab === 'users' ? 'var(--accent-blue)' : 'var(--bg-tertiary)'}" onclick="switchAdminTab('users')">Users</button>
        <button class="btn btn-sm ${adminTab === 'orders' ? 'btn-primary' : ''}" style="background:${adminTab === 'orders' ? 'var(--accent-blue)' : 'var(--bg-tertiary)'}" onclick="switchAdminTab('orders')">All Orders</button>
        <button class="btn btn-sm ${adminTab === 'holdings' ? 'btn-primary' : ''}" style="background:${adminTab === 'holdings' ? 'var(--accent-blue)' : 'var(--bg-tertiary)'}" onclick="switchAdminTab('holdings')">Holdings</button>
      </div>
    </div>
    <div id="admin-content"><div class="loading">Loading admin data</div></div>
  `;
  renderAdminTab(adminTab);
}

function switchAdminTab(tab) {
  adminTab = tab;
  renderAdminTab(tab);
  // Update button styles
  document.querySelectorAll('#view-admin .btn-sm').forEach(b => {
    b.style.background = 'var(--bg-tertiary)';
  });
  const btns = document.querySelectorAll('#view-admin .btn-sm');
  const idx = ['users', 'orders', 'holdings'].indexOf(tab);
  if (btns[idx]) btns[idx].style.background = 'var(--accent-blue)';
}

async function renderAdminTab(tab) {
  const el = document.getElementById('admin-content');
  if (!el) return;
  el.innerHTML = '<div class="loading">Loading</div>';

  try {
    if (tab === 'users') {
      const users = await apiAdminGetUsers();
      state.adminUsers = users;
      el.innerHTML = `
        <div class="card">
          <div class="card-header"><h3>All Users (${users.length})</h3></div>
          ${users.length === 0
            ? '<div class="empty-state"><p>No users</p></div>'
            : renderTable(['ID', 'Username', 'Role', 'Cash Balance', 'Holdings', 'Created'], users, u => [
              u.id,
              escapeHtml(u.username),
              u.role,
              `$${Number(u.cash_balance || 0).toFixed(2)}`,
              (u.ppu_holdings || []).map(h => `${h.instrument_name}: ${h.units}`).join('<br>') || '—',
              formatTime(u.created_at),
            ])}
        </div>
      `;
    } else if (tab === 'orders') {
      const orders = await apiAdminGetOrders();
      state.adminOrders = orders;
      el.innerHTML = `
        <div class="card">
          <div class="card-header">
            <h3>All Orders (${orders.length})</h3>
            <div style="display:flex;gap:4px">
              <button class="btn btn-sm" style="background:var(--bg-tertiary)" onclick="switchAdminTab('orders')">All</button>
              <button class="btn btn-sm" style="background:var(--bg-tertiary)" onclick="filterAdminOrders('open')">Open</button>
              <button class="btn btn-sm" style="background:var(--bg-tertiary)" onclick="filterAdminOrders('filled')">Filled</button>
              <button class="btn btn-sm" style="background:var(--bg-tertiary)" onclick="filterAdminOrders('partially_filled')">Partial</button>
            </div>
          </div>
          ${orders.length === 0
            ? '<div class="empty-state"><p>No orders</p></div>'
            : renderTable(['ID', 'User', 'Instrument', 'Side', 'Price', 'Qty', 'Filled', 'Status', 'Time'], orders, o => [
              o.id,
              o.username || o.user_id || '-',
              o.instrument_name || o.instrument_id || '-',
              `<span class="side-${o.side}">${o.side.toUpperCase()}</span>`,
              `$${Number(o.price).toFixed(2)}`,
              Number(o.quantity).toFixed(2),
              Number(o.filled_quantity || 0).toFixed(2),
              `<span class="status-${o.status}">${o.status.replace('_', ' ')}</span>`,
              formatTime(o.created_at),
            ])}
        </div>
      `;
    } else if (tab === 'holdings') {
      const holdings = await apiAdminGetHoldings();
      state.adminHoldings = holdings;
      el.innerHTML = `
        <div class="card">
          <div class="card-header"><h3>All PPU Holdings (${holdings.length})</h3></div>
          ${holdings.length === 0
            ? '<div class="empty-state"><p>No holdings</p></div>'
            : renderTable(['User', 'Instrument', 'Units', 'Avg Cost Basis'], holdings, h => [
              (h.username || `User #${h.user_id}`),
              h.instrument_name || `Instrument #${h.instrument_id}`,
              Number(h.units).toFixed(2),
              `$${Number(h.avg_cost_basis || 0).toFixed(2)}`,
            ])}
        </div>
      `;
    }
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>Error: ${escapeHtml(err.message)}</p></div>`;
  }
}

async function filterAdminOrders(status) {
  try {
    const orders = await apiAdminGetOrders(status);
    state.adminOrders = orders;
    const el = document.getElementById('admin-content');
    if (!el) return;
    // Re-render just the table portion
    el.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>All Orders (${orders.length}) — ${status || 'all'}</h3>
          <div style="display:flex;gap:4px">
            <button class="btn btn-sm" style="background:var(--bg-tertiary)" onclick="switchAdminTab('orders')">All</button>
            <button class="btn btn-sm" style="background:var(--bg-tertiary)" onclick="filterAdminOrders('open')">Open</button>
            <button class="btn btn-sm" style="background:var(--bg-tertiary)" onclick="filterAdminOrders('filled')">Filled</button>
            <button class="btn btn-sm" style="background:var(--bg-tertiary)" onclick="filterAdminOrders('partially_filled')">Partial</button>
          </div>
        </div>
        ${orders.length === 0
          ? '<div class="empty-state"><p>No orders</p></div>'
          : renderTable(['ID', 'User', 'Instrument', 'Side', 'Price', 'Qty', 'Filled', 'Status', 'Time'], orders, o => [
            o.id,
            o.username || o.user_id || '-',
            o.instrument_name || o.instrument_id || '-',
            `<span class="side-${o.side}">${o.side.toUpperCase()}</span>`,
            `$${Number(o.price).toFixed(2)}`,
            Number(o.quantity).toFixed(2),
            Number(o.filled_quantity || 0).toFixed(2),
            `<span class="status-${o.status}">${o.status.replace('_', ' ')}</span>`,
            formatTime(o.created_at),
          ])}
      </div>
    `;
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
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

// ========== EVENT HANDLERS ==========
async function submitOrder(event) {
  event.preventDefault();
  const instrumentId = Number(document.getElementById('tradeInstrument').value);
  const quantity = Number(document.getElementById('tradeQuantity').value);
  const side = tradeSide;
  const isMarket = tradeOrderType === 'market';
  const price = isMarket ? 0 : Number(document.getElementById('tradePrice').value);

  if (!instrumentId || !quantity) {
    showToast('Please fill in all fields', 'error');
    return;
  }

  if (quantity <= 0) {
    showToast('Quantity must be positive', 'error');
    return;
  }

  if (!isMarket && (!price || price <= 0)) {
    showToast('Price must be positive', 'error');
    return;
  }

  try {
    let result;
    if (isMarket) {
      result = await apiPlaceMarketOrder(instrumentId, side, quantity);
      showToast(`Market order filled: ${result.filled_quantity || 0} units at avg $${result.price} (${result.matches} matches)`, 'success');
    } else {
      result = await apiPlaceOrder(instrumentId, side, price, quantity);
      showToast(`Limit order placed! Order ID: ${result.order_id}, Matches: ${result.matches || 0}`, 'success');
    }
    document.getElementById('tradeQuantity').value = '';
    if (!isMarket) {
      document.getElementById('tradePrice').value = '';
    }
    renderOrderBookTrade(instrumentId);
  } catch (err) {
    showToast(`Order failed: ${err.message}`, 'error');
  }
}

async function cancelOrder(orderId) {
  if (!confirm('Cancel this order?')) return;
  try {
    await apiCancelOrder(orderId);
    showToast('Order cancelled', 'success');
    renderOrders();
  } catch (err) {
    showToast(`Cancel failed: ${err.message}`, 'error');
  }
}

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
    saveAuth(result.token, result.user_id, result.username, result.role);
    checkKycStatus();
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
  const role = document.getElementById('regRole').value;

  if (!username || !password) {
    showToast('Please fill in all fields', 'error');
    return;
  }

  if (password.length < 4) {
    showToast('Password must be at least 4 characters', 'error');
    return;
  }

  try {
    await apiRegister(username, password, role);
    showToast('Account created! Please log in.', 'success');
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

function showLoginForm() {
  document.getElementById('authContainer').innerHTML = `
    <div class="auth-card">
      <h1>Basic-broker</h1>
      <p>Sign in to your account</p>
      <form onsubmit="handleLogin(event)">
        <div class="form-group">
          <label>Username</label>
          <input type="text" id="loginUsername" placeholder="Enter username" required>
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" id="loginPassword" placeholder="Enter password" required>
        </div>
        <button type="submit" class="btn btn-primary" style="width:100%">Sign In</button>
      </form>
      <div class="auth-toggle">
        Don't have an account? <a onclick="showRegisterForm()">Register</a>
      </div>
    </div>
  `;
}

function showRegisterForm() {
  document.getElementById('authContainer').innerHTML = `
    <div class="auth-card">
      <h1>Basic-broker</h1>
      <p>Create a new account</p>
      <form onsubmit="handleRegister(event)">
        <div class="form-group">
          <label>Username</label>
          <input type="text" id="regUsername" placeholder="Choose a username" required>
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" id="regPassword" placeholder="Choose a password" required>
        </div>
        <div class="form-group">
          <label>Account Type</label>
          <select id="regRole">
            <option value="trader">Trader</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button type="submit" class="btn btn-success" style="width:100%">Create Account</button>
      </form>
      <div class="auth-toggle">
        Already have an account? <a onclick="showLoginForm()">Sign In</a>
      </div>
    </div>
  `;
}

function showAuthScreen() {
  document.getElementById('authContainer').style.display = 'flex';
  document.getElementById('appShell').style.display = 'none';
  showLoginForm();
  if (state.refreshInterval) {
    clearInterval(state.refreshInterval);
    state.refreshInterval = null;
  }
}

function showAppShell() {
  document.getElementById('authContainer').style.display = 'none';
  document.getElementById('appShell').style.display = 'block';
  document.getElementById('userDisplay').textContent = state.username;
  document.getElementById('userRoleDisplay').textContent = state.role;

  // Show admin tab if user is admin
  const adminNav = document.getElementById('navAdmin');
  if (adminNav) {
    adminNav.style.display = state.role === 'admin' ? 'block' : 'none';
  }
}

// ========== WEBSOCKET LIVE UPDATES ==========

const wsConnections = {};

function connectWebSocket(instrumentId) {
  // Close existing connection for this instrument
  if (wsConnections[instrumentId]) {
    wsConnections[instrumentId].close();
  }
  const ws = new WebSocket(`ws://${new URL(API_BASE).host || 'localhost:8000'}/ws/${instrumentId}`);
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'orderbook' && Number(data.instrument_id) === Number(instrumentId)) {
        state.orderBook = data;
        // Update any visible views that show order books
        if (state.currentView === 'market') {
          renderOrderBook(instrumentId);
          renderMarketSummary(instrumentId);
        } else if (state.currentView === 'trade') {
          renderOrderBookTrade(instrumentId);
        }
      }
    } catch (e) {
      console.error('WS message error:', e);
    }
  };
  ws.onclose = () => {
    // Reconnect after 3s
    setTimeout(() => {
      if (state.token && state.selectedInstrumentId) {
        connectWebSocket(state.selectedInstrumentId);
      }
    }, 3000);
  };
  ws.onerror = () => {
    ws.close();
  };
  wsConnections[instrumentId] = ws;
}

function selectInstrument(id) {
  state.selectedInstrumentId = Number(id);
  connectWebSocket(state.selectedInstrumentId);
  renderMarket();
}

// ========== DATA REFRESH (background polling for dashboard) ==========
function startAutoRefresh() {
  if (state.refreshInterval) clearInterval(state.refreshInterval);
  state.refreshInterval = setInterval(() => {
    if (state.currentView === 'dashboard') {
      renderDashboard();
    }
  }, 15000); // Dashboard only, every 15s — market/trade live via WebSocket
}

async function loadInstruments() {
  try {
    const instruments = await apiGetInstruments();
    state.instruments = (instruments || []).filter(i => i.status === 'active');
    if (state.instruments.length > 0 && !state.selectedInstrumentId) {
      state.selectedInstrumentId = state.instruments[0].id;
      connectWebSocket(state.selectedInstrumentId);
    }
  } catch (err) {
    console.error('Failed to load instruments:', err);
  }
}

async function loadInstrumentsSilent() {
  try {
    const instruments = await apiGetInstruments();
    state.instruments = (instruments || []).filter(i => i.status === 'active');
    renderView(state.currentView);
  } catch (err) {
    // silent
  }
}

// ========== INIT ==========
function initApp() {
  showAppShell();
  loadInstruments().then(() => {
    navigateTo('dashboard');
    startAutoRefresh();
  });
}

// ========== BOOT ==========
document.addEventListener('DOMContentLoaded', () => {
  if (state.token) {
    loadInstruments().then(() => {
      initApp();
    }).catch(() => {
      clearAuth();
      showAuthScreen();
    });
  } else {
    showAuthScreen();
  }
});