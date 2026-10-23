/**
 * ==============================================================================
 * LEND TRACKER - FRONTEND CLIENT APPLICATION LOGIC
 * ==============================================================================
 * Includes:
 * 1. Accrued Interest Calculation (Yearly Simple, Monthly Simple, Fixed Fee)
 * 3. File & Receipt Uploads to Google Drive (with viewable links & thumbnails)
 * 4. Secure Read-Only Borrower Statement Portal (with 1-click UPI repayments)
 * ==============================================================================
 */

// Application State
const state = {
  config: {
    webAppUrl: localStorage.getItem('lt_webapp_url') || '',
    passcode: localStorage.getItem('lt_passcode') || '',
    currency: localStorage.getItem('lt_currency') || '₹',
    lenderName: localStorage.getItem('lt_lender_name') || 'Nilesh Pithiya',
    upiId: localStorage.getItem('lt_upi_id') || ''
  },
  loans: [],
  payments: [],
  summary: {
    total_lent: 0,
    total_received: 0,
    total_outstanding: 0,
    counts: { all: 0, pending: 0, partial: 0, completed: 0, overdue: 0 }
  },
  filters: {
    search: '',
    status: 'ALL',
    sortBy: 'date_newest'
  },
  activeLoanForPayment: null,
  activeLoanForDelete: null,
  activeLoanForShare: null,
  loanFileUpload: null,
  paymentFileUpload: null,
  isLoading: false,
  isPortalMode: false
};

// ==============================================================================
// FORMATTING HELPERS (Indian Numbering & DD/MM/YYYY Dates)
// ==============================================================================

/**
 * Format currency using Indian Lakhs/Crores numbering system (e.g. ₹1,50,000)
 */
function formatCurrency(amount) {
  const num = Number(amount) || 0;
  const formatted = num.toLocaleString('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: num % 1 === 0 ? 0 : 2
  });
  return `${state.config.currency || '₹'}${formatted}`;
}

/**
 * Format ISO date string (YYYY-MM-DD) into Indian standard DD/MM/YYYY display
 */
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const parts = String(dateStr).substring(0, 10).split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

/**
 * Returns today's date in YYYY-MM-DD format (IST timezone friendly)
 */
function getTodayIsoString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

// ==============================================================================
// API CLIENT (Google Apps Script Web App Connector)
// ==============================================================================

async function apiGet(action, params = {}, customUrl = null) {
  const targetUrl = customUrl || state.config.webAppUrl;
  if (!targetUrl) {
    throw new Error('API Web App URL not configured');
  }

  const url = new URL(targetUrl);
  url.searchParams.set('action', action);
  if (state.config.passcode && action !== 'getPortalData') {
    url.searchParams.set('passcode', state.config.passcode);
  }
  Object.keys(params).forEach(k => url.searchParams.set(k, params[k]));

  const response = await fetch(url.toString(), {
    method: 'GET',
    redirect: 'follow'
  });

  if (!response.ok) {
    throw new Error(`Server returned HTTP ${response.status}`);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || 'Request failed on server');
  }
  return result;
}

async function apiPost(action, data = {}) {
  if (!state.config.webAppUrl || !state.config.passcode) {
    throw new Error('API URL or Passcode not configured');
  }

  const payload = {
    action: action,
    passcode: state.config.passcode,
    data: data
  };

  const response = await fetch(state.config.webAppUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8' // Skips CORS preflight
    },
    body: JSON.stringify(payload),
    redirect: 'follow'
  });

  if (!response.ok) {
    throw new Error(`Server returned HTTP ${response.status}`);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || 'Server error');
  }
  return result;
}

// ==============================================================================
// FILE ATTACHMENT HELPERS (BASE64 ENCODER)
// ==============================================================================

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    if (file.size > 5 * 1024 * 1024) {
      reject(new Error('File exceeds 5MB size limit. Please choose a smaller file.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        fileData: reader.result,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream'
      });
    };
    reader.onerror = error => reject(error);
    reader.readAsDataURL(file);
  });
}

// ==============================================================================
// 4. BORROWER READ-ONLY PORTAL CONTROLLER
// ==============================================================================

async function checkAndInitPortalMode() {
  const urlParams = new URLSearchParams(window.location.search);
  const portalToken = urlParams.get('portal');
  const customApi = urlParams.get('api');

  if (!portalToken) {
    return false; // Regular admin app mode
  }

  state.isPortalMode = true;
  document.getElementById('admin-app-view').classList.add('hidden');
  document.getElementById('mobile-add-fab').classList.add('hidden');
  const portalView = document.getElementById('borrower-portal-view');
  portalView.classList.remove('hidden');

  // Use API from URL if passed, or from localStorage
  const apiUrl = customApi ? decodeURIComponent(customApi) : state.config.webAppUrl;
  if (!apiUrl) {
    portalView.innerHTML = `
      <div class="portal-card">
        <h2>⚠️ Link Configuration Incomplete</h2>
        <p>The statement link is missing the server connection parameter. Please ask the lender to send an updated statement link.</p>
      </div>
    `;
    return true;
  }

  try {
    const res = await apiGet('getPortalData', { token: portalToken }, apiUrl);
    renderBorrowerPortal(res.data);
  } catch (err) {
    console.error('Portal load error:', err);
    portalView.innerHTML = `
      <div class="portal-card">
        <h2>⚠️ Unable to Load Loan Statement</h2>
        <p>${escapeHtml(err.message || 'Invalid or expired statement token.')}</p>
      </div>
    `;
  }

  return true;
}

