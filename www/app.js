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
let selectedShared   = true;   // gasto compartido (default) vs personal
let editingShared    = true;
let currentUser      = null;
let userGroupId      = null;
let expensesUnsub    = null;
let transfersUnsub   = null;
let incomesUnsub     = null;
let installmentsUnsub = null;
let subscriptionsUnsub = null;
let groupUnsub       = null;
let authMode         = 'login';
let groupData        = null;   // { members, memberNames, memberIncomes }
let groupTransfers   = [];     // array de transferencias del grupo
let groupIncomes     = [];     // array de ingresos variables del grupo
let groupInstallments = [];    // array de cuotas / deudas del grupo
let groupSubscriptions = [];   // array de suscripciones del grupo
let budgetPeriod     = 'current';
let transferToUid    = null;
let editingInstallmentId = null;
let installmentShared    = true;
let editingSubscriptionId = null;
let subShared    = true;
let subCurrency  = 'ARS';
let dolarTarjeta = parseFloat(localStorage.getItem('hormiga_dolar') || '0') || 0; // cotización USD→ARS

// ¿El grupo tiene pareja (2+ miembros) o es individual?
function isCouple() {
  return (groupData?.members?.length || 1) >= 2;
}

const CATEGORIES = {
  kiosko:        { name: 'Kiosko',    emoji: '🥤' },
  nafta:         { name: 'Nafta',     emoji: '⛽' },
  digitales:     { name: 'Digitales', emoji: '🎮' },
  transferencias:{ name: 'Transfer.', emoji: '💖' },
  casa:          { name: 'Casa',      emoji: '🏠' },
  tarjeta:       { name: 'Tarjeta',   emoji: '💳' },
};
const DEFAULT_CAT_KEYS = ['kiosko', 'nafta', 'digitales', 'transferencias', 'casa', 'tarjeta'];

// Categorías propias del grupo (las comparten ambos). Viven en el doc del grupo.
function getCustomCategories() {
  return (groupData && Array.isArray(groupData.customCategories)) ? groupData.customCategories : [];
}

// Devuelve {name, emoji, color} de una categoría (default o propia), con fallback seguro.
function getCat(key) {
  if (CATEGORIES[key]) return { name: CATEGORIES[key].name, emoji: CATEGORIES[key].emoji, color: CAT_COLORS[key] || 'var(--border)' };
  const c = getCustomCategories().find(x => x.key === key);
  if (c) return { name: c.name, emoji: c.emoji, color: c.color || 'var(--border)' };
  return { name: key, emoji: '📦', color: 'var(--border)' }; // categoría borrada / desconocida
}

// Lista completa (defaults + propias) para construir las grillas de selección.
function getAllCategoriesList() {
  const defaults = DEFAULT_CAT_KEYS.map(k => ({ key: k, name: CATEGORIES[k].name, emoji: CATEGORIES[k].emoji }));
  return defaults.concat(getCustomCategories().map(c => ({ key: c.key, name: c.name, emoji: c.emoji })));
}

// ===== DOM REFS =====
const amountValue   = document.getElementById('amount-value');
const btnSave       = document.getElementById('btn-save');
const noteInput     = document.getElementById('note-input');
const screenAdd     = document.getElementById('screen-add');
const screenHistory = document.getElementById('screen-history');
const screenStats   = document.getElementById('screen-stats');
const screenAuth    = document.getElementById('screen-auth');
const screenGroup   = document.getElementById('screen-group');
const screenBudget  = document.getElementById('screen-budget');
const screenInstallments = document.getElementById('screen-installments');
const screenSubs    = document.getElementById('screen-subs');
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
    stopAllListeners();
    groupData = null;
    groupTransfers = [];
    groupIncomes = [];
    groupInstallments = [];
    groupSubscriptions = [];
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

function hideLoadingScreen() {
  document.getElementById('screen-loading')?.classList.add('hidden');
}

function showAuthScreen() {
  hideLoadingScreen();
  screenAuth.classList.remove('hidden');
  screenGroup.classList.add('hidden');
  screenAdd.classList.remove('active');
  // Mostrar "olvidaste contraseña" solo si estamos en modo login
  btnForgotPassword?.classList.toggle('hidden', authMode !== 'login');
  // Pre-cargar el último mail usado (autocompletado confiable, sin depender del sistema)
  const lastEmail = localStorage.getItem('hormiga_last_email');
  if (lastEmail && !authEmail.value) {
    authEmail.value = lastEmail;
    validateAuthForm();
  }
}

const btnForgotPassword = document.getElementById('btn-forgot-password');

document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    authMode = tab.dataset.tab;
    authNameRow.classList.toggle('hidden', authMode !== 'register');
    btnAuthSubmit.textContent = authMode === 'login' ? 'Ingresar' : 'Crear cuenta';
    authError.classList.add('hidden');
    // Mostrar "olvidaste contraseña" solo en modo login
    btnForgotPassword.classList.toggle('hidden', authMode !== 'login');
    validateAuthForm();
  });
});

btnForgotPassword.addEventListener('click', async () => {
  const email = authEmail.value.trim();
  if (!email.includes('@')) {
    showToast('Ingresá tu email primero');
    return;
  }
  btnForgotPassword.disabled = true;
  try {
    await auth.sendPasswordResetEmail(email);
    showToast('📧 Revisá tu email para restablecer la contraseña');
  } catch (e) {
    const msg = e.code === 'auth/user-not-found'
      ? 'No existe una cuenta con ese email.'
      : 'No se pudo enviar el email. Intentá de nuevo.';
    showToast(msg);
  }
  btnForgotPassword.disabled = false;
});

[authEmail, authPassword, authName].forEach(el =>
  el.addEventListener('input', validateAuthForm)
);

function validateAuthForm() {
  const ok = authEmail.value.includes('@') &&
             authPassword.value.length >= 6 &&
             (authMode === 'login' || authName.value.trim().length >= 2);
  btnAuthSubmit.disabled = !ok;
}

document.getElementById('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (btnAuthSubmit.disabled) return;
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
    localStorage.setItem('hormiga_last_email', email); // recordar para la próxima
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
  hideLoadingScreen();
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
        shared:    exp.shared !== false,
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
  hideLoadingScreen();
  screenAuth.classList.add('hidden');
  screenGroup.classList.add('hidden');
  screenAdd.classList.add('active');
  updateUserBadge();
  applyCoupleModeUI();
  renderCategoryGrids();
  scheduleReminders();   // re-asegura los recordatorios programados al abrir
  startRealtimeListener();
  loadGroupData();
}

// Muestra/oculta toda la UI de pareja según si el grupo es individual o no.
function applyCoupleModeUI() {
  document.body.classList.toggle('solo', !isCouple());
}

// ===== GRUPO: datos, ingresos y transferencias (todo en tiempo real) =====
function loadGroupData() {
  if (!userGroupId) return;

  // 1. Documento del grupo (nombres + ingresos fijos) en tiempo real
  if (groupUnsub) groupUnsub();
  groupUnsub = db.collection('groups').doc(userGroupId).onSnapshot(
    doc => {
      if (doc.exists) {
        groupData = doc.data();
        applyCoupleModeUI();   // si la pareja se une/sale, refresca la UI
        renderCategoryGrids(); // categorías propias pueden haber cambiado
        if (!modalCategories.classList.contains('hidden')) renderCategoriesList();
        if (screenBudget.classList.contains('active')) renderBudget();
      }
    },
    () => {} // silencioso offline
  );

  startTransfersListener();
  startIncomesListener();
  startInstallmentsListener();
  startSubscriptionsListener();
}

function startSubscriptionsListener() {
  if (subscriptionsUnsub) subscriptionsUnsub();
  subscriptionsUnsub = db.collection('groups').doc(userGroupId)
    .collection('subscriptions')
    .orderBy('createdAt', 'desc')
    .onSnapshot(
      snap => {
        groupSubscriptions = snap.docs.map(d => ({ _docId: d.id, ...d.data() }));
        if (screenSubs && screenSubs.classList.contains('active')) renderSubscriptions();
      },
      () => {} // silencioso offline
    );
}

