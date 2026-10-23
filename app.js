/**
 * ==============================================================================
 * LEND TRACKER - FRONTEND CLIENT APPLICATION LOGIC (v2.0)
 * ==============================================================================
 * MODES:
 *   lend     → Track money lent to others (blue theme)
 *   borrow   → Track money borrowed from others (amber theme)
 *   overview → Combined net position dashboard (purple theme)
 * ==============================================================================
 */

// ==============================================================================
// APPLICATION STATE
// ==============================================================================
const state = {
  config: {
    webAppUrl: localStorage.getItem('lt_webapp_url') || '',
    passcode: localStorage.getItem('lt_passcode') || '',
    currency: localStorage.getItem('lt_currency') || '₹',
    lenderName: localStorage.getItem('lt_lender_name') || '',
    upiId: localStorage.getItem('lt_upi_id') || ''
  },
  // LEND mode data
  loans: [],
  payments: [],
  summary: { total_lent:0, total_received:0, total_outstanding:0, counts:{all:0,pending:0,partial:0,completed:0,overdue:0} },
  // BORROW mode data
  borrowings: [],
  borrowPayments: [],
  borrowSummary: { total_borrowed:0, total_repaid:0, total_i_owe:0, counts:{all:0,pending:0,partial:0,completed:0,overdue:0} },
  // UI state
  appMode: localStorage.getItem('lt_app_mode') || 'lend',   // 'lend' | 'borrow' | 'overview'
  filters: { search:'', status:'ALL', sortBy:'date_newest' },
  borrowFilters: { search:'', status:'ALL', sortBy:'date_newest' },
  overviewFilters: { fromDate:'', toDate:'', person:'' },
  activeLoanForPayment: null,
  activeBorrowingForPayment: null,
  activeLoanForDelete: null,
  activeBorrowingForDelete: null,
  activeLoanForShare: null,
  activeBorrowingForShare: null,
  loanFileUpload: null,
  paymentFileUpload: null,
  borrowFileUpload: null,
  borrowPayFileUpload: null,
  isLoading: false,
  isPortalMode: false
};

// ==============================================================================
// FORMATTING HELPERS
// ==============================================================================
function formatCurrency(amount) {
  const num = Number(amount) || 0;
  const formatted = num.toLocaleString('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: num % 1 === 0 ? 0 : 2
  });
  return `${state.config.currency || '₹'}${formatted}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const parts = String(dateStr).substring(0, 10).split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return dateStr;
}

function getTodayIsoString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

// ==============================================================================
// TOAST NOTIFICATIONS
// ==============================================================================
function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity='0'; toast.style.transform='translateY(10px)'; setTimeout(()=>toast.remove(),250); }, duration);
}

// ==============================================================================
// API CLIENT
// ==============================================================================
async function apiGet(action, params = {}, customUrl = null) {
  const targetUrl = customUrl || state.config.webAppUrl;
  if (!targetUrl) throw new Error('API Web App URL not configured');
  const url = new URL(targetUrl);
  url.searchParams.set('action', action);
  if (state.config.passcode && action !== 'getPortalData') url.searchParams.set('passcode', state.config.passcode);
  Object.keys(params).forEach(k => url.searchParams.set(k, params[k]));
  const response = await fetch(url.toString(), { method:'GET', redirect:'follow' });
  if (!response.ok) throw new Error(`Server returned HTTP ${response.status}`);
  const result = await response.json();
  if (!result.success) throw new Error(result.error || 'Request failed on server');
  return result;
}

async function apiPost(action, data = {}) {
  if (!state.config.webAppUrl || !state.config.passcode) throw new Error('API URL or Passcode not configured');
  const payload = { action, passcode: state.config.passcode, data };
  const response = await fetch(state.config.webAppUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
    redirect: 'follow'
  });
  if (!response.ok) throw new Error(`Server returned HTTP ${response.status}`);
  const result = await response.json();
  if (!result.success) throw new Error(result.error || 'Server error');
  return result;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    if (file.size > 5 * 1024 * 1024) { reject(new Error('File exceeds 5MB limit')); return; }
    const reader = new FileReader();
    reader.onload = () => resolve({ fileData: reader.result, fileName: file.name, mimeType: file.type || 'application/octet-stream' });
    reader.onerror = err => reject(err);
    reader.readAsDataURL(file);
  });
}

// ==============================================================================
// DATA FETCHING
// ==============================================================================
async function fetchAllData(showSpinner = true) {
  if (state.isPortalMode) return;
  if (!state.config.webAppUrl || !state.config.passcode) {
    updateSetupBannerVisibility();
    renderCurrentView();
    return;
  }

  if (showSpinner) {
    state.isLoading = true;
    setLoadingState(true);
  }

  try {
    const res = await apiGet('getData');
    // Lend data
    state.loans = res.data.loans || [];
    state.payments = res.data.payments || [];
    state.summary = res.data.summary || state.summary;
    // Borrow data
    state.borrowings = res.data.borrowings || [];
    state.borrowPayments = res.data.borrow_payments || [];
    state.borrowSummary = res.data.borrow_summary || state.borrowSummary;

    // Cache locally for offline
    localStorage.setItem('lt_cached_loans', JSON.stringify(state.loans));
    localStorage.setItem('lt_cached_payments', JSON.stringify(state.payments));
    localStorage.setItem('lt_cached_summary', JSON.stringify(state.summary));
    localStorage.setItem('lt_cached_borrowings', JSON.stringify(state.borrowings));
    localStorage.setItem('lt_cached_borrow_payments', JSON.stringify(state.borrowPayments));
    localStorage.setItem('lt_cached_borrow_summary', JSON.stringify(state.borrowSummary));
    localStorage.setItem('lt_last_sync', new Date().toISOString());

    updateHeaderSyncStatus('Synced just now');
    renderAllViews();
  } catch (err) {
    console.error('Fetch error:', err);
    showToast(err.message || 'Failed to load data', 'error');
    // Try offline cache
    const cached = localStorage.getItem('lt_cached_loans');
    if (cached) {
      state.loans = JSON.parse(cached);
      state.payments = JSON.parse(localStorage.getItem('lt_cached_payments') || '[]');
      state.summary = JSON.parse(localStorage.getItem('lt_cached_summary') || '{}');
      state.borrowings = JSON.parse(localStorage.getItem('lt_cached_borrowings') || '[]');
      state.borrowPayments = JSON.parse(localStorage.getItem('lt_cached_borrow_payments') || '[]');
      state.borrowSummary = JSON.parse(localStorage.getItem('lt_cached_borrow_summary') || '{}');
      updateHeaderSyncStatus('Offline (cached)');
      renderAllViews();
      showToast('Showing cached offline data', 'warning');
    } else {
      setLoadingState(false, err.message);
    }
  } finally {
    state.isLoading = false;
    setLoadingState(false);
  }
}

function setLoadingState(loading, errorMsg = '') {
  const lendContainer = document.getElementById('loans-container');
  const borrowContainer = document.getElementById('borrow-loans-container');
  if (loading) {
    const html = `<div class="loading-state"><div class="spinner"></div><p>Syncing with Google Sheets...</p></div>`;
    if (lendContainer) lendContainer.innerHTML = html;
    if (borrowContainer) borrowContainer.innerHTML = html;
  } else if (errorMsg) {
    const html = `<div class="empty-state"><p>⚠️ ${escapeHtml(errorMsg)}</p><button class="btn btn-primary btn-sm" onclick="fetchAllData(true)">Retry</button></div>`;
    if (lendContainer) lendContainer.innerHTML = html;
    if (borrowContainer) borrowContainer.innerHTML = html;
  }
}

function updateHeaderSyncStatus(text) {
  const el = document.getElementById('header-status');
  if (el) el.textContent = text;
}

// ==============================================================================
// MODE SWITCHER
// ==============================================================================
function setAppMode(mode) {
  state.appMode = mode;
  localStorage.setItem('lt_app_mode', mode);

  // Show/hide main views
  const lendView = document.getElementById('lend-app-view');
  const borrowView = document.getElementById('borrow-app-view');
  const overviewView = document.getElementById('overview-app-view');

  if (lendView) lendView.classList.toggle('hidden', mode !== 'lend');
  if (borrowView) borrowView.classList.toggle('hidden', mode !== 'borrow');
  if (overviewView) overviewView.classList.toggle('hidden', mode !== 'overview');

  // Update dropdown trigger icon & label in navbar
  const iconEl = document.getElementById('current-mode-icon');
  const textEl = document.getElementById('current-mode-text');
  if (mode === 'borrow') {
    if (iconEl) iconEl.textContent = '🏦';
    if (textEl) textEl.textContent = 'Borrowing';
  } else if (mode === 'overview') {
    if (iconEl) iconEl.textContent = '⚖️';
    if (textEl) textEl.textContent = 'Overview';
  } else {
    if (iconEl) iconEl.textContent = '💰';
    if (textEl) textEl.textContent = 'Lending';
  }

  // Update dropdown menu items active state
  document.querySelectorAll('.mode-dropdown-item').forEach(item => {
    item.classList.toggle('active', item.dataset.mode === mode);
  });

  // Apply theme to document
  document.documentElement.setAttribute('data-app-mode', mode);

  // Update FAB visibility
  const lendFab = document.getElementById('mobile-add-fab');
  const borrowFab = document.getElementById('mobile-add-borrow-fab');
  if (lendFab) lendFab.classList.toggle('hidden', mode !== 'lend');
  if (borrowFab) borrowFab.classList.toggle('hidden', mode !== 'borrow');

  renderCurrentView();
}

function renderCurrentView() {
  if (state.appMode === 'lend') {
    renderLendDashboard();
    renderLoansList();
    renderPeopleView();
  } else if (state.appMode === 'borrow') {
    renderBorrowDashboard();
    renderBorrowingsList();
    renderLendersView();
  } else if (state.appMode === 'overview') {
    renderOverview();
  }
}

function renderAllViews() {
  renderLendDashboard();
  renderLoansList();
  renderPeopleView();
  renderBorrowDashboard();
  renderBorrowingsList();
  renderLendersView();
  renderOverview();
  updateSetupBannerVisibility();
}

// ==============================================================================
// LEND MODE — DASHBOARD
// ==============================================================================
function renderLendDashboard() {
  const sum = state.summary;
  const el = id => document.getElementById(id);
  if (!el('metric-total-lent')) return;

  el('metric-total-lent').textContent = formatCurrency(sum.total_lent);
  el('metric-total-received').textContent = formatCurrency(sum.total_received);
  el('metric-total-outstanding').textContent = formatCurrency(sum.total_outstanding);

  const count = (state.loans || []).length;
  el('metric-total-loans').textContent = `${count} Loan${count===1?'':'s'} Recorded`;
  const pct = sum.total_lent > 0 ? Math.round((sum.total_received/sum.total_lent)*100) : 0;
  el('metric-recovery-rate').textContent = `${pct}% Recovered`;
  const pending = (sum.counts.pending||0)+(sum.counts.partial||0);
  el('metric-pending-count').textContent = `${pending} Active Unfinished`;

  el('count-overdue').textContent = sum.counts.overdue || 0;
  el('count-pending').textContent = sum.counts.pending || 0;
  el('count-partial').textContent = sum.counts.partial || 0;
  el('count-completed').textContent = sum.counts.completed || 0;
  el('loans-tab-count').textContent = count;

  // Overdue
  const overdueLoans = state.loans.filter(l => l.is_overdue);
  const overdueSection = el('overdue-section');
  if (overdueSection) {
    overdueSection.classList.toggle('hidden', overdueLoans.length === 0);
    if (overdueLoans.length) {
      el('overdue-badge-count').textContent = overdueLoans.length;
      el('overdue-list').innerHTML = overdueLoans.map(l => compactLoanItem(l, 'lend')).join('');
    }
  }

  // Upcoming dues
  const upcoming = state.loans.filter(l =>
    l.status !== 'Completed' && l.expected_return_date &&
    l.days_until_due !== null && l.days_until_due >= 0 && l.days_until_due <= 14
  ).sort((a,b) => a.days_until_due - b.days_until_due);

  const upcomingEl = el('upcoming-dues-list');
  if (upcomingEl) {
    upcomingEl.innerHTML = upcoming.length
      ? upcoming.map(l => compactLoanItem(l, 'lend')).join('')
      : '<p class="empty-state">No loans due in the next 14 days.</p>';
  }
}

function compactLoanItem(loan, mode) {
  const isLend = mode === 'lend';
  const dueLabel = loan.days_until_due === 0 ? 'Due Today!' : loan.days_until_due === 1 ? 'Due Tomorrow' :
    loan.days_until_due < 0 ? `${Math.abs(loan.days_until_due)} days overdue` : `In ${loan.days_until_due} days`;
  const name = isLend ? loan.borrower_name : loan.lender_name;
  const dateField = isLend ? loan.date_given : loan.date_taken;
  const dueDate = isLend ? loan.expected_return_date : loan.expected_return_date;
  const btnFn = isLend ? `openPaymentModal('${loan.loan_id}')` : `openBorrowPaymentModal('${loan.borrowing_id}')`;
  const viewFn = isLend ? `viewLoanDetails('${loan.loan_id}')` : `viewBorrowingDetails('${loan.borrowing_id}')`;

  return `
    <div class="compact-item" onclick="${viewFn}">
      <div class="compact-left">
        <span class="compact-borrower">${escapeHtml(name)}</span>
        <span class="compact-date">${dueDate ? `Due: ${formatDate(dueDate)} (${dueLabel})` : `Given: ${formatDate(dateField)}`}</span>
      </div>
      <div class="compact-right">
        <div class="compact-amount">
          <div>${formatCurrency(loan.remaining_balance)}</div>
          <div class="compact-balance">${isLend ? 'To Receive' : 'To Return'}</div>
        </div>
        <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();${btnFn}">
          ${isLend ? 'Add Payment' : 'Record Repayment'}
        </button>
      </div>
    </div>`;
}

// ==============================================================================
// LEND MODE — LOANS LIST
// ==============================================================================
function renderLoansList() {
  const container = document.getElementById('loans-container');
  if (!container) return;
  if (!state.config.webAppUrl || !state.config.passcode) {
    container.innerHTML = `<div class="empty-state"><p>⚙️ Configure your API settings to load loans.</p><button class="btn btn-primary btn-sm" onclick="openModal('settings-modal')">Open Settings</button></div>`;
    return;
  }

  let list = [...state.loans];
  const q = state.filters.search.toLowerCase().trim();
  if (q) list = list.filter(l =>
    (l.borrower_name||'').toLowerCase().includes(q) ||
    (l.notes||'').toLowerCase().includes(q) ||
    (l.phone_or_email||'').toLowerCase().includes(q)
  );

  const sf = state.filters.status;
  if (sf === 'ACTIVE') list = list.filter(l => l.status !== 'Completed');
  else if (sf === 'Overdue') list = list.filter(l => l.is_overdue);
  else if (sf !== 'ALL') list = list.filter(l => l.status === sf);

  list = sortList(list, state.filters.sortBy, 'lend');

  // Filter bar
  const filterBar = document.getElementById('active-filter-bar');
  if (filterBar) {
    const active = q || sf !== 'ALL';
    filterBar.classList.toggle('hidden', !active);
    if (active) {
      let desc = [];
      if (q) desc.push(`"${q}"`);
      if (sf !== 'ALL') desc.push(`Status: ${sf}`);
      const fd = document.getElementById('filter-description');
      if (fd) fd.textContent = desc.join(', ');
    }
  }

  if (list.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>No loans match your filter.</p><button class="btn btn-secondary btn-sm" onclick="resetFilters()">Reset Filters</button></div>`;
    return;
  }
  container.innerHTML = list.map(loan => renderLoanCard(loan)).join('');
}

