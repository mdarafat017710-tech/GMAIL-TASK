import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, query, where, onSnapshot, serverTimestamp, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB0AdImn8AlFKA4z_j4n25xz-Py2jgmMNU",
  authDomain: "sell-156d4.firebaseapp.com",
  projectId: "sell-156d4",
  storageBucket: "sell-156d4.firebasestorage.app",
  messagingSenderId: "1:622346055495:web:ac370b08e40d6eadd0a662",
  appId: "622346055495"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const tg = window.Telegram?.WebApp;
if (tg) tg.expand();

const user = tg?.initDataUnsafe?.user;
const userId = user?.id ? user.id.toString() : "guest_user";
const telegramFullName = user ? [user.first_name, user.last_name].filter(Boolean).join(" ") : "User";

let totalEarned = 0;
let totalWithdrawn = 0;
let userBalance = 0;

let activeEmailsMap = {}; 
let selectedPayment = 'bKash';
let formData = { email: "", password: "", recovery: "" };

let rawGmailHistory = [];
let rawWithdrawHistory = [];
let gmailSearchQuery = "";
let withdrawSearchQuery = "";

const copyIconSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
const checkIconSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

document.getElementById('username').innerText = telegramFullName;
document.getElementById('user-id').innerText = userId;
if (user?.photo_url) document.getElementById('avatar').src = user.photo_url;

function showToast(msg, isError = false) {
  const toast = document.getElementById('copy-toast');
  const toastIconBg = document.getElementById('toast-icon-bg');
  const svgCheck = document.getElementById('toast-svg-check');
  const svgClose = document.getElementById('toast-svg-close');
  
  document.getElementById('toast-msg').innerText = msg;

  if (isError) {
    toastIconBg.style.background = 'var(--accent-red)';
    svgCheck.style.display = 'none';
    svgClose.style.display = 'block';
  } else {
    toastIconBg.style.background = 'var(--accent-green)';
    svgCheck.style.display = 'block';
    svgClose.style.display = 'none';
  }

  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

function playRefreshSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch (e) {}
}

window.copyToClipboard = function(text, btnElement) {
  if (!text) return;
  const doFeedback = () => {
    showToast("Copied successfully!");
    if (btnElement) {
      btnElement.classList.add('copied');
      btnElement.innerHTML = checkIconSvg;
      setTimeout(() => {
        btnElement.classList.remove('copied');
        btnElement.innerHTML = copyIconSvg;
      }, 1500);
    }
  };

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(doFeedback).catch(() => {
      fallbackCopyText(text);
      doFeedback();
    });
  } else {
    fallbackCopyText(text);
    doFeedback();
  }
};

function fallbackCopyText(text) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try { document.execCommand('copy'); } catch (err) {}
  document.body.removeChild(textArea);
}

window.copyUserId = function() {
  const btn = document.getElementById('id-copy-btn');
  window.copyToClipboard(userId, btn);
};

function formatDate(timestamp) {
  if (!timestamp) return "N/A";
  let date;
  if (timestamp.seconds) date = new Date(timestamp.seconds * 1000);
  else if (timestamp instanceof Date) date = timestamp;
  else date = new Date(timestamp);
  
  if (isNaN(date.getTime())) return "N/A";
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, function(m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
  });
}

function escapeJs(str) {
  return String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function loadExistingEmails() {
  try {
    const querySnapshot = await getDocs(collection(db, "allGmailHistory"));
    activeEmailsMap = {};
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      const status = data.status || 'Pending';
      if (status !== 'Rejected') {
        if (data.email) activeEmailsMap[data.email.toLowerCase().trim()] = status;
        if (data.recovery) activeEmailsMap[data.recovery.toLowerCase().trim()] = status;
      }
    });
  } catch(e) {}
}
loadExistingEmails();

function updateOverallBalance() {
  userBalance = Math.max(0, Math.floor(totalEarned - totalWithdrawn));
  document.getElementById('user-balance').innerText = userBalance;
  const accBalVal = document.getElementById('account-balance-val');
  if (accBalVal) accBalVal.innerText = userBalance;
  validateWithdrawForm();
}