function startInstallmentsListener() {
  if (installmentsUnsub) installmentsUnsub();
  installmentsUnsub = db.collection('groups').doc(userGroupId)
    .collection('installments')
    .orderBy('createdAt', 'desc')
    .onSnapshot(
      snap => {
        groupInstallments = snap.docs.map(d => ({ _docId: d.id, ...d.data() }));
        if (screenInstallments.classList.contains('active')) renderInstallments();
      },
      () => {} // silencioso offline
    );
}

function startTransfersListener() {
  if (transfersUnsub) transfersUnsub();
  transfersUnsub = db.collection('groups').doc(userGroupId)
    .collection('transfers')
    .orderBy('createdAt', 'desc')
    .onSnapshot(
      snap => {
        groupTransfers = snap.docs.map(d => ({ _docId: d.id, ...d.data() }));
        if (screenBudget.classList.contains('active')) renderBudget();
      },
      () => {} // silencioso offline
    );
}

function startIncomesListener() {
  if (incomesUnsub) incomesUnsub();
  incomesUnsub = db.collection('groups').doc(userGroupId)
    .collection('incomes')
    .orderBy('createdAt', 'desc')
    .onSnapshot(
      snap => {
        groupIncomes = snap.docs.map(d => ({ _docId: d.id, ...d.data() }));
        if (screenBudget.classList.contains('active')) renderBudget();
      },
      () => {} // silencioso offline
    );
}

function startRealtimeListener() {
  if (expensesUnsub) expensesUnsub();

  expensesUnsub = db.collection('expenses')
    .where('groupId', '==', userGroupId)
    .onSnapshot(snapshot => {
      const expenses = snapshot.docs
        .map(doc => ({ _docId: doc.id, ...doc.data() }))
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        // Privacidad: veo los compartidos (de ambos) + sólo MIS personales,
        // nunca los gastos personales del otro. (Los viejos sin campo = compartidos.)
        .filter(e => e.shared !== false || e.userId === currentUser?.uid);

      saveExpenses(expenses);

      if (screenHistory.classList.contains('active')) renderHistory();
      if (screenStats.classList.contains('active'))   renderStats();
      if (screenBudget.classList.contains('active'))  renderBudget();
    });
}

function stopAllListeners() {
  [expensesUnsub, transfersUnsub, incomesUnsub, installmentsUnsub, subscriptionsUnsub, groupUnsub]
    .forEach(u => { if (u) u(); });
  expensesUnsub = transfersUnsub = incomesUnsub = installmentsUnsub = subscriptionsUnsub = groupUnsub = null;
}

// ===== USER BADGE & SETTINGS =====
function updateUserBadge() {
  if (userBadge) userBadge.textContent = currentUser?.displayName || '…';
}

function openSettings() {
  document.getElementById('settings-name-input').value = currentUser?.displayName || '';
  const codeBox = document.getElementById('modal-group-code');
  if (codeBox) codeBox.textContent = userGroupId || '------';
  // Mostrar ingreso actual si ya estaba guardado
  const currentIncome = groupData?.memberIncomes?.[currentUser?.uid] || '';
  const incomeInput = document.getElementById('settings-income-input');
  if (incomeInput) incomeInput.value = currentIncome > 0 ? String(currentIncome) : '';
  renderReminderTimes();
  modalSettings.classList.remove('hidden');
  modalBackdrop.classList.remove('hidden');
}

userBadge.addEventListener('click', openSettings);

// ===== MENÚ PRINCIPAL =====
const modalMenu = document.getElementById('modal-menu');

function openMenu() {
  modalMenu.classList.remove('hidden');
  modalBackdrop.classList.remove('hidden');
}
function closeMenu() {
  modalMenu.classList.add('hidden');
  modalBackdrop.classList.add('hidden');
}

document.getElementById('btn-menu').addEventListener('click', openMenu);
document.getElementById('btn-menu-close').addEventListener('click', closeMenu);

document.querySelectorAll('#modal-menu .menu-item').forEach(item => {
  item.addEventListener('click', () => goToScreen(item.dataset.go));
});

// Navega a cualquier pantalla desde el menú, dejando el Historial como "padre"
// (para que el botón atrás sea coherente).
function goToScreen(target) {
  closeMenu();
  [screenHistory, screenStats, screenBudget, screenInstallments, screenSubs]
    .forEach(s => s && s.classList.remove('active'));
  screenAdd.classList.remove('slide-left');

  if (target === 'add')      { return; }
  if (target === 'settings') { openSettings(); return; }
  if (target === 'history')  {
    screenAdd.classList.add('slide-left');
    screenHistory.classList.add('active');
    renderHistory();
    return;
  }

  // Sub-pantallas: se montan sobre el historial
  screenAdd.classList.add('slide-left');
  screenHistory.classList.add('active');
  if (target === 'stats')        { screenStats.classList.add('active'); renderStats(); }
  else if (target === 'budget')  { screenBudget.classList.add('active'); renderBudget(); }
  else if (target === 'installments') { screenInstallments.classList.add('active'); renderInstallments(); }
  else if (target === 'subs')    { screenSubs && screenSubs.classList.add('active'); renderSubscriptions(); fetchDolar(); }
}

modalBackdrop.addEventListener('click', () => {
  closeSettings();
  closeEditModal();
  closeTransferModal();
  closeIncomeModal();
  closeInstallmentModal();
  closeMenu();
  closeCategoriesModal();
});
document.getElementById('btn-settings-close').addEventListener('click', closeSettings);

function closeSettings() {
  modalSettings.classList.add('hidden');
  modalBackdrop.classList.add('hidden');
}

// ===== GESTIÓN DE CATEGORÍAS =====
const CATEGORY_EMOJIS = ['🍔','🛒','🚗','🚌','⛽','🏠','🏥','💊','🎮','🎬','🎵','📱','💻','👕','👟','💳','💖','🎁','✈️','☕','🍺','🐶','🐱','🎓','🔧','🧹','💡','🚿','🍷','🏋️','✂️','📚','🌐','⚽'];
const CATEGORY_COLORS = ['#c8f135','#f5a623','#7b5ea7','#ff6b9d','#4ecdc4','#45b7d1','#ff6b6b','#a8e063','#f78fb3','#778beb','#e056fd','#ffa502'];
let newCatEmoji = '';
let newCatColor = CATEGORY_COLORS[0];
const modalCategories = document.getElementById('modal-categories');

function openCategoriesModal() {
  closeSettings();
  closeMenu();
  newCatEmoji = '';
  newCatColor = CATEGORY_COLORS[0];
  document.getElementById('cat-name-input').value = '';

  document.getElementById('cat-emoji-grid').innerHTML = CATEGORY_EMOJIS
    .map(e => `<button type="button" class="emoji-pick" data-emoji="${e}">${e}</button>`).join('');
  document.getElementById('cat-color-row').innerHTML = CATEGORY_COLORS
    .map((c, i) => `<button type="button" class="color-swatch${i === 0 ? ' selected' : ''}" data-color="${c}" style="background:${c}"></button>`).join('');

  renderCategoriesList();
  modalCategories.classList.remove('hidden');
  modalBackdrop.classList.remove('hidden');
}

function closeCategoriesModal() {
  modalCategories.classList.add('hidden');
  modalBackdrop.classList.add('hidden');
}

function renderCategoriesList() {
  const list = document.getElementById('cat-manage-list');
  const custom = getCustomCategories();
  if (custom.length === 0) {
    list.innerHTML = `<p class="cat-manage-empty">Las 6 categorías base no se borran. Agregá las tuyas abajo 👇</p>`;
    return;
  }
  list.innerHTML = custom.map(c => `
    <div class="cat-manage-item">
      <span class="cm-emoji">${c.emoji}</span>
      <span class="cm-name">${escapeHtml(c.name)}</span>
      <span class="cm-dot" style="background:${c.color}"></span>
      <button class="cat-manage-del" onclick="deleteCategory('${c.key}')">🗑️</button>
    </div>`).join('');
}

document.getElementById('cat-emoji-grid').addEventListener('click', (e) => {
  const b = e.target.closest('.emoji-pick');
  if (!b) return;
  document.querySelectorAll('#cat-emoji-grid .emoji-pick').forEach(x => x.classList.remove('selected'));
  b.classList.add('selected');
  newCatEmoji = b.dataset.emoji;
});