function sortList(list, sortBy, mode) {
  const dateField = mode === 'lend' ? 'date_given' : 'date_taken';
  return list.sort((a, b) => {
    switch (sortBy) {
      case 'date_newest': return (b[dateField]||'').localeCompare(a[dateField]||'');
      case 'date_oldest': return (a[dateField]||'').localeCompare(b[dateField]||'');
      case 'due_date':
        if (!a.expected_return_date) return 1;
        if (!b.expected_return_date) return -1;
        return a.expected_return_date.localeCompare(b.expected_return_date);
      case 'amount_highest': return b.amount - a.amount;
      case 'amount_lowest': return a.amount - b.amount;
      case 'name_asc':
        const nameA = mode === 'lend' ? (a.borrower_name||'') : (a.lender_name||'');
        const nameB = mode === 'lend' ? (b.borrower_name||'') : (b.lender_name||'');
        return nameA.localeCompare(nameB);
      default: return 0;
    }
  });
}

function renderLoanCard(loan) {
  const totalPayable = loan.total_payable || loan.amount;
  const pct = totalPayable > 0 ? Math.min(100, Math.round((loan.total_paid/totalPayable)*100)) : 0;
  const isOverdue = loan.is_overdue;
  const isCompleted = loan.status === 'Completed';
  let statusClass = 'badge-pending';
  if (loan.status === 'Partial') statusClass = 'badge-partial';
  if (loan.status === 'Completed') statusClass = 'badge-completed';
  const cardClass = ['loan-card', isOverdue?'is-overdue':'', isCompleted?'is-completed':''].filter(Boolean).join(' ');

  let interestInfo = '';
  if (loan.accrued_interest > 0) {
    const rateLabel = loan.interest_type==='simple_yearly' ? `${loan.interest_rate}% p.a.` :
      loan.interest_type==='simple_monthly' ? `${loan.interest_rate}% p.m.` : 'Fixed Fee';
    interestInfo = ` &bull; <span class="text-warning">+${formatCurrency(loan.accrued_interest)} (${rateLabel})</span>`;
  }

  return `<div class="${cardClass}" id="card-${loan.loan_id}">
    <div class="loan-card-top">
      <div class="borrower-info">
        <h3>${escapeHtml(loan.borrower_name)}</h3>
        <div class="borrower-meta">
          <span>📅 ${formatDate(loan.date_given)}</span>
          ${loan.expected_return_date ? `<span>&bull; Due: ${formatDate(loan.expected_return_date)}</span>` : ''}
          ${loan.phone_or_email ? `<span>&bull; 📞 ${escapeHtml(loan.phone_or_email)}</span>` : ''}
          ${interestInfo}
        </div>
      </div>
      <div class="badges-group">
        ${isOverdue ? '<span class="badge badge-overdue">⚠️ Overdue</span>' : ''}
        <span class="badge ${statusClass}">${loan.status}</span>
      </div>
    </div>
    <div class="loan-financials">
      <div class="fin-col"><span>Principal</span><strong>${formatCurrency(loan.amount)}</strong></div>
      <div class="fin-col"><span>Received</span><strong class="text-success">${formatCurrency(loan.total_paid)}</strong></div>
      <div class="fin-col"><span>Balance</span><strong class="${loan.remaining_balance>0?'text-danger':'text-success'}">${formatCurrency(loan.remaining_balance)}</strong></div>
    </div>
    <div>
      <div class="progress-container"><div class="progress-bar" style="width:${pct}%"></div></div>
      <div class="progress-label">${pct}% received (${loan.payments.length} payment${loan.payments.length===1?'':'s'})</div>
    </div>
    ${loan.notes ? `<div class="loan-card-details"><div class="loan-note">"${escapeHtml(loan.notes)}"</div></div>` : ''}
    ${loan.attachment_url ? `<div><a href="${loan.attachment_url}" target="_blank" rel="noopener" class="attachment-link">📎 View Loan Document ↗</a></div>` : ''}
    <div class="loan-card-actions">
      ${!isCompleted ? `<button class="btn btn-sm btn-primary" onclick="openPaymentModal('${loan.loan_id}')">➕ Add Payment</button>` : ''}
      <button class="btn btn-sm btn-secondary" onclick="viewPaymentHistory('${loan.loan_id}')">📜 History (${loan.payments.length})</button>
      <button class="btn btn-sm btn-secondary" onclick="openSharePortalModal('${loan.loan_id}','lend')" title="Share statement">🔗 Statement</button>
      ${!isCompleted && loan.phone_or_email ? `<button class="btn btn-sm btn-whatsapp" onclick="openWhatsAppReminder('${loan.loan_id}','lend')">💬 WhatsApp</button>` : ''}
      <div class="spacer"></div>
      <button class="btn btn-sm btn-secondary btn-icon-only" onclick="openEditLoanModal('${loan.loan_id}')">✏️</button>
      <button class="btn btn-sm btn-secondary btn-icon-only" onclick="confirmDeleteLoan('${loan.loan_id}','lend')">🗑️</button>
    </div>
  </div>`;
}