window.refreshUserBalance = function() {
  const btn = document.getElementById('refresh-balance-btn');
  if (!btn || btn.classList.contains('refreshing')) return;

  btn.classList.add('refreshing');
  playRefreshSound();

  btn.innerHTML = `<svg class="ios-spinner" viewBox="0 0 24 24"><line x1="12" y1="3" x2="12" y2="6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><line x1="18.36" y1="5.64" x2="16.24" y2="7.76" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><line x1="21" y1="12" x2="18" y2="12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><line x1="18.36" y1="18.36" x2="16.24" y2="16.24" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><line x1="12" y1="21" x2="12" y2="18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><line x1="5.64" y1="18.36" x2="7.76" y2="16.24" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><line x1="3" y1="12" x2="6" y2="12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><line x1="5.64" y1="5.64" x2="7.76" y2="7.76" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`;

  setTimeout(() => {
    updateOverallBalance();
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    setTimeout(() => {
      btn.classList.remove('refreshing');
      btn.innerHTML = `<svg class="refresh-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>`;
    }, 800);
  }, 600);
};

onSnapshot(query(collection(db, "allGmailHistory"), where("userId", "==", userId)), (snapshot) => {
  let completedCount = 0;
  let pendingCount = 0;
  let rejectedCount = 0;
  let totalCount = 0;

  rawGmailHistory = [];
  
  snapshot.forEach((doc) => {
    const data = doc.data();
    const status = data.status || 'Pending';
    totalCount++;

    if (status === "Completed") completedCount++;
    else if (status === "Pending") pendingCount++;
    else if (status === "Rejected") rejectedCount++;

    rawGmailHistory.push(data);
  });

  document.getElementById('stat-total').innerText = totalCount;
  document.getElementById('stat-pending').innerText = pendingCount;
  document.getElementById('stat-completed').innerText = completedCount;
  document.getElementById('stat-rejected').innerText = rejectedCount;

  totalEarned = completedCount * 10;
  updateOverallBalance();
  renderGmailHistory();
});

onSnapshot(query(collection(db, "withdrawHistory"), where("userId", "==", userId)), (snapshot) => {
  let sumWithdrawn = 0;
  rawWithdrawHistory = [];

  snapshot.forEach((doc) => {
    const data = doc.data();
    sumWithdrawn += Number(data.amount || 0);
    rawWithdrawHistory.push(data);
  });

  totalWithdrawn = sumWithdrawn;
  updateOverallBalance();
  renderWithdrawHistory();
});

function renderGmailHistory() {
  const list = document.getElementById('gmail-history-container');
  const q = gmailSearchQuery.toLowerCase().trim();

  const filtered = rawGmailHistory.filter(data => {
    if (!q) return true;
    return (data.email && data.email.toLowerCase().includes(q)) ||
           (data.password && data.password.toLowerCase().includes(q)) ||
           (data.recovery && data.recovery.toLowerCase().includes(q));
  });

  if (filtered.length === 0) {
    list.innerHTML = '<p style="font-size:12px;color:#8e8e93;text-align:center;padding:20px;">No task history found</p>';
    return;
  }

  let html = '';
  filtered.forEach((data) => {
    const status = data.status || 'Pending';
    const statusClass = `status-${status.toLowerCase()}`;
    const dateStr = formatDate(data.timestamp);

    html += `
      <div class="account-card">
        <div class="field-item">
          <span class="field-left">Email</span>
          <div class="field-right-group">
            <span class="field-right">${escapeHtml(data.email)}</span>
            <button class="copy-btn" onclick="copyToClipboard('${escapeJs(data.email)}', this)">${copyIconSvg}</button>
          </div>
        </div>
        <div class="field-item">
          <span class="field-left">Password</span>
          <div class="field-right-group">
            <span class="field-right">${escapeHtml(data.password)}</span>
            <button class="copy-btn" onclick="copyToClipboard('${escapeJs(data.password)}', this)">${copyIconSvg}</button>
          </div>
        </div>
        <div class="field-item">
          <span class="field-left">Recovery Email</span>
          <div class="field-right-group">
            <span class="field-right">${escapeHtml(data.recovery)}</span>
            <button class="copy-btn" onclick="copyToClipboard('${escapeJs(data.recovery)}', this)">${copyIconSvg}</button>
          </div>
        </div>
        <div class="field-item">
          <span class="field-left">Date</span>
          <div class="field-right-group">
            <span class="field-right">${dateStr}</span>
          </div>
        </div>
        <div class="field-item">
          <span class="field-left">Status</span>
          <div class="field-right-group">
            <span class="status-badge ${statusClass}">${status}</span>
          </div>
        </div>
      </div>`;
  });
  list.innerHTML = html;
}

