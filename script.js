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

// Sound disabled per user request
function playRefreshSound() {}

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

  if (rawGmailHistory.length === 0) {
    list.innerHTML = '<p style="font-size:12px;color:#8e8e93;text-align:center;padding:20px;">No task history found</p>';
    return;
  }

  let html = '';
  rawGmailHistory.forEach((data) => {
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

  if (rawWithdrawHistory.length === 0) {
    list.innerHTML = '<p style="font-size:12px;color:#8e8e93;text-align:center;padding:20px;">No withdraw history found</p>';
    return;
  }

  let html = '';
  const payLogos = {
    'bkash': 'https://i.ibb.co.com/84S7K4Dk/bkash.png',
    'nagad': 'https://i.ibb.co.com/6c2m4pKG/nagad.png',
    'rocket': 'https://i.ibb.co.com/Kzmsm43F/rocket.png'
  };

  rawWithdrawHistory.forEach((data) => {
    const status = data.status || 'Pending';
    const statusClass = `status-${status.toLowerCase()}`;
    const dateStr = formatDate(data.timestamp);
    const methodKey = (data.method || 'bKash').toLowerCase();
    const logoUrl = payLogos[methodKey] || payLogos['bkash'];

    html += `
      <div class="account-card">
        <div class="field-item">
          <span class="field-left">Method</span>
          <div class="field-right-group">
            <img src="${logoUrl}" class="history-pay-logo" alt="${escapeHtml(data.method)}">
            <span class="field-right">${escapeHtml(data.method)}</span>
          </div>
        </div>
        <div class="field-item">
          <span class="field-left">Phone</span>
          <div class="field-right-group">
            <span class="field-right">${escapeHtml(data.phone)}</span>
            <button class="copy-btn" onclick="copyToClipboard('${escapeJs(data.phone)}', this)">${copyIconSvg}</button>
          </div>
        </div>
        <div class="field-item">
          <span class="field-left">Amount</span>
          <div class="field-right-group">
            <span class="field-right" style="color: var(--accent-green); font-weight: 700;">৳${escapeHtml(data.amount)}</span>
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

window.startTaskProcess = function() {
  document.getElementById('gmail-submit-trigger').style.display = 'none';
  document.getElementById('step-1').classList.add('active');
};

window.validateStepField = function(type) {
  let val = "", isValid = false, errorMsgText = "";
  const btn = document.getElementById(`btn-${type === 'email' ? 1 : type === 'password' ? 2 : 3}`);
  const input = document.getElementById(`input-${type}`);
  const indicator = document.getElementById(`${type}-indicator`);
  const errorMsg = document.getElementById(`${type}-error-msg`);
  const errorText = document.getElementById(`${type}-error-text`);

  val = input.value.trim();

  if (type === 'email') {
    const isGmailFormat = /^[a-zA-Z0-9.]+@gmail\.com$/.test(val.toLowerCase());
    if (val === "") {
      isValid = false;
      errorMsgText = "";
    } else if (!isGmailFormat) {
      isValid = false;
      errorMsgText = "Must be a valid @gmail.com address!";
    } else if (activeEmailsMap[val.toLowerCase()]) {
      isValid = false;
      errorMsgText = `This Gmail is already ${activeEmailsMap[val.toLowerCase()]}!`;
    } else {
      isValid = true;
    }
  } else if (type === 'password') {
    isValid = val.length >= 6;
  } else if (type === 'recovery') {
    const isEmailFormat = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.toLowerCase());
    if (val === "") {
      isValid = false;
      errorMsgText = "";
    } else if (!isEmailFormat) {
      isValid = false;
      errorMsgText = "Must be a valid email address!";
    } else if (activeEmailsMap[val.toLowerCase()]) {
      isValid = false;
      errorMsgText = `This Recovery Email is already ${activeEmailsMap[val.toLowerCase()]}!`;
    } else {
      isValid = true;
    }
  }

  if (errorMsg) {
    if (errorMsgText) {
      errorText.innerText = errorMsgText;
      errorMsg.classList.add('show');
    } else {
      errorMsg.classList.remove('show');
    }
  }

  if (isValid) {
    input.classList.remove('invalid');
    input.classList.add('valid');
    indicator.classList.add('show');
    btn.disabled = false;
  } else {
    input.classList.remove('valid');
    if (val.length > 0) input.classList.add('invalid');
    else input.classList.remove('invalid');
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
  }, 600);
};

window.prevStep = function(targetStep) {
  document.querySelectorAll('#tab-task .step-container').forEach(el => el.classList.remove('active'));
  document.getElementById(`step-${targetStep}`).classList.add('active');
};

function renderConfirmationStep() {
  const container = document.getElementById('confirmation-card-wrapper');
  container.innerHTML = `
    <div class="field-item">
      <span class="field-left">Gmail Address</span>
      <div class="field-right-group">
        <span class="field-right">${escapeHtml(formData.email)}</span>
      </div>
    </div>
    <div class="field-item">
      <span class="field-left">Password</span>
      <div class="field-right-group">
        <span class="field-right">${escapeHtml(formData.password)}</span>
      </div>
    </div>
    <div class="field-item">
      <span class="field-left">Recovery Email</span>
      <div class="field-right-group">
        <span class="field-right">${escapeHtml(formData.recovery)}</span>
      </div>
    </div>
  `;
}

window.submitTask = async function() {
  const btn = document.getElementById('btn-submit-task');
  const btnText = btn.querySelector('.btn-text');
  const btnSpinner = btn.querySelector('.btn-spinner');

  if (btnText) btnText.style.display = 'none';
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

    showToast("Submitted successfully!");

    // Reset Form
    document.getElementById('input-email').value = '';
    document.getElementById('input-password').value = '';
    document.getElementById('input-recovery').value = '';
    
    ['email', 'password', 'recovery'].forEach(type => {
      const input = document.getElementById(`input-${type}`);
      const indicator = document.getElementById(`${type}-indicator`);
      if (input) input.classList.remove('valid', 'invalid');
      if (indicator) indicator.classList.remove('show');
    });

    document.querySelectorAll('#tab-task .step-container').forEach(el => el.classList.remove('active'));
    document.getElementById('gmail-submit-trigger').style.display = 'block';

    loadExistingEmails();
  } catch (e) {
    showToast("Failed to submit!", true);
  } finally {
    if (btnText) btnText.style.display = 'inline';
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

  if (!phoneInput || !amountInput) return;

  const phone = phoneInput.value.trim();
  const amount = Number(amountInput.value);

  const phoneValid = /^01[3-9]\d{8}$/.test(phone);
  const amountValid = amount >= 50 && amount <= userBalance;

  if (phoneValid) {
    phoneInput.classList.remove('invalid');
    phoneInput.classList.add('valid');
    phoneIndicator.classList.add('show');
  } else {
    phoneInput.classList.remove('valid');
    if (phone.length > 0) phoneInput.classList.add('invalid');
    else phoneInput.classList.remove('invalid');
    phoneIndicator.classList.remove('show');
  }

  if (amountValid) {
    amountInput.classList.remove('invalid');
    amountInput.classList.add('valid');
    amountIndicator.classList.add('show');
  } else {
    amountInput.classList.remove('valid');
    if (amountInput.value.length > 0) amountInput.classList.add('invalid');
    else amountInput.classList.remove('invalid');
    amountIndicator.classList.remove('show');
  }

  let error = "";
  if (amountInput.value.length > 0) {
    if (amount < 50) error = "Min withdraw is ৳50";
    else if (amount > userBalance) error = "Insufficient balance!";
  }

  if (error) {
    errorText.innerText = error;
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
    'withdraw': 'Withdraw'
  };
  document.getElementById('main-title').innerText = titleMap[tab] || 'Task';
};