// ==============================================================================
// LEND MODE — PEOPLE VIEW
// ==============================================================================
function renderPeopleView() {
  const container = document.getElementById('people-container');
  if (!container) return;
  const q = (document.getElementById('people-search-input')?.value || '').toLowerCase().trim();

  const map = {};
  state.loans.forEach(loan => {
    const key = (loan.borrower_name||'Unknown').trim().toLowerCase();
    if (!map[key]) map[key] = { name:(loan.borrower_name||'Unknown').trim(), totalLent:0, totalPaid:0, totalBalance:0, count:0 };
    map[key].totalLent += loan.amount;
    map[key].totalPaid += loan.total_paid;
    map[key].totalBalance += loan.remaining_balance;
    map[key].count++;
  });

  let people = Object.values(map);
  if (q) people = people.filter(p => p.name.toLowerCase().includes(q));
  people.sort((a,b) => b.totalBalance - a.totalBalance);

  if (!people.length) { container.innerHTML = '<p class="empty-state">No borrowers recorded yet.</p>'; return; }

  container.innerHTML = people.map(p => `
    <div class="person-card">
      <div class="person-card-header">
        <span class="person-name">👤 ${escapeHtml(p.name)}</span>
        <button class="btn btn-sm btn-secondary" onclick="filterByPerson('${escapeHtml(p.name)}','lend')">Loans (${p.count})</button>
      </div>
      <div class="person-stats">
        <div><span>Lent</span><strong>${formatCurrency(p.totalLent)}</strong></div>
        <div><span>Received</span><strong class="text-success">${formatCurrency(p.totalPaid)}</strong></div>
        <div><span>Balance</span><strong class="${p.totalBalance>0?'text-danger':'text-success'}">${formatCurrency(p.totalBalance)}</strong></div>
      </div>
    </div>`).join('');
}

// ==============================================================================
// BORROW MODE — DASHBOARD
// ==============================================================================
function renderBorrowDashboard() {
  const sum = state.borrowSummary;
  const el = id => document.getElementById(id);
  if (!el('borrow-metric-total-borrowed')) return;

  el('borrow-metric-total-borrowed').textContent = formatCurrency(sum.total_borrowed);
  el('borrow-metric-total-repaid').textContent = formatCurrency(sum.total_repaid);
  el('borrow-metric-total-owe').textContent = formatCurrency(sum.total_i_owe);

  const count = (state.borrowings || []).length;
  el('borrow-metric-total-count').textContent = `${count} Borrowing${count===1?'':'s'} Recorded`;
  const pct = sum.total_borrowed > 0 ? Math.round((sum.total_repaid/sum.total_borrowed)*100) : 0;
  el('borrow-metric-repaid-rate').textContent = `${pct}% Repaid`;
  const pending = (sum.counts.pending||0)+(sum.counts.partial||0);
  el('borrow-metric-pending-count').textContent = `${pending} Still Outstanding`;

  el('borrow-count-overdue').textContent = sum.counts.overdue || 0;
  el('borrow-count-pending').textContent = sum.counts.pending || 0;
  el('borrow-count-partial').textContent = sum.counts.partial || 0;
  el('borrow-count-completed').textContent = sum.counts.completed || 0;
  el('borrowings-tab-count').textContent = count;

  // Overdue borrowings (I'm late repaying)
  const overdueB = state.borrowings.filter(b => b.is_overdue);
  const overdueSection = el('borrow-overdue-section');
  if (overdueSection) {
    overdueSection.classList.toggle('hidden', overdueB.length === 0);
    if (overdueB.length) {
      el('borrow-overdue-badge-count').textContent = overdueB.length;
      el('borrow-overdue-list').innerHTML = overdueB.map(b => compactLoanItem(b, 'borrow')).join('');
    }
  }

  // Upcoming repayments I need to make
  const upcoming = state.borrowings.filter(b =>
    b.status !== 'Completed' && b.expected_return_date &&
    b.days_until_due !== null && b.days_until_due >= 0 && b.days_until_due <= 14
  ).sort((a,b2) => a.days_until_due - b2.days_until_due);

  const upcomingEl = el('borrow-upcoming-dues-list');
  if (upcomingEl) {
    upcomingEl.innerHTML = upcoming.length
      ? upcoming.map(b => compactLoanItem(b, 'borrow')).join('')
      : '<p class="empty-state">No repayments due in the next 14 days.</p>';
  }
}