function renderWithdrawHistory() {
  const list = document.getElementById('withdraw-history-container');
  const q = withdrawSearchQuery.toLowerCase().trim();

  const filtered = rawWithdrawHistory.filter(data => {
    if (!q) return true;
    return (data.phone && data.phone.toLowerCase().includes(q)) ||
           (data.method && data.method.toLowerCase().includes(q)) ||
           (data.amount && String(data.amount).includes(q));
  });

  if (filtered.length === 0) {
    list.innerHTML = '<p style="font-size:12px;color:#8e8e93;text-align:center;padding:20px;">No withdraw history found</p>';
    return;
  }

  let html = '';
  filtered.forEach((data) => {
    const status = data.status || 'Pending';
    const statusClass = `status-${status.toLowerCase()}`;
    const dateStr = formatDate(data.timestamp);

    let logoUrl = "";
    if (data.method === 'bKash') logoUrl = "https://i.ibb.co.com/bR1wnvmg/images.jpg";
    else if (data.method === 'Nagad') logoUrl = "https://i.ibb.co.com/YF0cQypT/images-1.png";

    const methodDisplay = logoUrl 
      ? `<div style="display:flex;align-items:center;gap:6px;"><img src="${logoUrl}" class="history-pay-logo"><span>${escapeHtml(data.method)}</span></div>`
      : `<span>${escapeHtml(data.method)}</span>`;

    html += `
      <div class="account-card">
        <div class="field-item">
          <span class="field-left">Amount</span>
          <div class="field-right-group">
            <span class="field-right">৳${Math.floor(data.amount || 0)}</span>
          </div>
        </div>
        <div class="field-item">
          <span class="field-left">Payment Method</span>
          <div class="field-right-group">
            ${methodDisplay}
          </div>
        </div>
        <div class="field-item">
          <span class="field-left">Number</span>
          <div class="field-right-group">
            <span class="field-right">${escapeHtml(data.phone)}</span>
            <button class="copy-btn" onclick="copyToClipboard('${escapeJs(data.phone)}', this)">${copyIconSvg}</button>
          </div>
        </div>
        <div class="field-item">
          <span class="field-left">Date</span>
          <div class="field-right-group">
            <span class="field-right">${dateStr}</span>
          </div>
        </div>
        <div class="field-item">
          <span class="field-left">Status</span>
          <div class="field-right-group">
            <span class="status-badge ${statusClass}">${status}</span>
          </div>
        </div>
      </div>`;
  });
  list.innerHTML = html;
}

window.handleGmailSearchInput = function() {
  const val = document.getElementById('gmail-search-input').value;
  document.getElementById('gmail-clear-btn').style.display = val.length > 0 ? 'flex' : 'none';
  gmailSearchQuery = val;
  renderGmailHistory();
};

window.clearGmailSearchInput = function() {
  document.getElementById('gmail-search-input').value = '';
  document.getElementById('gmail-clear-btn').style.display = 'none';
  gmailSearchQuery = '';
  renderGmailHistory();
};

window.handleGmailSearch = function() {
  const spinner = document.getElementById('gmail-btn-spinner');
  const btnText = document.getElementById('gmail-btn-text');
  spinner.style.display = 'inline-block';
  btnText.style.display = 'none';
  
  setTimeout(() => {
    gmailSearchQuery = document.getElementById('gmail-search-input').value;
    renderGmailHistory();
    spinner.style.display = 'none';
    btnText.style.display = 'inline';
  }, 400);
};