function renderBorrowerPortal(portalData) {
  const loan = portalData.loan;
  const lenderName = portalData.lender_name || state.config.lenderName || 'Private Lender';
  const lenderUpi = portalData.lender_upi || state.config.upiId || '';

  document.getElementById('portal-lender-name').textContent = lenderName;
  document.getElementById('portal-borrower').textContent = loan.borrower_name;
  document.getElementById('portal-date-given').textContent = formatDate(loan.date_given);
  document.getElementById('portal-due-date').textContent = loan.expected_return_date ? formatDate(loan.expected_return_date) : 'No fixed date';

  // Status Badge
  const badge = document.getElementById('portal-status-badge');
  badge.textContent = loan.is_overdue ? '⚠️ Overdue' : loan.status;
  badge.className = `badge ${loan.is_overdue ? 'badge-overdue' : loan.status === 'Completed' ? 'badge-completed' : loan.status === 'Partial' ? 'badge-partial' : 'badge-pending'}`;

  // Financials
  document.getElementById('portal-principal').textContent = formatCurrency(loan.amount);

  const interestBox = document.getElementById('portal-interest-box');
  if (loan.accrued_interest > 0) {
    interestBox.classList.remove('hidden');
    document.getElementById('portal-interest').textContent = formatCurrency(loan.accrued_interest);
    let rateDesc = '';
    if (loan.interest_type === 'simple_yearly') rateDesc = `${loan.interest_rate}% p.a.`;
    else if (loan.interest_type === 'simple_monthly') rateDesc = `${loan.interest_rate}% p.m.`;
    else if (loan.interest_type === 'fixed_amount') rateDesc = 'Fixed Fee';
    document.getElementById('portal-interest-rate').textContent = rateDesc;
  } else {
    interestBox.classList.add('hidden');
  }

  document.getElementById('portal-balance').textContent = formatCurrency(loan.remaining_balance);

  // Repayment Progress Bar
  const totalPayable = loan.total_payable || loan.amount;
  const pct = totalPayable > 0 ? Math.min(100, Math.round((loan.total_paid / totalPayable) * 100)) : 0;
  document.getElementById('portal-progress-bar').style.width = `${pct}%`;
  document.getElementById('portal-paid-text').textContent = `${formatCurrency(loan.total_paid)} paid of ${formatCurrency(totalPayable)}`;
  document.getElementById('portal-pct-text').textContent = `${pct}%`;

  // Timeline
  const listEl = document.getElementById('portal-payments-list');
  if (!loan.payments || loan.payments.length === 0) {
    listEl.innerHTML = '<p class="empty-state">No payments recorded yet.</p>';
  } else {
    listEl.innerHTML = loan.payments.map(p => `
      <div class="timeline-entry">
        <div>
          <div class="entry-amount">+ ${formatCurrency(p.amount)}</div>
          <div class="entry-date">📅 ${formatDate(p.payment_date)}</div>
          ${p.notes ? `<div class="entry-notes">"${escapeHtml(p.notes)}"</div>` : ''}
        </div>
        ${p.receipt_url ? `
          <a href="${p.receipt_url}" target="_blank" rel="noopener" class="receipt-thumb-link">
            📎 Receipt ↗
          </a>
        ` : ''}
      </div>
    `).join('');
  }

  // Document Attachment if present
  const attachmentBox = document.getElementById('portal-attachment-box');
  const attachmentLink = document.getElementById('portal-attachment-link');
  if (loan.attachment_url) {
    attachmentBox.classList.remove('hidden');
    attachmentLink.href = loan.attachment_url;
  } else {
    attachmentBox.classList.add('hidden');
  }

  // UPI Repay Card
  const upiBox = document.getElementById('portal-upi-box');
  if (lenderUpi && loan.remaining_balance > 0) {
    upiBox.classList.remove('hidden');
    document.getElementById('portal-upi-id').textContent = lenderUpi;

    // Standard NPCI UPI URI Scheme
    const upiUri = `upi://pay?pa=${encodeURIComponent(lenderUpi)}&pn=${encodeURIComponent(lenderName)}&am=${loan.remaining_balance}&cu=INR&tn=${encodeURIComponent('Repayment: ' + loan.borrower_name)}`;
    document.getElementById('portal-upi-btn').href = upiUri;

    document.getElementById('copy-upi-btn').onclick = () => {
      navigator.clipboard.writeText(lenderUpi).then(() => showToast('UPI ID copied to clipboard!', 'success'));
    };
  } else {
    upiBox.classList.add('hidden');
  }

  // WhatsApp Contact button
  document.getElementById('portal-contact-btn').onclick = () => {
    const text = encodeURIComponent(`Hi ${lenderName}, I checked the loan statement. Regarding the remaining balance of ${formatCurrency(loan.remaining_balance)}...`);
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };
}

// ==============================================================================
// DATA FETCHING & LOCAL CACHING (ADMIN MODE)
// ==============================================================================

