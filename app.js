/**
 * IRIS UHK – frontend
 *
 * Očekávané rozšíření Google Apps Script (stejný deploy URL jako dosud):
 *
 * 1) POST JSON: { "action": "login", "email": "...", "password": "...", "role": "user" | "manager" }
 *    → { "ok": true, "role": "user"|"manager", "email": "..." } nebo { "ok": false, "message": "..." }
 *
 * 2) GET  ?action=cases&applicant_email=…  = jen případy žadatele (bez manager_key).
 *    GET  ?action=cases&manager_key=…      = plný seznam (Script Property IRIS_MANAGER_KEY).
 *    GET  ?action=dashboard&manager_key=…  = metriky jen pro správce.
 *
 * 3) POST { action: 'register', name, email, password } – založí řádek v Users (žadatel).
 *
 * 4) POST intake: server ověří, že applicant_email patří aktivnímu řádku Users (role user).
 *
 * 5) POST { action: 'update_case', manager_key, case_id, manager_email, status?, … } – úprava případu (správce).
 */

const API_URL =
  'https://script.google.com/macros/s/AKfycbyN8uGoqSqqH26K7eBzTx-QmE08e-27fWJRws5QcM6Dm6dl2NEGAygFak9T7X0rzYpZ6Q/exec';

const SESSION_KEY = 'iris_uhk_session';

/** Dočasné řešení: prázdné = vypnuto. Pokud máte v Apps Scriptu IRIS_MANAGER_KEY, nastavte stejnou hodnotu do MANAGER_STATIC_KEY, aby fungovalo PIN přihlášení správce. */
const MANAGER_FALLBACK_CODE = '';
const MANAGER_STATIC_KEY = '';

const form = document.getElementById('intakeForm');
const submitButton = document.getElementById('submitButton');
const fillDemoButton = document.getElementById('fillDemoButton');

const statusMessage = document.getElementById('statusMessage');
const resultDetails = document.getElementById('resultDetails');
const caseIdValue = document.getElementById('caseIdValue');
const intakeIdValue = document.getElementById('intakeIdValue');
const resultValue = document.getElementById('resultValue');
const scoreValue = document.getElementById('scoreValue');

const statTotal = document.getElementById('statTotal');
const statOpen = document.getElementById('statOpen');
const statClosed = document.getElementById('statClosed');
const statOverdue = document.getElementById('statOverdue');

const searchCases = document.getElementById('searchCases');
const filterStatus = document.getElementById('filterStatus');
const filterPriority = document.getElementById('filterPriority');
const refreshCasesButton = document.getElementById('refreshCasesButton');
const casesTableBody = document.getElementById('casesTableBody');
const userCasesTableBody = document.getElementById('userCasesTableBody');

const loginScreen = document.getElementById('loginScreen');
const appRoot = document.getElementById('appRoot');
const layoutUser = document.getElementById('layoutUser');
const layoutManager = document.getElementById('layoutManager');
const sessionBadge = document.getElementById('sessionBadge');
const logoutButton = document.getElementById('logoutButton');
const managerStatusMessage = document.getElementById('managerStatusMessage');

const userLoginForm = document.getElementById('userLoginForm');
const managerLoginForm = document.getElementById('managerLoginForm');
const userLoginError = document.getElementById('userLoginError');
const managerLoginError = document.getElementById('managerLoginError');
const tabRegister = document.getElementById('tabRegister');
const tabUser = document.getElementById('tabUser');
const tabManager = document.getElementById('tabManager');
const registerForm = document.getElementById('registerForm');
const registerSubmit = document.getElementById('registerSubmit');
const registerMessage = document.getElementById('registerMessage');

