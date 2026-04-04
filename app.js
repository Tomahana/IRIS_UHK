/**
 * IRIS UHK – frontend
 *
 * Očekávané rozšíření Google Apps Script (stejný deploy URL jako dosud):
 *
 * 1) POST JSON: { "action": "login", "email": "...", "password": "...", "role": "user" | "manager" }
 *    → { "ok": true, "role": "user"|"manager", "email": "..." } nebo { "ok": false, "message": "..." }
 *
 * 2) GET  ?action=cases&...  – pro role=user vždy posílejte také applicant_email=<přihlášený email>
 *    (server musí filtrovat; klientem to nelze spolehlivě zajistit).
 *
 * 3) POST intake: doporučeno přidat applicant_email ze session a na serveru ověřit shodu s účtem.
 */

const API_URL =
  'https://script.google.com/macros/s/AKfycbyN8uGoqSqqH26K7eBzTx-QmE08e-27fWJRws5QcM6Dm6dl2NEGAygFak9T7X0rzYpZ6Q/exec';

const SESSION_KEY = 'iris_uhk_session';

/** Dočasné řešení, dokud Apps Script neimplementuje login: prázdné = vypnuto. */
const MANAGER_FALLBACK_CODE = '';

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
const tabUser = document.getElementById('tabUser');
const tabManager = document.getElementById('tabManager');

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
  const isUser = tab === 'user';
  tabUser.classList.toggle('active', isUser);
  tabManager.classList.toggle('active', !isUser);
  userLoginForm.classList.toggle('hidden', !isUser);
  userLoginForm.classList.toggle('active', isUser);
  managerLoginForm.classList.toggle('hidden', isUser);
  managerLoginForm.classList.toggle('active', !isUser);
  userLoginError.classList.add('hidden');
  managerLoginError.classList.add('hidden');
}

tabUser.addEventListener('click', () => setTab('user'));
tabManager.addEventListener('click', () => setTab('manager'));

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
    setSession({ email, role: 'manager' });
    showApp(getSession());
    await refreshForRole();
    return;
  }

  try {
    const { response, data } = await apiLogin(email, password, 'manager');
    if (response.ok && data.ok && (data.role === 'manager' || data.role === 'iris_manager')) {
      setSession({ email: data.email || email, role: 'manager' });
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

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderDashboard(summary) {
  statTotal.textContent = summary.total ?? 0;
  statOpen.textContent = summary.open_cases ?? 0;
  statClosed.textContent = summary.closed_cases ?? 0;
  statOverdue.textContent = summary.overdue_cases ?? 0;
}

function renderManagerCases(items) {
  if (!items || !items.length) {
    casesTableBody.innerHTML = `<tr><td colspan="8" class="empty-row">Nebyly nalezeny žádné případy.</td></tr>`;
    return;
  }

  casesTableBody.innerHTML = items
    .map(
      (item) => `
    <tr>
      <td>${escapeHtml(item.case_id)}</td>
      <td>${escapeHtml(formatDate(item.created_at))}</td>
      <td>${escapeHtml(item.title)}</td>
      <td>${escapeHtml(item.partner_name)}</td>
      <td>${escapeHtml(item.applicant_name)}</td>
      <td>${escapeHtml(item.status)}</td>
      <td>${escapeHtml(item.priority)}</td>
      <td>${escapeHtml(item.risk_level)}</td>
    </tr>`
    )
    .join('');
}

function renderUserCases(items) {
  if (!items || !items.length) {
    userCasesTableBody.innerHTML = `<tr><td colspan="7" class="empty-row">Zatím nemáte žádné podání.</td></tr>`;
    return;
  }

  userCasesTableBody.innerHTML = items
    .map(
      (item) => `
    <tr>
      <td>${escapeHtml(item.case_id)}</td>
      <td>${escapeHtml(formatDate(item.created_at))}</td>
      <td>${escapeHtml(item.title)}</td>
      <td>${escapeHtml(item.partner_name)}</td>
      <td>${escapeHtml(item.status)}</td>
      <td>${escapeHtml(item.priority)}</td>
      <td>${escapeHtml(item.risk_level)}</td>
    </tr>`
    )
    .join('');
}

async function loadDashboard() {
  const response = await fetch(`${API_URL}?action=dashboard`);
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
  casesTableBody.innerHTML = `<tr><td colspan="8" class="empty-row">Načítání případů…</td></tr>`;

  const response = await fetch(`${API_URL}?${buildCasesParams().toString()}`);
  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(data.message || 'Nepodařilo se načíst případy.');
  }

  renderManagerCases(data.items || []);
}

async function loadUserCases() {
  userCasesTableBody.innerHTML = `<tr><td colspan="7" class="empty-row">Načítání…</td></tr>`;

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
      userCasesTableBody.innerHTML = `<tr><td colspan="7" class="empty-row">${escapeHtml(
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

(function init() {
  const session = getSession();
  if (session) {
    showApp(session);
    refreshForRole();
  } else {
    showLogin();
  }
})();