async function fetchAllData(showSpinner = true) {
  if (state.isPortalMode) return;

  if (!state.config.webAppUrl || !state.config.passcode) {
    updateSetupBannerVisibility();
    renderLoansList();
    return;
  }

  if (showSpinner) {
    state.isLoading = true;
    document.getElementById('loans-container').innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Syncing with Google Sheets...</p>
      </div>
    `;
  }

  try {
    const res = await apiGet('getData');
    state.loans = res.data.loans || [];
    state.payments = res.data.payments || [];
    state.summary = res.data.summary || state.summary;

    localStorage.setItem('lt_cached_loans', JSON.stringify(state.loans));
    localStorage.setItem('lt_cached_payments', JSON.stringify(state.payments));
    localStorage.setItem('lt_cached_summary', JSON.stringify(state.summary));
    localStorage.setItem('lt_last_sync', new Date().toISOString());

    updateHeaderSyncStatus('Synced just now');
    renderAllViews();
  } catch (err) {
    console.error('Fetch error:', err);
    showToast(err.message || 'Failed to load data', 'error');

    const cachedLoans = localStorage.getItem('lt_cached_loans');
    if (cachedLoans) {
      state.loans = JSON.parse(cachedLoans);
      state.payments = JSON.parse(localStorage.getItem('lt_cached_payments') || '[]');
      state.summary = JSON.parse(localStorage.getItem('lt_cached_summary') || '{}');
      updateHeaderSyncStatus('Offline (cached data)');
      renderAllViews();
      showToast('Loaded offline cached data', 'warning');
    } else {
      document.getElementById('loans-container').innerHTML = `
        <div class="empty-state">
          <p>⚠️ Unable to connect to Google Sheets.</p>
          <small>${escapeHtml(err.message)}</small><br><br>
          <button class="btn btn-primary btn-sm" onclick="fetchAllData(true)">Retry Connection</button>
        </div>
      `;
    }
  } finally {
    state.isLoading = false;
  }
}

function updateHeaderSyncStatus(text) {
  const el = document.getElementById('header-status');
  if (el) el.textContent = text;
}

// ==============================================================================
// VIEW RENDERING
// ==============================================================================

function renderAllViews() {
  if (state.isPortalMode) return;
  renderDashboard();
  renderLoansList();
  renderPeopleView();
  updateSetupBannerVisibility();
}

function renderDashboard() {
  const sum = state.summary;
  document.getElementById('metric-total-lent').textContent = formatCurrency(sum.total_lent);
  document.getElementById('metric-total-received').textContent = formatCurrency(sum.total_received);
  document.getElementById('metric-total-outstanding').textContent = formatCurrency(sum.total_outstanding);

  const totalLoansCount = (state.loans || []).length;
  document.getElementById('metric-total-loans').textContent = `${totalLoansCount} Loan${totalLoansCount === 1 ? '' : 's'} Recorded`;

  const recoveryPct = sum.total_lent > 0 ? Math.round((sum.total_received / sum.total_lent) * 100) : 0;
  document.getElementById('metric-recovery-rate').textContent = `${recoveryPct}% Recovered`;

  const pendingCount = (sum.counts.pending || 0) + (sum.counts.partial || 0);
  document.getElementById('metric-pending-count').textContent = `${pendingCount} Active Unfinished`;

  document.getElementById('count-overdue').textContent = sum.counts.overdue || 0;
  document.getElementById('count-pending').textContent = sum.counts.pending || 0;
  document.getElementById('count-partial').textContent = sum.counts.partial || 0;
  document.getElementById('count-completed').textContent = sum.counts.completed || 0;
  document.getElementById('loans-tab-count').textContent = totalLoansCount;

  // Overdue section
  const overdueSection = document.getElementById('overdue-section');
  const overdueList = document.getElementById('overdue-list');
  const overdueLoans = state.loans.filter(l => l.is_overdue);

  if (overdueLoans.length > 0) {
    overdueSection.classList.remove('hidden');
    document.getElementById('overdue-badge-count').textContent = overdueLoans.length;
    overdueList.innerHTML = overdueLoans.map(l => `
      <div class="compact-item" onclick="viewLoanDetails('${l.loan_id}')">
        <div class="compact-left">
          <span class="compact-borrower">${escapeHtml(l.borrower_name)}</span>
          <span class="compact-date">Due: ${formatDate(l.expected_return_date)} (${Math.abs(l.days_until_due)} days overdue)</span>
        </div>
        <div class="compact-right">
          <div class="compact-amount">
            <div>${formatCurrency(l.remaining_balance)}</div>
            <div class="compact-balance">Balance Owed</div>
          </div>
          <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); openPaymentModal('${l.loan_id}')">Repay</button>
        </div>
      </div>
    `).join('');
  } else {
    overdueSection.classList.add('hidden');
  }

  // Upcoming Dues
  const upcomingList = document.getElementById('upcoming-dues-list');
  const upcomingLoans = state.loans.filter(l =>
    l.status !== 'Completed' &&
    l.expected_return_date &&
    l.days_until_due !== null &&
    l.days_until_due >= 0 &&
    l.days_until_due <= 14
  ).sort((a, b) => a.days_until_due - b.days_until_due);

  if (upcomingLoans.length > 0) {
    upcomingList.innerHTML = upcomingLoans.map(l => {
      const dueLabel = l.days_until_due === 0 ? 'Due Today!' : l.days_until_due === 1 ? 'Due Tomorrow' : `In ${l.days_until_due} days`;
      return `
        <div class="compact-item" onclick="viewLoanDetails('${l.loan_id}')">
          <div class="compact-left">
            <span class="compact-borrower">${escapeHtml(l.borrower_name)}</span>
            <span class="compact-date">${formatDate(l.expected_return_date)} &bull; <strong>${dueLabel}</strong></span>
          </div>
          <div class="compact-right">
            <div class="compact-amount">
              <div>${formatCurrency(l.remaining_balance)}</div>
              <div class="compact-balance">Balance</div>
            </div>
            <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); openPaymentModal('${l.loan_id}')">Repay</button>
          </div>
        </div>
      `;
    }).join('');
  } else {
    upcomingList.innerHTML = '<p class="empty-state">No loans due in the next 14 days.</p>';
  }
}

function renderLoansList() {
  const container = document.getElementById('loans-container');
  if (!state.config.webAppUrl || !state.config.passcode) {
    container.innerHTML = `
      <div class="empty-state">
        <p>⚙️ Please configure your Google Apps Script Web App URL and Passcode to load loans.</p>
        <button class="btn btn-primary btn-sm" onclick="openModal('settings-modal')">Open Settings</button>
      </div>
    `;
    return;
  }

  let list = [...state.loans];

  const q = state.filters.search.toLowerCase().trim();
  if (q) {
    list = list.filter(l =>
      (l.borrower_name && l.borrower_name.toLowerCase().includes(q)) ||
      (l.notes && l.notes.toLowerCase().includes(q)) ||
      (l.phone_or_email && l.phone_or_email.toLowerCase().includes(q))
    );
  }

  const statusFilter = state.filters.status;
  if (statusFilter === 'ACTIVE') {
    list = list.filter(l => l.status !== 'Completed');
  } else if (statusFilter === 'Overdue') {
    list = list.filter(l => l.is_overdue);
  } else if (statusFilter !== 'ALL') {
    list = list.filter(l => l.status === statusFilter);
  }

  const sortBy = state.filters.sortBy;
  list.sort((a, b) => {
    switch (sortBy) {
      case 'date_newest': return (b.date_given || '').localeCompare(a.date_given || '');
      case 'date_oldest': return (a.date_given || '').localeCompare(b.date_given || '');
      case 'due_date':
        if (!a.expected_return_date) return 1;
        if (!b.expected_return_date) return -1;
        return a.expected_return_date.localeCompare(b.expected_return_date);
      case 'amount_highest': return b.amount - a.amount;
      case 'amount_lowest': return a.amount - b.amount;
      case 'name_asc': return (a.borrower_name || '').localeCompare(b.borrower_name || '');
      default: return 0;
    }
  });

  const filterBar = document.getElementById('active-filter-bar');
  if (q || statusFilter !== 'ALL') {
    filterBar.classList.remove('hidden');
    let desc = [];
    if (q) desc.push(`"${q}"`);
    if (statusFilter !== 'ALL') desc.push(`Status: ${statusFilter}`);
    document.getElementById('filter-description').textContent = desc.join(', ');
  } else {
    filterBar.classList.add('hidden');
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No loans match your current filter.</p>
        <button class="btn btn-secondary btn-sm" onclick="resetFilters()">Reset Filters</button>
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(loan => renderLoanCard(loan)).join('');
}

function renderLoanCard(loan) {
  const totalPayable = loan.total_payable || loan.amount;
  const percentPaid = totalPayable > 0 ? Math.min(100, Math.round((loan.total_paid / totalPayable) * 100)) : 0;
  const isOverdue = loan.is_overdue;
  const isCompleted = loan.status === 'Completed';

  let statusBadgeClass = 'badge-pending';
  if (loan.status === 'Partial') statusBadgeClass = 'badge-partial';
  if (loan.status === 'Completed') statusBadgeClass = 'badge-completed';

  const cardClasses = ['loan-card'];
  if (isOverdue) cardClasses.push('is-overdue');
  if (isCompleted) cardClasses.push('is-completed');

  // WhatsApp reminder button
  let whatsappBtn = '';
  if (!isCompleted && loan.phone_or_email) {
    whatsappBtn = `
      <button class="btn btn-sm btn-whatsapp" onclick="openWhatsAppReminder('${loan.loan_id}')" title="Send reminder message via WhatsApp">
        💬 WhatsApp
      </button>
    `;
  }

  // Interest description text if interest applies
  let interestInfo = '';
  if (loan.accrued_interest > 0) {
    let rateTxt = '';
    if (loan.interest_type === 'simple_yearly') rateTxt = `${loan.interest_rate}% p.a.`;
    else if (loan.interest_type === 'simple_monthly') rateTxt = `${loan.interest_rate}% p.m.`;
    else rateTxt = 'Fixed Fee';
    interestInfo = ` &bull; <span class="text-warning">Interest: +${formatCurrency(loan.accrued_interest)} (${rateTxt})</span>`;
  }

  return `
    <div class="${cardClasses.join(' ')}" id="card-${loan.loan_id}">
      <div class="loan-card-top">
        <div class="borrower-info">
          <h3>${escapeHtml(loan.borrower_name)}</h3>
          <div class="borrower-meta">
            <span>📅 Given: ${formatDate(loan.date_given)}</span>
            ${loan.expected_return_date ? `<span>&bull; Due: ${formatDate(loan.expected_return_date)}</span>` : ''}
            ${loan.phone_or_email ? `<span>&bull; 📞 ${escapeHtml(loan.phone_or_email)}</span>` : ''}
            ${interestInfo}
          </div>
        </div>
        <div class="badges-group">
          ${isOverdue ? '<span class="badge badge-overdue">⚠️ Overdue</span>' : ''}
          <span class="badge ${statusBadgeClass}">${loan.status}</span>
        </div>
      </div>

      <!-- Financials Breakdown -->
      <div class="loan-financials">
        <div class="fin-col">
          <span>Principal</span>
          <strong>${formatCurrency(loan.amount)}</strong>
        </div>
        <div class="fin-col">
          <span>Total Paid</span>
          <strong class="text-success">${formatCurrency(loan.total_paid)}</strong>
        </div>
        <div class="fin-col">
          <span>Balance</span>
          <strong class="${loan.remaining_balance > 0 ? 'text-danger' : 'text-success'}">${formatCurrency(loan.remaining_balance)}</strong>
        </div>
      </div>

      <!-- Progress Bar -->
      <div>
        <div class="progress-container">
          <div class="progress-bar" style="width: ${percentPaid}%;"></div>
        </div>
        <div class="progress-label">${percentPaid}% repaid (${loan.payments.length} payment${loan.payments.length === 1 ? '' : 's'})</div>
      </div>

      <!-- Notes & Document Attachment -->
      ${loan.notes ? `<div class="loan-card-details"><div class="loan-note">"${escapeHtml(loan.notes)}"</div></div>` : ''}
      ${loan.attachment_url ? `
        <div>
          <a href="${loan.attachment_url}" target="_blank" rel="noopener" class="attachment-link">
            📎 View Loan Document / Promissory Note ↗
          </a>
        </div>
      ` : ''}

      <!-- Action Buttons -->
      <div class="loan-card-actions">
        ${!isCompleted ? `
          <button class="btn btn-sm btn-primary" onclick="openPaymentModal('${loan.loan_id}')">
            ➕ Add Payment
          </button>
        ` : ''}
        <button class="btn btn-sm btn-secondary" onclick="viewPaymentHistory('${loan.loan_id}')">
          📜 History (${loan.payments.length})
        </button>
        <button class="btn btn-sm btn-secondary" onclick="openSharePortalModal('${loan.loan_id}')" title="Share live statement link with borrower">
          🔗 Statement
        </button>
        ${whatsappBtn}

        <div class="spacer"></div>

        <button class="btn btn-sm btn-secondary btn-icon-only" onclick="openEditLoanModal('${loan.loan_id}')" title="Edit Loan">
          ✏️
        </button>
        <button class="btn btn-sm btn-secondary btn-icon-only" onclick="confirmDeleteLoan('${loan.loan_id}')" title="Delete Loan">
          🗑️
        </button>
      </div>
    </div>
  `;
}

function renderPeopleView() {
  const container = document.getElementById('people-container');
  const search = (document.getElementById('people-search-input')?.value || '').toLowerCase().trim();

  const map = {};
  state.loans.forEach(loan => {
    const rawName = (loan.borrower_name || 'Unknown').trim();
    const key = rawName.toLowerCase();
    if (!map[key]) {
      map[key] = {
        name: rawName,
        totalLent: 0,
        totalInterest: 0,
        totalPaid: 0,
        totalBalance: 0,
        loanCount: 0,
        activeCount: 0
      };
    }
    map[key].totalLent += loan.amount;
    map[key].totalInterest += (loan.accrued_interest || 0);
    map[key].totalPaid += loan.total_paid;
    map[key].totalBalance += loan.remaining_balance;
    map[key].loanCount += 1;
    if (loan.status !== 'Completed') {
      map[key].activeCount += 1;
    }
  });

  let people = Object.values(map);
  if (search) {
    people = people.filter(p => p.name.toLowerCase().includes(search));
  }
  people.sort((a, b) => b.totalBalance - a.totalBalance);

  if (people.length === 0) {
    container.innerHTML = '<p class="empty-state">No borrowers recorded yet.</p>';
    return;
  }

  container.innerHTML = people.map(p => `
    <div class="person-card">
      <div class="person-card-header">
        <span class="person-name">👤 ${escapeHtml(p.name)}</span>
        <button class="btn btn-sm btn-secondary" onclick="filterByPerson('${escapeHtml(p.name)}')">View Loans (${p.loanCount})</button>
      </div>
      <div class="person-stats">
        <div>
          <span>Principal</span>
          <strong>${formatCurrency(p.totalLent)}</strong>
        </div>
        <div>
          <span>Total Paid</span>
          <strong class="text-success">${formatCurrency(p.totalPaid)}</strong>
        </div>
        <div>
          <span>Net Balance</span>
          <strong class="${p.totalBalance > 0 ? 'text-danger' : 'text-success'}">${formatCurrency(p.totalBalance)}</strong>
        </div>
      </div>
    </div>
  `).join('');
}

// ==============================================================================
// MODAL CONTROLS & ACTIONS
// ==============================================================================

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
  }
}

document.addEventListener('click', (e) => {
  if (e.target.dataset && e.target.dataset.close) {
    closeModal(e.target.dataset.close);
  }
  if (e.target.classList.contains('modal-overlay')) {
    closeModal(e.target.id);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(modal => {
      closeModal(modal.id);
    });
  }
});

function updateSetupBannerVisibility() {
  const banner = document.getElementById('setup-banner');
  if (!state.config.webAppUrl || !state.config.passcode) {
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

// ==============================================================================
// 1. ADD & EDIT LOAN (With Interest & Attachment Upload)
// ==============================================================================

// Interest rate field label updater
const interestTypeSelect = document.getElementById('loan-interest-type');
const interestRateGroup = document.getElementById('interest-rate-group');
const interestRateLabel = document.getElementById('interest-rate-label');

interestTypeSelect.addEventListener('change', () => {
  const val = interestTypeSelect.value;
  if (val === 'none') {
    interestRateGroup.classList.add('hidden');
    document.getElementById('loan-interest-rate').value = 0;
  } else if (val === 'fixed_amount') {
    interestRateGroup.classList.remove('hidden');
    interestRateLabel.textContent = 'Fixed Fee Amount (₹)';
  } else if (val === 'simple_monthly') {
    interestRateGroup.classList.remove('hidden');
    interestRateLabel.textContent = 'Monthly Interest Rate (%)';
  } else {
    interestRateGroup.classList.remove('hidden');
    interestRateLabel.textContent = 'Yearly Interest Rate (%)';
  }
});

// File upload listeners for loan
document.getElementById('loan-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    state.loanFileUpload = await readFileAsBase64(file);
    document.getElementById('loan-file-name').textContent = `📄 ${file.name} (${Math.round(file.size / 1024)} KB)`;
    document.getElementById('loan-file-preview').classList.remove('hidden');
  } catch (err) {
    showToast(err.message, 'error');
    e.target.value = '';
  }
});

document.getElementById('remove-loan-file-btn').addEventListener('click', () => {
  state.loanFileUpload = null;
  document.getElementById('loan-file').value = '';
  document.getElementById('loan-file-preview').classList.add('hidden');
  document.getElementById('loan-existing-attachment').value = '';
});

function openAddLoanModal() {
  document.getElementById('loan-modal-title').textContent = 'Record New Loan';
  document.getElementById('loan-form-id').value = '';
  document.getElementById('loan-form').reset();
  document.getElementById('loan-date-given').value = getTodayIsoString();
  document.getElementById('loan-interest-type').value = 'none';
  interestRateGroup.classList.add('hidden');
  document.getElementById('loan-interest-rate').value = 0;
  state.loanFileUpload = null;
  document.getElementById('loan-file-preview').classList.add('hidden');
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

  // Interest
  document.getElementById('loan-interest-type').value = loan.interest_type || 'none';
  document.getElementById('loan-interest-rate').value = loan.interest_rate || 0;
  interestTypeSelect.dispatchEvent(new Event('change'));

  // Existing file
  state.loanFileUpload = null;
  document.getElementById('loan-file').value = '';
  document.getElementById('loan-existing-attachment').value = loan.attachment_url || '';
  if (loan.attachment_url) {
    document.getElementById('loan-file-name').innerHTML = `<a href="${loan.attachment_url}" target="_blank" rel="noopener">📄 View Existing Document ↗</a>`;
    document.getElementById('loan-file-preview').classList.remove('hidden');
  } else {
    document.getElementById('loan-file-preview').classList.add('hidden');
  }

  openModal('loan-modal');
}

document.getElementById('loan-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = document.getElementById('loan-submit-btn');
  const loanId = document.getElementById('loan-form-id').value;
  const isEditing = Boolean(loanId);

  const payload = {
    loan_id: loanId,
    borrower_name: document.getElementById('loan-borrower').value.trim(),
    amount: parseFloat(document.getElementById('loan-amount').value),
    date_given: document.getElementById('loan-date-given').value,
    expected_return_date: document.getElementById('loan-return-date').value,
    phone_or_email: document.getElementById('loan-contact').value.trim(),
    notes: document.getElementById('loan-notes').value.trim(),
    interest_type: document.getElementById('loan-interest-type').value,
    interest_rate: parseFloat(document.getElementById('loan-interest-rate').value) || 0,
    attachment_url: document.getElementById('loan-existing-attachment').value
  };

  // If a new file was chosen, attach its base64 data
  if (state.loanFileUpload) {
    payload.fileData = state.loanFileUpload.fileData;
    payload.fileName = state.loanFileUpload.fileName;
    payload.mimeType = state.loanFileUpload.mimeType;
  }

  if (!payload.borrower_name) {
    showToast('Borrower name is required', 'warning');
    return;
  }
  if (!payload.amount || payload.amount <= 0) {
    showToast('Amount must be a positive number', 'warning');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = state.loanFileUpload ? 'Uploading to Drive...' : 'Saving...';

  try {
    const action = isEditing ? 'updateLoan' : 'addLoan';
    await apiPost(action, payload);
    showToast(isEditing ? 'Loan updated successfully!' : 'Loan recorded successfully!', 'success');
    closeModal('loan-modal');
    await fetchAllData(false);
  } catch (err) {
    console.error('Error saving loan:', err);
    showToast(err.message || 'Failed to save loan', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Loan';
  }
});

// ==============================================================================
// 3. ADD REPAYMENT (With Receipt Upload & Balance Check)
// ==============================================================================

// File upload listeners for payment receipt
document.getElementById('pay-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    state.paymentFileUpload = await readFileAsBase64(file);
    document.getElementById('pay-file-name').textContent = `📸 ${file.name} (${Math.round(file.size / 1024)} KB)`;
    document.getElementById('pay-file-preview').classList.remove('hidden');
  } catch (err) {
    showToast(err.message, 'error');
    e.target.value = '';
  }
});

document.getElementById('remove-pay-file-btn').addEventListener('click', () => {
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

  const interestRow = document.getElementById('pay-modal-interest-row');
  if (loan.accrued_interest > 0) {
    interestRow.classList.remove('hidden');
    document.getElementById('pay-modal-interest').textContent = `+ ${formatCurrency(loan.accrued_interest)}`;
  } else {
    interestRow.classList.add('hidden');
  }

  document.getElementById('pay-modal-paid').textContent = formatCurrency(loan.total_paid);
  document.getElementById('pay-modal-balance').textContent = formatCurrency(loan.remaining_balance);

  document.getElementById('payment-form').reset();
  state.paymentFileUpload = null;
  document.getElementById('pay-file-preview').classList.add('hidden');
  document.getElementById('pay-date').value = getTodayIsoString();
  document.getElementById('pay-amount').max = loan.remaining_balance;
  document.getElementById('pay-amount').value = loan.remaining_balance > 0 ? loan.remaining_balance : '';
  document.getElementById('payment-warning').classList.add('hidden');

  openModal('payment-modal');
}

// Balance check on input
document.getElementById('pay-amount').addEventListener('input', (e) => {
  const loan = state.activeLoanForPayment;
  if (!loan) return;

  const entered = parseFloat(e.target.value) || 0;
  const warningEl = document.getElementById('payment-warning');

  if (entered > (loan.remaining_balance + 0.05)) {
    warningEl.textContent = `⚠️ Amount (${formatCurrency(entered)}) exceeds remaining balance (${formatCurrency(loan.remaining_balance)})!`;
    warningEl.classList.remove('hidden');
  } else {
    warningEl.classList.add('hidden');
  }
});

document.getElementById('payment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const loan = state.activeLoanForPayment;
  if (!loan) return;

  const submitBtn = document.getElementById('payment-submit-btn');
  const amount = parseFloat(document.getElementById('pay-amount').value);
  const paymentDate = document.getElementById('pay-date').value;
  const notes = document.getElementById('pay-notes').value.trim();

  if (!amount || amount <= 0) {
    showToast('Please enter a valid repayment amount', 'warning');
    return;
  }

  if (amount > (loan.remaining_balance + 0.05)) {
    showToast(`Payment cannot exceed remaining balance of ${formatCurrency(loan.remaining_balance)}`, 'error');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = state.paymentFileUpload ? 'Uploading receipt...' : 'Recording...';

  const payload = {
    loan_id: loan.loan_id,
    amount: amount,
    payment_date: paymentDate,
    notes: notes
  };

  if (state.paymentFileUpload) {
    payload.fileData = state.paymentFileUpload.fileData;
    payload.fileName = state.paymentFileUpload.fileName;
    payload.mimeType = state.paymentFileUpload.mimeType;
  }

  try {
    await apiPost('addPayment', payload);
    showToast(`Repayment of ${formatCurrency(amount)} recorded!`, 'success');
    closeModal('payment-modal');
    await fetchAllData(false);
  } catch (err) {
    console.error('Error adding payment:', err);
    showToast(err.message || 'Failed to record repayment', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Record Repayment';
  }
});

// ==============================================================================
// PAYMENT HISTORY TIMELINE (With Receipt Links)
// ==============================================================================

function viewPaymentHistory(loanId) {
  const loan = state.loans.find(l => l.loan_id === loanId);
  if (!loan) return;

  document.getElementById('history-loan-subtitle').textContent = `${loan.borrower_name} &bull; Given: ${formatDate(loan.date_given)}`;
  document.getElementById('history-principal').textContent = formatCurrency(loan.amount);

  const interestEl = document.getElementById('history-interest-metric');
  if (loan.accrued_interest > 0) {
    interestEl.classList.remove('hidden');
    document.getElementById('history-interest').textContent = formatCurrency(loan.accrued_interest);
  } else {
    interestEl.classList.add('hidden');
  }

  document.getElementById('history-paid').textContent = formatCurrency(loan.total_paid);
  document.getElementById('history-balance').textContent = formatCurrency(loan.remaining_balance);

  const totalPayable = loan.total_payable || loan.amount;
  const pct = totalPayable > 0 ? Math.min(100, Math.round((loan.total_paid / totalPayable) * 100)) : 0;
  document.getElementById('history-progress-bar').style.width = `${pct}%`;
  document.getElementById('history-progress-text').textContent = `${pct}% repaid (${loan.payments.length} transactions)`;

  const timelineList = document.getElementById('timeline-list');
  if (loan.payments.length === 0) {
    timelineList.innerHTML = '<p class="empty-state">No repayments recorded yet for this loan.</p>';
  } else {
    timelineList.innerHTML = loan.payments.map(p => `
      <div class="timeline-entry">
        <div>
          <div class="entry-amount">+ ${formatCurrency(p.amount)}</div>
          <div class="entry-date">📅 ${formatDate(p.payment_date)}</div>
          ${p.notes ? `<div class="entry-notes">"${escapeHtml(p.notes)}"</div>` : ''}
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          ${p.receipt_url ? `
            <a href="${p.receipt_url}" target="_blank" rel="noopener" class="receipt-thumb-link">
              📎 Receipt ↗
            </a>
          ` : ''}
          <button class="btn btn-sm btn-secondary btn-icon-only" onclick="deletePaymentRecord('${p.payment_id}', '${loan.loan_id}')" title="Delete payment entry">
            🗑️
          </button>
        </div>
      </div>
    `).join('');
  }

  const addPayBtn = document.getElementById('history-add-payment-btn');
  if (loan.status === 'Completed') {
    addPayBtn.classList.add('hidden');
  } else {
    addPayBtn.classList.remove('hidden');
    addPayBtn.onclick = () => {
      closeModal('history-modal');
      openPaymentModal(loan.loan_id);
    };
  }

  openModal('history-modal');
}

async function deletePaymentRecord(paymentId, loanId) {
  if (!confirm('Are you sure you want to remove this repayment entry?')) return;
  try {
    await apiPost('deletePayment', { payment_id: paymentId });
    showToast('Payment entry removed', 'success');
    await fetchAllData(false);
    viewPaymentHistory(loanId);
  } catch (err) {
    showToast(err.message || 'Failed to remove payment', 'error');
  }
}

// ==============================================================================
// 4. SHARE BORROWER PORTAL MODAL CONTROLLER
// ==============================================================================

function openSharePortalModal(loanId) {
  const loan = state.loans.find(l => l.loan_id === loanId);
  if (!loan) return;

  state.activeLoanForShare = loan;
  document.getElementById('portal-share-name').textContent = loan.borrower_name;

  // Construct absolute URL with portal token and encoded Web App URL
  const base = `${window.location.origin}${window.location.pathname}`.replace(/\/index\.html$/, '/');
  const portalUrl = `${base}?portal=${loan.portal_token}&api=${encodeURIComponent(state.config.webAppUrl)}`;

  const urlInput = document.getElementById('portal-share-url-input');
  urlInput.value = portalUrl;

  document.getElementById('copy-portal-url-btn').onclick = () => {
    navigator.clipboard.writeText(portalUrl).then(() => {
      showToast('Portal link copied to clipboard!', 'success');
    });
  };

  document.getElementById('preview-portal-btn').onclick = () => {
    window.open(portalUrl, '_blank');
  };

  document.getElementById('whatsapp-share-portal-btn').onclick = () => {
    let phone = (loan.phone_or_email || '').replace(/[^0-9+]/g, '');
    if (phone.length === 10 && !phone.startsWith('+')) phone = '91' + phone;
    else if (phone.startsWith('+')) phone = phone.substring(1);

    const msg = `Hi ${loan.borrower_name}, you can view your live loan statement, repayment history, and balance anytime here: ${portalUrl}`;
    const waUrl = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(waUrl, '_blank');
  };

  openModal('portal-share-modal');
}

// ==============================================================================
// DELETE LOAN CONFIRMATION
// ==============================================================================

function confirmDeleteLoan(loanId) {
  const loan = state.loans.find(l => l.loan_id === loanId);
  if (!loan) return;

  state.activeLoanForDelete = loan;
  document.getElementById('delete-borrower-name').textContent = loan.borrower_name;
  openModal('delete-modal');
}

document.getElementById('confirm-delete-btn').addEventListener('click', async () => {
  const loan = state.activeLoanForDelete;
  if (!loan) return;

  const btn = document.getElementById('confirm-delete-btn');
  btn.disabled = true;
  btn.textContent = 'Deleting...';

  try {
    await apiPost('deleteLoan', { loan_id: loan.loan_id });
    showToast(`Loan for ${loan.borrower_name} deleted`, 'success');
    closeModal('delete-modal');
    await fetchAllData(false);
  } catch (err) {
    showToast(err.message || 'Failed to delete loan', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Delete Permanently';
  }
});

// ==============================================================================
// WHATSAPP REMINDER GENERATOR
// ==============================================================================

function openWhatsAppReminder(loanId) {
  const loan = state.loans.find(l => l.loan_id === loanId);
  if (!loan) return;

  let phone = (loan.phone_or_email || '').replace(/[^0-9+]/g, '');
  if (!phone) {
    showToast('No phone number saved for this borrower', 'warning');
    return;
  }

  if (phone.length === 10 && !phone.startsWith('+')) phone = '91' + phone;
  else if (phone.startsWith('+')) phone = phone.substring(1);

  const dueDateText = loan.expected_return_date ? `due on ${formatDate(loan.expected_return_date)}` : ``;
  const message = `Hi ${loan.borrower_name}, hope you are doing well! Friendly reminder regarding the loan of ${formatCurrency(loan.amount)} given on ${formatDate(loan.date_given)}. Outstanding balance is ${formatCurrency(loan.remaining_balance)}${dueDateText ? ` (${dueDateText})` : ''}. Thank you!`;

  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
}

// ==============================================================================
// CSV EXPORT (WITH INTEREST AND ATTACHMENTS)
// ==============================================================================

function exportLoansToCsv() {
  if (state.loans.length === 0) {
    showToast('No loans available to export', 'warning');
    return;
  }

  const headers = ['Loan ID', 'Borrower Name', 'Principal', 'Date Given', 'Expected Return Date', 'Phone/Email', 'Notes', 'Interest Rate', 'Interest Type', 'Accrued Interest', 'Total Payable', 'Total Paid', 'Remaining Balance', 'Status', 'Attachment URL', 'Portal Token'];
  const rows = state.loans.map(l => [
    l.loan_id,
    `"${(l.borrower_name || '').replace(/"/g, '""')}"`,
    l.amount,
    l.date_given,
    l.expected_return_date || '',
    `"${(l.phone_or_email || '').replace(/"/g, '""')}"`,
    `"${(l.notes || '').replace(/"/g, '""')}"`,
    l.interest_rate || 0,
    l.interest_type || 'none',
    l.accrued_interest || 0,
    l.total_payable || l.amount,
    l.total_paid,
    l.remaining_balance,
    l.status,
    `"${(l.attachment_url || '').replace(/"/g, '""')}"`,
    l.portal_token || ''
  ]);

  downloadCsv('LendTracker_Loans_' + getTodayIsoString() + '.csv', [headers.join(','), ...rows.map(r => r.join(','))].join('\n'));
}