// ==============================================================================
// BORROW MODE — BORROWINGS LIST
// ==============================================================================
function renderBorrowingsList() {
  const container = document.getElementById('borrow-loans-container');
  if (!container) return;
  if (!state.config.webAppUrl || !state.config.passcode) {
    container.innerHTML = `<div class="empty-state"><p>⚙️ Configure API settings first.</p><button class="btn btn-primary btn-sm" onclick="openModal('settings-modal')">Open Settings</button></div>`;
    return;
  }

  let list = [...state.borrowings];
  const q = state.borrowFilters.search.toLowerCase().trim();
  if (q) list = list.filter(b =>
    (b.lender_name||'').toLowerCase().includes(q) ||
    (b.notes||'').toLowerCase().includes(q) ||
    (b.phone_or_email||'').toLowerCase().includes(q)
  );

  const sf = state.borrowFilters.status;
  if (sf === 'ACTIVE') list = list.filter(b => b.status !== 'Completed');
  else if (sf === 'Overdue') list = list.filter(b => b.is_overdue);
  else if (sf !== 'ALL') list = list.filter(b => b.status === sf);

  list = sortList(list, state.borrowFilters.sortBy, 'borrow');

  if (list.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>No borrowings match your filter.</p><button class="btn btn-secondary btn-sm" onclick="resetBorrowFilters()">Reset Filters</button></div>`;
    return;
  }
  container.innerHTML = list.map(b => renderBorrowingCard(b)).join('');
}

function renderBorrowingCard(b) {
  const totalPayable = b.total_payable || b.amount;
  const pct = totalPayable > 0 ? Math.min(100, Math.round((b.total_paid/totalPayable)*100)) : 0;
  const isOverdue = b.is_overdue;
  const isCompleted = b.status === 'Completed';
  let statusClass = 'badge-pending';
  if (b.status === 'Partial') statusClass = 'badge-partial';
  if (b.status === 'Completed') statusClass = 'badge-completed';
  const cardClass = ['loan-card borrow-card', isOverdue?'is-overdue':'', isCompleted?'is-completed':''].filter(Boolean).join(' ');

  let interestInfo = '';
  if (b.accrued_interest > 0) {
    const rLabel = b.interest_type==='simple_yearly' ? `${b.interest_rate}% p.a.` :
      b.interest_type==='simple_monthly' ? `${b.interest_rate}% p.m.` : 'Fixed Fee';
    interestInfo = ` &bull; <span class="text-warning">Interest: +${formatCurrency(b.accrued_interest)} (${rLabel})</span>`;
  }

  return `<div class="${cardClass}" id="bcard-${b.borrowing_id}">
    <div class="loan-card-top">
      <div class="borrower-info">
        <h3>From: ${escapeHtml(b.lender_name)}</h3>
        <div class="borrower-meta">
          <span>📅 Taken: ${formatDate(b.date_taken)}</span>
          ${b.expected_return_date ? `<span>&bull; Return by: ${formatDate(b.expected_return_date)}</span>` : ''}
          ${b.phone_or_email ? `<span>&bull; 📞 ${escapeHtml(b.phone_or_email)}</span>` : ''}
          ${interestInfo}
        </div>
      </div>
      <div class="badges-group">
        ${isOverdue ? '<span class="badge badge-overdue">⚠️ Overdue</span>' : ''}
        <span class="badge ${statusClass}">${b.status}</span>
      </div>
    </div>
    <div class="loan-financials">
      <div class="fin-col"><span>Borrowed</span><strong>${formatCurrency(b.amount)}</strong></div>
      <div class="fin-col"><span>Repaid</span><strong class="text-success">${formatCurrency(b.total_paid)}</strong></div>
      <div class="fin-col"><span>Still Owe</span><strong class="${b.remaining_balance>0?'text-danger':'text-success'}">${formatCurrency(b.remaining_balance)}</strong></div>
    </div>
    <div>
      <div class="progress-container"><div class="progress-bar borrow-progress" style="width:${pct}%"></div></div>
      <div class="progress-label">${pct}% repaid (${(b.payments||[]).length} payment${(b.payments||[]).length===1?'':'s'})</div>
    </div>
    ${b.notes ? `<div class="loan-card-details"><div class="loan-note">"${escapeHtml(b.notes)}"</div></div>` : ''}
    ${b.attachment_url ? `<div><a href="${b.attachment_url}" target="_blank" rel="noopener" class="attachment-link">📎 View Borrowing Document ↗</a></div>` : ''}
    <div class="loan-card-actions">
      ${!isCompleted ? `<button class="btn btn-sm borrow-btn-primary" onclick="openBorrowPaymentModal('${b.borrowing_id}')">➕ Record Repayment</button>` : ''}
      <button class="btn btn-sm btn-secondary" onclick="viewBorrowPaymentHistory('${b.borrowing_id}')">📜 History (${(b.payments||[]).length})</button>
      ${!isCompleted && b.phone_or_email ? `<button class="btn btn-sm btn-whatsapp" onclick="openWhatsAppReminder('${b.borrowing_id}','borrow')">💬 WhatsApp</button>` : ''}
      <div class="spacer"></div>
      <button class="btn btn-sm btn-secondary btn-icon-only" onclick="openEditBorrowingModal('${b.borrowing_id}')">✏️</button>
      <button class="btn btn-sm btn-secondary btn-icon-only" onclick="confirmDeleteLoan('${b.borrowing_id}','borrow')">🗑️</button>
    </div>
  </div>`;
}

// ==============================================================================
// BORROW MODE — LENDERS VIEW
// ==============================================================================
function renderLendersView() {
  const container = document.getElementById('lenders-container');
  if (!container) return;
  const q = (document.getElementById('lenders-search-input')?.value || '').toLowerCase().trim();

  const map = {};
  state.borrowings.forEach(b => {
    const key = (b.lender_name||'Unknown').trim().toLowerCase();
    if (!map[key]) map[key] = { name:(b.lender_name||'Unknown').trim(), totalBorrowed:0, totalRepaid:0, totalOwe:0, count:0 };
    map[key].totalBorrowed += b.amount;
    map[key].totalRepaid += b.total_paid;
    map[key].totalOwe += b.remaining_balance;
    map[key].count++;
  });

  let people = Object.values(map);
  if (q) people = people.filter(p => p.name.toLowerCase().includes(q));
  people.sort((a,b) => b.totalOwe - a.totalOwe);

  if (!people.length) { container.innerHTML = '<p class="empty-state">No lenders recorded yet.</p>'; return; }

  container.innerHTML = people.map(p => `
    <div class="person-card borrow-person-card">
      <div class="person-card-header">
        <span class="person-name">🏦 ${escapeHtml(p.name)}</span>
        <button class="btn btn-sm btn-secondary" onclick="filterByPerson('${escapeHtml(p.name)}','borrow')">Borrowings (${p.count})</button>
      </div>
      <div class="person-stats">
        <div><span>Borrowed</span><strong>${formatCurrency(p.totalBorrowed)}</strong></div>
        <div><span>Repaid</span><strong class="text-success">${formatCurrency(p.totalRepaid)}</strong></div>
        <div><span>I Still Owe</span><strong class="${p.totalOwe>0?'text-danger':'text-success'}">${formatCurrency(p.totalOwe)}</strong></div>
      </div>
    </div>`).join('');
}

// ==============================================================================
// NET OVERVIEW DASHBOARD
// ==============================================================================
function renderOverview() {
  const el = id => document.getElementById(id);
  if (!el('overview-net-receivable')) return;

  // Apply date filter
  const fromDate = state.overviewFilters.fromDate;
  const toDate = state.overviewFilters.toDate;
  const personFilter = state.overviewFilters.person.toLowerCase().trim();

  let filteredLoans = state.loans.filter(l => {
    if (fromDate && l.date_given < fromDate) return false;
    if (toDate && l.date_given > toDate) return false;
    if (personFilter && !(l.borrower_name||'').toLowerCase().includes(personFilter)) return false;
    return true;
  });
  let filteredBorrowings = state.borrowings.filter(b => {
    if (fromDate && b.date_taken < fromDate) return false;
    if (toDate && b.date_taken > toDate) return false;
    if (personFilter && !(b.lender_name||'').toLowerCase().includes(personFilter)) return false;
    return true;
  });

  const netReceivable = filteredLoans.reduce((s,l) => s + l.remaining_balance, 0);
  const netPayable = filteredBorrowings.reduce((s,b) => s + b.remaining_balance, 0);
  const netPosition = netReceivable - netPayable;

  el('overview-net-receivable').textContent = formatCurrency(netReceivable);
  el('overview-net-payable').textContent = formatCurrency(netPayable);
  el('overview-net-position').textContent = formatCurrency(Math.abs(netPosition));
  el('overview-position-sub').textContent = netPosition >= 0 ? '⚖️ Net You Are Owed' : '⚖️ Net You Owe';

  const posCard = el('overview-position-card');
  if (posCard) {
    posCard.classList.toggle('net-positive', netPosition >= 0);
    posCard.classList.toggle('net-negative', netPosition < 0);
  }

  // Summary counts (optional)
  const elTotLent = el('overview-total-lent');
  if (elTotLent) elTotLent.textContent = formatCurrency(filteredLoans.reduce((s,l) => s+l.amount, 0));
  const elTotBor = el('overview-total-borrowed');
  if (elTotBor) elTotBor.textContent = formatCurrency(filteredBorrowings.reduce((s,b) => s+b.amount, 0));
  const elActLoans = el('overview-active-loans');
  if (elActLoans) elActLoans.textContent = filteredLoans.filter(l => l.status !== 'Completed').length;
  const elActBor = el('overview-active-borrowings');
  if (elActBor) elActBor.textContent = filteredBorrowings.filter(b => b.status !== 'Completed').length;

  // Person-wise combined table
  const personMap = {};
  filteredLoans.forEach(l => {
    const key = (l.borrower_name||'').toLowerCase();
    if (!personMap[key]) personMap[key] = { name:l.borrower_name, theyOweMe:0, iOweThem:0 };
    personMap[key].theyOweMe += l.remaining_balance;
  });
  filteredBorrowings.forEach(b => {
    const key = (b.lender_name||'').toLowerCase();
    if (!personMap[key]) personMap[key] = { name:b.lender_name, theyOweMe:0, iOweThem:0 };
    personMap[key].iOweThem += b.remaining_balance;
  });

  const peopleRows = Object.values(personMap).filter(p => p.theyOweMe > 0 || p.iOweThem > 0);
  peopleRows.sort((a,b) => (b.theyOweMe - b.iOweThem) - (a.theyOweMe - a.iOweThem));

  const table = el('overview-people-net-list');
  if (table) {
    if (!peopleRows.length) {
      table.innerHTML = '<p class="empty-state">No records match the current filter.</p>';
    } else {
      table.innerHTML = `
        <div class="net-table-header people-net-row">
          <span>Person</span>
          <span>They Owe Me 💚</span>
          <span>I Owe Them 🔴</span>
          <span>Net</span>
        </div>
        ${peopleRows.map(p => {
          const net = p.theyOweMe - p.iOweThem;
          return `<div class="people-net-row ${net>0?'net-row-positive':net<0?'net-row-negative':''}">
            <span class="net-person-name">${escapeHtml(p.name)}</span>
            <span class="text-success">${p.theyOweMe > 0 ? formatCurrency(p.theyOweMe) : '-'}</span>
            <span class="text-danger">${p.iOweThem > 0 ? formatCurrency(p.iOweThem) : '-'}</span>
            <strong class="${net>0?'text-success':net<0?'text-danger':''}">${formatCurrency(Math.abs(net))} ${net>0?'↑':net<0?'↓':'='}</strong>
          </div>`;
        }).join('')}`;
    }
  }

  // Recent activity (last 10 combined)
  const allActivity = [
    ...filteredLoans.map(l => l.payments.map(p => ({
      type: 'received', person: l.borrower_name, amount: p.amount, date: p.payment_date, note: p.notes
    }))).flat(),
    ...filteredBorrowings.map(b => (b.payments||[]).map(p => ({
      type: 'repaid', person: b.lender_name, amount: p.amount, date: p.payment_date, note: p.notes
    }))).flat(),
    ...filteredLoans.filter(l => l.date_given).map(l => ({
      type: 'lent', person: l.borrower_name, amount: l.amount, date: l.date_given, note: l.notes
    })),
    ...filteredBorrowings.filter(b => b.date_taken).map(b => ({
      type: 'borrowed', person: b.lender_name, amount: b.amount, date: b.date_taken, note: b.notes
    }))
  ].sort((a,b) => (b.date||'').localeCompare(a.date||'')).slice(0, 10);

  const activityEl = el('overview-recent-activity');
  if (activityEl) {
    const icons = { received:'💚', repaid:'🔴', lent:'💙', borrowed:'🟠' };
    const labels = { received:'Received from', repaid:'Repaid to', lent:'Lent to', borrowed:'Borrowed from' };
    activityEl.innerHTML = allActivity.length ? allActivity.map(a => `
      <div class="activity-item">
        <span class="activity-icon">${icons[a.type]}</span>
        <div class="activity-body">
          <div class="activity-title">${labels[a.type]} <strong>${escapeHtml(a.person)}</strong></div>
          <div class="activity-sub">${formatDate(a.date)}${a.note ? ` &bull; "${escapeHtml(a.note)}"` : ''}</div>
        </div>
        <div class="activity-amount ${a.type==='lent'||a.type==='borrowed'?'text-danger':'text-success'}">${a.type==='received'||a.type==='repaid'?'+':'-'}${formatCurrency(a.amount)}</div>
      </div>`).join('')
    : '<p class="empty-state">No recent activity.</p>';
  }
}

// ==============================================================================
// MODALS - ADD / EDIT LOAN (Lend Mode)
// ==============================================================================
const interestTypeSelect = document.getElementById('loan-interest-type');
const interestRateGroup = document.getElementById('interest-rate-group');
const interestRateLabel = document.getElementById('interest-rate-label');

if (interestTypeSelect) {
  interestTypeSelect.addEventListener('change', () => updateInterestLabel(interestTypeSelect.value, interestRateGroup, interestRateLabel));
}

function updateInterestLabel(val, group, label) {
  if (!group || !label) return;
  if (val === 'none') { group.classList.add('hidden'); return; }
  group.classList.remove('hidden');
  if (val === 'fixed_amount') label.textContent = 'Fixed Fee Amount (₹)';
  else if (val === 'simple_monthly') label.textContent = 'Monthly Interest Rate (%)';
  else label.textContent = 'Yearly Interest Rate (%)';
}

document.getElementById('loan-file')?.addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    state.loanFileUpload = await readFileAsBase64(file);
    document.getElementById('loan-file-name').textContent = `📄 ${file.name} (${Math.round(file.size/1024)}KB)`;
    document.getElementById('loan-file-preview').classList.remove('hidden');
  } catch(err) { showToast(err.message,'error'); e.target.value=''; }
});

document.getElementById('remove-loan-file-btn')?.addEventListener('click', () => {
  state.loanFileUpload = null;
  document.getElementById('loan-file').value = '';
  document.getElementById('loan-file-preview').classList.add('hidden');
  document.getElementById('loan-existing-attachment').value = '';
});

function openAddLoanModal() {
  document.getElementById('loan-modal-title').textContent = 'Record New Loan (Money I Lend)';
  document.getElementById('loan-form-id').value = '';
  document.getElementById('loan-form').reset();
  document.getElementById('loan-date-given').value = getTodayIsoString();
  interestTypeSelect && (interestTypeSelect.value = 'none');
  interestRateGroup && interestRateGroup.classList.add('hidden');
  state.loanFileUpload = null;
  document.getElementById('loan-file-preview')?.classList.add('hidden');
  openModal('loan-modal');
}

function openEditLoanModal(loanId) {
  const loan = state.loans.find(l => l.loan_id === loanId);
  if (!loan) return;
  document.getElementById('loan-modal-title').textContent = 'Edit Loan Details';
  document.getElementById('loan-form-id').value = loan.loan_id;
  document.getElementById('loan-borrower').value = loan.borrower_name;
  document.getElementById('loan-amount').value = loan.amount;
  document.getElementById('loan-date-given').value = loan.date_given;
  document.getElementById('loan-return-date').value = loan.expected_return_date || '';
  document.getElementById('loan-contact').value = loan.phone_or_email || '';
  document.getElementById('loan-notes').value = loan.notes || '';
  if (interestTypeSelect) {
    interestTypeSelect.value = loan.interest_type || 'none';
    updateInterestLabel(interestTypeSelect.value, interestRateGroup, interestRateLabel);
  }
  document.getElementById('loan-interest-rate').value = loan.interest_rate || 0;
  document.getElementById('loan-existing-attachment').value = loan.attachment_url || '';
  state.loanFileUpload = null;
  document.getElementById('loan-file').value = '';
  if (loan.attachment_url) {
    document.getElementById('loan-file-name').innerHTML = `<a href="${loan.attachment_url}" target="_blank" rel="noopener">📄 Existing Document ↗</a>`;
    document.getElementById('loan-file-preview').classList.remove('hidden');
  } else {
    document.getElementById('loan-file-preview')?.classList.add('hidden');
  }
  openModal('loan-modal');
}

document.getElementById('loan-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const submitBtn = document.getElementById('loan-submit-btn');
  const loanId = document.getElementById('loan-form-id').value;
  const payload = {
    loan_id: loanId,
    borrower_name: document.getElementById('loan-borrower').value.trim(),
    amount: parseFloat(document.getElementById('loan-amount').value),
    date_given: document.getElementById('loan-date-given').value,
    expected_return_date: document.getElementById('loan-return-date').value,
    phone_or_email: document.getElementById('loan-contact').value.trim(),
    notes: document.getElementById('loan-notes').value.trim(),
    interest_type: document.getElementById('loan-interest-type')?.value || 'none',
    interest_rate: parseFloat(document.getElementById('loan-interest-rate')?.value) || 0,
    attachment_url: document.getElementById('loan-existing-attachment').value
  };
  if (state.loanFileUpload) Object.assign(payload, state.loanFileUpload);
  if (!payload.borrower_name) { showToast('Borrower name is required','warning'); return; }
  if (!payload.amount || payload.amount <= 0) { showToast('Amount must be a positive number','warning'); return; }
  submitBtn.disabled = true; submitBtn.textContent = state.loanFileUpload ? 'Uploading...' : 'Saving...';
  try {
    await apiPost(loanId ? 'updateLoan' : 'addLoan', payload);
    showToast(loanId ? 'Loan updated!' : 'Loan recorded!', 'success');
    closeModal('loan-modal');
    await fetchAllData(false);
  } catch(err) { showToast(err.message,'error'); }
  finally { submitBtn.disabled=false; submitBtn.textContent='Save Loan'; }
});

// ==============================================================================
// MODALS - ADD / EDIT BORROWING (Borrow Mode)
// ==============================================================================
const borrowInterestTypeSelect = document.getElementById('borrowing-interest-type');
const borrowInterestRateGroup = document.getElementById('borrowing-interest-rate-group');
const borrowInterestRateLabel = document.getElementById('borrowing-interest-rate-label');

if (borrowInterestTypeSelect) {
  borrowInterestTypeSelect.addEventListener('change', () =>
    updateInterestLabel(borrowInterestTypeSelect.value, borrowInterestRateGroup, borrowInterestRateLabel)
  );
}

document.getElementById('borrowing-file')?.addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    state.borrowFileUpload = await readFileAsBase64(file);
    document.getElementById('borrowing-file-name').textContent = `📄 ${file.name}`;
    document.getElementById('borrowing-file-preview').classList.remove('hidden');
  } catch(err) { showToast(err.message,'error'); e.target.value=''; }
});

document.getElementById('remove-borrowing-file-btn')?.addEventListener('click', () => {
  state.borrowFileUpload = null;
  document.getElementById('borrowing-file').value = '';
  document.getElementById('borrowing-file-preview').classList.add('hidden');
  document.getElementById('borrowing-existing-attachment').value = '';
});

function openAddBorrowingModal() {
  document.getElementById('borrowing-modal-title').textContent = 'Record New Borrowing (Money I Took)';
  document.getElementById('borrowing-form-id').value = '';
  document.getElementById('borrowing-form').reset();
  document.getElementById('borrowing-date-taken').value = getTodayIsoString();
  borrowInterestTypeSelect && (borrowInterestTypeSelect.value = 'none');
  borrowInterestRateGroup && borrowInterestRateGroup.classList.add('hidden');
  state.borrowFileUpload = null;
  document.getElementById('borrowing-file-preview')?.classList.add('hidden');
  openModal('borrowing-modal');
}

function openEditBorrowingModal(borrowingId) {
  const b = state.borrowings.find(x => x.borrowing_id === borrowingId);
  if (!b) return;
  document.getElementById('borrowing-modal-title').textContent = 'Edit Borrowing Details';
  document.getElementById('borrowing-form-id').value = b.borrowing_id;
  document.getElementById('borrowing-lender').value = b.lender_name;
  document.getElementById('borrowing-amount').value = b.amount;
  document.getElementById('borrowing-date-taken').value = b.date_taken;
  document.getElementById('borrowing-return-date').value = b.expected_return_date || '';
  document.getElementById('borrowing-contact').value = b.phone_or_email || '';
  document.getElementById('borrowing-notes').value = b.notes || '';
  if (borrowInterestTypeSelect) {
    borrowInterestTypeSelect.value = b.interest_type || 'none';
    updateInterestLabel(borrowInterestTypeSelect.value, borrowInterestRateGroup, borrowInterestRateLabel);
  }
  document.getElementById('borrowing-interest-rate').value = b.interest_rate || 0;
  document.getElementById('borrowing-existing-attachment').value = b.attachment_url || '';
  state.borrowFileUpload = null;
  document.getElementById('borrowing-file').value = '';
  if (b.attachment_url) {
    document.getElementById('borrowing-file-name').innerHTML = `<a href="${b.attachment_url}" target="_blank" rel="noopener">📄 Existing Doc ↗</a>`;
    document.getElementById('borrowing-file-preview').classList.remove('hidden');
  } else {
    document.getElementById('borrowing-file-preview')?.classList.add('hidden');
  }
  openModal('borrowing-modal');
}

document.getElementById('borrowing-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const submitBtn = document.getElementById('borrowing-submit-btn');
  const borrowingId = document.getElementById('borrowing-form-id').value;
  const payload = {
    borrowing_id: borrowingId,
    lender_name: document.getElementById('borrowing-lender').value.trim(),
    amount: parseFloat(document.getElementById('borrowing-amount').value),
    date_taken: document.getElementById('borrowing-date-taken').value,
    expected_return_date: document.getElementById('borrowing-return-date').value,
    phone_or_email: document.getElementById('borrowing-contact').value.trim(),
    notes: document.getElementById('borrowing-notes').value.trim(),
    interest_type: borrowInterestTypeSelect?.value || 'none',
    interest_rate: parseFloat(document.getElementById('borrowing-interest-rate')?.value) || 0,
    attachment_url: document.getElementById('borrowing-existing-attachment').value
  };
  if (state.borrowFileUpload) Object.assign(payload, state.borrowFileUpload);
  if (!payload.lender_name) { showToast('Lender name is required','warning'); return; }
  if (!payload.amount || payload.amount <= 0) { showToast('Amount must be positive','warning'); return; }
  submitBtn.disabled = true; submitBtn.textContent = 'Saving...';
  try {
    await apiPost(borrowingId ? 'updateBorrowing' : 'addBorrowing', payload);
    showToast(borrowingId ? 'Borrowing updated!' : 'Borrowing recorded!', 'success');
    closeModal('borrowing-modal');
    await fetchAllData(false);
  } catch(err) { showToast(err.message,'error'); }
  finally { submitBtn.disabled=false; submitBtn.textContent='Save Borrowing'; }
});

// ==============================================================================
// PAYMENT MODALS - LEND MODE
// ==============================================================================
document.getElementById('pay-file')?.addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    state.paymentFileUpload = await readFileAsBase64(file);
    document.getElementById('pay-file-name').textContent = `📸 ${file.name}`;
    document.getElementById('pay-file-preview').classList.remove('hidden');
  } catch(err) { showToast(err.message,'error'); e.target.value=''; }
});

document.getElementById('remove-pay-file-btn')?.addEventListener('click', () => {
  state.paymentFileUpload = null;
  document.getElementById('pay-file').value = '';
  document.getElementById('pay-file-preview').classList.add('hidden');
});

function openPaymentModal(loanId) {
  const loan = state.loans.find(l => l.loan_id === loanId);
  if (!loan) return;
  state.activeLoanForPayment = loan;
  document.getElementById('pay-loan-id').value = loan.loan_id;
  document.getElementById('pay-modal-borrower').textContent = loan.borrower_name;
  document.getElementById('pay-modal-principal').textContent = formatCurrency(loan.amount);
  const intRow = document.getElementById('pay-modal-interest-row');
  if (intRow) intRow.classList.toggle('hidden', !loan.accrued_interest);
  document.getElementById('pay-modal-interest').textContent = `+ ${formatCurrency(loan.accrued_interest||0)}`;
  document.getElementById('pay-modal-paid').textContent = formatCurrency(loan.total_paid);
  document.getElementById('pay-modal-balance').textContent = formatCurrency(loan.remaining_balance);
  document.getElementById('payment-form').reset();
  state.paymentFileUpload = null;
  document.getElementById('pay-file-preview')?.classList.add('hidden');
  document.getElementById('pay-date').value = getTodayIsoString();
  document.getElementById('pay-amount').value = loan.remaining_balance > 0 ? loan.remaining_balance : '';
  document.getElementById('payment-warning').classList.add('hidden');
  openModal('payment-modal');
}

document.getElementById('pay-amount')?.addEventListener('input', e => {
  const loan = state.activeLoanForPayment;
  if (!loan) return;
  const entered = parseFloat(e.target.value) || 0;
  const warn = document.getElementById('payment-warning');
  if (entered > (loan.remaining_balance + 0.05)) {
    warn.textContent = `⚠️ Amount (${formatCurrency(entered)}) exceeds remaining balance (${formatCurrency(loan.remaining_balance)})!`;
    warn.classList.remove('hidden');
  } else { warn.classList.add('hidden'); }
});

document.getElementById('payment-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const loan = state.activeLoanForPayment;
  if (!loan) return;
  const submitBtn = document.getElementById('payment-submit-btn');
  const amount = parseFloat(document.getElementById('pay-amount').value);
  if (!amount || amount <= 0) { showToast('Enter a valid amount','warning'); return; }
  if (amount > (loan.remaining_balance + 0.05)) { showToast(`Cannot exceed balance of ${formatCurrency(loan.remaining_balance)}`,'error'); return; }
  const payload = {
    loan_id: loan.loan_id,
    amount,
    payment_date: document.getElementById('pay-date').value,
    notes: document.getElementById('pay-notes').value.trim()
  };
  if (state.paymentFileUpload) Object.assign(payload, state.paymentFileUpload);
  submitBtn.disabled = true; submitBtn.textContent = 'Recording...';
  try {
    await apiPost('addPayment', payload);
    showToast(`₹${amount} payment recorded!`, 'success');
    closeModal('payment-modal');
    await fetchAllData(false);
  } catch(err) { showToast(err.message,'error'); }
  finally { submitBtn.disabled=false; submitBtn.textContent='Record Repayment'; }
});

// ==============================================================================
// PAYMENT MODALS - BORROW MODE
// ==============================================================================
document.getElementById('borrow-pay-file')?.addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    state.borrowPayFileUpload = await readFileAsBase64(file);
    document.getElementById('borrow-pay-file-name').textContent = `📸 ${file.name}`;
    document.getElementById('borrow-pay-file-preview').classList.remove('hidden');
  } catch(err) { showToast(err.message,'error'); e.target.value=''; }
});

document.getElementById('remove-borrow-pay-file-btn')?.addEventListener('click', () => {
  state.borrowPayFileUpload = null;
  document.getElementById('borrow-pay-file').value = '';
  document.getElementById('borrow-pay-file-preview').classList.add('hidden');
});

function openBorrowPaymentModal(borrowingId) {
  const b = state.borrowings.find(x => x.borrowing_id === borrowingId);
  if (!b) return;
  state.activeBorrowingForPayment = b;
  document.getElementById('borrow-pay-borrowing-id').value = b.borrowing_id;
  document.getElementById('borrow-pay-modal-lender').textContent = b.lender_name;
  document.getElementById('borrow-pay-modal-principal').textContent = formatCurrency(b.amount);
  document.getElementById('borrow-pay-modal-paid').textContent = formatCurrency(b.total_paid);
  document.getElementById('borrow-pay-modal-balance').textContent = formatCurrency(b.remaining_balance);
  document.getElementById('borrow-payment-form').reset();
  state.borrowPayFileUpload = null;
  document.getElementById('borrow-pay-file-preview')?.classList.add('hidden');
  document.getElementById('borrow-pay-date').value = getTodayIsoString();
  document.getElementById('borrow-pay-amount').value = b.remaining_balance > 0 ? b.remaining_balance : '';
  document.getElementById('borrow-payment-warning').classList.add('hidden');
  openModal('borrow-payment-modal');
}

document.getElementById('borrow-pay-amount')?.addEventListener('input', e => {
  const b = state.activeBorrowingForPayment;
  if (!b) return;
  const entered = parseFloat(e.target.value) || 0;
  const warn = document.getElementById('borrow-payment-warning');
  if (entered > (b.remaining_balance + 0.05)) {
    warn.textContent = `⚠️ Exceeds balance of ${formatCurrency(b.remaining_balance)}`;
    warn.classList.remove('hidden');
  } else { warn.classList.add('hidden'); }
});

document.getElementById('borrow-payment-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const b = state.activeBorrowingForPayment;
  if (!b) return;
  const submitBtn = document.getElementById('borrow-payment-submit-btn');
  const amount = parseFloat(document.getElementById('borrow-pay-amount').value);
  if (!amount || amount <= 0) { showToast('Enter a valid amount','warning'); return; }
  if (amount > (b.remaining_balance + 0.05)) { showToast(`Cannot exceed balance of ${formatCurrency(b.remaining_balance)}`,'error'); return; }
  const payload = {
    borrowing_id: b.borrowing_id,
    amount,
    payment_date: document.getElementById('borrow-pay-date').value,
    notes: document.getElementById('borrow-pay-notes').value.trim()
  };
  if (state.borrowPayFileUpload) Object.assign(payload, state.borrowPayFileUpload);
  submitBtn.disabled = true; submitBtn.textContent = 'Recording...';
  try {
    await apiPost('addBorrowPayment', payload);
    showToast(`₹${amount} repayment recorded!`, 'success');
    closeModal('borrow-payment-modal');
    await fetchAllData(false);
  } catch(err) { showToast(err.message,'error'); }
  finally { submitBtn.disabled=false; submitBtn.textContent='Record Repayment'; }
});

// ==============================================================================
// PAYMENT HISTORY (LEND)
// ==============================================================================
function viewPaymentHistory(loanId) {
  const loan = state.loans.find(l => l.loan_id === loanId);
  if (!loan) return;
  document.getElementById('history-loan-subtitle').textContent = `${loan.borrower_name} · Given: ${formatDate(loan.date_given)}`;
  document.getElementById('history-principal').textContent = formatCurrency(loan.amount);
  const intEl = document.getElementById('history-interest-metric');
  if (intEl) intEl.classList.toggle('hidden', !loan.accrued_interest);
  document.getElementById('history-interest').textContent = formatCurrency(loan.accrued_interest||0);
  document.getElementById('history-paid').textContent = formatCurrency(loan.total_paid);
  document.getElementById('history-balance').textContent = formatCurrency(loan.remaining_balance);
  const totalPayable = loan.total_payable || loan.amount;
  const pct = totalPayable > 0 ? Math.min(100, Math.round((loan.total_paid/totalPayable)*100)) : 0;
  document.getElementById('history-progress-bar').style.width = `${pct}%`;
  document.getElementById('history-progress-text').textContent = `${pct}% received (${loan.payments.length} transactions)`;
  const tl = document.getElementById('timeline-list');
  tl.innerHTML = loan.payments.length ? loan.payments.map(p => `
    <div class="timeline-entry">
      <div>
        <div class="entry-amount">+ ${formatCurrency(p.amount)}</div>
        <div class="entry-date">📅 ${formatDate(p.payment_date)}</div>
        ${p.notes?`<div class="entry-notes">"${escapeHtml(p.notes)}"</div>`:''}
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        ${p.receipt_url?`<a href="${p.receipt_url}" target="_blank" rel="noopener" class="receipt-thumb-link">📎 Receipt ↗</a>`:''}
        <button class="btn btn-sm btn-secondary btn-icon-only" onclick="deletePaymentRecord('${p.payment_id}','${loanId}','lend')">🗑️</button>
      </div>
    </div>`).join('') : '<p class="empty-state">No repayments recorded yet.</p>';
  const addBtn = document.getElementById('history-add-payment-btn');
  if (addBtn) {
    addBtn.classList.toggle('hidden', loan.status==='Completed');
    addBtn.onclick = () => { closeModal('history-modal'); openPaymentModal(loanId); };
  }
  openModal('history-modal');
}

// ==============================================================================
// PAYMENT HISTORY (BORROW)
// ==============================================================================
function viewBorrowPaymentHistory(borrowingId) {
  const b = state.borrowings.find(x => x.borrowing_id === borrowingId);
  if (!b) return;
  document.getElementById('borrow-history-subtitle').textContent = `From: ${b.lender_name} · Taken: ${formatDate(b.date_taken)}`;
  document.getElementById('borrow-history-principal').textContent = formatCurrency(b.amount);
  document.getElementById('borrow-history-paid').textContent = formatCurrency(b.total_paid);
  document.getElementById('borrow-history-balance').textContent = formatCurrency(b.remaining_balance);
  const totalPayable = b.total_payable || b.amount;
  const pct = totalPayable > 0 ? Math.min(100, Math.round((b.total_paid/totalPayable)*100)) : 0;
  document.getElementById('borrow-history-progress-bar').style.width = `${pct}%`;
  document.getElementById('borrow-history-progress-text').textContent = `${pct}% repaid (${(b.payments||[]).length} transactions)`;
  const tl = document.getElementById('borrow-timeline-list');
  tl.innerHTML = (b.payments||[]).length ? (b.payments||[]).map(p => `
    <div class="timeline-entry">
      <div>
        <div class="entry-amount text-danger">- ${formatCurrency(p.amount)}</div>
        <div class="entry-date">📅 ${formatDate(p.payment_date)}</div>
        ${p.notes?`<div class="entry-notes">"${escapeHtml(p.notes)}"</div>`:''}
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        ${p.receipt_url?`<a href="${p.receipt_url}" target="_blank" rel="noopener" class="receipt-thumb-link">📎 Receipt ↗</a>`:''}
        <button class="btn btn-sm btn-secondary btn-icon-only" onclick="deletePaymentRecord('${p.borrow_payment_id||p.payment_id}','${borrowingId}','borrow')">🗑️</button>
      </div>
    </div>`).join('') : '<p class="empty-state">No repayments recorded yet.</p>';
  const addBtn = document.getElementById('borrow-history-add-payment-btn');
  if (addBtn) {
    addBtn.classList.toggle('hidden', b.status==='Completed');
    addBtn.onclick = () => { closeModal('borrow-history-modal'); openBorrowPaymentModal(borrowingId); };
  }
  openModal('borrow-history-modal');
}

async function deletePaymentRecord(paymentId, parentId, mode) {
  if (!confirm('Remove this payment entry?')) return;
  try {
    const action = mode === 'borrow' ? 'deleteBorrowPayment' : 'deletePayment';
    const key = mode === 'borrow' ? 'borrow_payment_id' : 'payment_id';
    await apiPost(action, { [key]: paymentId });
    showToast('Payment entry removed', 'success');
    await fetchAllData(false);
    if (mode === 'borrow') viewBorrowPaymentHistory(parentId);
    else viewPaymentHistory(parentId);
  } catch(err) { showToast(err.message,'error'); }
}

// ==============================================================================
// DELETE CONFIRMATION
// ==============================================================================
function confirmDeleteLoan(id, mode) {
  const item = mode === 'borrow'
    ? state.borrowings.find(b => b.borrowing_id === id)
    : state.loans.find(l => l.loan_id === id);
  if (!item) return;
  if (mode === 'borrow') state.activeBorrowingForDelete = item;
  else state.activeLoanForDelete = item;
  document.getElementById('delete-borrower-name').textContent = mode === 'borrow' ? item.lender_name : item.borrower_name;
  document.getElementById('delete-record-type').textContent = mode === 'borrow' ? 'borrowing' : 'loan';
  openModal('delete-modal');
}

document.getElementById('confirm-delete-btn')?.addEventListener('click', async () => {
  const isDeleteLend = !!state.activeLoanForDelete && !state.activeBorrowingForDelete;
  const item = state.activeLoanForDelete || state.activeBorrowingForDelete;
  if (!item) return;
  const btn = document.getElementById('confirm-delete-btn');
  btn.disabled = true; btn.textContent = 'Deleting...';
  try {
    if (state.activeLoanForDelete) {
      await apiPost('deleteLoan', { loan_id: item.loan_id });
      state.activeLoanForDelete = null;
    } else {
      await apiPost('deleteBorrowing', { borrowing_id: item.borrowing_id });
      state.activeBorrowingForDelete = null;
    }
    showToast('Record deleted permanently', 'success');
    closeModal('delete-modal');
    await fetchAllData(false);
  } catch(err) { showToast(err.message,'error'); }
  finally { btn.disabled=false; btn.textContent='Delete Permanently'; }
});

// ==============================================================================
// SHARE PORTAL
// ==============================================================================
function openSharePortalModal(id, mode) {
  const item = mode === 'borrow'
    ? state.borrowings.find(b => b.borrowing_id === id)
    : state.loans.find(l => l.loan_id === id);
  if (!item) return;
  state.activeLoanForShare = { item, mode };
  const name = mode === 'borrow' ? item.lender_name : item.borrower_name;
  document.getElementById('portal-share-name').textContent = name;
  const base = `${window.location.origin}${window.location.pathname}`.replace(/\/index\.html$/,'/');
  const portalUrl = `${base}?portal=${item.portal_token}&api=${encodeURIComponent(state.config.webAppUrl)}`;
  document.getElementById('portal-share-url-input').value = portalUrl;
  document.getElementById('copy-portal-url-btn').onclick = () => {
    navigator.clipboard.writeText(portalUrl).then(() => showToast('Link copied!','success'));
  };
  document.getElementById('preview-portal-btn').onclick = () => window.open(portalUrl,'_blank');
  document.getElementById('whatsapp-share-portal-btn').onclick = () => {
    let phone = (item.phone_or_email||'').replace(/[^0-9+]/g,'');
    if (phone.length===10) phone = '91'+phone;
    else if (phone.startsWith('+')) phone = phone.substring(1);
    const msg = `Hi ${name}, here's your live loan statement: ${portalUrl}`;
    window.open(`https://wa.me/${phone||''}?text=${encodeURIComponent(msg)}`, '_blank');
  };
  openModal('portal-share-modal');
}