document.getElementById('cat-color-row').addEventListener('click', (e) => {
  const b = e.target.closest('.color-swatch');
  if (!b) return;
  document.querySelectorAll('#cat-color-row .color-swatch').forEach(x => x.classList.remove('selected'));
  b.classList.add('selected');
  newCatColor = b.dataset.color;
});

document.getElementById('btn-manage-categories').addEventListener('click', openCategoriesModal);
document.getElementById('btn-categories-close').addEventListener('click', closeCategoriesModal);

document.getElementById('btn-category-add').addEventListener('click', async () => {
  const name = document.getElementById('cat-name-input').value.trim();
  if (name.length < 2) { showToast('Poné un nombre'); return; }
  if (!newCatEmoji)     { showToast('Elegí un emoji'); return; }
  if (!userGroupId)     return;

  const cat = { key: 'cat_' + Date.now().toString(36), name, emoji: newCatEmoji, color: newCatColor };
  document.getElementById('cat-name-input').value = '';
  newCatEmoji = '';
  document.querySelectorAll('#cat-emoji-grid .emoji-pick').forEach(x => x.classList.remove('selected'));
  showToast(`${cat.emoji} ${cat.name} agregada`);

  try {
    await db.collection('groups').doc(userGroupId).update({
      customCategories: firebase.firestore.FieldValue.arrayUnion(cat),
    });
    // El snapshot del grupo re-renderiza las grillas y la lista
  } catch {
    showToast('⚠ Error al guardar. Revisá la conexión.');
  }
});

function deleteCategory(key) {
  if (!confirm('¿Eliminar esta categoría? Los gastos que la usaban quedan con un ícono genérico.')) return;
  const remaining = getCustomCategories().filter(c => c.key !== key);
  db.collection('groups').doc(userGroupId).update({ customCategories: remaining })
    .then(() => showToast('Categoría eliminada'))
    .catch(() => showToast('⚠ Error al eliminar. Revisá la conexión.'));
}

// ===== RECORDATORIOS DIARIOS (notificaciones locales, sin servidor) =====
const REMINDER_IDS = [2001, 2002, 2003, 2004];
let reminderTimes = [];
try { reminderTimes = JSON.parse(localStorage.getItem('hormiga_reminders') || '[]'); } catch { reminderTimes = []; }

function renderReminderTimes() {
  const el = document.getElementById('reminder-times');
  if (!el) return;
  if (reminderTimes.length === 0) {
    el.innerHTML = `<p class="reminder-empty">Sin recordatorios todavía.</p>`;
  } else {
    el.innerHTML = reminderTimes.map((t, i) => `
      <div class="reminder-row">
        <input type="time" class="reminder-time" value="${t}" data-idx="${i}" />
        <button class="reminder-del" data-idx="${i}" title="Quitar">🗑️</button>
      </div>`).join('');
  }
  const addBtn = document.getElementById('btn-add-reminder');
  if (addBtn) addBtn.disabled = reminderTimes.length >= 4;
}

document.getElementById('btn-add-reminder').addEventListener('click', () => {
  if (reminderTimes.length >= 4) return;
  reminderTimes.push(reminderTimes.length === 0 ? '21:00' : '09:00');
  persistReminders();
  renderReminderTimes();
});

// Editar un horario (change = cuando el usuario confirma la hora)
document.getElementById('reminder-times').addEventListener('change', (e) => {
  const input = e.target.closest('.reminder-time');
  if (!input) return;
  reminderTimes[+input.dataset.idx] = input.value;
  persistReminders();
});

// Quitar un horario
document.getElementById('reminder-times').addEventListener('click', (e) => {
  const del = e.target.closest('.reminder-del');
  if (!del) return;
  reminderTimes.splice(+del.dataset.idx, 1);
  persistReminders();
  renderReminderTimes();
});

function persistReminders() {
  localStorage.setItem('hormiga_reminders', JSON.stringify(reminderTimes));
  scheduleReminders();
}

// Programa (o reprograma) las notificaciones diarias repetentes.
async function scheduleReminders() {
  const LN = window.Capacitor?.Plugins?.LocalNotifications;
  if (!LN) return; // en navegador/preview no hay plugin nativo → solo guarda la preferencia

  try {
    const perm = await LN.requestPermissions();
    if (perm.display !== 'granted') {
      showToast('Activá las notificaciones para recibir recordatorios');
      return;
    }
    // Limpiar los 4 slots y reprogramar desde cero
    await LN.cancel({ notifications: REMINDER_IDS.map(id => ({ id })) });

    const valid = reminderTimes.filter(t => /^\d{1,2}:\d{2}$/.test(t)).slice(0, 4);
    if (valid.length === 0) return;

    const notifications = valid.map((t, i) => {
      const [hour, minute] = t.split(':').map(Number);
      return {
        id: REMINDER_IDS[i],
        title: 'Hormiga 🐜',
        body: '¿Registraste tus gastos de hoy?',
        schedule: { on: { hour, minute }, repeats: true, allowWhileIdle: true },
      };
    });
    await LN.schedule({ notifications });
  } catch { /* silencioso */ }
}

document.getElementById('btn-settings-save').addEventListener('click', async () => {
  const name = document.getElementById('settings-name-input').value.trim();
  if (name.length < 2) return;

  // Parsear ingreso (acepta puntos como separador de miles)
  const incomeRaw = (document.getElementById('settings-income-input')?.value || '')
    .replace(/\./g, '').replace(',', '.');
  const income = parseFloat(incomeRaw);

  try {
    await currentUser.updateProfile({ displayName: name });
    if (userGroupId) {
      const updatePayload = { [`memberNames.${currentUser.uid}`]: name };
      if (!isNaN(income) && income > 0) {
        updatePayload[`memberIncomes.${currentUser.uid}`] = income;
        // Actualizar caché local inmediatamente
        if (!groupData) groupData = { memberNames: {}, memberIncomes: {} };
        if (!groupData.memberIncomes) groupData.memberIncomes = {};
        groupData.memberIncomes[currentUser.uid] = income;
      }
      await db.collection('groups').doc(userGroupId).update(updatePayload);
      if (groupData?.memberNames) groupData.memberNames[currentUser.uid] = name;
    }
    updateUserBadge();
    closeSettings();
    showToast(`Ajustes guardados ✓`);
  } catch {
    showToast('Error al guardar. Revisá la conexión.');
  }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  closeSettings();
  stopAllListeners();
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
// Construye las grillas de categorías (registro + edición) desde defaults + propias.
function renderCategoryGrids() {
  const cats = getAllCategoriesList();
  const btns = cats.map(c =>
    `<button class="cat-btn" data-cat="${c.key}"><span class="cat-emoji">${c.emoji}</span><span class="cat-name">${escapeHtml(c.name)}</span></button>`
  ).join('');

  const addGrid  = document.getElementById('add-category-grid');
  const editGrid = document.getElementById('edit-category-grid');
  if (addGrid) {
    addGrid.innerHTML = btns +
      `<button class="cat-btn cat-btn-manage" id="cat-btn-new"><span class="cat-emoji">➕</span><span class="cat-name">Nueva</span></button>`;
    if (selectedCategory) {
      addGrid.querySelector(`.cat-btn[data-cat="${selectedCategory}"]`)?.classList.add('selected');
    }
  }
  if (editGrid) {
    editGrid.innerHTML = btns;
    if (editingCategory) {
      editGrid.querySelector(`.cat-btn[data-cat="${editingCategory}"]`)?.classList.add('selected');
    }
  }
}

// Selección por delegación (los botones se generan dinámicamente).
document.getElementById('add-category-grid').addEventListener('click', (e) => {
  const btn = e.target.closest('.cat-btn');
  if (!btn) return;
  if (btn.id === 'cat-btn-new') { openCategoriesModal(); return; }
  document.querySelectorAll('#add-category-grid .cat-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedCategory = btn.dataset.cat;
  updateSaveBtn();
});

// ===== TOGGLE COMPARTIDO / PERSONAL =====
document.querySelectorAll('#share-toggle .share-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#share-toggle .share-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedShared = btn.dataset.shared === 'true';
  });
});

document.querySelectorAll('#edit-share-toggle .share-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#edit-share-toggle .share-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    editingShared = btn.dataset.shared === 'true';
  });
});