function exportPaymentsToCsv() {
  if (state.payments.length === 0) {
    showToast('No payments recorded yet', 'warning');
    return;
  }

  const headers = ['Payment ID', 'Loan ID', 'Borrower', 'Amount Paid', 'Payment Date', 'Notes', 'Receipt URL', 'Created At'];
  const rows = state.payments.map(p => {
    const loan = state.loans.find(l => l.loan_id === p.loan_id);
    const borrowerName = loan ? loan.borrower_name : 'Unknown';
    return [
      p.payment_id,
      p.loan_id,
      `"${borrowerName.replace(/"/g, '""')}"`,
      p.amount,
      p.payment_date,
      `"${(p.notes || '').replace(/"/g, '""')}"`,
      `"${(p.receipt_url || '').replace(/"/g, '""')}"`,
      p.created_at
    ];
  });

  downloadCsv('LendTracker_Payments_' + getTodayIsoString() + '.csv', [headers.join(','), ...rows.map(r => r.join(','))].join('\n'));
}

function downloadCsv(filename, content) {
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
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

document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = document.getElementById('setting-webapp-url').value.trim();
  const passcode = document.getElementById('setting-passcode').value.trim();
  const currency = document.getElementById('setting-currency').value.trim() || '₹';
  const lenderName = document.getElementById('setting-lender-name').value.trim();
  const upiId = document.getElementById('setting-upi-id').value.trim();

  state.config.webAppUrl = url;
  state.config.passcode = passcode;
  state.config.currency = currency;
  state.config.lenderName = lenderName;
  state.config.upiId = upiId;

  localStorage.setItem('lt_webapp_url', url);
  localStorage.setItem('lt_passcode', passcode);
  localStorage.setItem('lt_currency', currency);
  localStorage.setItem('lt_lender_name', lenderName);
  localStorage.setItem('lt_upi_id', upiId);

  showToast('Settings saved successfully!', 'success');
  closeModal('settings-modal');
  await fetchAllData(true);
});