const managerCasePanel = document.getElementById('managerCasePanel');
const managerCasePanelTitle = document.getElementById('managerCasePanelTitle');
const managerCasePanelSubtitle = document.getElementById('managerCasePanelSubtitle');
const managerEditCaseId = document.getElementById('managerEditCaseId');
const managerCaseStatus = document.getElementById('managerCaseStatus');
const managerCaseDue = document.getElementById('managerCaseDue');
const managerCaseNextStep = document.getElementById('managerCaseNextStep');
const managerCaseStatement = document.getElementById('managerCaseStatement');
const managerCaseAnalysisUrl = document.getElementById('managerCaseAnalysisUrl');
const managerCaseFile = document.getElementById('managerCaseFile');
const managerCaseSave = document.getElementById('managerCaseSave');
const managerCaseCancel = document.getElementById('managerCaseCancel');
const managerCaseFormMessage = document.getElementById('managerCaseFormMessage');

/** @type {Array<Record<string, unknown>>} */
let managerCasesCache = [];

const CASE_STATUS_LABELS = {
  new: 'Nový',
  under_review: 'V posouzení',
  dd_in_progress: 'Probíhá DD',
  case_handling: 'Řeší se',
  analysis_in_progress: 'Probíhá analýza',
  closed: 'Uzavřeno',
  waiting_internal_opinion: 'Čeká na interní stanovisko',
  ready_for_decision: 'Připraveno k rozhodnutí',
};

const STATUS_FALLBACK_NEXT = {
  new: 'Případ je v evidenci; IRIS stanoví další krok v obvyklé lhůtě (viz metodika).',
  under_review: 'Probíhá posouzení; vyčkejte na vyjádření nebo termín v řádku výše.',
  dd_in_progress: 'Probíhá due diligence / rozšířená prověrka dle metodiky.',
  case_handling: 'Případ se aktivně řeší na straně IRIS / prorektorátu.',
  analysis_in_progress: 'Probíhá analýza; po dokončení obdržíte odkaz nebo vyjádření.',
  closed: 'Případ je uzavřen; případné podklady najdete u odkazu na analýzu.',
  waiting_internal_opinion: 'Čeká se na interní stanovisko součásti.',
  ready_for_decision: 'Případ je připraven k rozhodnutí; sledujte termín a vyjádření.',
};

const OPEN_CASE_STATUSES = [
  'new',
  'under_review',
  'dd_in_progress',
  'case_handling',
  'analysis_in_progress',
  'waiting_internal_opinion',
  'ready_for_decision',
];

function getSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.email || !s.role) return null;
    if (s.role !== 'user' && s.role !== 'manager') return null;
    return s;
  } catch {
    return null;
  }
}

function setSession(session) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

function showLogin() {
  loginScreen.classList.remove('hidden');
  appRoot.classList.add('hidden');
  layoutUser.classList.add('hidden');
  layoutManager.classList.add('hidden');
}

function showApp(session) {
  loginScreen.classList.add('hidden');
  appRoot.classList.remove('hidden');
  sessionBadge.textContent =
    session.role === 'manager'
      ? `IRIS Manager · ${session.email}`
      : `Žadatel · ${session.email}`;

  if (session.role === 'user') {
    layoutUser.classList.remove('hidden');
    layoutManager.classList.add('hidden');
    const emailInput = form.elements.applicant_email;
    if (emailInput) {
      emailInput.value = session.email;
      emailInput.readOnly = true;
    }
  } else {
    layoutUser.classList.add('hidden');
    layoutManager.classList.remove('hidden');
  }
}

function setTab(tab) {
  tabRegister.classList.toggle('active', tab === 'register');
  tabUser.classList.toggle('active', tab === 'user');
  tabManager.classList.toggle('active', tab === 'manager');

  registerForm.classList.toggle('hidden', tab !== 'register');
  registerForm.classList.toggle('active', tab === 'register');

  userLoginForm.classList.toggle('hidden', tab !== 'user');
  userLoginForm.classList.toggle('active', tab === 'user');

  managerLoginForm.classList.toggle('hidden', tab !== 'manager');
  managerLoginForm.classList.toggle('active', tab === 'manager');

  userLoginError.classList.add('hidden');
  managerLoginError.classList.add('hidden');
  registerMessage.classList.add('hidden');
  registerMessage.classList.remove('login-success');
}