function setShareToggle(toggleId, shared) {
  document.querySelectorAll(`#${toggleId} .share-btn`).forEach(b => {
    b.classList.toggle('active', (b.dataset.shared === 'true') === shared);
  });
}

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

  const note     = noteInput.value.trim();
  const category = selectedCategory; // capturar ANTES de resetForm() — evita guardar null
  // En pareja respeta el toggle; individual → personal; si el grupo aún no cargó → compartido (default seguro)
  const shared   = !groupData ? true : (isCouple() ? selectedShared : false);
  const cat      = CATEGORIES[category];

  showToast(`${cat.emoji} $${formatAmount(amount)} guardado`);
  resetForm();

  try {
    await db.collection('expenses').add({
      groupId:   userGroupId,
      id:        Date.now(),
      amount,
      category,
      note,
      shared,
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
  selectedShared = true;            // vuelve al default "Compartido"
  noteInput.value = '';
  amountValue.textContent = '0';
  document.querySelectorAll('#screen-add .cat-btn').forEach(b => b.classList.remove('selected'));
  setShareToggle('share-toggle', true);
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

    const cat      = getCat(exp.category);
    const time     = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const noteHtml = exp.note    ? `<div class="item-note">${escapeHtml(exp.note)}</div>` : '';
    const userHtml = exp.usuario ? `<span class="item-user">${escapeHtml(exp.usuario)}</span>` : '';
    const personalHtml = (isCouple() && exp.shared === false) ? `<span class="item-personal">👤 personal</span>` : '';

    const catColor = cat.color;
    html += `
      <div class="history-item" data-id="${exp.id}" ontouchstart="" style="--cat-color:${catColor}">
        <div class="item-emoji">${cat.emoji}</div>
        <div class="item-info">
          <div class="item-cat-row">
            <span class="item-cat">${cat.name}</span>
            ${userHtml}
            ${personalHtml}
          </div>
          ${noteHtml}
          <div class="item-date">${time}</div>
        </div>
        <div class="item-amount">$${formatAmount(exp.amount)}</div>
        <div class="item-actions">
          <div class="item-edit" onclick="openEditExpense(${exp.id})">✏️</div>
          <div class="item-delete" onclick="confirmDeleteExpense(${exp.id})">🗑️</div>
        </div>
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
function confirmDeleteExpense(numId) {
  if (!confirm('¿Eliminar este gasto? Esta acción no se puede deshacer.')) return;
  deleteExpense(numId);
}

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

// ===== EDITAR GASTO =====
let editingExpenseId = null;
let editingCategory  = null;
const modalEdit       = document.getElementById('modal-edit');
const editAmountInput = document.getElementById('edit-amount-input');
const editNoteInput   = document.getElementById('edit-note-input');
const btnEditSave     = document.getElementById('btn-edit-save');

function openEditExpense(numId) {
  const expenses = getExpenses();
  const exp = expenses.find(e => e.id === numId);
  if (!exp) return;

  editingExpenseId = numId;
  editingCategory  = exp.category;
  editingShared    = exp.shared !== false;   // viejos (sin campo) → compartido
  editAmountInput.value = String(exp.amount).replace('.', ',');
  editNoteInput.value   = exp.note || '';
  document.querySelectorAll('#edit-category-grid .cat-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.cat === exp.category);
  });
  setShareToggle('edit-share-toggle', editingShared);

  modalEdit.classList.remove('hidden');
  modalBackdrop.classList.remove('hidden');
}

function closeEditModal() {
  modalEdit.classList.add('hidden');
  modalBackdrop.classList.add('hidden');
  editingExpenseId = null;
  editingCategory  = null;
  editingShared    = true;
}

document.getElementById('edit-category-grid').addEventListener('click', (e) => {
  const btn = e.target.closest('.cat-btn');
  if (!btn) return;
  document.querySelectorAll('#edit-category-grid .cat-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  editingCategory = btn.dataset.cat;
});

document.getElementById('btn-edit-close').addEventListener('click', closeEditModal);

btnEditSave.addEventListener('click', async () => {
  if (!editingExpenseId || !editingCategory) return;

  const raw    = editAmountInput.value.replace(',', '.');
  const amount = parseFloat(raw);
  if (isNaN(amount) || amount <= 0) { showToast('Monto inválido'); return; }

  const expenses = getExpenses();
  const exp = expenses.find(e => e.id === editingExpenseId);
  if (!exp) return;

  const category = editingCategory;
  const note     = editNoteInput.value.trim();
  const shared   = isCouple() ? editingShared : false;
  const docId    = exp._docId;

  closeEditModal();
  showToast('Gasto actualizado');

  if (docId) {
    try {
      await db.collection('expenses').doc(docId).update({ amount, category, note, shared });
    } catch {
      showToast('⚠ Error al actualizar. Revisá la conexión.');
    }
  }
});

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

  const rows = [['Fecha', 'Hora', 'Categoria', 'Monto', 'Tipo', 'Nota', 'Usuario']];
  expenses.forEach(e => {
    const d = new Date(e.date);
    rows.push([
      d.toLocaleDateString('es-AR'),
      d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
      getCat(e.category).name,
      e.amount.toFixed(2).replace('.', ','),
      e.shared === false ? 'Personal' : 'Compartido',
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

// ===== BOTÓN ATRÁS (Android / Capacitor) =====
function anyModalOpen() {
  return ['modal-settings', 'modal-edit', 'modal-transfer', 'modal-income', 'modal-installment', 'modal-menu', 'modal-subscription', 'modal-categories']
    .some(id => !document.getElementById(id)?.classList.contains('hidden'));
}

function closeAllModals() {
  closeSettings();
  closeEditModal();
  closeTransferModal();
  closeIncomeModal();
  closeInstallmentModal();
  closeMenu();
  closeSubscriptionModal();
  closeCategoriesModal();
}

// Devuelve true si manejó el "atrás"; false si hay que salir de la app.
function handleBackNavigation() {
  if (anyModalOpen()) { closeAllModals(); return true; }

  if (screenBudget.classList.contains('active')) {
    screenBudget.classList.remove('active');
    screenHistory.classList.add('active');
    return true;
  }
  if (screenInstallments.classList.contains('active')) {
    screenInstallments.classList.remove('active');
    screenHistory.classList.add('active');
    return true;
  }
  if (screenSubs && screenSubs.classList.contains('active')) {
    screenSubs.classList.remove('active');
    screenHistory.classList.add('active');
    return true;
  }
  if (screenStats.classList.contains('active')) {
    screenStats.classList.remove('active');
    screenHistory.classList.add('active');
    return true;
  }
  if (screenHistory.classList.contains('active')) {
    screenHistory.classList.remove('active');
    screenAdd.classList.remove('slide-left');
    return true;
  }
  return false; // en pantalla principal (o login) → permitir minimizar
}

(function setupBackButton() {
  const App = window.Capacitor?.Plugins?.App;
  if (!App) return; // en navegador/preview no existe
  App.addListener('backButton', () => {
    if (!handleBackNavigation()) App.minimizeApp();
  });
})();

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
        shared:    exp.shared !== false,   // overlay rápido → compartido por defecto
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

// ===== PRESUPUESTO =====

// Helpers de período
function getBudgetYearMonth(period) {
  const now = new Date();
  if (period === 'current') {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
}

function isSameYearMonth(dateStr, yearMonth) {
  return dateStr && dateStr.startsWith(yearMonth);
}

// Ingreso total de un miembro para un mes: fijo (base) + ingresos variables cargados
function incomeForMonth(uid, month) {
  const base = (groupData?.memberIncomes?.[uid]) || 0;
  const variable = groupIncomes
    .filter(i => i.uid === uid && i.month === month)
    .reduce((s, i) => s + i.amount, 0);
  return base + variable;
}

// Cálculos principales — modelo proporcional
function calcBudget() {
  if (!groupData) return [];
  const month      = getBudgetYearMonth(budgetPeriod);
  // En pareja, sólo cuentan los gastos COMPARTIDOS (los viejos sin campo = compartidos).
  // En modo individual no hay distinción: entran todos.
  const members    = groupData.members || [];
  const couple     = members.length >= 2;
  const monthExp   = getExpenses().filter(e =>
    isSameYearMonth(e.date, month) && (!couple || e.shared !== false));
  const monthTrans = groupTransfers.filter(t => t.month === month);
  const names      = groupData.memberNames || {};

  // Pase 1: datos base por miembro
  const base = members.map(uid => {
    const income      = incomeForMonth(uid, month);
    const name        = names[uid] || 'Usuario';
    const spent       = monthExp.filter(e => e.userId === uid)
                                .reduce((s, e) => s + e.amount, 0);
    const sentAmt     = monthTrans.filter(t => t.from === uid)
                                  .reduce((s, t) => s + t.amount, 0);
    // En pareja, "recibido" = lo que mandó el otro (robusto ante cambios de UID).
    const receivedAmt = couple
      ? monthTrans.filter(t => t.from !== uid).reduce((s, t) => s + t.amount, 0)
      : monthTrans.filter(t => t.to   === uid).reduce((s, t) => s + t.amount, 0);
    const pool        = income + receivedAmt;   // de dónde sale su gasto
    return { uid, name, income, spent, sentAmt, receivedAmt, pool };
  });

  // Pase 2: atribución proporcional del gasto
  return base.map((m, idx) => {
    const ownPortion      = m.pool > 0 ? m.spent * m.income / m.pool : m.spent;
    const fundedByPartner = m.spent - ownPortion;   // gasto cubierto por transferencia recibida

    // Crédito que recibe por financiar el gasto del otro (sólo en pareja)
    let creditFromPartner = 0;
    if (couple && base.length === 2) {
      const partner = base[1 - idx];
      creditFromPartner = partner.pool > 0
        ? partner.spent * partner.receivedAmt / partner.pool
        : 0;
    }

    const contribution    = ownPortion + creditFromPartner;          // aporte real a gastos compartidos
    const contribPct      = m.income > 0 ? contribution / m.income * 100 : 0;
    const available       = m.income + m.receivedAmt - m.sentAmt - m.spent;
    const unspentReceived = Math.max(0, m.receivedAmt - fundedByPartner);

    return {
      ...m,
      ownPortion:        Math.round(ownPortion),
      fundedByPartner:   Math.round(fundedByPartner),
      creditFromPartner: Math.round(creditFromPartner),
      contribution:      Math.round(contribution),
      contribPct,
      available:         Math.round(available),
      unspentReceived:   Math.round(unspentReceived),
    };
  });
}

// Render pantalla presupuesto
function renderBudget() {
  const calcs = calcBudget();
  const month = getBudgetYearMonth(budgetPeriod);

  // --- Tarjetas de miembros ---
  const membersEl = document.getElementById('budget-members-list');
  const allHaveIncome = calcs.length > 0 && calcs.every(m => m.income > 0);

  if (calcs.length === 0) {
    membersEl.innerHTML = `<p style="color:var(--text-dim);font-size:13px;text-align:center;padding:28px 0">Cargá tu ingreso para empezar:<br>desde <b>Configuración</b> (ingreso fijo) o con <b>+ Nuevo</b> en Ingresos del mes.</p>`;
  } else {
    const couple = isCouple();
    membersEl.innerHTML = calcs.map(m => {
      const pct      = Math.min(m.contribPct, 100);
      const barColor = m.contribPct < 70 ? 'var(--accent)' : m.contribPct < 90 ? '#f5a623' : '#ff6b6b';

      const availLabel = m.income === 0 && m.receivedAmt === 0
        ? `<span style="color:var(--text-dim)">Cargá tu ingreso</span>`
        : m.available >= 0
          ? `Disponible: $${formatAmount(m.available)}`
          : `<span style="color:#ff6b6b">Excedido: $${formatAmount(Math.abs(m.available))}</span>`;

      const transferNote = (m.sentAmt > 0 || m.receivedAmt > 0)
        ? `<div class="budget-transfer-note">${
            [m.sentAmt > 0 ? `↑ Transferiste $${formatAmount(m.sentAmt)}` : '',
             m.receivedAmt > 0 ? `↓ Recibiste $${formatAmount(m.receivedAmt)}${m.unspentReceived > 1 ? ` (te quedan $${formatAmount(m.unspentReceived)} sin usar)` : ''}` : '']
            .filter(Boolean).join(' · ')
          }</div>`
        : '';

      const incomeLabel = m.income > 0
        ? `$${formatAmount(m.income)}`
        : '<i style="color:var(--text-dim)">sin cargar</i>';

      // Detalle: cómo se compone el aporte (sólo tiene sentido en pareja)
      let detail = '';
      if (couple && (m.spent > 0 || m.creditFromPartner > 1)) {
        const parts = [`Gastó <b>$${formatAmount(m.spent)}</b>`];
        if (m.fundedByPartner > 1)
          parts.push(`<span class="budget-funded">$${formatAmount(m.fundedByPartner)} cubierto por transferencia</span>`);
        if (m.creditFromPartner > 1)
          parts.push(`financió <b>$${formatAmount(m.creditFromPartner)}</b> del gasto compartido`);
        detail = `<div class="budget-detail">${parts.join(' · ')}<br>Aporte total a gastos compartidos: <b>$${formatAmount(m.contribution)}</b></div>`;
      }

      return `
        <div class="budget-member-card">
          <div class="budget-member-top">
            <div>
              <div class="budget-member-name">${escapeHtml(m.name)}</div>
              <div class="budget-income-row">Ingreso del mes: ${incomeLabel}</div>
            </div>
            <div class="budget-pct-block">
              <div class="budget-pct" style="color:${barColor}">${m.income > 0 ? m.contribPct.toFixed(1) + '%' : '—'}</div>
              <div class="budget-pct-label">${couple ? 'aporte / ingreso' : 'gastado / ingreso'}</div>
            </div>
          </div>
          <div class="budget-bar-wrap">
            <div class="budget-bar-fill" style="width:${pct}%;background:${barColor}"></div>
          </div>
          <div class="budget-bar-labels">
            <span>${couple ? 'Aportó' : 'Gastó'}: $${formatAmount(m.contribution)}</span>
            <span>${availLabel}</span>
          </div>
          ${detail}
          ${transferNote}
        </div>`;
    }).join('');
  }

  // --- Caja de equidad (sólo en pareja, ambos con ingreso) ---
  const equityEl = document.getElementById('budget-equity-box');
  if (calcs.length === 2 && allHaveIncome) {
    const [a, b]       = calcs;
    const totalIncome  = a.income + b.income;
    const totalContrib = a.contribution + b.contribution;   // = gasto compartido total
    const targetPct    = totalIncome > 0 ? totalContrib / totalIncome * 100 : 0;

    const over  = a.contribPct >= b.contribPct ? a : b;   // aporta % más alto
    const under = a.contribPct <  b.contribPct ? a : b;
    const diff  = Math.round(Math.abs(over.contribution - over.income * targetPct / 100));

    // Equilibrado: la diferencia es chica frente al gasto compartido total (no por puntos %,
    // que se inflan cuando un ingreso es bajo).
    const balanced = totalContrib > 0 && diff < totalContrib * 0.05;
    // ¿El que aporta de menos ya transfirió plata que el otro tiene sin usar y cubre la diferencia?
    const coveredByTransfer = over.unspentReceived >= diff && under.sentAmt > 0;

    const headLine =
      `<b>${escapeHtml(over.name)}</b> aporta el <b>${over.contribPct.toFixed(1)}%</b> de su ingreso<br>` +
      `<b>${escapeHtml(under.name)}</b> aporta el <b>${under.contribPct.toFixed(1)}%</b> de su ingreso<br>` +
      `<br>Lo parejo sería el <b>${targetPct.toFixed(1)}%</b> del ingreso de cada uno.`;

    let insideHtml;
    if (balanced) {
      insideHtml = `<span class="equity-ok">✓ Están equilibrados: ambos aportan casi el mismo % de su ingreso.</span>`;
    } else if (coveredByTransfer) {
      insideHtml = `${headLine}<br><br>` +
        `La diferencia es de <b>$${formatAmount(diff)}</b>, pero <b>${escapeHtml(over.name)}</b> todavía tiene ` +
        `<b>$${formatAmount(over.unspentReceived)}</b> sin usar de la transferencia de ${escapeHtml(under.name)}. ` +
        `<span class="equity-ok">En plata real ya está cubierto.</span>`;
    } else {
      insideHtml = `${headLine}<br><br>` +
        `Diferencia de aporte: <b>$${formatAmount(diff)}</b> — <b>${escapeHtml(under.name)}</b> podría ` +
        `registrar más gastos compartidos o transferirle a ${escapeHtml(over.name)} para emparejar.`;
    }

    equityEl.innerHTML = `<div class="budget-equity-title">⚖️ Equidad proporcional</div><div class="equity-gap">${insideHtml}</div>`;
    equityEl.classList.remove('hidden');
  } else {
    equityEl.classList.add('hidden');
  }

  // --- Lista de ingresos del mes ---
  const names       = groupData?.memberNames || {};
  const monthInc    = groupIncomes.filter(i => i.month === month);
  const incEl       = document.getElementById('budget-incomes-list');
  if (incEl) {
    if (monthInc.length === 0) {
      incEl.innerHTML = `<p class="empty-transfers">Sin ingresos cargados este mes.</p>`;
    } else {
      incEl.innerHTML = monthInc.map(i => {
        const d       = new Date(i.date);
        const dateStr = d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
        const who     = i.uidName || names[i.uid] || 'Usuario';
        const mine    = i.uid === currentUser?.uid;
        return `
          <div class="transfer-item">
            <span class="transfer-arrow income-plus">+</span>
            <div class="transfer-info">
              <div class="transfer-names">${escapeHtml(who)}</div>
              ${i.note ? `<div class="transfer-note-text">${escapeHtml(i.note)}</div>` : ''}
            </div>
            <div class="transfer-right">
              <div class="transfer-amount income-amount">$${formatAmount(i.amount)}</div>
              <div class="transfer-date">${dateStr}</div>
            </div>
            ${mine ? `<button class="transfer-delete-btn" onclick="confirmDeleteIncome('${i._docId}')">🗑️</button>` : '<span style="width:24px;flex-shrink:0"></span>'}
          </div>`;
      }).join('');
    }
  }

  // --- Lista de transferencias ---
  const monthTrans = groupTransfers.filter(t => t.month === month);
  const transEl    = document.getElementById('budget-transfers-list');

  if (monthTrans.length === 0) {
    transEl.innerHTML = `<p class="empty-transfers">Sin transferencias este período.</p>`;
  } else {
    transEl.innerHTML = monthTrans.map(t => {
      const d        = new Date(t.date);
      const dateStr  = d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
      // Usar nombre guardado en el doc si existe, sino buscar en groupData (fallback)
      const fromName = t.fromName || names[t.from] || '?';
      const toName   = t.toName   || names[t.to]   || '?';
      return `
        <div class="transfer-item">
          <span class="transfer-arrow">→</span>
          <div class="transfer-info">
            <div class="transfer-names">${escapeHtml(fromName)} → ${escapeHtml(toName)}</div>
            ${t.note ? `<div class="transfer-note-text">${escapeHtml(t.note)}</div>` : ''}
          </div>
          <div class="transfer-right">
            <div class="transfer-amount">$${formatAmount(t.amount)}</div>
            <div class="transfer-date">${dateStr}</div>
          </div>
          <button class="transfer-delete-btn" onclick="confirmDeleteTransfer('${t._docId}')">🗑️</button>
        </div>`;
    }).join('');
  }
}

// Eliminar transferencia
function confirmDeleteTransfer(docId) {
  if (!confirm('¿Eliminar esta transferencia? Se ajustará el presupuesto de ambos.')) return;
  deleteTransfer(docId);
}

async function deleteTransfer(docId) {
  try {
    await db.collection('groups').doc(userGroupId)
      .collection('transfers').doc(docId).delete();
    showToast('Transferencia eliminada');
  } catch {
    showToast('⚠ Error al eliminar. Revisá la conexión.');
  }
}

// ===== MODAL DE INGRESO VARIABLE =====
function openIncomeModal() {
  document.getElementById('income-amount-input').value = '';
  document.getElementById('income-note-input').value   = '';
  document.getElementById('modal-income').classList.remove('hidden');
  modalBackdrop.classList.remove('hidden');
}

function closeIncomeModal() {
  document.getElementById('modal-income').classList.add('hidden');
  modalBackdrop.classList.add('hidden');
}

document.getElementById('btn-income-close').addEventListener('click', closeIncomeModal);
document.getElementById('btn-add-income').addEventListener('click', openIncomeModal);

document.getElementById('btn-income-save').addEventListener('click', async () => {
  const raw    = document.getElementById('income-amount-input').value
                   .replace(/\./g, '').replace(',', '.');
  const amount = parseFloat(raw);
  if (isNaN(amount) || amount <= 0) { showToast('Ingresá un monto válido'); return; }

  const note  = document.getElementById('income-note-input').value.trim();
  const month = getBudgetYearMonth(budgetPeriod);

  closeIncomeModal();
  showToast('Ingreso registrado ✓');

  try {
    await db.collection('groups').doc(userGroupId)
      .collection('incomes').add({
        uid:       currentUser.uid,
        uidName:   currentUser.displayName || 'Usuario',
        amount,
        note,
        date:      getLocalISOString(),
        month,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
  } catch {
    showToast('⚠ Error al guardar. Revisá la conexión.');
  }
});

function confirmDeleteIncome(docId) {
  if (!confirm('¿Eliminar este ingreso?')) return;
  deleteIncome(docId);
}

async function deleteIncome(docId) {
  try {
    await db.collection('groups').doc(userGroupId)
      .collection('incomes').doc(docId).delete();
    showToast('Ingreso eliminado');
  } catch {
    showToast('⚠ Error al eliminar. Revisá la conexión.');
  }
}

// Tabs de período del presupuesto
document.querySelectorAll('.budget-period-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.budget-period-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    budgetPeriod = btn.dataset.bperiod;
    renderBudget();
  });
});

// ===== CUOTAS / DEUDAS =====
const modalInstallment = document.getElementById('modal-installment');

// Limpia un campo de monto/numero (acepta puntos de miles y coma decimal)
function cleanNumField(id) {
  return (document.getElementById(id).value || '').replace(/\./g, '').replace(',', '.');
}

function openInstallmentModal(docId) {
  editingInstallmentId = docId || null;
  installmentShared = true;

  const titleEl = document.getElementById('modal-installment-title');
  const delBtn  = document.getElementById('btn-installment-delete');

  if (docId) {
    const it = groupInstallments.find(i => i._docId === docId);
    if (!it) return;
    titleEl.textContent = 'Editar cuota';
    document.getElementById('inst-desc-input').value   = it.description || '';
    document.getElementById('inst-entity-input').value = it.entity || '';
    document.getElementById('inst-amount-input').value = String(it.installmentAmount || '').replace('.', ',');
    document.getElementById('inst-count-input').value  = it.installmentCount || '';
    document.getElementById('inst-paid-input').value   = it.paidCount || 0;
    installmentShared = it.shared !== false;
    delBtn.classList.remove('hidden');
  } else {
    titleEl.textContent = 'Nueva cuota';
    ['inst-desc-input', 'inst-entity-input', 'inst-amount-input', 'inst-count-input']
      .forEach(id => document.getElementById(id).value = '');
    document.getElementById('inst-paid-input').value = '0';
    delBtn.classList.add('hidden');
  }
  setShareToggle('inst-share-toggle', installmentShared);

  modalInstallment.classList.remove('hidden');
  modalBackdrop.classList.remove('hidden');
}

function closeInstallmentModal() {
  modalInstallment.classList.add('hidden');
  modalBackdrop.classList.add('hidden');
  editingInstallmentId = null;
}

document.querySelectorAll('#inst-share-toggle .share-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#inst-share-toggle .share-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    installmentShared = btn.dataset.shared === 'true';
  });
});

document.getElementById('btn-add-installment').addEventListener('click', () => openInstallmentModal());
document.getElementById('btn-installment-close').addEventListener('click', closeInstallmentModal);

document.getElementById('btn-installment-delete').addEventListener('click', () => {
  if (!editingInstallmentId) return;
  if (!confirm('¿Eliminar esta cuota / deuda?')) return;
  const docId = editingInstallmentId;
  closeInstallmentModal();
  db.collection('groups').doc(userGroupId).collection('installments').doc(docId).delete()
    .then(() => showToast('Eliminada'))
    .catch(() => showToast('⚠ Error al eliminar. Revisá la conexión.'));
});

document.getElementById('btn-installment-save').addEventListener('click', async () => {
  const description = document.getElementById('inst-desc-input').value.trim();
  const entity      = document.getElementById('inst-entity-input').value.trim();
  const amount      = parseFloat(cleanNumField('inst-amount-input'));
  const count       = parseInt(cleanNumField('inst-count-input'), 10);
  let   paid        = parseInt(cleanNumField('inst-paid-input'), 10);

  if (!description)                 { showToast('¿Qué compraste?'); return; }
  if (isNaN(amount) || amount <= 0) { showToast('Monto de cuota inválido'); return; }
  if (isNaN(count)  || count  <= 0) { showToast('Cantidad de cuotas inválida'); return; }
  if (isNaN(paid) || paid < 0) paid = 0;
  if (paid > count) paid = count;

  const shared = isCouple() ? installmentShared : false;
  const docId  = editingInstallmentId;
  closeInstallmentModal();
  showToast(docId ? 'Cuota actualizada' : 'Cuota guardada ✓');

  const data = {
    description, entity,
    installmentAmount: amount,
    installmentCount:  count,
    paidCount:         paid,
    shared,
    ownerUid:  currentUser.uid,
    ownerName: currentUser.displayName || 'Usuario',
  };

  try {
    const col = db.collection('groups').doc(userGroupId).collection('installments');
    if (docId) {
      await col.doc(docId).update(data);
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await col.add(data);
    }
  } catch {
    showToast('⚠ Error al guardar. Revisá la conexión.');
  }
});

// Pagar una cuota → incrementa el contador de pagadas
async function payInstallment(docId) {
  const it = groupInstallments.find(i => i._docId === docId);
  if (!it) return;
  const newPaid = Math.min((it.paidCount || 0) + 1, it.installmentCount);
  if (newPaid === (it.paidCount || 0)) return;
  try {
    await db.collection('groups').doc(userGroupId).collection('installments')
      .doc(docId).update({ paidCount: newPaid });
    showToast(newPaid === it.installmentCount
      ? '🎉 ¡Deuda saldada!'
      : `Cuota ${newPaid}/${it.installmentCount} pagada`);
  } catch {
    showToast('⚠ Error. Revisá la conexión.');
  }
}

function renderInstallments() {
  const couple = isCouple();
  const listEl = document.getElementById('installments-list');

  // Resumen: compromiso mensual + deuda restante
  let monthlyCommit = 0, totalRemaining = 0, activeCount = 0;
  groupInstallments.forEach(it => {
    const remaining = it.installmentCount - (it.paidCount || 0);
    if (remaining > 0) { monthlyCommit += it.installmentAmount; activeCount++; }
    totalRemaining += Math.max(0, remaining) * it.installmentAmount;
  });
  document.getElementById('inst-monthly').textContent      = `$${formatAmount(monthlyCommit)}`;
  document.getElementById('inst-remaining').textContent    = `$${formatAmount(totalRemaining)}`;
  document.getElementById('inst-active-count').textContent = `${activeCount} activa${activeCount !== 1 ? 's' : ''}`;
  document.getElementById('inst-total-count').textContent  = `${groupInstallments.length} en total`;

  if (groupInstallments.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <span class="empty-emoji">💳</span>
        <p>Sin cuotas ni deudas cargadas.<br>Tocá + para agregar una.</p>
      </div>`;
    return;
  }

  // Activas primero, saldadas al final
  const sorted = [...groupInstallments].sort((a, b) => {
    const ra = a.installmentCount - (a.paidCount || 0) > 0 ? 1 : 0;
    const rb = b.installmentCount - (b.paidCount || 0) > 0 ? 1 : 0;
    return rb - ra;
  });

  listEl.innerHTML = sorted.map(it => {
    const paid       = it.paidCount || 0;
    const total      = it.installmentCount;
    const done       = paid >= total;
    const pct        = total > 0 ? paid / total * 100 : 0;
    const paidAmount = paid * it.installmentAmount;
    const remAmount  = Math.max(0, total - paid) * it.installmentAmount;

    const badge = couple
      ? (it.shared !== false
          ? `<span class="inst-badge shared">🏠 compartida</span>`
          : `<span class="inst-badge personal">👤 personal</span>`)
      : '';
    const owner = couple && it.ownerName ? `<span class="inst-owner">· ${escapeHtml(it.ownerName)}</span>` : '';

    return `
      <div class="inst-card ${done ? 'done' : ''}">
        <div class="inst-top" onclick="openInstallmentModal('${it._docId}')">
          <div>
            <div class="inst-desc">${escapeHtml(it.description)} ${badge} ${owner}</div>
            ${it.entity ? `<div class="inst-entity">${escapeHtml(it.entity)}</div>` : ''}
          </div>
          <div class="inst-quota">$${formatAmount(it.installmentAmount)}<small>por cuota</small></div>
        </div>
        <div class="inst-bar-wrap"><div class="inst-bar-fill" style="width:${pct}%"></div></div>
        <div class="inst-labels">
          <span>Cuota <b>${paid}</b> de <b>${total}</b></span>
          <span>Pagado <b>$${formatAmount(paidAmount)}</b> · Falta <b>$${formatAmount(remAmount)}</b></span>
        </div>
        <div class="inst-foot">
          <button class="btn-pay-quota" ${done ? 'disabled' : ''} onclick="payInstallment('${it._docId}')">
            ${done ? '✓ Saldada' : '✓ Pagar cuota'}
          </button>
        </div>
      </div>`;
  }).join('');
}

// ===== SUSCRIPCIONES =====
const modalSubscription = document.getElementById('modal-subscription');

// Trae la cotización del dólar tarjeta (para convertir suscripciones en USD). Cacheada.
async function fetchDolar() {
  try {
    const res = await fetch('https://dolarapi.com/v1/dolares/tarjeta');
    if (!res.ok) return;
    const data = await res.json();
    const venta = parseFloat(data.venta);
    if (venta > 0) {
      dolarTarjeta = venta;
      localStorage.setItem('hormiga_dolar', String(venta));
      if (screenSubs && screenSubs.classList.contains('active')) renderSubscriptions();
    }
  } catch { /* sin conexión → se usa la última cotización cacheada */ }
}

// Convierte el monto de una suscripción a ARS según su moneda
function subToArs(sub) {
  if (sub.currency === 'USD') return dolarTarjeta > 0 ? sub.amount * dolarTarjeta : 0;
  return sub.amount;
}

function openSubscriptionModal(docId) {
  editingSubscriptionId = docId || null;
  subShared = true;
  subCurrency = 'ARS';

  const titleEl = document.getElementById('modal-subscription-title');
  const delBtn  = document.getElementById('btn-subscription-delete');

  if (docId) {
    const s = groupSubscriptions.find(x => x._docId === docId);
    if (!s) return;
    titleEl.textContent = 'Editar suscripción';
    document.getElementById('sub-name-input').value   = s.name || '';
    document.getElementById('sub-amount-input').value = String(s.amount || '').replace('.', ',');
    document.getElementById('sub-day-input').value    = s.billingDay || '';
    subCurrency = s.currency || 'ARS';
    subShared   = s.shared !== false;
    delBtn.classList.remove('hidden');
  } else {
    titleEl.textContent = 'Nueva suscripción';
    ['sub-name-input', 'sub-amount-input', 'sub-day-input'].forEach(id => document.getElementById(id).value = '');
    delBtn.classList.add('hidden');
  }
  // Reflejar moneda y compartido en los toggles
  document.querySelectorAll('#sub-currency-toggle .share-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.cur === subCurrency));
  setShareToggle('sub-share-toggle', subShared);

  modalSubscription.classList.remove('hidden');
  modalBackdrop.classList.remove('hidden');
}

function closeSubscriptionModal() {
  modalSubscription.classList.add('hidden');
  modalBackdrop.classList.add('hidden');
  editingSubscriptionId = null;
}

document.querySelectorAll('#sub-currency-toggle .share-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#sub-currency-toggle .share-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    subCurrency = btn.dataset.cur;
  });
});