document.getElementById('test-connection-btn').addEventListener('click', async () => {
  const resultEl = document.getElementById('test-result');
  const url = document.getElementById('setting-webapp-url').value.trim();
  const passcode = document.getElementById('setting-passcode').value.trim();

  if (!url || !passcode) {
    resultEl.textContent = '❌ Fill URL & Passcode first';
    resultEl.style.color = 'var(--danger)';
    return;
  }

  resultEl.textContent = 'Testing...';
  resultEl.style.color = 'var(--text-muted)';

  try {
    const testUrl = new URL(url);
    testUrl.searchParams.set('action', 'ping');
    testUrl.searchParams.set('passcode', passcode);

    const res = await fetch(testUrl.toString(), { method: 'GET', redirect: 'follow' });
    const data = await res.json();
    if (data.success) {
      resultEl.textContent = '✅ Connected successfully!';
      resultEl.style.color = 'var(--success)';
    } else {
      resultEl.textContent = `❌ ${data.error || 'Failed'}`;
      resultEl.style.color = 'var(--danger)';
    }
  } catch (err) {
    resultEl.textContent = `❌ Connection failed: ${err.message}`;
    resultEl.style.color = 'var(--danger)';
  }
});

document.getElementById('toggle-passcode-visibility').addEventListener('click', () => {
  const input = document.getElementById('setting-passcode');
  input.type = input.type === 'password' ? 'text' : 'password';
});