tabRegister.addEventListener('click', () => setTab('register'));
tabUser.addEventListener('click', () => setTab('user'));
tabManager.addEventListener('click', () => setTab('manager'));

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  registerMessage.classList.add('hidden');
  registerMessage.classList.remove('login-success');

  const name = document.getElementById('registerName').value.trim();
  const email = document.getElementById('registerEmail').value.trim();
  const password = document.getElementById('registerPassword').value;
  const password2 = document.getElementById('registerPassword2').value;

  if (password !== password2) {
    registerMessage.textContent = 'Hesla se neshodují.';
    registerMessage.classList.remove('hidden');
    return;
  }
  if (password.length < 8) {
    registerMessage.textContent = 'Heslo musí mít alespoň 8 znaků.';
    registerMessage.classList.remove('hidden');
    return;
  }

  registerSubmit.disabled = true;
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'register',
        name,
        email,
        password,
      }),
    });
    const data = await response.json().catch(() => ({}));

    if (response.ok && data.ok) {
      registerMessage.textContent =
        data.message ||
        'Účet byl založen. Přepněte na „Přihlášení žadatele“ a přihlaste se stejným e-mailem a heslem.';
      registerMessage.classList.remove('hidden');
      registerMessage.classList.add('login-success');
      document.getElementById('loginUserEmail').value = email;
      registerForm.reset();
      return;
    }
    registerMessage.textContent = data.message || 'Registrace se nezdařila.';
    registerMessage.classList.remove('hidden');
  } catch {
    registerMessage.textContent = 'Chyba spojení. Zkuste to znovu nebo kontaktujte správce IRIS.';
    registerMessage.classList.remove('hidden');
  } finally {
    registerSubmit.disabled = false;
  }
});

async function apiLogin(email, password, role) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'login', email, password, role }),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

userLoginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  userLoginError.classList.add('hidden');
  const email = document.getElementById('loginUserEmail').value.trim();
  const password = document.getElementById('loginUserPassword').value;

  try {
    const { response, data } = await apiLogin(email, password, 'user');
    if (response.ok && data.ok) {
      setSession({ email: data.email || email, role: 'user' });
      showApp(getSession());
      await refreshForRole();
      return;
    }
    if (data.message) {
      userLoginError.textContent = data.message;
      userLoginError.classList.remove('hidden');
      return;
    }
  } catch {
    /* fallback níže */
  }

  userLoginError.textContent =
    'Přihlášení se nezdařilo. Zkontrolujte údaje nebo zda je v Apps Scriptu implementována akce login.';
  userLoginError.classList.remove('hidden');
});

managerLoginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  managerLoginError.classList.add('hidden');
  const email = document.getElementById('loginManagerEmail').value.trim();
  const password = document.getElementById('loginManagerPassword').value;

  if (MANAGER_FALLBACK_CODE && password === MANAGER_FALLBACK_CODE) {
    setSession({ email, role: 'manager', managerKey: MANAGER_STATIC_KEY || '' });
    showApp(getSession());
    await refreshForRole();
    return;
  }

  try {
    const { response, data } = await apiLogin(email, password, 'manager');
    if (response.ok && data.ok && (data.role === 'manager' || data.role === 'iris_manager')) {
      setSession({
        email: data.email || email,
        role: 'manager',
        managerKey: data.manager_key || '',
      });
      showApp(getSession());
      await refreshForRole();
      return;
    }
    if (data.message) {
      managerLoginError.textContent = data.message;
      managerLoginError.classList.remove('hidden');
      return;
    }
  } catch {
    /* zpráva níže */
  }

  managerLoginError.textContent =
    MANAGER_FALLBACK_CODE
      ? 'Neplatné heslo nebo chyba serveru.'
      : 'Přihlášení správce se nezdařilo. V app.js nastavte MANAGER_FALLBACK_CODE (dočasně) nebo doplňte login v Apps Scriptu.';
  managerLoginError.classList.remove('hidden');
});

logoutButton.addEventListener('click', () => {
  clearSession();
  showLogin();
  if (form) form.reset();
  hideResult();
});

function setStatus(message, type = 'neutral') {
  statusMessage.textContent = message;
  statusMessage.className = `status-message status-${type}`;
}