window.handleWithdrawSearchInput = function() {
  const val = document.getElementById('withdraw-search-input').value;
  document.getElementById('withdraw-clear-btn').style.display = val.length > 0 ? 'flex' : 'none';
  withdrawSearchQuery = val;
  renderWithdrawHistory();
};

window.clearWithdrawSearchInput = function() {
  document.getElementById('withdraw-search-input').value = '';
  document.getElementById('withdraw-clear-btn').style.display = 'none';
  withdrawSearchQuery = '';
  renderWithdrawHistory();
};

window.handleWithdrawSearch = function() {
  const spinner = document.getElementById('withdraw-btn-spinner');
  const btnText = document.getElementById('withdraw-btn-text');
  spinner.style.display = 'inline-block';
  btnText.style.display = 'none';
  
  setTimeout(() => {
    withdrawSearchQuery = document.getElementById('withdraw-search-input').value;
    renderWithdrawHistory();
    spinner.style.display = 'none';
    btnText.style.display = 'inline';
  }, 400);
};

/* Reset Task Submission Form */
function resetTaskForm() {
  document.getElementById('input-email').value = '';
  document.getElementById('input-password').value = '';
  document.getElementById('input-recovery').value = '';
  document.querySelectorAll('.ios-box').forEach(i => i.classList.remove('valid', 'invalid'));
  document.querySelectorAll('.input-indicator').forEach(i => i.classList.remove('show'));
  document.querySelectorAll('.field-error-msg').forEach(i => i.classList.remove('show'));

  document.getElementById('btn-1').disabled = true;
  document.getElementById('btn-2').disabled = true;
  document.getElementById('btn-3').disabled = true;

  document.querySelectorAll('#tab-task .step-container').forEach(el => el.classList.remove('active'));
  document.getElementById('step-1').classList.add('active');
  document.getElementById('gmail-submit-form').style.display = 'none';
  document.getElementById('gmail-submit-trigger').style.display = 'block';
}

window.startGmailSubmission = function() {
  document.getElementById('gmail-submit-trigger').style.display = 'none';
  document.getElementById('gmail-submit-form').style.display = 'block';
};

window.validateGmailField = function(fieldType, step) {
  const input = document.getElementById(`input-${fieldType}`);
  const indicator = document.getElementById(`${fieldType}-indicator`);
  const errorMsg = document.getElementById(`${fieldType}-error-msg`);
  const btn = document.getElementById(`btn-${step}`);
  const val = input.value.trim().toLowerCase();

  if (val.length === 0) {
    input.classList.remove('valid', 'invalid');
    indicator.classList.remove('show');
    errorMsg.classList.remove('show');
    btn.disabled = true;
    return;
  }

  const isGmail = val.endsWith('@gmail.com') && val.length > 10;
  const isDuplicateActive = activeEmailsMap[val] !== undefined;

  if (isDuplicateActive) {
    input.classList.remove('valid');
    input.classList.add('invalid');
    indicator.classList.remove('show');
    errorMsg.classList.add('show');
    btn.disabled = true;
  } else if (isGmail) {
    input.classList.remove('invalid');
    input.classList.add('valid');
    indicator.classList.add('show');
    errorMsg.classList.remove('show');
    btn.disabled = false;
  } else {
    input.classList.remove('valid');
    input.classList.add('invalid');
    indicator.classList.remove('show');
    errorMsg.classList.remove('show');
    btn.disabled = true;
  }
};

window.validateStandardField = function(fieldType, minLen, step) {
  const input = document.getElementById(`input-${fieldType}`);
  const indicator = document.getElementById(`${fieldType}-indicator`);
  const btn = document.getElementById(`btn-${step}`);
  const val = input.value.trim();

  if (val.length === 0) {
    input.classList.remove('valid', 'invalid');
    indicator.classList.remove('show');
    btn.disabled = true;
    return;
  }

  if (val.length >= minLen) {
    input.classList.remove('invalid');
    input.classList.add('valid');
    indicator.classList.add('show');
    btn.disabled = false;
  } else {
    input.classList.remove('valid');
    input.classList.add('invalid');
    indicator.classList.remove('show');
    btn.disabled = true;
  }
};

