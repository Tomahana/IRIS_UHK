/**
 * IRIS UHK – jednotný Web App endpoint (doGet / doPost)
 * Zkopírujte do projektu Apps Script navázaného na tabulku.
 *
 * List Users – sloupce (1. řádek = hlavička), povinné:
 *   email | password | role | active
 *   Doporučené navíc: name (jméno žadatele), registered_at (datum registrace – vyplní skript)
 *   role: user | manager | iris_manager | admin
 *   active: TRUE / FALSE (žádost o přístup ukládá user + active TRUE)
 *   Heslo je v tabulce jako prostý text (vnitřní nástroj).
 *
 * Projekt → Nastavení → Skriptové vlastnosti:
 *   IRIS_MANAGER_KEY = náhodný dlouhý řetězec
 *   Po nastavení musí dashboard a „plný“ seznam cases posílat ?manager_key=...
 *   (klient ho dostane v odpovědi na úspěšné přihlášení správce.)
 *   Testovací podání checklistu od správce: POST stejné tělo jako intake + test_intake: true + manager_key
 *   (pouze pokud je IRIS_MANAGER_KEY nastaven; neověřuje se list Users).
 *
 * List Cases – doporučené další sloupce (pro metodiku / UI):
 *   iris_statement      – vyjádření IRIS k případu (text)
 *   next_step_note      – co může žadatel očekávat a kdy (text)
 *   analysis_document_url – odkaz na zprávu / analýzu (URL; po nahrání souboru doplní skript)
 *   preliminary_risk_score, preliminary_result – z checklistu (čísla/text; doplní se u nových případů)
 *   analysis_subject, analysis_scope_methodology, analysis_conclusion, analysis_recommendations,
 *   analysis_recurrence_note – struktura analytické zprávy dle metodiky IRIS (text)
 *   next_analysis_due   – plánovaný termín obnovy / další analýzy (datum; pro připomínky ve dashboardu)
 *
 * List Intake_Checklist – volitelně: test_intake (ano/ne) – značí testovací podání od správce (manager_key).
 *
 * Skriptové vlastnosti (volitelné):
 *   IRIS_CASE_FILES_FOLDER_ID – kořen příloh (např. 1VQyJWN4Pay4RjCuBnLzuVav6jeceG9hz).
 *     Skript vytváří podsložky rok_RRRR/CASE-…/ – viz IRIS_DRIVE_STRUCTURE.txt v repu.
 *   IRIS_REMINDER_DAYS_BEFORE – kolik kalendářních dopředu upozornit (výchozí 3).
 *   Po použití DriveApp při prvním běhu povolte oprávnění k Drive (scope drive.file).
 *
 * Časovač (notifikace termínů):
 *   V editoru: Spouštěče → Přidat spouštěč → runDeadlineReminderJob → Časová jednotka: den.
 *   Job pošle managerům e-mail u otevřených případů se lhůtou do X dnů nebo po lhůtě (max. 14 dní po).
 *   Duplicity stejný den: kontrola listu Notifications (template DEADLINE_MANAGER / DEADLINE_APPLICANT).
 *
 * Nový případ: e-mail všem aktivním účtům manager/iris_manager/admin z listu Users (+ záložní testEmail).
 *
 * Odstraňte z projektu druhou kopii doPost / IRIS_CONFIG, ať zůstane jen tento soubor.
 */

const IRIS_CONFIG = {
  spreadsheetId: '13gzlqCLpn-Q8n0J0eyhdZ0e5jD97hi7x9gcgB7ONdgk',
  sheets: {
    users: 'Users',
    cases: 'Cases',
    intake: 'Intake_Checklist',
    events: 'Case_Events',
    notifications: 'Notifications',
    countries: 'Countries',
  },
  testEmail: 'hana.tomaskova@uhk.cz',
};

function doPost(e) {
  try {
    const data = parseJsonBody_(e);
    const action = String(data.action || '').toLowerCase();

    if (action === 'register') {
      return handleRegister_(data);
    }

    if (action === 'login') {
      return handleLogin_(data);
    }

    if (action === 'update_case') {
      return handleUpdateCase_(data);
    }

    return processIntakeSubmission_(data);
  } catch (error) {
    return jsonResponse_(500, {
      ok: false,
      message: error.message,
    });
  }
}

function handleLogin_(data) {
  validateRequiredFields_(data, ['email', 'password']);
  const email = normalizeEmail_(data.email);
  const password = String(data.password || '');
  const requestedRole = String(data.role || 'user').toLowerCase();

  if (!['user', 'manager'].includes(requestedRole)) {
    return jsonResponse_(400, { ok: false, message: 'Neplatná role.' });
  }

  const user = findUserByCredentials_(email, password);
  if (!user) {
    return jsonResponse_(401, { ok: false, message: 'Neplatné přihlašovací údaje.' });
  }

  const sheetRole = String(user.role || 'user')
    .trim()
    .toLowerCase();
  const isManagerRole = ['manager', 'iris_manager', 'admin'].includes(sheetRole);

  if (requestedRole === 'manager') {
    if (!isManagerRole) {
      return jsonResponse_(403, { ok: false, message: 'Účet nemá oprávnění správce (IRIS Manager).' });
    }
  } else {
    if (isManagerRole) {
      return jsonResponse_(403, {
        ok: false,
        message: 'Pro účet správce použijte záložku IRIS Manager.',
      });
    }
  }

  const payload = {
    ok: true,
    email: user.email,
    role: requestedRole === 'manager' ? 'manager' : 'user',
  };

  const mk = getManagerKey_();
  if (requestedRole === 'manager' && mk) {
    payload.manager_key = mk;
  }

  return jsonResponse_(200, payload);
}

/**
 * Samoobslužná žádost o přístup – nový řádek v Users.
 */
function handleRegister_(data) {
  validateRequiredFields_(data, ['name', 'email', 'password']);

  const name = String(data.name || '').trim();
  const emailRaw = String(data.email || '').trim();
  const emailNorm = normalizeEmail_(emailRaw);
  const password = String(data.password || '');

  if (name.length < 2) {
    return jsonResponse_(400, { ok: false, message: 'Vyplňte jméno a příjmení.' });
  }
  if (!emailNorm || emailNorm.indexOf('@') === -1) {
    return jsonResponse_(400, { ok: false, message: 'Vyplňte platný e-mail.' });
  }
  if (password.length < 8) {
    return jsonResponse_(400, { ok: false, message: 'Heslo musí mít alespoň 8 znaků.' });
  }

  if (findUserByEmail_(emailRaw)) {
    return jsonResponse_(409, {
      ok: false,
      message: 'Účet s tímto e-mailem už existuje. Použijte záložku Přihlášení žadatele.',
    });
  }

  const usersSheet = getUsersSheet_();
  const now = new Date();

  appendByHeaders_(usersSheet, {
    name: name,
    email: emailRaw,
    password: password,
    role: 'user',
    active: true,
    registered_at: now,
  });

  try {
    const subj = 'IRIS UHK – nová žádost o přístup (žadatel)';
    const body =
      'Byl založen nový účet žadatele.\n\n' +
      'Jméno: ' +
      name +
      '\n' +
      'E-mail: ' +
      emailRaw +
      '\n' +
      'Čas: ' +
      now.toISOString();
    MailApp.sendEmail(IRIS_CONFIG.testEmail, subj, body);
  } catch (mailErr) {
    /* e-mail správci není kritický */
  }

  return jsonResponse_(200, {
    ok: true,
    message: 'Účet byl založen. Nyní se přihlaste v záložce Přihlášení žadatele.',
    email: emailRaw,
  });
}