function showResult(data) {
  caseIdValue.textContent = data.case_id || '—';
  intakeIdValue.textContent = data.intake_id || '—';
  resultValue.textContent = data.preliminary_result || '—';
  scoreValue.textContent = data.preliminary_risk_score ?? '—';
  resultDetails.classList.remove('hidden');
}

function hideResult() {
  resultDetails.classList.add('hidden');
}

function checkboxToYesNo(checkboxName) {
  return form.elements[checkboxName].checked ? 'ano' : 'ne';
}

function collectFormData() {
  const session = getSession();
  return {
    applicant_name: form.applicant_name.value.trim(),
    applicant_email: (session && session.role === 'user' ? session.email : form.applicant_email.value).trim(),
    applicant_unit: form.applicant_unit.value.trim(),
    cooperation_type: form.cooperation_type.value,
    cooperation_stage: form.cooperation_stage.value,
    partner_name: form.partner_name.value.trim(),
    partner_country: form.partner_country.value.trim(),
    partner_website: form.partner_website.value.trim(),
    intent_description: form.intent_description.value.trim(),
    external_funding: checkboxToYesNo('external_funding'),
    access_to_uhk_systems: checkboxToYesNo('access_to_uhk_systems'),
    sharing_data_knowhow: checkboxToYesNo('sharing_data_knowhow'),
    sensitive_outputs: checkboxToYesNo('sensitive_outputs'),
    transfer_outside_eu: checkboxToYesNo('transfer_outside_eu'),
    training_or_technical_assistance: checkboxToYesNo('training_or_technical_assistance'),
    involves_doctoral_students_or_infrastructure: checkboxToYesNo('involves_doctoral_students_or_infrastructure'),
  };
}

function validateFormData(data) {
  const requiredFields = [
    ['applicant_name', 'Jméno žadatele'],
    ['applicant_email', 'E-mail žadatele'],
    ['applicant_unit', 'Součást / fakulta / útvar'],
    ['cooperation_type', 'Typ spolupráce'],
    ['cooperation_stage', 'Fáze spolupráce'],
    ['partner_name', 'Název partnera'],
    ['partner_country', 'Země partnera / zapojené země'],
    ['intent_description', 'Popis záměru'],
  ];

  for (const [key, label] of requiredFields) {
    if (!String(data[key] || '').trim()) {
      throw new Error(`Vyplňte pole: ${label}`);
    }
  }
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function formatDateOnly(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'long' }).format(date);
}

function toDatetimeLocalValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function caseStatusLabel(status) {
  const k = String(status || '').trim();
  return CASE_STATUS_LABELS[k] || k || '—';
}

function nextStepForUser(item) {
  const custom = String(item.next_step_note || '').trim();
  if (custom) return custom;
  const st = String(item.status || '').trim();
  return STATUS_FALLBACK_NEXT[st] || 'Sledujte stav případu a e-mailové upozornění od IRIS.';
}

function analysisUrlForItem(item) {
  const u = String(item.analysis_document_url || item.final_statement_link || '').trim();
  return /^https:\/\//i.test(u) ? u : '';
}

function isCaseOpen(status) {
  return OPEN_CASE_STATUSES.includes(String(status || '').trim());
}

function isCaseOverdue(item) {
  if (!item.due_date || !isCaseOpen(item.status)) return false;
  const due = new Date(item.due_date);
  return !Number.isNaN(due.getTime()) && due.getTime() < Date.now();
}

function cellPreview(text, maxLen) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '—';
  if (s.length <= maxLen) return escapeHtml(s);
  return `${escapeHtml(s.slice(0, maxLen))}…`;
}