document.querySelectorAll('#sub-share-toggle .share-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#sub-share-toggle .share-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    subShared = btn.dataset.shared === 'true';
  });
});

document.getElementById('btn-add-subscription').addEventListener('click', () => openSubscriptionModal());
document.getElementById('btn-subscription-close').addEventListener('click', closeSubscriptionModal);

document.getElementById('btn-subscription-delete').addEventListener('click', () => {
  if (!editingSubscriptionId) return;
  if (!confirm('¿Eliminar esta suscripción?')) return;
  const docId = editingSubscriptionId;
  closeSubscriptionModal();
  db.collection('groups').doc(userGroupId).collection('subscriptions').doc(docId).delete()
    .then(() => showToast('Eliminada'))
    .catch(() => showToast('⚠ Error al eliminar. Revisá la conexión.'));
});

document.getElementById('btn-subscription-save').addEventListener('click', async () => {
  const name   = document.getElementById('sub-name-input').value.trim();
  const amount = parseFloat(cleanNumField('sub-amount-input'));
  let   day    = parseInt(cleanNumField('sub-day-input'), 10);

  if (!name)                        { showToast('¿Cómo se llama?'); return; }
  if (isNaN(amount) || amount <= 0) { showToast('Monto inválido'); return; }
  if (isNaN(day) || day < 1 || day > 31) day = null;

  const shared = isCouple() ? subShared : false;
  const docId  = editingSubscriptionId;
  closeSubscriptionModal();
  showToast(docId ? 'Suscripción actualizada' : 'Suscripción guardada ✓');

  const data = {
    name,
    amount,
    currency:  subCurrency,
    billingDay: day,
    shared,
    ownerUid:  currentUser.uid,
    ownerName: currentUser.displayName || 'Usuario',
  };

  try {
    const col = db.collection('groups').doc(userGroupId).collection('subscriptions');
    if (docId) {
      await col.doc(docId).update(data);
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await col.add(data);
    }
  } catch {
    showToast('⚠ Error al guardar. Revisá la conexión.');
  }
});