/**
 * Úprava případu správcem (stav, vyjádření, termín, odkaz / soubor analýzy).
 * POST: { action, manager_key, case_id, manager_email?, status?, iris_statement?, next_step_note?, due_date?, analysis_document_url?, analysis_file_base64?, analysis_file_name?, analysis_file_mime? }
 */
function handleUpdateCase_(data) {
  assertManagerKeyFromPayload_(data);
  validateRequiredFields_(data, ['case_id']);

  const caseId = String(data.case_id || '').trim();
  const ss = SpreadsheetApp.openById(IRIS_CONFIG.spreadsheetId);
  const casesSheet = ss.getSheetByName(IRIS_CONFIG.sheets.cases);
  const eventsSheet = ss.getSheetByName(IRIS_CONFIG.sheets.events);

  if (findCaseRowIndex_(casesSheet, caseId) < 0) {
    return jsonResponse_(404, { ok: false, message: 'Případ nenalezen.' });
  }

  const updates = {};
  if (data.status !== undefined && String(data.status || '').trim()) {
    const st = String(data.status).trim();
    if (!isAllowedCaseStatus_(st)) {
      return jsonResponse_(400, { ok: false, message: 'Neplatný stav případu: ' + st });
    }
    updates.status = st;
  }

  if (data.iris_statement !== undefined) {
    updates.iris_statement = String(data.iris_statement || '');
  }
  if (data.next_step_note !== undefined) {
    updates.next_step_note = String(data.next_step_note || '');
  }
  if (data.due_date !== undefined && String(data.due_date || '').trim()) {
    const d = new Date(data.due_date);
    if (isNaN(d.getTime())) {
      return jsonResponse_(400, { ok: false, message: 'Neplatné datum termínu.' });
    }
    updates.due_date = d;
  }

  let analysisUrl = null;
  if (data.analysis_document_url !== undefined) {
    analysisUrl = String(data.analysis_document_url || '').trim();
  }
  const b64 = data.analysis_file_base64 ? String(data.analysis_file_base64).trim() : '';
  if (b64) {
    const fname = String(data.analysis_file_name || 'analyza.pdf').trim();
    const mime = String(data.analysis_file_mime || 'application/pdf').trim();
    try {
      analysisUrl = saveCaseAttachment_(b64, fname, mime, caseId);
    } catch (err) {
      return jsonResponse_(400, { ok: false, message: err.message });
    }
  }
  if (analysisUrl !== null && analysisUrl !== '') {
    updates.analysis_document_url = analysisUrl;
    updates.final_statement_link = analysisUrl;
  }

  var optionalTextFields = [
    'analysis_subject',
    'analysis_scope_methodology',
    'analysis_conclusion',
    'analysis_recommendations',
    'analysis_recurrence_note',
  ];
  optionalTextFields.forEach(function (field) {
    if (data[field] !== undefined) {
      updates[field] = String(data[field] || '');
    }
  });
  if (data.next_analysis_due !== undefined && String(data.next_analysis_due || '').trim()) {
    var nd = new Date(data.next_analysis_due);
    if (!isNaN(nd.getTime())) {
      updates.next_analysis_due = nd;
    }
  }

  if (Object.keys(updates).length === 0) {
    return jsonResponse_(400, { ok: false, message: 'Nebyla odeslána žádná pole k uložení.' });
  }

  updates.last_update = new Date();
  updates.last_updated_by = String(data.manager_email || 'iris_manager');

  updateRowFieldsByCaseId_(casesSheet, caseId, updates);

  const now = new Date();
  appendByHeaders_(eventsSheet, {
    event_id: 'EVT-' + Utilities.getUuid().slice(0, 8),
    case_id: caseId,
    event_time: now,
    event_type: 'case_updated',
    actor: String(data.manager_email || 'iris_manager'),
    actor_role: 'iris_manager',
    old_value: '',
    new_value: JSON.stringify(updates),
    note: 'Úprava případu (stav / vyjádření / termín / analýza).',
  });

  return jsonResponse_(200, {
    ok: true,
    message: 'Případ byl uložen.',
    case_id: caseId,
  });
}

function assertManagerKeyFromPayload_(data) {
  const required = getManagerKey_();
  if (!required) {
    return;
  }
  if (String(data.manager_key || '') !== required) {
    throw new Error('Chybí nebo je neplatný manager_key.');
  }
}

function isAllowedCaseStatus_(st) {
  const allowed = [
    'new',
    'under_review',
    'dd_in_progress',
    'case_handling',
    'analysis_in_progress',
    'closed',
    'waiting_internal_opinion',
    'ready_for_decision',
  ];
  return allowed.indexOf(st) !== -1;
}

function findCaseRowIndex_(sheet, caseId) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) {
    return -1;
  }
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const col = headers.indexOf('case_id');
  if (col === -1) {
    return -1;
  }
  const data = sheet.getDataRange().getValues();
  const want = String(caseId).trim();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][col] || '').trim() === want) {
      return i + 1;
    }
  }
  return -1;
}

function updateRowFieldsByCaseId_(sheet, caseId, updates) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) {
    throw new Error('List Cases nemá hlavičku.');
  }
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const rowNum = findCaseRowIndex_(sheet, caseId);
  if (rowNum < 0) {
    throw new Error('Případ nenalezen.');
  }

  headers.forEach((header, index) => {
    if (Object.prototype.hasOwnProperty.call(updates, header)) {
      sheet.getRange(rowNum, index + 1).setValue(updates[header]);
    }
  });
}

/**
 * Uloží soubor do Drive: kořen IRIS_CASE_FILES_FOLDER_ID / rok_RRRR / CASE-ID / soubor.
 * Limit cca 8 MB kvůli JSON POST – větší soubory nahrajte ručně a vložte URL.
 */
