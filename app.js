// ===== FIREBASE =====
const firebaseConfig = {
  apiKey:            "AIzaSyAQQoKpHlg0XSfqsF-yKF30KWUHM7pQlSc",
  authDomain:        "hormiga-327ec.firebaseapp.com",
  projectId:         "hormiga-327ec",
  storageBucket:     "hormiga-327ec.firebasestorage.app",
  messagingSenderId: "388337254801",
  appId:             "1:388337254801:web:28f59031ce7e0d2807da30",
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

// Persistencia offline nativa — Firestore cachea los datos localmente
db.enablePersistence({ synchronizeTabs: false }).catch(() => {});

// ===== STATE =====
let currentAmount    = '';
let selectedCategory = null;
let currentUser      = null;
let userGroupId      = null;
let expensesUnsub    = null;
let authMode         = 'login';

const CATEGORIES = {
  kiosko:        { name: 'Kiosko',    emoji: '🥤' },
  nafta:         { name: 'Nafta',     emoji: '⛽' },
  digitales:     { name: 'Digitales', emoji: '🎮' },
  transferencias:{ name: 'Transfer.', emoji: '💖' },
  casa:          { name: 'Casa',      emoji: '🏠' },
  tarjeta:       { name: 'Tarjeta',   emoji: '💳' },
};

// ===== DOM REFS =====
const amountValue   = document.getElementById('amount-value');
const btnSave       = document.getElementById('btn-save');
const noteInput     = document.getElementById('note-input');
const screenAdd     = document.getElementById('screen-add');
const screenHistory = document.getElementById('screen-history');
const screenStats   = document.getElementById('screen-stats');
const screenAuth    = document.getElementById('screen-auth');
const screenGroup   = document.getElementById('screen-group');
const btnGoHistory  = document.getElementById('btn-go-history');
const btnGoAdd      = document.getElementById('btn-go-add');
const btnExport     = document.getElementById('btn-export');
const historyList   = document.getElementById('history-list');
const summaryMonth  = document.getElementById('summary-month');
const summaryTotal  = document.getElementById('summary-total');
const toast         = document.getElementById('toast');
const userBadge     = document.getElementById('user-badge');
const modalSettings = document.getElementById('modal-settings');
const modalBackdrop = document.getElementById('modal-backdrop');

// ===== CACHÉ LOCAL (evita pantalla en blanco mientras carga Firestore) =====
function getExpenses() {
  try { return JSON.parse(localStorage.getItem('hormiga_expenses') || '[]'); }
  catch { return []; }
}
function saveExpenses(expenses) {
  localStorage.setItem('hormiga_expenses', JSON.stringify(expenses));
}

// ===== AUTH: OBSERVER PRINCIPAL =====
auth.onAuthStateChanged(async user => {
  if (!user) {
    currentUser = null;
    userGroupId = null;
    if (expensesUnsub) { expensesUnsub(); expensesUnsub = null; }
    showAuthScreen();
    return;
  }

  currentUser = user;
  updateUserBadge();

  // 1. Intentar con caché local primero (arranque instantáneo)
  const cachedGroupId = localStorage.getItem('hormiga_groupid');
  if (cachedGroupId) {
    try {
      const groupDoc = await db.collection('groups').doc(cachedGroupId).get();
      if (groupDoc.exists && groupDoc.data().members.includes(user.uid)) {
        userGroupId = cachedGroupId;
        enterApp();
        return;
      }
    } catch { /* continúa a buscar en Firestore */ }
    localStorage.removeItem('hormiga_groupid');
  }

  // 2. Buscar en Firestore si no hay caché válida
  try {
    const q = await db.collection('groups')
      .where('members', 'array-contains', user.uid)
      .limit(1).get();
    if (!q.empty) {
      userGroupId = q.docs[0].id;
      localStorage.setItem('hormiga_groupid', userGroupId);
      enterApp();
    } else {
      showGroupScreen();
    }
  } catch {
    showGroupScreen();
  }
});

// ===== AUTH SCREEN =====
const authEmail     = document.getElementById('auth-email');
const authPassword  = document.getElementById('auth-password');
const authName      = document.getElementById('auth-name');
const authNameRow   = document.getElementById('auth-name-row');
const btnAuthSubmit = document.getElementById('btn-auth-submit');
const authError     = document.getElementById('auth-error');

function showAuthScreen() {
  screenAuth.classList.remove('hidden');
  screenGroup.classList.add('hidden');
  screenAdd.classList.remove('active');
}

document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    authMode = tab.dataset.tab;
    authNameRow.classList.toggle('hidden', authMode !== 'register');
    btnAuthSubmit.textContent = authMode === 'login' ? 'Ingresar' : 'Crear cuenta';
    authError.classList.add('hidden');
    validateAuthForm();
  });
});

