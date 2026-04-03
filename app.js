const API_URL = 'https://script.google.com/macros/s/AKfycbyN8uGoqSqqH26K7eBzTx-QmE08e-27fWJRws5QcM6Dm6dl2NEGAygFak9T7X0rzYpZ6Q/exec';

const form = document.getElementById('intakeForm');
const submitButton = document.getElementById('submitButton');
const fillDemoButton = document.getElementById('fillDemoButton');

const statusMessage = document.getElementById('statusMessage');
const resultDetails = document.getElementById('resultDetails');
const caseIdValue = document.getElementById('caseIdValue');
const intakeIdValue = document.getElementById('intakeIdValue');
const resultValue = document.getElementById('resultValue');
const scoreValue = document.getElementById('scoreValue');

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
  return {
    applicant_name: form.applicant_name.value.trim(),
    applicant_email: form.applicant_email.value.trim(),
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
    involves_doctoral_students_or_infrastructure: checkboxToYesNo('involves_doctoral_students_or_infrastructure')
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
    ['partner_country', 'Země partnera'],
    ['intent_description', 'Popis záměru']
  ];

  for (const [key, label] of requiredFields) {
    if (!String(data[key] || '').trim()) {
      throw new Error(`Vyplňte pole: ${label}`);
    }
  }
}

async function submitForm(event) {
  event.preventDefault();
  hideResult();

  const payload = collectFormData();

  try {
    validateFormData(payload);

    submitButton.disabled = true;
    setStatus('Odesílání checklistu do systému IRIS UHK…', 'neutral');

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.message || 'Nepodařilo se odeslat formulář.');
    }

    showResult(data);

    if (
      typeof data.preliminary_risk_score === 'number' &&
      data.preliminary_risk_score >= 6
    ) {
      setStatus('Checklist byl přijat. Případ vyžaduje eskalaci nebo rozšířenou DD.', 'warning');
    } else {
      setStatus('Checklist byl úspěšně odeslán a případ byl založen.', 'success');
    }

    form.reset();
  } catch (error) {
    setStatus(error.message || 'Došlo k chybě při odeslání.', 'error');
  } finally {
    submitButton.disabled = false;
  }
}

function fillDemoData() {
  form.applicant_name.value = 'Jan Novák';
  form.applicant_email.value = 'hana.tomaskova@uhk.cz';
  form.applicant_unit.value = 'FIM';
  form.cooperation_type.value = 'výzkumná spolupráce';
  form.cooperation_stage.value = 'příprava MoU';
  form.partner_name.value = 'Example Institute';
  form.partner_country.value = 'Čína';
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