function saveCaseAttachment_(base64, filename, mimeType, caseId) {
  const folderId = PropertiesService.getScriptProperties().getProperty('IRIS_CASE_FILES_FOLDER_ID');
  if (!folderId) {
    throw new Error(
      'Nahrávání souboru: nastavte IRIS_CASE_FILES_FOLDER_ID (kořen Drive, např. 1VQyJWN4Pay4RjCuBnLzuVav6jeceG9hz), nebo vložte odkaz do pole URL analýzy.'
    );
  }
  const decoded = Utilities.base64Decode(base64);
  if (decoded.length > 8 * 1024 * 1024) {
    throw new Error('Soubor je příliš velký (max. cca 8 MB). Nahrajte ručně do Drive a vložte odkaz.');
  }
  const blob = Utilities.newBlob(decoded, mimeType || 'application/octet-stream', filename);
  const root = DriveApp.getFolderById(folderId);
  const year = extractYearFromCaseId_(caseId) || String(new Date().getFullYear());
  const yearFolder = getOrCreateSubfolder_(root, 'rok_' + year);
  const caseFolderName = String(caseId || 'bez_case_id').replace(/[\\/]/g, '_');
  const caseFolder = getOrCreateSubfolder_(yearFolder, caseFolderName);
  const file = caseFolder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function getOrCreateSubfolder_(parent, name) {
  const safe = String(name || 'slozka').slice(0, 200);
  const it = parent.getFoldersByName(safe);
  if (it.hasNext()) {
    return it.next();
  }
  return parent.createFolder(safe);
}

function extractYearFromCaseId_(caseId) {
  const m = String(caseId || '').match(/-(\d{4})-\d+/);
  return m ? m[1] : null;
}

function isManagerTestIntake_(data) {
  var raw = data.test_intake;
  if (raw === true) return true;
  return String(raw || '').toLowerCase() === 'true';
}

/**
 * Testovací podání checklistu správcem: vyžaduje platný manager_key a nastavené IRIS_MANAGER_KEY.
 * Neprověřuje řádek Users (žadatel) – slouží jen pro admin/test.
 */
function verifyManagerTestIntake_(data) {
  var required = getManagerKey_();
  if (!required) {
    throw new Error(
      'Testovací podání je vypnuto: nastavte IRIS_MANAGER_KEY ve skriptových vlastnostech a přihlaste se jako správce s platným klíčem.'
    );
  }
  assertManagerKeyFromPayload_(data);
  var email = String(data.applicant_email || '').trim();
  if (!email || email.indexOf('@') === -1) {
    throw new Error('Vyplňte platný e-mail v poli žadatele (testovací režim).');
  }
}

function processIntakeSubmission_(data) {
  validateRequiredFields_(data, [
    'applicant_name',
    'applicant_email',
    'applicant_unit',
    'cooperation_type',
    'cooperation_stage',
    'partner_country',
    'partner_name',
    'intent_description',
  ]);

  if (isManagerTestIntake_(data)) {
    verifyManagerTestIntake_(data);
  } else {
    verifyApplicantForIntake_(data.applicant_email);
  }

  const ss = SpreadsheetApp.openById(IRIS_CONFIG.spreadsheetId);
  const intakeSheet = ss.getSheetByName(IRIS_CONFIG.sheets.intake);
  const casesSheet = ss.getSheetByName(IRIS_CONFIG.sheets.cases);
  const eventsSheet = ss.getSheetByName(IRIS_CONFIG.sheets.events);
  const notificationsSheet = ss.getSheetByName(IRIS_CONFIG.sheets.notifications);

  const now = new Date();
  const intakeId = generateSequentialId_(intakeSheet, 'INT');
  const caseId = generateSequentialId_(casesSheet, 'CASE');

  const risk = calculateRisk_(data);

  appendByHeaders_(intakeSheet, {
    intake_id: intakeId,
    case_id: caseId,
    submitted_at: now,
    applicant_name: data.applicant_name,
    applicant_email: data.applicant_email,
    applicant_unit: data.applicant_unit,
    cooperation_type: data.cooperation_type,
    cooperation_stage: data.cooperation_stage,
    partner_country: data.partner_country,
    partner_name: data.partner_name,
    partner_website: data.partner_website || '',
    external_funding: normalizeYesNo_(data.external_funding),
    access_to_uhk_systems: normalizeYesNo_(data.access_to_uhk_systems),
    sharing_data_knowhow: normalizeYesNo_(data.sharing_data_knowhow),
    sensitive_outputs: normalizeYesNo_(data.sensitive_outputs),
    transfer_outside_eu: normalizeYesNo_(data.transfer_outside_eu),
    training_or_technical_assistance: normalizeYesNo_(data.training_or_technical_assistance),
    involves_doctoral_students_or_infrastructure: normalizeYesNo_(
      data.involves_doctoral_students_or_infrastructure
    ),
    intent_description: data.intent_description,
    preliminary_risk_score: risk.score,
    preliminary_result: risk.result,
    auto_flags: risk.flags.join(', '),
    country_matches: (risk.country_matches || []).join(', '),
    country_risk_category: risk.country_risk_category || '',
    country_risk_score: risk.country_risk_score || 0,
    notification_status: 'sent',
    created_case: true,
    test_intake: isManagerTestIntake_(data) ? 'ano' : 'ne',
    raw_payload_json: JSON.stringify(data),
  });

  appendByHeaders_(casesSheet, {
    case_id: caseId,
    created_at: now,
    created_by: data.applicant_name,
    source_intake_id: intakeId,
    current_phase: 'intake',
    case_type: data.cooperation_type,
    title: buildCaseTitle_(data),
    description: data.intent_description,
    applicant_name: data.applicant_name,
    applicant_email: data.applicant_email,
    applicant_unit: data.applicant_unit,
    partner_name: data.partner_name,
    partner_country: data.partner_country,
    priority: risk.priority,
    status: risk.status,
    responsible_person: 'Hana Tomášková',
    co_responsible_persons: '',
    due_date: addWorkDays_(now, 10),
    escalation_level: risk.escalation_level,
    risk_level: risk.risk_level,
    consultation_required: risk.consultation_required,
    dd_required: risk.dd_required,
    preliminary_risk_score: risk.score,
    preliminary_result: risk.result,
    final_outcome: '',
    conditions_summary: '',
    final_statement_link: '',
    drive_folder_url: '',
    last_update: now,
    last_updated_by: 'system',
    archived: false,
    iris_statement: '',
    next_step_note: '',
    analysis_document_url: '',
    analysis_subject: '',
    analysis_scope_methodology: '',
    analysis_conclusion: '',
    analysis_recommendations: '',
    analysis_recurrence_note: '',
    next_analysis_due: '',
  });

  appendByHeaders_(eventsSheet, {
    event_id: 'EVT-' + Utilities.getUuid().slice(0, 8),
    case_id: caseId,
    event_time: now,
    event_type: 'case_created',
    actor: data.applicant_name,
    actor_role: 'applicant',
    old_value: '',
    new_value: risk.status,
    note: 'Byl založen případ ze vstupního checklistu.',
  });

  const subject = 'IRIS UHK – přijat checklist ' + caseId;
  const body =
    'Dobrý den,\n\n' +
    'vaše podání bylo přijato.\n\n' +
    'Case ID: ' +
    caseId +
    '\n' +
    'Intake ID: ' +
    intakeId +
    '\n' +
    'Předběžný výsledek: ' +
    risk.result +
    '\n' +
    'Skóre: ' +
    risk.score +
    '\n' +
    'Flagy: ' +
    (risk.flags.join(', ') || 'bez zjevných flagů') +
    '\n\n' +
    'Toto je automatické potvrzení.';

  MailApp.sendEmail(data.applicant_email, subject, body);

  const managerEmails = getManagerEmails_();
  const internalSubject = 'IRIS UHK – nový případ ' + caseId;
  const internalBody =
    'Byl podán nový vstupní checklist.\n\n' +
    'Case ID: ' +
    caseId +
    '\n' +
    'Intake ID: ' +
    intakeId +
    '\n' +
    'Žadatel: ' +
    (data.applicant_name || '') +
    ' <' +
    data.applicant_email +
    '>\n' +
    'Předběžný výsledek: ' +
    risk.result +
    '\n' +
    'Skóre: ' +
    risk.score +
    '\n' +
    'Lhůta (výchozí): ' +
    Utilities.formatDate(addWorkDays_(now, 10), Session.getScriptTimeZone(), 'dd.MM.yyyy') +
    '\n\n' +
    'Zpracujte případ v aplikaci IRIS (dashboard správce).';

  if (managerEmails.length) {
    MailApp.sendEmail(managerEmails.join(','), internalSubject, internalBody);
  } else {
    MailApp.sendEmail(IRIS_CONFIG.testEmail, internalSubject, internalBody);
  }

  appendByHeaders_(notificationsSheet, {
    notification_id: 'NOT-' + Utilities.getUuid().slice(0, 8),
    case_id: caseId,
    triggered_at: now,
    template_code: 'INTAKE_CONFIRM',
    recipient_group: 'applicant',
    recipient_emails: data.applicant_email,
    subject: subject,
    delivery_status: 'sent',
    related_result: risk.result,
  });

  appendByHeaders_(notificationsSheet, {
    notification_id: 'NOT-' + Utilities.getUuid().slice(0, 8),
    case_id: caseId,
    triggered_at: now,
    template_code: 'INTAKE_INTERNAL',
    recipient_group: 'internal',
    recipient_emails: managerEmails.length ? managerEmails.join(',') : IRIS_CONFIG.testEmail,
    subject: internalSubject,
    delivery_status: 'sent',
    related_result: risk.result,
  });

  return jsonResponse_(200, {
    ok: true,
    case_id: caseId,
    intake_id: intakeId,
    preliminary_result: risk.result,
    preliminary_risk_score: risk.score,
  });
}

function doGet(e) {
  try {
    const action = e && e.parameter && e.parameter.action ? e.parameter.action : '';

    if (action === 'cases') {
      return getCasesResponse_(e);
    }

    if (action === 'dashboard') {
      return getDashboardResponse_(e);
    }

    return jsonResponse_(200, {
      ok: true,
      message: 'IRIS API běží.',
    });
  } catch (error) {
    return jsonResponse_(500, {
      ok: false,
      message: error.message,
    });
  }
}

function getManagerKey_() {
  return PropertiesService.getScriptProperties().getProperty('IRIS_MANAGER_KEY') || '';
}

function assertManagerKey_(e) {
  const required = getManagerKey_();
  if (!required) {
    return;
  }
  const provided = getParam_(e, 'manager_key');
  if (provided !== required) {
    throw new Error('Chybí nebo je neplatný manager_key (nastavte IRIS_MANAGER_KEY ve skriptových vlastnostech).');
  }
}

function getCasesResponse_(e) {
  const ss = SpreadsheetApp.openById(IRIS_CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(IRIS_CONFIG.sheets.cases);

  const rows = getSheetObjects_(sheet);

  let cases = rows.filter(row => String(row.case_id || '').trim());

  const applicantEmail = getParam_(e, 'applicant_email');
  /** Plný seznam bez filtru e-mailem = jen správce (+ manager_key). Žadatel používá applicant_email. */
  if (!applicantEmail) {
    assertManagerKey_(e);
  }

  if (applicantEmail) {
    const want = normalizeEmail_(applicantEmail);
    cases = cases.filter(row => normalizeEmail_(row.applicant_email) === want);
  }

  const status = getParam_(e, 'status');
  const priority = getParam_(e, 'priority');
  const riskLevel = getParam_(e, 'risk_level');
  const search = getParam_(e, 'search');

  if (status) {
    cases = cases.filter(row => normalizeText_(row.status) === normalizeText_(status));
  }

  if (priority) {
    cases = cases.filter(row => normalizeText_(row.priority) === normalizeText_(priority));
  }

  if (riskLevel) {
    cases = cases.filter(row => normalizeText_(row.risk_level) === normalizeText_(riskLevel));
  }

  if (search) {
    const s = normalizeText_(search);
    cases = cases.filter(
      row =>
        normalizeText_(row.case_id).includes(s) ||
        normalizeText_(row.title).includes(s) ||
        normalizeText_(row.partner_name).includes(s) ||
        normalizeText_(row.applicant_name).includes(s) ||
        normalizeText_(row.applicant_unit).includes(s)
    );
  }

  cases.sort((a, b) => {
    const aDate = new Date(a.created_at || 0).getTime();
    const bDate = new Date(b.created_at || 0).getTime();
    return bDate - aDate;
  });

  const items = cases.slice(0, 200).map(function (row) {
    return enrichCaseWithDueMeta_(row);
  });

  return jsonResponse_(200, {
    ok: true,
    items: items,
  });
}

function getDashboardResponse_(e) {
  assertManagerKey_(e);

  const ss = SpreadsheetApp.openById(IRIS_CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(IRIS_CONFIG.sheets.cases);

  const rows = getSheetObjects_(sheet).filter(row => String(row.case_id || '').trim());
  const now = new Date();

  const openStatuses = getOpenCaseStatuses_();

  const total = rows.length;
  const openCases = rows.filter(row => openStatuses.includes(String(row.status || ''))).length;
  const closedCases = rows.filter(row => {
    const s = String(row.status || '');
    return s === 'closed' || s.indexOf('closed') === 0;
  }).length;

  const overdueCases = rows.filter(row => {
    if (!row.due_date) return false;
    const due = new Date(row.due_date);
    if (isNaN(due.getTime())) return false;
    return due < now && openStatuses.includes(String(row.status || ''));
  }).length;

  const reminderDays = getReminderDaysAhead_();
  const dueSoonCases = rows.filter(row => {
    if (!openStatuses.includes(String(row.status || ''))) return false;
    const d = calendarDaysUntilDue_(row.due_date);
    return d !== null && d >= 0 && d <= reminderDays;
  }).length;

  var nextAnalysisOverdue = rows.filter(function (row) {
    if (!openStatuses.includes(String(row.status || ''))) return false;
    if (!row.next_analysis_due) return false;
    var d = calendarDaysUntilDue_(row.next_analysis_due);
    return d !== null && d < 0;
  }).length;

  var nextAnalysisSoon = rows.filter(function (row) {
    if (!openStatuses.includes(String(row.status || ''))) return false;
    if (!row.next_analysis_due) return false;
    var d = calendarDaysUntilDue_(row.next_analysis_due);
    return d !== null && d >= 0 && d <= reminderDays;
  }).length;

  const byPriority = countBy_(rows, 'priority');
  const byStatus = countBy_(rows, 'status');
  const byRisk = countBy_(rows, 'risk_level');

  return jsonResponse_(200, {
    ok: true,
    summary: {
      total,
      open_cases: openCases,
      closed_cases: closedCases,
      overdue_cases: overdueCases,
      due_soon_cases: dueSoonCases,
      next_analysis_overdue: nextAnalysisOverdue,
      next_analysis_soon: nextAnalysisSoon,
      reminder_days_before: reminderDays,
      by_priority: byPriority,
      by_status: byStatus,
      by_risk: byRisk,
    },
  });
}

/* ---------- Termíny, notifikace, Drive meta ---------- */

function getOpenCaseStatuses_() {
  return [
    'new',
    'under_review',
    'dd_in_progress',
    'waiting_internal_opinion',
    'ready_for_decision',
    'case_handling',
    'analysis_in_progress',
  ];
}

function getReminderDaysAhead_() {
  const raw = PropertiesService.getScriptProperties().getProperty('IRIS_REMINDER_DAYS_BEFORE');
  const n = Number(raw);
  return n > 0 && n <= 30 ? n : 3;
}

function startOfDayInTz_(d) {
  const date = new Date(d);
  if (isNaN(date.getTime())) return null;
  const z = Session.getScriptTimeZone();
  const s = Utilities.formatDate(date, z, 'yyyy-MM-dd');
  return new Date(s + 'T00:00:00');
}

function calendarDaysUntilDue_(dueValue) {
  if (!dueValue) return null;
  const due = startOfDayInTz_(dueValue);
  if (!due) return null;
  const today = startOfDayInTz_(new Date());
  if (!today) return null;
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

function enrichCaseWithDueMeta_(row) {
  const copy = {};
  Object.keys(row).forEach(function (k) {
    copy[k] = row[k];
  });
  const days = calendarDaysUntilDue_(row.due_date);
  copy.days_until_due = days;
  const open = getOpenCaseStatuses_().indexOf(String(row.status || '')) !== -1;
  const windowDays = getReminderDaysAhead_();
  copy.due_soon = open && days !== null && days >= 0 && days <= windowDays;
  copy.due_overdue_flag = open && days !== null && days < 0;
  return copy;
}

function getManagerEmails_() {
  let sheet;
  try {
    sheet = getUsersSheet_();
  } catch (e) {
    return IRIS_CONFIG.testEmail ? [IRIS_CONFIG.testEmail] : [];
  }
  const rows = getSheetObjects_(sheet);
  const emails = [];
  rows.forEach(function (r) {
    if (!isActive_(r.active)) return;
    const role = String(r.role || '')
      .trim()
      .toLowerCase();
    if (['manager', 'iris_manager', 'admin'].indexOf(role) === -1) return;
    const em = String(r.email || '').trim();
    if (em) emails.push(em);
  });
  const unique = [];
  emails.forEach(function (e) {
    if (unique.indexOf(e) === -1) unique.push(e);
  });
  if (!unique.length && IRIS_CONFIG.testEmail) {
    unique.push(IRIS_CONFIG.testEmail);
  }
  return unique;
}

function deadlineReminderPropKey_(caseId, templateCode) {
  const day = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return ['irisdeadline', String(templateCode), String(caseId), day].join('_');
}

function wasDeadlineNotificationSentToday_(notificationsSheet, caseId, templateCode) {
  if (
    PropertiesService.getScriptProperties().getProperty(deadlineReminderPropKey_(caseId, templateCode)) ===
    '1'
  ) {
    return true;
  }
  if (!notificationsSheet) return false;
  const values = notificationsSheet.getDataRange().getValues();
  if (values.length < 2) return false;
  const headers = values[0];
  const idxCase = headers.indexOf('case_id');
  const idxTpl = headers.indexOf('template_code');
  const idxTime = headers.indexOf('triggered_at');
  if (idxCase === -1 || idxTpl === -1 || idxTime === -1) return false;
  const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  for (let i = values.length - 1; i >= 1; i--) {
    const row = values[i];
    if (String(row[idxCase] || '').trim() !== String(caseId || '').trim()) continue;
    if (String(row[idxTpl] || '').trim() !== String(templateCode)) continue;
    const t = row[idxTime];
    if (!t) continue;
    const d = t instanceof Date ? t : new Date(t);
    if (isNaN(d.getTime())) continue;
    if (Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd') === todayStr) {
      return true;
    }
  }
  return false;
}

function markDeadlineReminderSentToday_(caseId, templateCode) {
  PropertiesService.getScriptProperties().setProperty(deadlineReminderPropKey_(caseId, templateCode), '1');
}

/**
 * Denní úloha: e-mail managerům (a žadateli) u blízkých / nedodržených lhůt.
 * Nastavte časovač v Apps Scriptu na tuto funkci (1× denně).
 */
function runDeadlineReminderJob() {
  const ss = SpreadsheetApp.openById(IRIS_CONFIG.spreadsheetId);
  const casesSheet = ss.getSheetByName(IRIS_CONFIG.sheets.cases);
  const notificationsSheet = ss.getSheetByName(IRIS_CONFIG.sheets.notifications);
  if (!casesSheet) return;

  const rows = getSheetObjects_(casesSheet).filter(function (r) {
    return String(r.case_id || '').trim();
  });
  const openStatuses = getOpenCaseStatuses_();
  const ahead = getReminderDaysAhead_();
  const managers = getManagerEmails_();
  const now = new Date();

  rows.forEach(function (row) {
    const st = String(row.status || '');
    if (openStatuses.indexOf(st) === -1) return;
    if (!row.due_date) return;

    const days = calendarDaysUntilDue_(row.due_date);
    if (days === null) return;

    const overdueGrace = 14;
    const inReminderWindow = days >= 0 && days <= ahead;
    const overdueRecent = days < 0 && days >= -overdueGrace;
    if (!inReminderWindow && !overdueRecent) return;

    const caseId = String(row.case_id || '').trim();
    if (!caseId) return;

    if (!wasDeadlineNotificationSentToday_(notificationsSheet, caseId, 'DEADLINE_MANAGER')) {
      const dueStr = Utilities.formatDate(new Date(row.due_date), Session.getScriptTimeZone(), 'dd.MM.yyyy');
      let headline = 'Blíží se termín';
      if (days < 0) headline = 'Po termínu (vyžaduje akci)';
      else if (days === 0) headline = 'Termín je dnes';
      else headline = 'Zbývá ' + days + ' dní do termínu';

      const mgrBody =
        headline +
        ' – případ ' +
        caseId +
        '\n\n' +
        'Název: ' +
        (row.title || '') +
        '\n' +
        'Žadatel: ' +
        (row.applicant_name || '') +
        ' <' +
        (row.applicant_email || '') +
        '>\n' +
        'Stav: ' +
        st +
        '\n' +
        'Lhůta / termín: ' +
        dueStr +
        '\n' +
        (row.next_step_note ? 'Poznámka k postupu: ' + row.next_step_note + '\n' : '') +
        '\n' +
        'Zpracujte dle metodiky IRIS.';

      if (managers.length) {
        MailApp.sendEmail(managers.join(','), 'IRIS UHK – ' + headline + ': ' + caseId, mgrBody);
      }

      markDeadlineReminderSentToday_(caseId, 'DEADLINE_MANAGER');

      if (notificationsSheet) {
        try {
          appendByHeaders_(notificationsSheet, {
            notification_id: 'NOT-' + Utilities.getUuid().slice(0, 8),
            case_id: caseId,
            triggered_at: now,
            template_code: 'DEADLINE_MANAGER',
            recipient_group: 'internal',
            recipient_emails: managers.join(','),
            subject: 'IRIS UHK – ' + headline + ': ' + caseId,
            delivery_status: 'sent',
            related_result: String(days),
          });
        } catch (logErr) {
          /* list Notifications může mít jiné sloupce */
        }
      }
    }

    const applicant = String(row.applicant_email || '').trim();
    if (
      applicant &&
      days >= 0 &&
      days <= ahead &&
      !wasDeadlineNotificationSentToday_(notificationsSheet, caseId, 'DEADLINE_APPLICANT')
    ) {
      const dueStr = Utilities.formatDate(new Date(row.due_date), Session.getScriptTimeZone(), 'dd.MM.yyyy');
      const appBody =
        'Dobrý den,\n\n' +
        'u vašeho případu ' +
        caseId +
        ' se blíží termín dle metodiky IRIS.\n' +
        'Termín (orientačně): ' +
        dueStr +
        '\n' +
        'Stav: ' +
        st +
        '\n\n' +
        (row.next_step_note ? 'Další postup: ' + row.next_step_note + '\n\n' : '') +
        'V případě dotazů kontaktujte IRIS / prorektorát.\n\n' +
        'IRIS UHK (automatická zpráva)';

      MailApp.sendEmail(
        applicant,
        'IRIS UHK – blíží se termín u případu ' + caseId,
        appBody
      );

      markDeadlineReminderSentToday_(caseId, 'DEADLINE_APPLICANT');

      if (notificationsSheet) {
        try {
          appendByHeaders_(notificationsSheet, {
            notification_id: 'NOT-' + Utilities.getUuid().slice(0, 8),
            case_id: caseId,
            triggered_at: now,
            template_code: 'DEADLINE_APPLICANT',
            recipient_group: 'applicant',
            recipient_emails: applicant,
            subject: 'IRIS UHK – blíží se termín',
            delivery_status: 'sent',
            related_result: String(days),
          });
        } catch (logErr2) {
          /* */
        }
      }
    }
  });
}

/* ---------- Users / auth ---------- */

function getUsersSheet_() {
  const ss = SpreadsheetApp.openById(IRIS_CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(IRIS_CONFIG.sheets.users);
  if (!sheet) {
    throw new Error('List Users neexistuje. Vytvořte list Users se sloupci: email, password, role, active');
  }
  return sheet;
}

function findUserByCredentials_(email, password) {
  const sheet = getUsersSheet_();
  const rows = getSheetObjects_(sheet);
  const want = normalizeEmail_(email);
  const pass = String(password || '');

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowEmail = normalizeEmail_(row.email);
    if (rowEmail !== want) continue;
    if (!isActive_(row.active)) continue;
    if (String(row.password || '') !== pass) continue;
    return {
      email: String(row.email || '').trim(),
      role: row.role,
      active: row.active,
    };
  }
  return null;
}

function findUserByEmail_(email) {
  const sheet = getUsersSheet_();
  const rows = getSheetObjects_(sheet);
  const want = normalizeEmail_(email);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (normalizeEmail_(row.email) === want) return row;
  }
  return null;
}

function verifyApplicantForIntake_(email) {
  const row = findUserByEmail_(email);
  if (!row || !isActive_(row.active)) {
    throw new Error(
      'E-mail není registrovaný aktivní žadatel. Nejprve odešlete žádost o přístup nebo kontaktujte správce IRIS.'
    );
  }
  const sheetRole = String(row.role || 'user')
    .trim()
    .toLowerCase();
  if (['manager', 'iris_manager', 'admin'].includes(sheetRole)) {
    throw new Error('Podání checklistu patří k účtu žadatele, ne správce.');
  }
}

function normalizeEmail_(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function isActive_(cell) {
  return cell === true || String(cell).toUpperCase() === 'TRUE';
}

/* ---------- Risk / countries ---------- */

function calculateRisk_(data) {
  let score = 0;
  const flags = [];

  const countryEvaluation = evaluateCountries_(data.partner_country);

  if (countryEvaluation.score > 0) {
    score += countryEvaluation.score;
  }

  if (countryEvaluation.flags.length) {
    flags.push(...countryEvaluation.flags);
  }

  if (isYes_(data.access_to_uhk_systems)) {
    score += 2;
    flags.push('přístup do systémů UHK');
  }

  if (isYes_(data.sharing_data_knowhow)) {
    score += 2;
    flags.push('sdílení dat / know-how');
  }

  if (isYes_(data.sensitive_outputs)) {
    score += 3;
    flags.push('citlivé výstupy');
  }

  if (isYes_(data.transfer_outside_eu)) {
    score += 2;
    flags.push('přenos mimo EU');
  }

  if (isYes_(data.training_or_technical_assistance)) {
    score += 1;
    flags.push('technická pomoc / školení');
  }

  if (isYes_(data.external_funding)) {
    score += 1;
    flags.push('externí financování');
  }

  if (isYes_(data.involves_doctoral_students_or_infrastructure)) {
    score += 1;
    flags.push('zapojení infrastruktury / doktorandů');
  }

  if (score <= 2) {
    return {
      score,
      result: 'bez zjevných rizik',
      status: 'new',
      priority: 'nízká',
      escalation_level: 'nízká',
      risk_level: 'nízké',
      consultation_required: false,
      dd_required: false,
      flags,
      country_matches: countryEvaluation.matchedCountries,
      country_risk_category: countryEvaluation.category || '',
      country_risk_score: countryEvaluation.score,
    };
  }

  if (score <= 5) {
    return {
      score,
      result: 'vyžaduje posouzení',
      status: 'under_review',
      priority: 'střední',
      escalation_level: 'nízká',
      risk_level: 'střední',
      consultation_required: true,
      dd_required: false,
      flags,
      country_matches: countryEvaluation.matchedCountries,
      country_risk_category: countryEvaluation.category || '',
      country_risk_score: countryEvaluation.score,
    };
  }

  return {
    score,
    result: 'vyžaduje eskalaci / rozšířenou DD',
    status: 'dd_in_progress',
    priority: 'vysoká',
    escalation_level: 'vysoká',
    risk_level: 'vysoké',
    consultation_required: true,
    dd_required: true,
    flags,
    country_matches: countryEvaluation.matchedCountries,
    country_risk_category: countryEvaluation.category || '',
    country_risk_score: countryEvaluation.score,
  };
}

function normalizeCountryName_(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function parseCountries_(rawValue) {
  return String(rawValue || '')
    .split(/[;,/]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function evaluateCountries_(partnerCountryRaw) {
  const ss = SpreadsheetApp.openById(IRIS_CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(IRIS_CONFIG.sheets.countries);

  if (!sheet) {
    return {
      inputCountries: parseCountries_(partnerCountryRaw),
      matchedCountries: [],
      unmatchedCountries: parseCountries_(partnerCountryRaw),
      category: '',
      score: 0,
      flags: [],
    };
  }

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return {
      inputCountries: parseCountries_(partnerCountryRaw),
      matchedCountries: [],
      unmatchedCountries: parseCountries_(partnerCountryRaw),
      category: '',
      score: 0,
      flags: [],
    };
  }

  const headers = values[0];
  const rows = values.slice(1);

  const codeIndex = headers.indexOf('country_code');
  const nameIndex = headers.indexOf('country_name');
  const categoryIndex = headers.indexOf('category');
  const scoreIndex = headers.indexOf('risk_score');
  const activeIndex = headers.indexOf('active');

  if ([nameIndex, categoryIndex, scoreIndex, activeIndex].includes(-1)) {
    throw new Error('List Countries nemá požadované sloupce: country_name, category, risk_score, active');
  }

  const dictionary = {};

  rows.forEach(row => {
    const countryName = String(row[nameIndex] || '').trim();
    const countryCode = codeIndex > -1 ? String(row[codeIndex] || '').trim() : '';
    const active = row[activeIndex] === true || String(row[activeIndex]).toUpperCase() === 'TRUE';

    if (!countryName || !active) return;

    const record = {
      code: countryCode,
      name: countryName,
      category: String(row[categoryIndex] || '').trim(),
      score: Number(row[scoreIndex] || 0),
    };

    dictionary[normalizeCountryName_(countryName)] = record;

    if (countryCode) {
      dictionary[normalizeCountryName_(countryCode)] = record;
    }
  });

  const inputCountries = parseCountries_(partnerCountryRaw);

  const matched = [];
  const unmatched = [];
  let maxScore = 0;
  let finalCategory = '';

  inputCountries.forEach(country => {
    const found = dictionary[normalizeCountryName_(country)];

    if (found) {
      matched.push(found);

      if (found.score > maxScore) {
        maxScore = found.score;
        finalCategory = found.category;
      }
    } else {
      unmatched.push(country);
    }
  });

  const flags = [];

  if (matched.length > 0 && maxScore > 0) {
    const matchedAtMax = matched
      .filter(item => item.score === maxScore)
      .map(item => item.name);

    flags.push(finalCategory + ' země: ' + [...new Set(matchedAtMax)].join(', '));
  }

  if (unmatched.length > 0) {
    flags.push('nezařazené země: ' + unmatched.join(', '));
  }

  return {
    inputCountries,
    matchedCountries: [...new Set(matched.map(item => item.name))],
    unmatchedCountries: unmatched,
    category: finalCategory,
    score: maxScore,
    flags,
  };
}

/* ---------- Údržba: Cases – Notion API, CSV list ----------
 *
 * A) Automaticky z Notion (doporučeno – jedno tlačítko Spustit):
 * 1) Notion → Nastavení připojení → Develop or connect integrations → nová integrace → zkopírujte „Internal integration secret“.
 * 2) Otevřete DATABÁZI v Notion (ne jen stránku) → ⋮ → Connections → přidejte integraci.
 * 3) Zkopírujte ID databáze z URL (32 hex znaků, s nebo bez pomlček), např. …notion.so/ba496fe4e44d4d19b4e394dae327efde → použijte celý řetězec.
 * 4) Apps Script → Projekt → Nastavení → Skriptové vlastnosti:
 *      NOTION_TOKEN = secret z kroku 1
 *      NOTION_DATABASE_ID = ID z kroku 3
 * 5) Spusťte syncNotionDatabaseToCases (smaže datové řádky Cases a naplní je z Notion).
 *    Pokud sloupce v Notion neodpovídají názvům v Cases, doplňte IRIS_CASES_TO_NOTION_PROPERTY níže.
 *
 * B) Ručně přes CSV: list Notion_Import + clearCasesDataRowsOnly + importCasesFromNotionImportSheet.
 *
 * Volitelně: clearIntakeEventsAndNotificationsDataRows – vyčistí Intake / Events / Notifications po testech.
 */
const IRIS_NOTION_IMPORT_SHEET = 'Notion_Import';

/** CSV z Notion: název sloupce v exportu → sloupec v Cases. */
const IRIS_NOTION_COLUMN_MAP = {
  // 'Name': 'title',
};

/** Notion API: sloupec v Cases → přesný název vlastnosti v databázi (jinak shoda podle názvu / bez diakritiky; title = první Title v DB). */
const IRIS_CASES_TO_NOTION_PROPERTY = {
  // title: 'Název případu',
  // partner_name: 'Partner',
};

function clearCasesDataRowsOnly() {
  const ss = SpreadsheetApp.openById(IRIS_CONFIG.spreadsheetId);
  const sh = ss.getSheetByName(IRIS_CONFIG.sheets.cases);
  if (!sh) {
    throw new Error('List Cases nenalezen.');
  }
  const last = sh.getLastRow();
  if (last > 1) {
    sh.deleteRows(2, last - 1);
  }
}

function clearIntakeEventsAndNotificationsDataRows() {
  const ss = SpreadsheetApp.openById(IRIS_CONFIG.spreadsheetId);
  [IRIS_CONFIG.sheets.intake, IRIS_CONFIG.sheets.events, IRIS_CONFIG.sheets.notifications].forEach(function (name) {
    const sh = ss.getSheetByName(name);
    if (!sh) {
      return;
    }
    const last = sh.getLastRow();
    if (last > 1) {
      sh.deleteRows(2, last - 1);
    }
  });
}

function mapNotionHeaderToCasesHeader_(rawHeader) {
  const raw = String(rawHeader || '').trim();
  if (!raw) {
    return '';
  }
  if (Object.prototype.hasOwnProperty.call(IRIS_NOTION_COLUMN_MAP, raw)) {
    return IRIS_NOTION_COLUMN_MAP[raw];
  }
  const norm = normalizeText_(raw);
  for (const k in IRIS_NOTION_COLUMN_MAP) {
    if (Object.prototype.hasOwnProperty.call(IRIS_NOTION_COLUMN_MAP, k) && normalizeText_(k) === norm) {
      return IRIS_NOTION_COLUMN_MAP[k];
    }
  }
  return raw;
}

function buildNotionToCasesColumnMap_(srcHeaders, dstHeaders) {
  const map = {};
  for (let i = 0; i < srcHeaders.length; i++) {
    const canonical = mapNotionHeaderToCasesHeader_(srcHeaders[i]);
    if (!canonical) {
      continue;
    }
    for (let j = 0; j < dstHeaders.length; j++) {
      const dh = String(dstHeaders[j] || '').trim();
      if (!dh) {
        continue;
      }
      if (dh === canonical || normalizeText_(dh) === normalizeText_(canonical)) {
        map[dh] = i;
        break;
      }
    }
  }
  return map;
}

function isDataRowEmpty_(row) {
  return row.every(function (c) {
    return String(c || '').trim() === '';
  });
}

function importCasesFromNotionImportSheet() {
  const ss = SpreadsheetApp.openById(IRIS_CONFIG.spreadsheetId);
  const src = ss.getSheetByName(IRIS_NOTION_IMPORT_SHEET);
  const dst = ss.getSheetByName(IRIS_CONFIG.sheets.cases);
  if (!src) {
    throw new Error(
      'Chybí list "' +
        IRIS_NOTION_IMPORT_SHEET +
        '". Vytvořte ho v této tabulce a vložte export z Notion (1. řádek = hlavičky).'
    );
  }
  if (!dst) {
    throw new Error('List Cases nenalezen.');
  }

  const srcValues = src.getDataRange().getValues();
  if (srcValues.length < 2) {
    return;
  }

  const srcHeaders = srcValues[0];
  const dstHeaders = dst.getRange(1, 1, 1, dst.getLastColumn()).getValues()[0];
  const colMap = buildNotionToCasesColumnMap_(srcHeaders, dstHeaders);

  for (let r = 1; r < srcValues.length; r++) {
    const row = srcValues[r];
    if (isDataRowEmpty_(row)) {
      continue;
    }

    const obj = {};
    dstHeaders.forEach(function (dh) {
      const key = String(dh || '').trim();
      if (!key) {
        return;
      }
      if (Object.prototype.hasOwnProperty.call(colMap, key)) {
        obj[key] = row[colMap[key]];
      } else {
        obj[key] = '';
      }
    });

    if (!String(obj.case_id || '').trim()) {
      obj.case_id = generateSequentialId_(dst, 'CASE');
    }
    if (!obj.created_at) {
      obj.created_at = new Date();
    }
    if (!String(obj.status || '').trim()) {
      obj.status = 'new';
    }
    if (obj.archived === '' || obj.archived === null || typeof obj.archived === 'undefined') {
      obj.archived = false;
    }

    appendByHeaders_(dst, obj);
  }
}

function formatNotionId_(raw) {
  const s = String(raw || '')
    .trim()
    .replace(/-/g, '');
  if (s.length !== 32 || !/^[a-f0-9]+$/i.test(s)) {
    return String(raw || '').trim();
  }
  return (
    s.slice(0, 8) +
    '-' +
    s.slice(8, 12) +
    '-' +
    s.slice(12, 16) +
    '-' +
    s.slice(16, 20) +
    '-' +
    s.slice(20, 32)
  );
}

function queryNotionDatabaseAllPages_(token, databaseIdRaw) {
  const uuid = formatNotionId_(databaseIdRaw);
  const url = 'https://api.notion.com/v1/databases/' + uuid + '/query';
  const out = [];
  let cursor;
  do {
    const body = { page_size: 100 };
    if (cursor) {
      body.start_cursor = cursor;
    }
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + token,
        'Notion-Version': '2022-06-28',
      },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    const text = res.getContentText();
    if (code !== 200) {
      throw new Error('Notion API HTTP ' + code + ': ' + text);
    }
    const data = JSON.parse(text);
    (data.results || []).forEach(function (p) {
      out.push(p);
    });
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return out;
}

function extractNotionPropertyValue_(prop) {
  if (!prop || !prop.type) {
    return '';
  }
  const t = prop.type;
  switch (t) {
    case 'title':
      return (prop.title || [])
        .map(function (r) {
          return r.plain_text || '';
        })
        .join('');
    case 'rich_text':
      return (prop.rich_text || [])
        .map(function (r) {
          return r.plain_text || '';
        })
        .join('');
    case 'number':
      return prop.number != null && prop.number !== '' ? prop.number : '';
    case 'select':
      return prop.select ? prop.select.name : '';
    case 'status':
      return prop.status ? prop.status.name : '';
    case 'multi_select':
      return (prop.multi_select || [])
        .map(function (x) {
          return x.name;
        })
        .join(', ');
    case 'date':
      if (!prop.date) {
        return '';
      }
      return prop.date.start || '';
    case 'checkbox':
      return prop.checkbox === true;
    case 'url':
      return prop.url || '';
    case 'email':
      return prop.email || '';
    case 'phone_number':
      return prop.phone_number || '';
    case 'created_time':
      return prop.created_time || '';
    case 'last_edited_time':
      return prop.last_edited_time || '';
    case 'formula': {
      const f = prop.formula;
      if (!f) {
        return '';
      }
      if (f.type === 'string') {
        return f.string || '';
      }
      if (f.type === 'number') {
        return f.number != null ? f.number : '';
      }
      if (f.type === 'boolean') {
        return f.boolean === true;
      }
      if (f.type === 'date' && f.date) {
        return f.date.start || '';
      }
      return '';
    }
    default:
      return '';
  }
}

function findNotionPropCaseInsensitive_(props, name) {
  const want = normalizeText_(name);
  for (const k in props) {
    if (Object.prototype.hasOwnProperty.call(props, k) && normalizeText_(k) === want) {
      return props[k];
    }
  }
  return null;
}

function getNotionPropertyForCasesColumn_(casesColumn, props) {
  const col = String(casesColumn || '').trim();
  if (!col) {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(IRIS_CASES_TO_NOTION_PROPERTY, col)) {
    const name = IRIS_CASES_TO_NOTION_PROPERTY[col];
    return props[name] || findNotionPropCaseInsensitive_(props, name);
  }
  if (col === 'title') {
    for (const k in props) {
      if (props[k] && props[k].type === 'title') {
        return props[k];
      }
    }
  }
  return props[col] || findNotionPropCaseInsensitive_(props, col);
}

function coerceSheetCellForCasesColumn_(header, value) {
  if (value === null || typeof value === 'undefined') {
    return '';
  }
  const h = String(header || '');
  if (['created_at', 'due_date', 'last_update'].indexOf(h) !== -1) {
    if (typeof value === 'string' && value.length > 0) {
      const d = new Date(value);
      if (!isNaN(d.getTime())) {
        return d;
      }
    }
  }
  if (h === 'archived' || h === 'consultation_required' || h === 'dd_required') {
    if (typeof value === 'boolean') {
      return value;
    }
    const s = String(value)
      .trim()
      .toLowerCase();
    if (['true', 'ano', 'yes', '1'].indexOf(s) !== -1) {
      return true;
    }
    if (['false', 'ne', 'no', '0'].indexOf(s) !== -1) {
      return false;
    }
  }
  return value;
}

function notionPageToCaseObject_(page, dstHeaders) {
  const props = page.properties || {};
  const obj = {};
  dstHeaders.forEach(function (dh) {
    const key = String(dh || '').trim();
    if (!key) {
      return;
    }
    const prop = getNotionPropertyForCasesColumn_(key, props);
    const raw = extractNotionPropertyValue_(prop);
    obj[key] = coerceSheetCellForCasesColumn_(key, raw);
  });
  return obj;
}

/**
 * Smaže datové řádky v Cases a naplní je z Notion databáze (vyžaduje NOTION_TOKEN + NOTION_DATABASE_ID ve skriptových vlastnostech).
 */
function syncNotionDatabaseToCases() {
  const sp = PropertiesService.getScriptProperties();
  const token = sp.getProperty('NOTION_TOKEN');
  const dbId = sp.getProperty('NOTION_DATABASE_ID');
  if (!token || !dbId) {
    throw new Error(
      'Nastavte ve skriptových vlastnostech NOTION_TOKEN a NOTION_DATABASE_ID a databázi v Notion připojte k integraci (Connections).'
    );
  }

  const pages = queryNotionDatabaseAllPages_(token, dbId);
  clearCasesDataRowsOnly();

  const ss = SpreadsheetApp.openById(IRIS_CONFIG.spreadsheetId);
  const dst = ss.getSheetByName(IRIS_CONFIG.sheets.cases);
  if (!dst) {
    throw new Error('List Cases nenalezen.');
  }
  const dstHeaders = dst.getRange(1, 1, 1, dst.getLastColumn()).getValues()[0];

  pages.forEach(function (page) {
    const obj = notionPageToCaseObject_(page, dstHeaders);
    if (!String(obj.case_id || '').trim()) {
      obj.case_id = generateSequentialId_(dst, 'CASE');
    }
    if (!obj.created_at) {
      obj.created_at = new Date();
    }
    if (!String(obj.status || '').trim()) {
      obj.status = 'new';
    }
    if (obj.archived === '' || obj.archived === null || typeof obj.archived === 'undefined') {
      obj.archived = false;
    }
    appendByHeaders_(dst, obj);
  });
}

/* ---------- Helpers ---------- */

function appendByHeaders_(sheet, rowObject) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = headers.map(header =>
    Object.prototype.hasOwnProperty.call(rowObject, header) ? rowObject[header] : ''
  );
  sheet.appendRow(row);
}

function generateSequentialId_(sheet, prefix) {
  const values = sheet.getDataRange().getValues();
  const year = new Date().getFullYear();
  let maxNum = 0;

  for (let i = 1; i < values.length; i++) {
    const cell = String(values[i][0] || '');
    const match = cell.match(new RegExp('^' + prefix + '-' + year + '-(\\d+)$'));
    if (match) {
      maxNum = Math.max(maxNum, Number(match[1]));
    }
  }

  return prefix + '-' + year + '-' + String(maxNum + 1).padStart(3, '0');
}

function validateRequiredFields_(data, fields) {
  const missing = fields.filter(field => !String(data[field] || '').trim());
  if (missing.length) {
    throw new Error('Chybí povinná pole: ' + missing.join(', '));
  }
}

function parseJsonBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error('Chybí POST data.');
  }
  return JSON.parse(e.postData.contents);
}

function buildCaseTitle_(data) {
  return (data.cooperation_type || 'Případ') + ' – ' + (data.partner_name || 'bez partnera');
}

function normalizeYesNo_(value) {
  return isYes_(value) ? 'ano' : 'ne';
}

function isYes_(value) {
  return ['ano', 'yes', 'true', '1'].includes(String(value || '').trim().toLowerCase());
}

function addWorkDays_(startDate, workDays) {
  const date = new Date(startDate);
  let added = 0;
  while (added < workDays) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return date;
}

function jsonResponse_(status, payload) {
  return ContentService.createTextOutput(JSON.stringify({ status, ...payload })).setMimeType(
    ContentService.MimeType.JSON
  );
}

function getSheetObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0];

  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = row[index];
    });
    return obj;
  });
}

function countBy_(rows, fieldName) {
  return rows.reduce((acc, row) => {
    const key = String(row[fieldName] || 'neuvedeno');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function getParam_(e, name) {
  return e && e.parameter && e.parameter[name] ? String(e.parameter[name]).trim() : '';
}

function normalizeText_(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