[authEmail, authPassword, authName].forEach(el =>
  el.addEventListener('input', validateAuthForm)
);

authPassword.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !btnAuthSubmit.disabled) btnAuthSubmit.click();
});

function validateAuthForm() {
  const ok = authEmail.value.includes('@') &&
             authPassword.value.length >= 6 &&
             (authMode === 'login' || authName.value.trim().length >= 2);
  btnAuthSubmit.disabled = !ok;
}

btnAuthSubmit.addEventListener('click', async () => {
  btnAuthSubmit.disabled = true;
  authError.classList.add('hidden');
  const email = authEmail.value.trim();
  const pass  = authPassword.value;

  try {
    if (authMode === 'login') {
      await auth.signInWithEmailAndPassword(email, pass);
    } else {
      const cred = await auth.createUserWithEmailAndPassword(email, pass);
      await cred.user.updateProfile({ displayName: authName.value.trim() });
    }
    // onAuthStateChanged maneja el resto
  } catch (e) {
    authError.textContent = translateAuthError(e.code);
    authError.classList.remove('hidden');
    btnAuthSubmit.disabled = false;
  }
});

function translateAuthError(code) {
  const msgs = {
    'auth/invalid-email':        'Email inválido.',
    'auth/user-not-found':       'No existe una cuenta con ese email.',
    'auth/wrong-password':       'Contraseña incorrecta.',
    'auth/invalid-credential':   'Email o contraseña incorrectos.',
    'auth/email-already-in-use': 'Ese email ya tiene una cuenta.',
    'auth/weak-password':        'La contraseña debe tener al menos 6 caracteres.',
    'auth/too-many-requests':    'Demasiados intentos. Intentá más tarde.',
    'auth/network-request-failed': 'Sin conexión. Revisá tu internet.',
  };
  return msgs[code] || 'Error al iniciar sesión. Intentá de nuevo.';
}

// ===== GROUP SCREEN =====
const joinCodeInput    = document.getElementById('join-code-input');
const btnJoinGroup     = document.getElementById('btn-join-group');
const btnCreateGroup   = document.getElementById('btn-create-group');
const groupCodeDisplay = document.getElementById('group-code-display');
const groupCodeValue   = document.getElementById('group-code-value');
const btnGroupContinue = document.getElementById('btn-group-continue');

function showGroupScreen() {
  screenGroup.classList.remove('hidden');
  screenAuth.classList.add('hidden');
  screenAdd.classList.remove('active');
}