window.nextStep = function(step) {
  const btn = document.getElementById(`btn-${step}`);
  const btnText = btn.querySelector('.btn-text');
  const btnSpinner = btn.querySelector('.btn-spinner');

  if (btnText) btnText.style.display = 'none';
  if (btnSpinner) btnSpinner.style.display = 'inline-block';
  btn.disabled = true;

  setTimeout(() => {
    if (btnText) btnText.style.display = 'inline';
    if (btnSpinner) btnSpinner.style.display = 'none';
    btn.disabled = false;

    if (step === 1) formData.email = document.getElementById('input-email').value.trim();
    if (step === 2) formData.password = document.getElementById('input-password').value.trim();
    if (step === 3) {
      formData.recovery = document.getElementById('input-recovery').value.trim();
      renderConfirmationStep();
    }

    document.querySelectorAll('#tab-task .step-container').forEach(el => el.classList.remove('active'));
    document.getElementById(`step-${step + 1}`).classList.add('active');
  }, 1000);
};

window.prevStep = function(targetStep) {
  document.querySelectorAll('#tab-task .step-container').forEach(el => el.classList.remove('active'));
  document.getElementById(`step-${targetStep}`).classList.add('active');
};

function renderConfirmationStep() {
  const container = document.getElementById('confirmation-card-content');
  container.innerHTML = `
    <div class="field-item">
      <span class="field-left">Email</span>
      <div class="field-right-group"><span class="field-right">${escapeHtml(formData.email)}</span></div>
    </div>
    <div class="field-item">
      <span class="field-left">Password</span>
      <div class="field-right-group"><span class="field-right">${escapeHtml(formData.password)}</span></div>
    </div>
    <div class="field-item">
      <span class="field-left">Recovery Email</span>
      <div class="field-right-group"><span class="field-right">${escapeHtml(formData.recovery)}</span></div>
    </div>
    <div class="action-container" style="margin-top:15px; display:flex; flex-direction:column; gap:8px;">
      <button class="btn-confirm-submit" id="btn-submit-final" onclick="submitFinalAccount()">
        <div class="check-icon-circle">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
        </div>
        <span class="btn-text">Confirm Account</span>
        <svg class="ios-spinner btn-spinner" viewBox="0 0 24 24">
          <line x1="12" y1="3" x2="12" y2="6" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>
          <line x1="18.36" y1="5.64" x2="16.24" y2="7.76" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>
          <line x1="21" y1="12" x2="18" y2="12" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>
          <line x1="18.36" y1="18.36" x2="16.24" y2="16.24" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>
          <line x1="12" y1="21" x2="12" y2="18" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>
          <line x1="5.64" y1="18.36" x2="7.76" y2="16.24" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>
          <line x1="3" y1="12" x2="6" y2="12" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>
          <line x1="5.64" y1="5.64" x2="7.76" y2="7.76" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
      </button>
      <button class="btn-cancel-submit" onclick="cancelAccountSubmission()">
        <span>Cancel</span>
      </button>
    </div>
  `;
}

window.cancelAccountSubmission = function() {
  showToast("Account submit cancel", true);
  resetTaskForm();
};