// ==============================================================================
// WHATSAPP REMINDER
// ==============================================================================
function openWhatsAppReminder(id, mode) {
  const item = mode === 'borrow'
    ? state.borrowings.find(b => b.borrowing_id === id)
    : state.loans.find(l => l.loan_id === id);
  if (!item) return;
  let phone = (item.phone_or_email||'').replace(/[^0-9+]/g,'');
  if (!phone) { showToast('No phone number saved','warning'); return; }
  if (phone.length===10) phone = '91'+phone;
  else if (phone.startsWith('+')) phone = phone.substring(1);
  const name = mode === 'borrow' ? item.lender_name : item.borrower_name;
  const balance = formatCurrency(item.remaining_balance);
  const msg = mode === 'borrow'
    ? `Hi ${name}, just a reminder that I need to return ${balance} to you by ${formatDate(item.expected_return_date||'')}. I will arrange it soon. Thank you!`
    : `Hi ${name}, hope you're doing well! Friendly reminder about the outstanding balance of ${balance} from the loan given on ${formatDate(item.date_given||'')}. Thank you!`;
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer');
}

// ==============================================================================
// PORTAL MODE (BORROWER READ-ONLY VIEW)
// ==============================================================================
async function checkAndInitPortalMode() {
  const urlParams = new URLSearchParams(window.location.search);
  const portalToken = urlParams.get('portal');
  const customApi = urlParams.get('api');
  if (!portalToken) return false;
  state.isPortalMode = true;
  document.getElementById('admin-app-view').classList.add('hidden');
  const portalView = document.getElementById('borrower-portal-view');
  portalView.classList.remove('hidden');
  const apiUrl = customApi ? decodeURIComponent(customApi) : state.config.webAppUrl;
  if (!apiUrl) { portalView.innerHTML = '<div class="portal-card"><h2>⚠️ Link is incomplete — ask the lender to resend.</h2></div>'; return true; }
  try {
    const res = await apiGet('getPortalData', { token: portalToken }, apiUrl);
    renderBorrowerPortal(res.data);
  } catch(err) {
    portalView.innerHTML = `<div class="portal-card"><h2>⚠️ Could not load statement</h2><p>${escapeHtml(err.message)}</p></div>`;
  }
  return true;
}