function generateGroupCode() {
  // Sin chars confusos (0/O, 1/I/L)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

btnCreateGroup.addEventListener('click', async () => {
  btnCreateGroup.disabled = true;
  const code = generateGroupCode();
  try {
    await db.collection('groups').doc(code).set({
      members:     [currentUser.uid],
      memberNames: { [currentUser.uid]: currentUser.displayName || 'Usuario' },
      createdAt:   firebase.firestore.FieldValue.serverTimestamp(),
    });

    await migrateLocalData(code);

    groupCodeValue.textContent = code;
    groupCodeDisplay.classList.remove('hidden');
    btnCreateGroup.classList.add('hidden');
    document.querySelector('.group-divider').classList.add('hidden');
    document.querySelector('.group-join-row').classList.add('hidden');
  } catch {
    showToast('Error al crear el grupo. Intentá de nuevo.');
    btnCreateGroup.disabled = false;
  }
});

btnGroupContinue.addEventListener('click', () => {
  userGroupId = groupCodeValue.textContent;
  localStorage.setItem('hormiga_groupid', userGroupId);
  screenGroup.classList.add('hidden');
  enterApp();
});

joinCodeInput.addEventListener('input', () => {
  joinCodeInput.value = joinCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  btnJoinGroup.disabled = joinCodeInput.value.length < 6;
});

btnJoinGroup.addEventListener('click', async () => {
  btnJoinGroup.disabled = true;
  const code = joinCodeInput.value.trim().toUpperCase();
  try {
    const groupDoc = await db.collection('groups').doc(code).get();
    if (!groupDoc.exists) {
      showToast('Código inválido. Revisalo e intentá de nuevo.');
      btnJoinGroup.disabled = false;
      return;
    }
    await db.collection('groups').doc(code).update({
      members: firebase.firestore.FieldValue.arrayUnion(currentUser.uid),
      [`memberNames.${currentUser.uid}`]: currentUser.displayName || 'Usuario',
    });
    await migrateLocalData(code);
    userGroupId = code;
    localStorage.setItem('hormiga_groupid', userGroupId);
    screenGroup.classList.add('hidden');
    enterApp();
  } catch {
    showToast('Error al unirse. Revisá la conexión.');
    btnJoinGroup.disabled = false;
  }
});

// Sube los gastos previos de localStorage a Firestore (una sola vez)
async function migrateLocalData(groupId) {
  const existing = getExpenses().filter(e => !e._docId); // solo los no migrados
  if (existing.length === 0) return;
  try {
    const batch = db.batch();
    existing.forEach(exp => {
      const ref = db.collection('expenses').doc();
      batch.set(ref, {
        groupId,
        id:        exp.id,
        amount:    exp.amount,
        category:  exp.category,
        note:      exp.note || '',
        date:      exp.date,
        usuario:   exp.usuario || currentUser.displayName || 'Usuario',
        userId:    currentUser.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
  } catch { /* silencioso — se puede reintentar */ }
}

// ===== ENTRAR A LA APP =====
function enterApp() {
  screenAuth.classList.add('hidden');
  screenGroup.classList.add('hidden');
  screenAdd.classList.add('active');
  updateUserBadge();
  startRealtimeListener();
}

function startRealtimeListener() {
  if (expensesUnsub) expensesUnsub();

  expensesUnsub = db.collection('expenses')
    .where('groupId', '==', userGroupId)
    .onSnapshot(snapshot => {
      const expenses = snapshot.docs
        .map(doc => ({ _docId: doc.id, ...doc.data() }))
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      saveExpenses(expenses);

      if (screenHistory.classList.contains('active')) renderHistory();
      if (screenStats.classList.contains('active'))   renderStats();
    });
}

// ===== USER BADGE & SETTINGS =====
function updateUserBadge() {
  if (userBadge) userBadge.textContent = currentUser?.displayName || '…';
}

userBadge.addEventListener('click', () => {
  document.getElementById('settings-name-input').value = currentUser?.displayName || '';
  modalSettings.classList.remove('hidden');
  modalBackdrop.classList.remove('hidden');
});

modalBackdrop.addEventListener('click', closeSettings);
document.getElementById('btn-settings-close').addEventListener('click', closeSettings);

function closeSettings() {
  modalSettings.classList.add('hidden');
  modalBackdrop.classList.add('hidden');
}

document.getElementById('btn-settings-save').addEventListener('click', async () => {
  const name = document.getElementById('settings-name-input').value.trim();
  if (name.length < 2) return;
  try {
    await currentUser.updateProfile({ displayName: name });
    // Actualizar nombre en el grupo
    if (userGroupId) {
      await db.collection('groups').doc(userGroupId).update({
        [`memberNames.${currentUser.uid}`]: name,
      });
    }
    updateUserBadge();
    closeSettings();
    showToast(`Nombre actualizado: ${name}`);
  } catch {
    showToast('Error al guardar. Revisá la conexión.');
  }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  closeSettings();
  if (expensesUnsub) { expensesUnsub(); expensesUnsub = null; }
  userGroupId = null;
  localStorage.removeItem('hormiga_groupid');
  await auth.signOut();
  showToast('Sesión cerrada');
});

// ===== NUMPAD =====
document.querySelectorAll('.num-btn').forEach(btn => {
  btn.addEventListener('click', () => handleNumpad(btn.dataset.val));
});

function handleNumpad(val) {
  if (val === 'del') {
    currentAmount = currentAmount.slice(0, -1);
  } else if (val === ',') {
    if (currentAmount.includes(',')) return;
    if (currentAmount === '') currentAmount = '0';
    currentAmount += ',';
  } else {
    if (currentAmount.includes(',') && currentAmount.split(',')[1].length >= 2) return;
    if (currentAmount === '0') currentAmount = '';
    if (!currentAmount.includes(',') && currentAmount.length >= 9) return;
    currentAmount += val;
  }
  updateAmountDisplay();
  updateSaveBtn();
}

function updateAmountDisplay() {
  const display = amountValue.closest('.amount-display');
  if (currentAmount === '' || currentAmount === '0') {
    amountValue.textContent = '0';
    amountValue.classList.remove('has-value');
    display?.classList.remove('has-value');
    return;
  }
  const [int, dec] = currentAmount.split(',');
  amountValue.textContent = dec !== undefined
    ? `${parseInt(int || '0').toLocaleString('es-AR')},${dec}`
    : parseInt(int || '0').toLocaleString('es-AR');
  amountValue.classList.add('has-value');
  display?.classList.add('has-value');
}

// ===== CATEGORIES =====
document.querySelectorAll('.cat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedCategory = btn.dataset.cat;
    updateSaveBtn();
  });
});

// ===== SAVE BUTTON STATE =====
function updateSaveBtn() {
  const hasAmount = currentAmount !== '' && currentAmount !== '0' && currentAmount !== '0,';
  btnSave.disabled = !(hasAmount && selectedCategory);
}

// ===== SAVE EXPENSE =====
btnSave.addEventListener('click', saveExpense);

async function saveExpense() {
  if (btnSave.disabled || !currentUser || !userGroupId) return;

  const raw    = currentAmount.replace(',', '.');
  const amount = parseFloat(raw);
  if (isNaN(amount) || amount <= 0) return;

  const note = noteInput.value.trim();
  const cat  = CATEGORIES[selectedCategory];

  showToast(`${cat.emoji} $${formatAmount(amount)} guardado`);
  resetForm();

  try {
    await db.collection('expenses').add({
      groupId:   userGroupId,
      id:        Date.now(),
      amount,
      category:  selectedCategory,
      note,
      date:      getLocalISOString(),
      usuario:   currentUser.displayName || 'Usuario',
      userId:    currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch {
    showToast('⚠ Error al guardar. Revisá la conexión.');
  }
}

function resetForm() {
  currentAmount = '';
  selectedCategory = null;
  noteInput.value = '';
  amountValue.textContent = '0';
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('selected'));
  updateSaveBtn();
}

// ===== NAVIGATION =====
btnGoHistory.addEventListener('click', () => {
  screenAdd.classList.add('slide-left');
  screenHistory.classList.add('active');
  renderHistory();
});

btnGoAdd.addEventListener('click', () => {
  screenAdd.classList.remove('slide-left');
  screenHistory.classList.remove('active');
});

// ===== RENDER HISTORY =====
function renderHistory() {
  const expenses = getExpenses();
  updateSummary(expenses);

  if (expenses.length === 0) {
    historyList.innerHTML = `
      <div class="empty-state">
        <span class="empty-emoji">🐜</span>
        <p>Todavía no hay gastos registrados.</p>
      </div>`;
    return;
  }

  let html = '';
  let lastDate = '';

  [...expenses].reverse().forEach(exp => {
    const d       = new Date(exp.date);
    const dateKey = d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });

    if (dateKey !== lastDate) {
      html += `<div class="date-sep">${dateKey}</div>`;
      lastDate = dateKey;
    }

    const cat      = CATEGORIES[exp.category] || { name: exp.category, emoji: '📦' };
    const time     = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const noteHtml = exp.note    ? `<div class="item-note">${escapeHtml(exp.note)}</div>` : '';
    const userHtml = exp.usuario ? `<span class="item-user">${escapeHtml(exp.usuario)}</span>` : '';

    const catColor = CAT_COLORS[exp.category] || 'var(--border)';
    html += `
      <div class="history-item" data-id="${exp.id}" ontouchstart="" style="--cat-color:${catColor}">
        <div class="item-emoji">${cat.emoji}</div>
        <div class="item-info">
          <div class="item-cat-row">
            <span class="item-cat">${cat.name}</span>
            ${userHtml}
          </div>
          ${noteHtml}
          <div class="item-date">${time}</div>
        </div>
        <div class="item-amount">$${formatAmount(exp.amount)}</div>
        <div class="item-delete" onclick="deleteExpense(${exp.id})">🗑️</div>
      </div>`;
  });

  historyList.innerHTML = html;

  document.querySelectorAll('.history-item').forEach(item => {
    let timer;
    item.addEventListener('touchstart', () => {
      timer = setTimeout(() => item.classList.toggle('show-delete'), 500);
    });
    item.addEventListener('touchend',  () => clearTimeout(timer));
    item.addEventListener('touchmove', () => clearTimeout(timer));
  });
}

// ===== DELETE =====
async function deleteExpense(numId) {
  const expenses = getExpenses();
  const expense  = expenses.find(e => e.id === numId);
  if (!expense) return;

  saveExpenses(expenses.filter(e => e.id !== numId));
  renderHistory();
  showToast('Gasto eliminado');

  if (expense._docId) {
    try {
      await db.collection('expenses').doc(expense._docId).delete();
    } catch {
      showToast('⚠ Error al eliminar en la nube.');
    }
  }
}

// ===== SUMMARY =====
function updateSummary(expenses) {
  const now = new Date();
  const thisMonth = expenses.filter(e => {
    const d = new Date(e.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  summaryMonth.textContent = `$${formatAmount(thisMonth.reduce((s, e) => s + e.amount, 0))}`;
  summaryTotal.textContent = `$${formatAmount(expenses.reduce((s, e) => s + e.amount, 0))}`;
  const mc = document.getElementById('summary-month-count');
  const tc = document.getElementById('summary-total-count');
  if (mc) mc.textContent = `${thisMonth.length} gasto${thisMonth.length !== 1 ? 's' : ''}`;
  if (tc) tc.textContent = `${expenses.length} en total`;
}

// ===== EXPORT CSV =====
btnExport.addEventListener('click', exportCSV);

function exportCSV() {
  const expenses = getExpenses();
  if (expenses.length === 0) { showToast('No hay gastos para exportar'); return; }

  const rows = [['Fecha', 'Hora', 'Categoria', 'Monto', 'Nota', 'Usuario']];
  expenses.forEach(e => {
    const d = new Date(e.date);
    rows.push([
      d.toLocaleDateString('es-AR'),
      d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
      CATEGORIES[e.category]?.name || e.category,
      e.amount.toFixed(2).replace('.', ','),
      e.note || '',
      e.usuario || '',
    ]);
  });

  const csv  = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `hormiga_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exportado ✓');
}

// ===== DATE UTILS =====
function getLocalISOString() {
  const d   = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.000`;
}

// ===== UTILS =====
function formatAmount(n) {
  return n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

// ===== SERVICE WORKER =====
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ===== SYNC GASTOS DESDE OVERLAY NATIVO (Capacitor) =====
async function syncPendingExpenses() {
  try {
    if (!window.Capacitor?.isNativePlatform()) return;
    const { HormigaStorage } = window.Capacitor.Plugins;
    if (!HormigaStorage || !currentUser || !userGroupId) return;

    const { expenses: raw } = await HormigaStorage.getPendingExpenses();
    const pending = JSON.parse(raw || '[]');
    if (pending.length === 0) return;

    const batch = db.batch();
    pending.forEach(exp => {
      const ref = db.collection('expenses').doc();
      batch.set(ref, {
        groupId:   userGroupId,
        id:        exp.id || Date.now(),
        amount:    exp.amount,
        category:  exp.category,
        note:      exp.note || '',
        date:      exp.date,
        usuario:   currentUser.displayName || 'Usuario',
        userId:    currentUser.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });

    await batch.commit();
    await HormigaStorage.clearPending();
    showToast(`🐜 +${pending.length} gasto${pending.length > 1 ? 's' : ''} sincronizado${pending.length > 1 ? 's' : ''}`);
  } catch { /* silencioso */ }
}

document.addEventListener('resume', syncPendingExpenses);

// ===== ESTADÍSTICAS =====
const CAT_COLORS = {
  kiosko:         '#c8f135',
  nafta:          '#f5a623',
  digitales:      '#7b5ea7',
  transferencias: '#ff6b9d',
  casa:           '#4ecdc4',
  tarjeta:        '#45b7d1',
};
const PERSON_COLORS = ['#c8f135', '#7b5ea7', '#f5a623', '#ff6b9d', '#4ecdc4', '#45b7d1'];

let statsPeriod = 'month';
let statsView   = 'category';

const btnGoStats   = document.getElementById('btn-go-stats');
const btnStatsBack = document.getElementById('btn-stats-back');

btnGoStats.addEventListener('click', () => {
  screenHistory.classList.remove('active');
  screenStats.classList.add('active');
  renderStats();
});

btnStatsBack.addEventListener('click', () => {
  screenStats.classList.remove('active');
  screenHistory.classList.add('active');
});

document.querySelectorAll('.period-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.period-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    statsPeriod = btn.dataset.period;
    renderStats();
  });
});

document.querySelectorAll('.toggle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    statsView = btn.dataset.view;
    renderStats();
  });
});

function getFilteredExpenses(period) {
  const all = getExpenses();
  const now = new Date();
  if (period === 'month') {
    return all.filter(e => {
      const d = new Date(e.date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
  }
  if (period === 'prev') {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return all.filter(e => {
      const d = new Date(e.date);
      return d.getMonth() === prev.getMonth() && d.getFullYear() === prev.getFullYear();
    });
  }
  return all;
}

function buildSegments(expenses, view) {
  const totals = {};
  expenses.forEach(e => {
    const key = view === 'person' ? (e.usuario || 'Sin nombre') : e.category;
    totals[key] = (totals[key] || 0) + e.amount;
  });
  return Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .map(([key, amount], i) => ({
      label: view === 'person' ? key : (CATEGORIES[key]?.name || key),
      emoji: view === 'person' ? '👤' : (CATEGORIES[key]?.emoji || '📦'),
      amount,
      color: view === 'person' ? PERSON_COLORS[i % PERSON_COLORS.length] : (CAT_COLORS[key] || '#888'),
    }));
}

function buildPieChart(segments, total) {
  const R = 78, CX = 110, CY = 110;
  const C       = 2 * Math.PI * R;
  const GAP_RAD = segments.length > 1 ? (1.5 / 360) * C : 0;
  let paths  = '';
  let cumPct = 0;

  segments.forEach(seg => {
    const pct   = seg.amount / total;
    const dash  = Math.max(0, pct * C - GAP_RAD);
    const gap   = C - dash;
    const angle = cumPct * 360 - 90;
    paths += `<circle cx="${CX}" cy="${CY}" r="${R}"
      fill="none" stroke="${seg.color}" stroke-width="38"
      stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}"
      transform="rotate(${angle.toFixed(2)}, ${CX}, ${CY})"
    />`;
    cumPct += pct;
  });

  return `<svg width="220" height="220" viewBox="0 0 220 220">
    ${paths}
    <circle cx="${CX}" cy="${CY}" r="${R - 19}" fill="var(--bg2)"/>
    <text x="${CX}" y="${CY - 7}" text-anchor="middle" fill="var(--text-dim)"
      font-family="'Space Mono',monospace" font-size="9" font-weight="700" letter-spacing="1.5">TOTAL</text>
    <text x="${CX}" y="${CY + 11}" text-anchor="middle" fill="var(--accent)"
      font-family="'Space Mono',monospace" font-size="16" font-weight="700">$${formatAmount(total)}</text>
  </svg>`;
}

function renderStats() {
  const expenses  = getFilteredExpenses(statsPeriod);
  const segments  = buildSegments(expenses, statsView);
  const total     = segments.reduce((s, d) => s + d.amount, 0);
  const container = document.getElementById('chart-container');
  const legend    = document.getElementById('chart-legend');

  if (total === 0) {
    container.innerHTML = `<div class="chart-empty"><span>🐜</span><p>Sin gastos en este período</p></div>`;
    legend.innerHTML = '';
    return;
  }

  container.innerHTML = buildPieChart(segments, total);
  legend.innerHTML = segments.map(seg => {
    const pct = ((seg.amount / total) * 100).toFixed(1);
    return `
      <div class="legend-item">
        <div class="legend-main">
          <div class="legend-left">
            <span class="legend-dot" style="background:${seg.color}"></span>
            <span class="legend-emoji">${seg.emoji}</span>
            <span class="legend-label">${escapeHtml(seg.label)}</span>
          </div>
          <div class="legend-right">
            <span class="legend-amount">$${formatAmount(seg.amount)}</span>
            <span class="legend-pct">${pct}%</span>
          </div>
        </div>
        <div class="legend-bar">
          <div class="legend-bar-fill" style="width:${pct}%;background:${seg.color}"></div>
        </div>
      </div>`;
  }).join('');
}