// ==============================================================================
// THEME & NAVIGATION
// ==============================================================================

function initTheme() {
  const savedTheme = localStorage.getItem('lt_theme');
  const systemPrefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(savedTheme ? savedTheme : (systemPrefersDark ? 'dark' : 'light'));
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('lt_theme', theme);
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = theme === 'dark' ? '☀️' : '🌙';
}

document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

// Tab Switcher
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    btn.classList.add('active');
    const target = btn.dataset.tab;
    document.getElementById(target).classList.add('active');
  });
});

function switchTab(tabId) {
  const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  if (btn) btn.click();
}

document.querySelectorAll('.status-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    const filter = pill.dataset.filter;
    document.getElementById('status-filter').value = filter;
    state.filters.status = filter;
    switchTab('tab-loans');
    renderLoansList();
  });
});

// Search, Filter & Sort inputs
document.getElementById('loan-search-input')?.addEventListener('input', (e) => {
  state.filters.search = e.target.value;
  const clearBtn = document.getElementById('clear-search-btn');
  if (e.target.value) clearBtn.classList.remove('hidden');
  else clearBtn.classList.add('hidden');
  renderLoansList();
});

document.getElementById('clear-search-btn')?.addEventListener('click', () => {
  document.getElementById('loan-search-input').value = '';
  document.getElementById('clear-search-btn').classList.add('hidden');
  state.filters.search = '';
  renderLoansList();
});