function renderBorrowerPortal(portalData) {
  const { loan, lender_name, lender_upi, is_borrowing } = portalData;
  const myName = lender_name || state.config.lenderName || 'Your Lender';
  const title = is_borrowing ? 'Borrowing Statement' : 'Loan Statement';
  const labelName = is_borrowing ? 'Lender (You owe this person)' : 'Borrower';
  const personName = is_borrowing ? loan.lender_name : loan.borrower_name;

  document.getElementById('portal-lender-name').textContent = myName;
  document.getElementById('portal-borrower').textContent = personName;
  document.getElementById('portal-date-given').textContent = formatDate(loan.date_given || loan.date_taken);
  document.getElementById('portal-due-date').textContent = loan.expected_return_date ? formatDate(loan.expected_return_date) : 'No fixed date';

  const badge = document.getElementById('portal-status-badge');
  badge.textContent = loan.is_overdue ? '⚠️ Overdue' : loan.status;
  badge.className = `badge ${loan.is_overdue?'badge-overdue':loan.status==='Completed'?'badge-completed':loan.status==='Partial'?'badge-partial':'badge-pending'}`;

  document.getElementById('portal-principal').textContent = formatCurrency(loan.amount);
  const intBox = document.getElementById('portal-interest-box');
  if (loan.accrued_interest > 0) {
    intBox.classList.remove('hidden');
    document.getElementById('portal-interest').textContent = formatCurrency(loan.accrued_interest);
    document.getElementById('portal-interest-rate').textContent =
      loan.interest_type==='simple_yearly' ? `${loan.interest_rate}% p.a.` :
      loan.interest_type==='simple_monthly' ? `${loan.interest_rate}% p.m.` : 'Fixed Fee';
  } else intBox.classList.add('hidden');

  document.getElementById('portal-balance').textContent = formatCurrency(loan.remaining_balance);

  const totalPayable = loan.total_payable || loan.amount;
  const pct = totalPayable > 0 ? Math.min(100, Math.round((loan.total_paid/totalPayable)*100)) : 0;
  document.getElementById('portal-progress-bar').style.width = `${pct}%`;
  document.getElementById('portal-paid-text').textContent = `${formatCurrency(loan.total_paid)} paid of ${formatCurrency(totalPayable)}`;
  document.getElementById('portal-pct-text').textContent = `${pct}%`;

  const listEl = document.getElementById('portal-payments-list');
  listEl.innerHTML = (loan.payments||[]).length ? (loan.payments||[]).map(p => `
    <div class="timeline-entry">
      <div>
        <div class="entry-amount">+ ${formatCurrency(p.amount)}</div>
        <div class="entry-date">📅 ${formatDate(p.payment_date)}</div>
        ${p.notes?`<div class="entry-notes">"${escapeHtml(p.notes)}"</div>`:''}
      </div>
      ${p.receipt_url?`<a href="${p.receipt_url}" target="_blank" rel="noopener" class="receipt-thumb-link">📎 Receipt ↗</a>`:''}
    </div>`).join('') : '<p class="empty-state">No payments recorded yet.</p>';

  const attBox = document.getElementById('portal-attachment-box');
  if (loan.attachment_url) {
    attBox.classList.remove('hidden');
    document.getElementById('portal-attachment-link').href = loan.attachment_url;
  } else attBox.classList.add('hidden');

  const upiBox = document.getElementById('portal-upi-box');
  if (lender_upi && loan.remaining_balance > 0) {
    upiBox.classList.remove('hidden');
    document.getElementById('portal-upi-id').textContent = lender_upi;
    const upiUri = `upi://pay?pa=${encodeURIComponent(lender_upi)}&pn=${encodeURIComponent(myName)}&am=${loan.remaining_balance}&cu=INR&tn=${encodeURIComponent('Loan Repayment')}`;
    document.getElementById('portal-upi-btn').href = upiUri;
    document.getElementById('copy-upi-btn').onclick = () => navigator.clipboard.writeText(lender_upi).then(()=>showToast('UPI ID copied!','success'));
  } else upiBox.classList.add('hidden');

  document.getElementById('portal-contact-btn').onclick = () => {
    const msg = encodeURIComponent(`Hi ${myName}, I checked the statement. Outstanding balance is ${formatCurrency(loan.remaining_balance)}.`);
    window.open(`https://wa.me/?text=${msg}`, '_blank');
  };
}