function analysisLinkCell(url) {
  const u = String(url || '').trim();
  if (!/^https:\/\//i.test(u)) return '—';
  const safe = u.replace(/"/g, '%22');
  return `<a href="${safe}" target="_blank" rel="noopener noreferrer">otevřít</a>`;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const i = result.indexOf(',');
      resolve(i >= 0 ? result.slice(i + 1) : result);
    };
    reader.onerror = () => reject(new Error('Soubor se nepodařilo načíst.'));
    reader.readAsDataURL(file);
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('\n', ' ');
}

function renderDashboard(summary) {
  statTotal.textContent = summary.total ?? 0;
  statOpen.textContent = summary.open_cases ?? 0;
  statClosed.textContent = summary.closed_cases ?? 0;
  statOverdue.textContent = summary.overdue_cases ?? 0;
}

function renderManagerCases(items) {
  if (!items || !items.length) {
    casesTableBody.innerHTML = `<tr><td colspan="10" class="empty-row">Nebyly nalezeny žádné případy.</td></tr>`;
    return;
  }

  casesTableBody.innerHTML = items
    .map((item) => {
      const overdueCls = isCaseOverdue(item) ? 'row-overdue' : '';
      const dueStr = formatDateOnly(item.due_date);
      return `
    <tr class="${overdueCls}">
      <td>${escapeHtml(item.case_id)}</td>
      <td>${escapeHtml(dueStr)}</td>
      <td>${escapeHtml(formatDate(item.created_at))}</td>
      <td>${escapeHtml(item.title)}</td>
      <td>${escapeHtml(item.partner_name)}</td>
      <td>${escapeHtml(item.applicant_name)}</td>
      <td>${escapeHtml(caseStatusLabel(item.status))}</td>
      <td>${escapeHtml(item.priority)}</td>
      <td>${escapeHtml(item.risk_level)}</td>
      <td><button type="button" class="btn-secondary btn-compact" data-manage-case="${escapeHtml(item.case_id)}">Spravovat</button></td>
    </tr>`;
    })
    .join('');
}

function renderUserCases(items) {
  if (!items || !items.length) {
    userCasesTableBody.innerHTML = `<tr><td colspan="9" class="empty-row">Zatím nemáte žádné podání.</td></tr>`;
    return;
  }

  userCasesTableBody.innerHTML = items
    .map((item) => {
      const overdueCls = isCaseOverdue(item) ? 'row-overdue' : '';
      const nextText = nextStepForUser(item);
      const stmt = cellPreview(item.iris_statement, 120);
      return `
    <tr class="${overdueCls}">
      <td>${escapeHtml(item.case_id)}</td>
      <td>${escapeHtml(formatDate(item.created_at))}</td>
      <td>${escapeHtml(item.title)}</td>
      <td>${escapeHtml(item.partner_name)}</td>
      <td>${escapeHtml(caseStatusLabel(item.status))}</td>
      <td>${escapeHtml(formatDateOnly(item.due_date))}</td>
      <td title="${escapeAttr(nextText)}">${cellPreview(nextText, 80)}</td>
      <td title="${escapeAttr(String(item.iris_statement || ''))}">${stmt}</td>
      <td>${analysisLinkCell(analysisUrlForItem(item))}</td>
    </tr>`;
    })
    .join('');
}

async function loadDashboard() {
  const session = getSession();
  const q = new URLSearchParams({ action: 'dashboard' });
  if (session && session.role === 'manager' && session.managerKey) {
    q.set('manager_key', session.managerKey);
  }
  const response = await fetch(`${API_URL}?${q.toString()}`);
  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(data.message || 'Nepodařilo se načíst dashboard.');
  }

  renderDashboard(data.summary || {});
}

function buildCasesParams() {
  const params = new URLSearchParams();
  params.set('action', 'cases');
  const session = getSession();

  if (session && session.role === 'user') {
    params.set('applicant_email', session.email);
  }

  if (session && session.role === 'manager' && session.managerKey) {
    params.set('manager_key', session.managerKey);
  }

  if (searchCases && searchCases.value.trim()) {
    params.set('search', searchCases.value.trim());
  }
  if (filterStatus && filterStatus.value) {
    params.set('status', filterStatus.value);
  }
  if (filterPriority && filterPriority.value) {
    params.set('priority', filterPriority.value);
  }
  return params;
}

async function loadManagerCases() {
  casesTableBody.innerHTML = `<tr><td colspan="10" class="empty-row">Načítání případů…</td></tr>`;

  const response = await fetch(`${API_URL}?${buildCasesParams().toString()}`);
  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(data.message || 'Nepodařilo se načíst případy.');
  }

  managerCasesCache = data.items || [];
  renderManagerCases(managerCasesCache);
}