window.submitFinalAccount = async function() {
  const btn = document.getElementById('btn-submit-final');
  const btnText = btn.querySelector('.btn-text');
  const btnSpinner = btn.querySelector('.btn-spinner');
  const checkIcon = btn.querySelector('.check-icon-circle');

  if (btnText) btnText.style.display = 'none';
  if (checkIcon) checkIcon.style.display = 'none';
  if (btnSpinner) btnSpinner.style.display = 'inline-block';
  btn.disabled = true;

  try {
    await addDoc(collection(db, "allGmailHistory"), {
      userId: userId,
      email: formData.email,
      password: formData.password,
      recovery: formData.recovery,
      status: "Pending",
      timestamp: serverTimestamp()
    });

    setTimeout(() => {
      showToast("Account Submit Successful");
      resetTaskForm();
      loadExistingEmails();
    }, 1000);

  } catch (e) {
    showToast("Submission failed!", true);
    if (btnText) btnText.style.display = 'inline';
    if (checkIcon) checkIcon.style.display = 'flex';
    if (btnSpinner) btnSpinner.style.display = 'none';
    btn.disabled = false;
  }
};

window.selectPaymentMethod = function(method, elem) {
  selectedPayment = method;
  document.querySelectorAll('.payment-card').forEach(c => c.classList.remove('active'));
  elem.classList.add('active');
};

window.validateWithdrawForm = function() {
  const phoneInput = document.getElementById('withdraw-phone');
  const amountInput = document.getElementById('withdraw-amount');
  const phoneIndicator = document.getElementById('phone-indicator');
  const amountIndicator = document.getElementById('amount-indicator');
  const errorMsg = document.getElementById('withdraw-error-msg');
  const errorText = document.getElementById('withdraw-error-text');
  const btn = document.getElementById('btn-withdraw-submit');

  if (!phoneInput || !amountInput || !btn) return;

  const phoneValid = phoneInput.value.trim().length >= 11;
  const rawAmount = amountInput.value.trim();
  const amount = Math.floor(Number(rawAmount) || 0);

  let hasAmountError = false;
  let errorMessage = "";

  if (rawAmount !== "") {
    if (amount < 20) {
      hasAmountError = true;
      errorMessage = "Minimum withdraw 20 BDT";
    } else if (amount > userBalance) {
      hasAmountError = true;
      errorMessage = "Insufficient balance";
    }
  }

  const amountValid = rawAmount !== "" && !hasAmountError;

  if (phoneValid) {
    phoneInput.classList.add('valid'); phoneIndicator.classList.add('show');
  } else {
    phoneInput.classList.remove('valid'); phoneIndicator.classList.remove('show');
  }

  if (amountValid) {
    amountInput.classList.add('valid');
    amountInput.classList.remove('invalid');
    amountIndicator.classList.add('show');
  } else if (hasAmountError) {
    amountInput.classList.remove('valid');
    amountInput.classList.add('invalid');
    amountIndicator.classList.remove('show');
  } else {
    amountInput.classList.remove('valid', 'invalid');
    amountIndicator.classList.remove('show');
  }

  if (hasAmountError) {
    errorText.innerText = errorMessage;
    errorMsg.classList.add('show');
  } else {
    errorMsg.classList.remove('show');
  }

  btn.disabled = !(phoneValid && amountValid);
};

window.handleWithdrawSubmit = async function() {
  const phone = document.getElementById('withdraw-phone').value.trim();
  const amount = Math.floor(Number(document.getElementById('withdraw-amount').value) || 0);

  if (amount > userBalance) {
    showToast("Insufficient balance!", true);
    return;
  }

  try {
    await addDoc(collection(db, "withdrawHistory"), {
      userId: userId,
      method: selectedPayment,
      phone: phone,
      amount: amount,
      status: "Pending",
      timestamp: serverTimestamp()
    });

    showToast("Withdraw requested!");
    document.getElementById('withdraw-phone').value = '';
    document.getElementById('withdraw-amount').value = '';
    validateWithdrawForm();
  } catch (e) {
    showToast("Withdraw request failed!", true);
  }
};

window.switchMainTab = function(tab, elem) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  
  document.getElementById(`tab-${tab}`).classList.add('active');
  elem.classList.add('active');

  const titleMap = {
    'task': 'Task',
    'submit-history': 'History',
    'my-account': 'My Account',
    'withdraw': 'Withdraw',
    'withdraw-history': 'History'
  };
  document.getElementById('main-title').innerText = titleMap[tab] || 'Account';

  if (tab === 'task') {
    resetTaskForm();
  }
};