function renderSubscriptions() {
  const couple = isCouple();
  const listEl = document.getElementById('subs-list');

  // Total mensual en ARS (convirtiendo USD con la cotización tarjeta)
  let monthlyArs = 0, usdCount = 0, usdTotal = 0;
  groupSubscriptions.forEach(s => {
    monthlyArs += subToArs(s);
    if (s.currency === 'USD') { usdCount++; usdTotal += s.amount; }
  });

  document.getElementById('subs-monthly').textContent = `$${formatAmount(Math.round(monthlyArs))}`;
  document.getElementById('subs-yearly').textContent  = `$${formatAmount(Math.round(monthlyArs * 12))}`;
  document.getElementById('subs-count').textContent   =
    `${groupSubscriptions.length} activa${groupSubscriptions.length !== 1 ? 's' : ''}`;
  document.getElementById('subs-usd-note').textContent = usdCount > 0
    ? (dolarTarjeta > 0 ? `incl. US$${formatAmount(usdTotal)} @ $${formatAmount(Math.round(dolarTarjeta))}` : 'falta cotización USD')
    : 'estimado';

  if (groupSubscriptions.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <span class="empty-emoji">🔁</span>
        <p>Sin suscripciones cargadas.<br>Tocá + para agregar una.</p>
      </div>`;
    return;
  }

  // Ordenar por monto ARS descendente
  const sorted = [...groupSubscriptions].sort((a, b) => subToArs(b) - subToArs(a));

  listEl.innerHTML = sorted.map(s => {
    const isUsd   = s.currency === 'USD';
    const arsVal  = subToArs(s);
    const amountMain = isUsd ? `US$${formatAmount(s.amount)}` : `$${formatAmount(s.amount)}`;
    const arsSub  = isUsd
      ? (dolarTarjeta > 0 ? `≈ $${formatAmount(Math.round(arsVal))}` : 'sin cotización')
      : 'por mes';
    const dayTxt  = s.billingDay ? `Día ${s.billingDay}` : 'Mensual';
    const badge   = couple
      ? (s.shared !== false
          ? `<span class="inst-badge shared">🏠 compartida</span>`
          : `<span class="inst-badge personal">👤 personal</span>`)
      : '';
    const owner   = couple && s.ownerName ? `· ${escapeHtml(s.ownerName)}` : '';

    return `
      <div class="sub-card" onclick="openSubscriptionModal('${s._docId}')">
        <div class="sub-info">
          <div class="sub-name">${escapeHtml(s.name)} ${badge}</div>
          <div class="sub-meta">${dayTxt} <span class="sub-cur-badge">${s.currency || 'ARS'}</span> ${owner}</div>
        </div>
        <div class="sub-right">
          <div class="sub-amount">${amountMain}<small>${arsSub}</small></div>
        </div>
      </div>`;
  }).join('');
}

// ===== MODAL DE TRANSFERENCIA INTERNA =====
function openTransferModal() {
  if (!groupData) { showToast('Cargando datos del grupo…'); return; }
  transferToUid = null;
  document.getElementById('transfer-amount-input').value = '';
  document.getElementById('transfer-note-input').value   = '';

  // Selector de destinatario (todos menos el usuario actual)
  const others = (groupData.members || []).filter(uid => uid !== currentUser.uid);
  const names  = groupData.memberNames || {};
  document.getElementById('transfer-to-selector').innerHTML = others.map(uid =>
    `<button class="transfer-to-btn" data-uid="${uid}">${escapeHtml(names[uid] || 'Usuario')}</button>`
  ).join('');
  document.querySelectorAll('#transfer-to-selector .transfer-to-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#transfer-to-selector .transfer-to-btn')
               .forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      transferToUid = btn.dataset.uid;
    });
  });
  // Pre-seleccionar si hay un solo otro miembro
  if (others.length === 1) {
    transferToUid = others[0];
    document.querySelector('#transfer-to-selector .transfer-to-btn')?.classList.add('selected');
  }

  document.getElementById('modal-transfer').classList.remove('hidden');
  modalBackdrop.classList.remove('hidden');
}

function closeTransferModal() {
  document.getElementById('modal-transfer').classList.add('hidden');
  modalBackdrop.classList.add('hidden');
  transferToUid = null;
}

document.getElementById('btn-transfer-close').addEventListener('click', closeTransferModal);
document.getElementById('btn-add-transfer').addEventListener('click', openTransferModal);

document.getElementById('btn-transfer-save').addEventListener('click', async () => {
  if (!transferToUid) { showToast('Elegí a quién transferir'); return; }

  const raw    = document.getElementById('transfer-amount-input').value
                   .replace(/\./g, '').replace(',', '.');
  const amount = parseFloat(raw);
  if (isNaN(amount) || amount <= 0) { showToast('Ingresá un monto válido'); return; }

  const note  = document.getElementById('transfer-note-input').value.trim();
  const month = getBudgetYearMonth('current');

  // Capturar nombres ANTES de cerrar el modal (groupData podría cambiar)
  const fromName = currentUser.displayName || 'Usuario';
  const toName   = groupData?.memberNames?.[transferToUid] || '?';

  closeTransferModal();
  showToast('Transferencia registrada ✓');

  try {
    await db.collection('groups').doc(userGroupId)
      .collection('transfers').add({
        from:      currentUser.uid,
        fromName,
        to:        transferToUid,
        toName,
        amount,
        note,
        date:      getLocalISOString(),
        month,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
  } catch {
    showToast('⚠ Error al guardar. Revisá la conexión.');
  }
});

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

document.getElementById('btn-go-budget').addEventListener('click', () => {
  screenHistory.classList.remove('active');
  screenBudget.classList.add('active');
  renderBudget();
});

document.getElementById('btn-budget-back').addEventListener('click', () => {
  screenBudget.classList.remove('active');
  screenHistory.classList.add('active');
});

document.getElementById('btn-go-installments').addEventListener('click', () => {
  screenHistory.classList.remove('active');
  screenInstallments.classList.add('active');
  renderInstallments();
});

document.getElementById('btn-installments-back').addEventListener('click', () => {
  screenInstallments.classList.remove('active');
  screenHistory.classList.add('active');
});

document.getElementById('btn-subs-back').addEventListener('click', () => {
  screenSubs.classList.remove('active');
  screenHistory.classList.add('active');
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
      label: view === 'person' ? key : getCat(key).name,
      emoji: view === 'person' ? '👤' : getCat(key).emoji,
      amount,
      color: view === 'person' ? PERSON_COLORS[i % PERSON_COLORS.length] : getCat(key).color,
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