// ==============================================================================
// CSV EXPORT
// ==============================================================================
function exportLoansToCsv() {
  if (!state.loans.length) { showToast('No loans to export','warning'); return; }
  const headers = ['Loan ID','Borrower','Principal','Date Given','Return Date','Contact','Notes','Interest Rate','Interest Type','Interest','Total Payable','Total Received','Balance','Status'];
  const rows = state.loans.map(l => [l.loan_id,`"${(l.borrower_name||'').replace(/"/g,'""')}"`,l.amount,l.date_given,l.expected_return_date||'',`"${(l.phone_or_email||'').replace(/"/g,'""')}"`,`"${(l.notes||'').replace(/"/g,'""')}"`,l.interest_rate||0,l.interest_type||'none',l.accrued_interest||0,l.total_payable||l.amount,l.total_paid,l.remaining_balance,l.status]);
  downloadCsv('LendTracker_Loans_'+getTodayIsoString()+'.csv', [headers.join(','),...rows.map(r=>r.join(','))].join('\n'));
}

function exportBorrowingsToCsv() {
  if (!state.borrowings.length) { showToast('No borrowings to export','warning'); return; }
  const headers = ['Borrowing ID','Lender','Principal','Date Taken','Return Date','Contact','Notes','Interest Rate','Interest Type','Interest','Total Payable','Total Repaid','Still Owe','Status'];
  const rows = state.borrowings.map(b => [b.borrowing_id,`"${(b.lender_name||'').replace(/"/g,'""')}"`,b.amount,b.date_taken,b.expected_return_date||'',`"${(b.phone_or_email||'').replace(/"/g,'""')}"`,`"${(b.notes||'').replace(/"/g,'""')}"`,b.interest_rate||0,b.interest_type||'none',b.accrued_interest||0,b.total_payable||b.amount,b.total_paid,b.remaining_balance,b.status]);
  downloadCsv('LendTracker_Borrowings_'+getTodayIsoString()+'.csv', [headers.join(','),...rows.map(r=>r.join(','))].join('\n'));
}

function downloadCsv(filename, content) {
  const blob = new Blob(['\uFEFF'+content], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
  showToast(`Downloaded ${filename}`, 'success');
}

// ==============================================================================
// SETTINGS
// ==============================================================================
function loadSettingsForm() {
  document.getElementById('setting-webapp-url').value = state.config.webAppUrl;
  document.getElementById('setting-passcode').value = state.config.passcode;
  document.getElementById('setting-currency').value = state.config.currency || '₹';
  document.getElementById('setting-lender-name').value = state.config.lenderName || '';
  document.getElementById('setting-upi-id').value = state.config.upiId || '';
  document.getElementById('test-result').textContent = '';
}

document.getElementById('settings-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const url = document.getElementById('setting-webapp-url').value.trim();
  state.config.webAppUrl = url;
  state.config.passcode = document.getElementById('setting-passcode').value.trim();
  state.config.currency = document.getElementById('setting-currency').value.trim() || '₹';
  state.config.lenderName = document.getElementById('setting-lender-name').value.trim();
  state.config.upiId = document.getElementById('setting-upi-id').value.trim();
  localStorage.setItem('lt_webapp_url', state.config.webAppUrl);
  localStorage.setItem('lt_passcode', state.config.passcode);
  localStorage.setItem('lt_currency', state.config.currency);
  localStorage.setItem('lt_lender_name', state.config.lenderName);
  localStorage.setItem('lt_upi_id', state.config.upiId);
  showToast('Settings saved!','success');
  closeModal('settings-modal');
  await fetchAllData(true);
});