async function loadUserCases() {
  userCasesTableBody.innerHTML = `<tr><td colspan="9" class="empty-row">Načítání…</td></tr>`;

  const params = buildCasesParams();
  const response = await fetch(`${API_URL}?${params.toString()}`);
  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(data.message || 'Nepodařilo se načíst vaše podání.');
  }

  renderUserCases(data.items || []);
}

function setManagerStatus(message, isError = false) {
  if (!managerStatusMessage) return;
  managerStatusMessage.textContent = message || '';
  managerStatusMessage.classList.toggle('hidden', !message);
  managerStatusMessage.classList.toggle('manager-status--error', Boolean(isError));
  managerStatusMessage.classList.toggle('manager-status--success', Boolean(message) && !isError);
}

async function refreshForRole() {
  const session = getSession();
  if (!session) return;

  setManagerStatus('');

  try {
    if (session.role === 'manager') {
      await loadDashboard();
      await loadManagerCases();
    } else {
      await loadUserCases();
    }
  } catch (error) {
    if (session.role === 'manager') {
      setManagerStatus(error.message || 'Nepodařilo se načíst přehled.', true);
    } else {
      userCasesTableBody.innerHTML = `<tr><td colspan="9" class="empty-row">${escapeHtml(
        error.message || 'Nepodařilo se načíst podání.'
      )}</td></tr>`;
    }
  }
}

async function refreshOverview() {
  await refreshForRole();
}

async function submitForm(event) {
  event.preventDefault();
  hideResult();

  const session = getSession();
  if (!session || session.role !== 'user') {
    setStatus('Checklist mohou odesílat pouze přihlášení žadatelé.', 'error');
    return;
  }

  const payload = collectFormData();

  try {
    validateFormData(payload);

    submitButton.disabled = true;
    setStatus('Odesílání checklistu do systému IRIS UHK…', 'neutral');

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.message || 'Nepodařilo se odeslat formulář.');
    }

    showResult(data);
    await refreshForRole();

    if (typeof data.preliminary_risk_score === 'number' && data.preliminary_risk_score >= 6) {
      setStatus('Checklist byl přijat. Případ vyžaduje eskalaci nebo rozšířenou DD.', 'warning');
    } else {
      setStatus('Checklist byl úspěšně odeslán a případ byl založen.', 'success');
    }

    form.reset();
    form.elements.applicant_email.value = session.email;
  } catch (error) {
    setStatus(error.message || 'Došlo k chybě při odeslání.', 'error');
  } finally {
    submitButton.disabled = false;
  }
}

function fillDemoData() {
  const session = getSession();
  if (!session || session.role !== 'user') return;

  form.applicant_name.value = 'Jan Novák';
  form.applicant_email.value = session.email;
  form.applicant_unit.value = 'FIM';
  form.cooperation_type.value = 'výzkumná spolupráce';
  form.cooperation_stage.value = 'příprava MoU';
  form.partner_name.value = 'Example Institute';
  form.partner_country.value = 'Čína, Německo';
  form.partner_website.value = 'https://example.org';
  form.intent_description.value = 'Pilotní navázání výzkumné spolupráce v oblasti AI.';

  form.external_funding.checked = true;
  form.access_to_uhk_systems.checked = false;
  form.sharing_data_knowhow.checked = true;
  form.sensitive_outputs.checked = true;
  form.transfer_outside_eu.checked = true;
  form.training_or_technical_assistance.checked = false;
  form.involves_doctoral_students_or_infrastructure.checked = true;

  setStatus('Ukázková data byla doplněna.', 'neutral');
}

form.addEventListener('submit', submitForm);
fillDemoButton.addEventListener('click', fillDemoData);

refreshCasesButton.addEventListener('click', refreshOverview);
filterStatus.addEventListener('change', loadManagerCases);
filterPriority.addEventListener('change', loadManagerCases);

let searchTimeout;
searchCases.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(loadManagerCases, 300);
});