document.getElementById('status-filter')?.addEventListener('change', (e) => {
  state.filters.status = e.target.value;
  renderLoansList();
});

document.getElementById('sort-by-select')?.addEventListener('change', (e) => {
  state.filters.sortBy = e.target.value;
  renderLoansList();
});

document.getElementById('reset-filter-btn')?.addEventListener('click', resetFilters);

function resetFilters() {
  state.filters.search = '';
  state.filters.status = 'ALL';
  const input = document.getElementById('loan-search-input');
  if (input) input.value = '';
  document.getElementById('clear-search-btn')?.classList.add('hidden');
  const sel = document.getElementById('status-filter');
  if (sel) sel.value = 'ALL';
  renderLoansList();
}

function filterByPerson(personName) {
  const input = document.getElementById('loan-search-input');
  if (input) input.value = personName;
  document.getElementById('clear-search-btn')?.classList.remove('hidden');
  state.filters.search = personName;
  state.filters.status = 'ALL';
  const sel = document.getElementById('status-filter');
  if (sel) sel.value = 'ALL';
  switchTab('tab-loans');
  renderLoansList();
}

function viewLoanDetails(loanId) {
  switchTab('tab-loans');
  const card = document.getElementById(`card-${loanId}`);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.style.borderColor = 'var(--primary)';
    setTimeout(() => { card.style.borderColor = ''; }, 2000);
  }
}