document.getElementById('test-connection-btn')?.addEventListener('click', async () => {
  const resultEl = document.getElementById('test-result');
  const url = document.getElementById('setting-webapp-url').value.trim();
  const passcode = document.getElementById('setting-passcode').value.trim();
  if (!url || !passcode) { resultEl.textContent='❌ Fill URL & Passcode first'; resultEl.style.color='var(--danger)'; return; }
  resultEl.textContent='Testing...'; resultEl.style.color='var(--text-muted)';
  try {
    const testUrl = new URL(url);
    testUrl.searchParams.set('action','ping'); testUrl.searchParams.set('passcode',passcode);
    const res = await fetch(testUrl.toString(), {method:'GET',redirect:'follow'});
    const data = await res.json();
    if (data.success) { resultEl.textContent='✅ Connected!'; resultEl.style.color='var(--success)'; }
    else { resultEl.textContent=`❌ ${data.error}`; resultEl.style.color='var(--danger)'; }
  } catch(err) { resultEl.textContent=`❌ ${err.message}`; resultEl.style.color='var(--danger)'; }
});

document.getElementById('toggle-passcode-visibility')?.addEventListener('click', () => {
  const inp = document.getElementById('setting-passcode');
  inp.type = inp.type==='password' ? 'text' : 'password';
});

// ==============================================================================
// OVERVIEW FILTERS
// ==============================================================================
document.getElementById('overview-apply-filter')?.addEventListener('click', () => {
  state.overviewFilters.fromDate = document.getElementById('overview-from-date').value;
  state.overviewFilters.toDate = document.getElementById('overview-to-date').value;
  state.overviewFilters.person = document.getElementById('overview-person-filter').value;
  renderOverview();
});

document.getElementById('overview-reset-filter')?.addEventListener('click', () => {
  state.overviewFilters = { fromDate:'', toDate:'', person:'' };
  document.getElementById('overview-from-date').value = '';
  document.getElementById('overview-to-date').value = '';
  document.getElementById('overview-person-filter').value = '';
  renderOverview();
});

// ==============================================================================
// MODAL HELPERS
// ==============================================================================
function openModal(id) {
  const m = document.getElementById(id);
  if (m) { m.classList.remove('hidden'); document.body.style.overflow='hidden'; }
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (m) { m.classList.add('hidden'); document.body.style.overflow=''; }
}

document.addEventListener('click', e => {
  if (e.target.dataset?.close) closeModal(e.target.dataset.close);
  if (e.target.classList.contains('modal-overlay')) closeModal(e.target.id);
});
document.addEventListener('keydown', e => {
  if (e.key==='Escape') document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m=>closeModal(m.id));
});

// ==============================================================================
// THEME & NAVIGATION
// ==============================================================================
function initTheme() {
  const saved = localStorage.getItem('lt_theme');
  const sys = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (sys ? 'dark' : 'light'));
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('lt_theme', theme);
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = theme==='dark' ? '☀️' : '🌙';
}
document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
  applyTheme(document.documentElement.getAttribute('data-theme')==='dark' ? 'light' : 'dark');
});

// Tab Switcher (Lend mode)
document.querySelectorAll('#lend-app-view .tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#lend-app-view .tab-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('#lend-app-view .tab-content').forEach(c=>c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

// Tab Switcher (Borrow mode)
document.querySelectorAll('#borrow-app-view .tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#borrow-app-view .tab-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('#borrow-app-view .tab-content').forEach(c=>c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

// Navbar Mode Dropdown
const modeDropdownBtn = document.getElementById('mode-dropdown-btn');
const modeDropdownMenu = document.getElementById('mode-dropdown-menu');

if (modeDropdownBtn && modeDropdownMenu) {
  modeDropdownBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    modeDropdownMenu.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!modeDropdownMenu.classList.contains('hidden') && !modeDropdownBtn.contains(e.target)) {
      modeDropdownMenu.classList.add('hidden');
    }
  });

  document.querySelectorAll('.mode-dropdown-item').forEach(item => {
    item.addEventListener('click', () => {
      setAppMode(item.dataset.mode);
      modeDropdownMenu.classList.add('hidden');
    });
  });
}

// Lend filter/search events
document.getElementById('loan-search-input')?.addEventListener('input', e => {
  state.filters.search = e.target.value;
  document.getElementById('clear-search-btn')?.classList.toggle('hidden', !e.target.value);
  renderLoansList();
});
document.getElementById('clear-search-btn')?.addEventListener('click', () => {
  document.getElementById('loan-search-input').value = '';
  document.getElementById('clear-search-btn').classList.add('hidden');
  state.filters.search = '';
  renderLoansList();
});
document.getElementById('status-filter')?.addEventListener('change', e => { state.filters.status=e.target.value; renderLoansList(); });
document.getElementById('sort-by-select')?.addEventListener('change', e => { state.filters.sortBy=e.target.value; renderLoansList(); });
document.getElementById('reset-filter-btn')?.addEventListener('click', resetFilters);

function resetFilters() {
  state.filters = { search:'', status:'ALL', sortBy:'date_newest' };
  const inp = document.getElementById('loan-search-input'); if (inp) inp.value='';
  document.getElementById('clear-search-btn')?.classList.add('hidden');
  const sel = document.getElementById('status-filter'); if (sel) sel.value='ALL';
  renderLoansList();
}

// Borrow filter/search events
document.getElementById('borrow-search-input')?.addEventListener('input', e => {
  state.borrowFilters.search = e.target.value;
  renderBorrowingsList();
});
document.getElementById('borrow-status-filter')?.addEventListener('change', e => { state.borrowFilters.status=e.target.value; renderBorrowingsList(); });
document.getElementById('borrow-sort-by-select')?.addEventListener('change', e => { state.borrowFilters.sortBy=e.target.value; renderBorrowingsList(); });

function resetBorrowFilters() {
  state.borrowFilters = { search:'', status:'ALL', sortBy:'date_newest' };
  const inp = document.getElementById('borrow-search-input'); if (inp) inp.value='';
  const sel = document.getElementById('borrow-status-filter'); if (sel) sel.value='ALL';
  renderBorrowingsList();
}

function filterByPerson(name, mode) {
  if (mode === 'borrow') {
    state.borrowFilters.search = name;
    const inp = document.getElementById('borrow-search-input'); if (inp) inp.value=name;
    setAppMode('borrow');
    document.querySelector('#borrow-app-view .tab-btn[data-tab="borrow-tab-loans"]')?.click();
    renderBorrowingsList();
  } else {
    state.filters.search = name;
    const inp = document.getElementById('loan-search-input'); if (inp) inp.value=name;
    document.getElementById('clear-search-btn')?.classList.remove('hidden');
    setAppMode('lend');
    document.querySelector('#lend-app-view .tab-btn[data-tab="tab-loans"]')?.click();
    renderLoansList();
  }
}

function viewLoanDetails(loanId) {
  setAppMode('lend');
  document.querySelector('#lend-app-view .tab-btn[data-tab="tab-loans"]')?.click();
  setTimeout(() => {
    const card = document.getElementById(`card-${loanId}`);
    if (card) { card.scrollIntoView({behavior:'smooth',block:'center'}); card.style.borderColor='var(--primary)'; setTimeout(()=>{card.style.borderColor='';},2000); }
  }, 100);
}

function viewBorrowingDetails(borrowingId) {
  setAppMode('borrow');
  document.querySelector('#borrow-app-view .tab-btn[data-tab="borrow-tab-loans"]')?.click();
  setTimeout(() => {
    const card = document.getElementById(`bcard-${borrowingId}`);
    if (card) { card.scrollIntoView({behavior:'smooth',block:'center'}); card.style.borderColor='var(--warning)'; setTimeout(()=>{card.style.borderColor='';},2000); }
  }, 100);
}

document.getElementById('people-search-input')?.addEventListener('input', renderPeopleView);
document.getElementById('lenders-search-input')?.addEventListener('input', renderLendersView);

// Open add modal buttons
document.querySelectorAll('.open-add-loan-btn').forEach(btn => btn.addEventListener('click', openAddLoanModal));
document.querySelectorAll('.open-add-borrowing-btn, .open-add-borrow-btn').forEach(btn => btn.addEventListener('click', openAddBorrowingModal));

// Header actions
document.getElementById('settings-btn')?.addEventListener('click', () => { loadSettingsForm(); openModal('settings-modal'); });
document.getElementById('open-setup-btn')?.addEventListener('click', () => { loadSettingsForm(); openModal('settings-modal'); });
// refresh-btn removed in favor of mode dropdown

// Export buttons
document.getElementById('export-loans-csv-btn')?.addEventListener('click', exportLoansToCsv);
document.getElementById('export-payments-csv-btn')?.addEventListener('click', () => {
  if (!state.payments.length) { showToast('No payments to export','warning'); return; }
  const headers = ['Payment ID','Loan ID','Borrower','Amount','Date','Notes'];
  const rows = state.payments.map(p => { const l=state.loans.find(x=>x.loan_id===p.loan_id); return [p.payment_id,p.loan_id,`"${(l?.borrower_name||'').replace(/"/g,'""')}"`,p.amount,p.payment_date,`"${(p.notes||'').replace(/"/g,'""')}"`]; });
  downloadCsv('Payments_'+getTodayIsoString()+'.csv', [headers.join(','),...rows.map(r=>r.join(','))].join('\n'));
});
document.getElementById('dash-export-csv-btn')?.addEventListener('click', exportLoansToCsv);
document.getElementById('borrow-export-csv-btn')?.addEventListener('click', exportBorrowingsToCsv);
document.getElementById('borrow-dash-export-btn')?.addEventListener('click', exportBorrowingsToCsv);

// Online/offline
window.addEventListener('online', () => { document.getElementById('offline-banner')?.classList.add('hidden'); if (!state.isPortalMode) fetchAllData(false); });
window.addEventListener('offline', () => { document.getElementById('offline-banner')?.classList.remove('hidden'); });

// Setup banner
function updateSetupBannerVisibility() {
  const banner = document.getElementById('setup-banner');
  if (banner) banner.classList.toggle('hidden', !!(state.config.webAppUrl && state.config.passcode));
}

// ==============================================================================
// INITIALIZATION
// ==============================================================================
window.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  if (!navigator.onLine) document.getElementById('offline-banner')?.classList.remove('hidden');

  const isPortal = await checkAndInitPortalMode();
  if (!isPortal) {
    setAppMode(state.appMode);
    fetchAllData(true);
  }
});