function closeManagerCasePanel() {
  if (!managerCasePanel) return;
  managerCasePanel.classList.add('hidden');
  managerCasePanel.setAttribute('aria-hidden', 'true');
  managerEditCaseId.value = '';
  if (managerCaseFile) managerCaseFile.value = '';
  if (managerCaseFormMessage) {
    managerCaseFormMessage.classList.add('hidden');
    managerCaseFormMessage.textContent = '';
    managerCaseFormMessage.classList.remove('login-success');
  }
}

function openManagerCasePanel(caseId) {
  const item = managerCasesCache.find((c) => String(c.case_id) === String(caseId));
  if (!item || !managerCasePanel) return;

  managerEditCaseId.value = String(item.case_id);
  managerCasePanelTitle.textContent = `Úprava případu: ${item.case_id}`;
  managerCasePanelSubtitle.textContent = [item.title, item.applicant_name].filter(Boolean).join(' · ');

  const st = String(item.status || 'new');
  managerCaseStatus.value = [...managerCaseStatus.options].some((o) => o.value === st) ? st : 'new';

  managerCaseDue.value = toDatetimeLocalValue(item.due_date);
  managerCaseNextStep.value = String(item.next_step_note || '');
  managerCaseStatement.value = String(item.iris_statement || '');
  managerCaseAnalysisUrl.value = analysisUrlForItem(item) || '';
  managerCaseFile.value = '';
  managerCaseFormMessage.classList.add('hidden');

  managerCasePanel.classList.remove('hidden');
  managerCasePanel.setAttribute('aria-hidden', 'false');
  managerCasePanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

casesTableBody.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-manage-case]');
  if (!btn) return;
  openManagerCasePanel(btn.getAttribute('data-manage-case'));
});

managerCaseCancel.addEventListener('click', () => closeManagerCasePanel());

managerCaseSave.addEventListener('click', async () => {
  const session = getSession();
  if (!session || session.role !== 'manager') return;

  const caseId = managerEditCaseId.value.trim();
  if (!caseId) return;

  managerCaseFormMessage.classList.add('hidden');

  const payload = {
    action: 'update_case',
    case_id: caseId,
    manager_email: session.email,
    status: managerCaseStatus.value,
    iris_statement: managerCaseStatement.value,
    next_step_note: managerCaseNextStep.value,
  };

  if (session.managerKey) {
    payload.manager_key = session.managerKey;
  }

  const dueVal = managerCaseDue.value;
  if (dueVal) {
    payload.due_date = new Date(dueVal).toISOString();
  }

  const urlVal = managerCaseAnalysisUrl.value.trim();
  if (urlVal) {
    payload.analysis_document_url = urlVal;
  }

  const file = managerCaseFile.files && managerCaseFile.files[0];
  if (file) {
    if (file.size > 5.5 * 1024 * 1024) {
      managerCaseFormMessage.textContent = 'Soubor je příliš velký (max. cca 5 MB). Vložte odkaz ručně.';
      managerCaseFormMessage.classList.remove('hidden');
      return;
    }
    try {
      payload.analysis_file_base64 = await readFileAsBase64(file);
      payload.analysis_file_name = file.name;
      payload.analysis_file_mime = file.type || 'application/pdf';
    } catch (err) {
      managerCaseFormMessage.textContent = err.message || 'Chyba při čtení souboru.';
      managerCaseFormMessage.classList.remove('hidden');
      return;
    }
  }

  managerCaseSave.disabled = true;
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.ok) {
      throw new Error(data.message || 'Uložení se nezdařilo.');
    }

    await loadManagerCases();
    await loadDashboard();
    closeManagerCasePanel();
    setManagerStatus(data.message || 'Případ byl uložen.', false);
  } catch (err) {
    managerCaseFormMessage.textContent = err.message || 'Chyba.';
    managerCaseFormMessage.classList.remove('hidden');
    managerCaseFormMessage.classList.remove('login-success');
  } finally {
    managerCaseSave.disabled = false;
  }
});

(function init() {
  const session = getSession();
  if (session) {
    showApp(session);
    refreshForRole();
  } else {
    showLogin();
  }
})();