document.getElementById('people-search-input')?.addEventListener('input', renderPeopleView);

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Offline Detection
window.addEventListener('online', () => {
  document.getElementById('offline-banner')?.classList.add('hidden');
  showToast('Back online! Syncing...', 'success');
  if (!state.isPortalMode) fetchAllData(false);
});

window.addEventListener('offline', () => {
  document.getElementById('offline-banner')?.classList.remove('hidden');
  showToast('You are offline. Showing cached records.', 'warning');
});

// Event Listeners for Header / Buttons
document.querySelectorAll('.open-add-loan-btn').forEach(btn => {
  btn.addEventListener('click', openAddLoanModal);
});

document.getElementById('settings-btn')?.addEventListener('click', () => {
  loadSettingsForm();
  openModal('settings-modal');
});

document.getElementById('open-setup-btn')?.addEventListener('click', () => {
  loadSettingsForm();
  openModal('settings-modal');
});

document.getElementById('refresh-btn')?.addEventListener('click', () => {
  fetchAllData(true);
});

document.getElementById('export-loans-csv-btn')?.addEventListener('click', exportLoansToCsv);
document.getElementById('export-payments-csv-btn')?.addEventListener('click', exportPaymentsToCsv);
document.getElementById('dash-export-csv-btn')?.addEventListener('click', exportLoansToCsv);

// ==============================================================================
// INITIALIZATION
// ==============================================================================

window.addEventListener('DOMContentLoaded', async () => {
  initTheme();

  if (!navigator.onLine) {
    document.getElementById('offline-banner')?.classList.remove('hidden');
  }

  // Check if opened as borrower portal link
  const isPortal = await checkAndInitPortalMode();
  if (!isPortal) {
    fetchAllData(true);
  }
});
