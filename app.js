/**
 * IRIS UHK – frontend
 *
 * Očekávané rozšíření Google Apps Script (stejný deploy URL jako dosud):
 *
 * 1) POST JSON: { "action": "login", "email": "...", "password": "...", "role": "user" | "manager" }
 *    → { "ok": true, "role": "user"|"manager", "email": "...", "manager_key"?, "is_admin"?, "can_delete_submissions"? }
 *    (is_admin při role admin; can_delete_submissions při role admin nebo iris_manager – tlačítko smazání případu.)
 *
 * 2) GET  ?action=cases&applicant_email=…  = jen případy žadatele (bez manager_key).
 *    GET  ?action=cases&manager_key=…      = plný seznam (Script Property IRIS_MANAGER_KEY).
 *    GET  ?action=dashboard&manager_key=…  = metriky jen pro správce.
 *
 * 3) POST { action: 'register', name, email, password } – založí řádek v Users (žadatel).
 *
 * 4) POST intake: server ověří, že applicant_email patří aktivnímu řádku Users (role user).
 *    Výjimka: test_intake: true + platný manager_key → testovací podání správce (bez Users).
 *
 * 5) POST { action: 'update_case', manager_key, case_id, manager_email, status?, … } – úprava případu (správce).
 * 6) POST { action: 'delete_submission', manager_key, admin_email, case_id } – smazání případu (Users: admin nebo iris_manager).
 * 7) POST { action: 'submit_person_analysis', manager_key, manager_email, … } – podnět (submission_channel=manager).
 * 8) POST { action: 'submit_applicant_person_vetting', applicant_email, applicant_name, … } – podání prověrky FO (submission_channel=applicant).
 *
 * Frontend: index.html načítá iris-prompts.js (šablony pro ChatGPT/Claude) před tímto souborem – při nasazení je přiložte.
 */

const API_URL =
  'https://script.google.com/macros/s/AKfycbyN8uGoqSqqH26K7eBzTx-QmE08e-27fWJRws5QcM6Dm6dl2NEGAygFak9T7X0rzYpZ6Q/exec';

const SESSION_KEY = 'iris_uhk_session';
const INTAKE_DRAFT_PREFIX = 'iris_intake_draft_v2_';
const PERSON_VETTING_DRAFT_PREFIX = 'iris_person_vetting_draft_v1_';

const LANG_STORAGE = 'iris_uhk_lang';
/** @type {'cs' | 'en'} */
let currentLang = 'cs';

const STRINGS = {
  cs: {
    'page.title': 'IRIS UHK – Vstupní checklist',
    'aria.lang': 'Jazyk / Language',
    'login.eyebrow': 'Institucionální bezpečnost',
    'login.h1': 'IRIS UHK',
    'login.leadHtml':
      '<strong>První vstup:</strong> žádost o přístup s vlastním heslem → účet typu <em>žadatel (User)</em>. Role správce přiřadí pouze IRIS Manager v tabulce Users.',
    'login.step1': 'Žádost o přístup + heslo',
    'login.step2': 'Přihlášení žadatele',
    'login.step3': 'Checklist a sledování stavu / termínů',
    'login.tabRegister': 'Žádost o přístup',
    'login.tabUser': 'Přihlášení žadatele',
    'login.tabManager': 'IRIS Manager',
    'login.labelName': 'Jméno a příjmení *',
    'login.phName': 'např. Jan Novák',
    'login.labelEmail': 'E-mail (pracovní @uhk.cz) *',
    'login.phEmail': 'jmeno@uhk.cz',
    'login.labelPassword': 'Heslo *',
    'login.labelPassword2': 'Potvrzení hesla *',
    'login.hintPassword': 'Minimálně 8 znaků. Účet vznikne jako <strong>User</strong> ihned; stejné údaje použijete u přihlášení žadatele.',
    'login.submitRegister': 'Odeslat žádost o přístup',
    'login.labelUserEmail': 'E-mail (stejný jako u podání)',
    'login.hintUser': 'Použijte e-mail a heslo z žádosti o přístup.',
    'login.submitUser': 'Přihlásit se',
    'login.labelMgrEmail': 'E-mail (účet správce)',
    'login.phMgrEmail': 'iris.manager@uhk.cz',
    'login.submitManager': 'Přihlásit se jako správce',
    'app.eyebrow': 'Institucionální bezpečnost',
    'app.title': 'IRIS UHK – vstupní checklist',
    'app.subtitle':
      'Předběžné vyhodnocení rizikovosti mezinárodní aktivity a založení případu do evidence.',
    'app.logout': 'Odhlásit se',
    'user.intakeTitle': 'Vyplnění podání',
    'user.intakeDesc': 'Vyplňte základní údaje o zamýšlené aktivitě a partnerovi.',
    'user.pvTitle': 'Podání prověrky fyzické osoby',
    'user.pvLead':
      'Žádost o zahájení / zařazení prověrky fyzické osoby v režimu IRIS. Vyplňte známé veřejné údaje o prověřované osobě a stručný popis věci.',
    'user.pvHintOsint':
      'Uvádějte zejména informace legálně dostupné z otevřených zdrojů. Citlivé údaje nad rámec běžně zveřejňovaných zde nevyplňujte.',
    'user.pvLegendRequester': 'Žadatel',
    'user.pvLblRequesterName': 'Jméno a příjmení žadatele *',
    'user.pvLblRequesterEmail': 'E-mail žadatele *',
    'user.pvLegendLink': 'Vazba na stávající případ (nepovinné)',
    'user.pvLblSummary': 'Důvod a rozsah požadované prověrky *',
    'user.pvSubmit': 'Odeslat podání prověrky',
    'user.pvReset': 'Vymazat formulář',
    'user.pvOk': 'Podání bylo přijato. ID záznamu: {id}',
    'user.pvFail': 'Podání se nepodařilo odeslat.',
    'user.lblApplicantName': 'Jméno žadatele *',
    'user.lblApplicantEmail': 'E-mail žadatele *',
    'user.titleEmailReadonly': 'E-mail je vázán na přihlášení',
    'user.lblUnit': 'Součást / fakulta / útvar *',
    'user.lblCoopType': 'Typ spolupráce *',
    'user.lblStage': 'Fáze spolupráce *',
    'user.lblPartner': 'Název partnera *',
    'user.lblCountry': 'Země partnera / zapojené země *',
    'user.phCountry': 'např. Čína; Německo',
    'user.hintCountry': 'Při více zemích je oddělte čárkou, středníkem nebo lomítkem.',
    'user.lblWebsite': 'Web partnera',
    'user.phUrl': 'https://…',
    'user.lblIntent': 'Popis záměru *',
    'user.legendRisk': 'Rizikové indikátory',
    'user.riskFunding': 'Externí financování',
    'user.riskSystems': 'Přístup do systémů UHK',
    'user.riskShare': 'Sdílení dat / know-how',
    'user.riskSensitive': 'Citlivé výstupy / citlivá oblast',
    'user.riskNonEu': 'Přenos mimo EU',
    'user.riskTraining': 'Technická pomoc / školení',
    'user.riskPhd': 'Zapojení infrastruktury / doktorandů',
    'user.submit': 'Odeslat checklist',
    'user.demo': 'Vyplnit ukázková data',
    'user.clear': 'Vymazat',
    'user.casesTitle': 'Moje podání',
    'user.casesDesc': 'Pouze případy pod vaším přihlášeným e-mailem.',
    'user.resultTitle': 'Výsledek odeslání',
    'user.resultDesc': 'Okamžitá zpětná vazba po odeslání checklistu.',
    'user.statusNone': 'Formulář ještě nebyl odeslán.',
    'user.lblCaseId': 'Case ID',
    'user.lblRecordUid': 'Jednoznačné referenční ID',
    'user.lblIntakeId': 'Intake ID',
    'user.lblPrelim': 'Předběžný výsledek',
    'user.lblScore': 'Skóre',
    'user.workflowTitle': 'Workflow',
    'user.workflowDesc': 'Checklist → Case → Posouzení',
    'user.workflowDeadlines': 'Lhůty',
    'user.workflowDeadlinesVal': 'u každého případu v tabulce; dle metodiky IRIS',
    'tbl.caseId': 'Case ID',
    'tbl.refUid': 'Referenční ID',
    'tbl.refUidShort': 'Ref. ID',
    'tbl.created': 'Vytvořeno',
    'tbl.name': 'Název',
    'tbl.partner': 'Partner',
    'tbl.status': 'Stav',
    'tbl.due': 'Termín (lhůta)',
    'tbl.next': 'Další postup',
    'tbl.iris': 'Vyjádření IRIS',
    'tbl.analysis': 'Analýza',
    'tbl.dueShort': 'Termín',
    'tbl.applicant': 'Žadatel',
    'tbl.priority': 'Priorita',
    'tbl.risk': 'Riziko',
    'tbl.actions': '',
    'common.select': 'Vyberte',
    'common.open': 'otevřít',
    'common.loading': 'Načítání…',
    'common.emDash': '—',
    'coop.research': 'Výzkumná spolupráce',
    'coop.education': 'Vzdělávací spolupráce',
    'coop.mou': 'Memorandum / MoU',
    'coop.mobility': 'Mobilita / hostování',
    'coop.gift': 'Dar / sponzoring',
    'coop.data': 'Sdílení dat / know-how',
    'coop.other': 'Jiné',
    'stage.idea': 'Prvotní úvaha',
    'stage.prelim': 'Předběžné jednání',
    'stage.mouPrep': 'Příprava MoU',
    'stage.contractPrep': 'Příprava smlouvy',
    'stage.impl': 'Realizace',
    'manager.title': 'Přehled případů',
    'manager.desc': 'Základní dashboard a seznam případů napříč organizací.',
    'manager.statTotal': 'Celkem',
    'manager.statOpen': 'Otevřené',
    'manager.statDueSoon': 'Blíží se termín',
    'manager.statClosed': 'Uzavřené',
    'manager.statOverdue': 'Po termínu',
    'manager.statAnalysisOverdue': 'Další analýza: po termínu',
    'manager.statAnalysisSoon': 'Další analýza: blíží se',
    'manager.searchPh': 'Hledat (referenční ID, Case ID, název…)',
    'manager.searchAria': 'Hledat v případech',
    'filter.allStatus': 'Všechny stavy',
    'filter.allPri': 'Všechny priority',
    'pri.low': 'Nízká',
    'pri.mid': 'Střední',
    'pri.high': 'Vysoká',
    'manager.refresh': 'Obnovit',
    'manager.loadingCases': 'Načítání případů…',
    'manager.empty': 'Nebyly nalezeny žádné případy.',
    'manager.manage': 'Spravovat',
    'user.empty': 'Zatím nemáte žádné podání.',
    'user.loadingRow': 'Načítání…',
    'manager.panelTitle': 'Úprava případu',
    'manager.lblStatus': 'Stav případu',
    'manager.lblDue': 'Termín / lhůta (další milník)',
    'manager.lblNext': 'Další postup pro žadatele (co a kdy očekávat)',
    'manager.phNext': 'Dle metodiky IRIS – stručně lhůty a krok.',
    'manager.lblStatement': 'Vyjádření IRIS k případu',
    'manager.phStatement': 'Shrnutí pro žadatele, odkaz na metodiku.',
    'manager.lblAnalysisUrl': 'Odkaz na zprávu / analýzu (Drive, SharePoint…)',
    'manager.lblFile': 'Nebo nahrát soubor (PDF; vyžaduje složku Drive ve skriptu)',
    'manager.save': 'Uložit změny',
    'manager.close': 'Zavřít',
    'status.new': 'Nový',
    'status.under_review': 'V posouzení',
    'status.dd_in_progress': 'Probíhá DD',
    'status.case_handling': 'Řeší se',
    'status.analysis_in_progress': 'Probíhá analýza',
    'status.closed': 'Uzavřeno',
    'status.waiting_internal_opinion': 'Čeká na interní stanovisko',
    'status.ready_for_decision': 'Připraveno k rozhodnutí',
    'next.new': 'Případ je v evidenci; IRIS stanoví další krok v obvyklé lhůtě (viz metodika).',
    'next.under_review': 'Probíhá posouzení; vyčkejte na vyjádření nebo termín v řádku výše.',
    'next.dd_in_progress': 'Probíhá due diligence / rozšířená prověrka dle metodiky.',
    'next.case_handling': 'Případ se aktivně řeší na straně IRIS / prorektorátu.',
    'next.analysis_in_progress': 'Probíhá analýza; po dokončení obdržíte odkaz nebo vyjádření.',
    'next.closed': 'Případ je uzavřen; případné podklady najdete u odkazu na analýzu.',
    'next.waiting_internal_opinion': 'Čeká se na interní stanovisko součásti.',
    'next.ready_for_decision': 'Případ je připraven k rozhodnutí; sledujte termín a vyjádření.',
    'next.default': 'Sledujte stav případu a e-mailové upozornění od IRIS.',
    'due.overdue': 'po termínu',
    'due.today': 'dnes',
    'due.inDays': 'za {n} d.',
    'session.manager': 'IRIS Manager',
    'session.applicant': 'Žadatel',
    'session.testerSuffix': 'test žadatele',
    'manager.enterTesterMode': 'Režim žadatele (test)',
    'manager.exitTesterMode': 'Zpět na správce',
    'manager.testerBanner':
      'Testovací režim: checklist se odešle jako zkušební podání. Klíč správce se po prvním přihlášení v Apps Scriptu vytvoří automaticky; pokud chyba přetrvává, odhlaste se a přihlaste znovu jako IRIS Manager. E-mail žadatele lze upravit (např. testovací účet @uhk.cz).',
    'err.testIntakeNoKey':
      'Nelze odeslat testovací podání: v relaci chybí manager_key. Nasaděte aktuální Apps Script, odhlaste se a přihlaste znovu jako IRIS Manager (nebo u PIN režimu vyplňte MANAGER_STATIC_KEY stejně jako IRIS_MANAGER_KEY ve skriptu).',
    'err.passwordMismatch': 'Hesla se neshodují.',
    'err.passwordShort': 'Heslo musí mít alespoň 8 znaků.',
    'reg.successDefault':
      'Účet byl založen. Přepněte na „Přihlášení žadatele“ a přihlaste se stejným e-mailem a heslem.',
    'reg.fail': 'Registrace se nezdařila.',
    'reg.network': 'Chyba spojení. Zkuste to znovu nebo kontaktujte správce IRIS.',
    'login.userFail':
      'Přihlášení se nezdařilo. Zkontrolujte údaje nebo zda je v Apps Scriptu implementována akce login.',
    'login.mgrFailPin': 'Neplatné heslo nebo chyba serveru.',
    'login.mgrFailSetup':
      'Přihlášení správce se nezdařilo. V app.js nastavte MANAGER_FALLBACK_CODE (dočasně) nebo doplňte login v Apps Scriptu.',
    'login.mgrKeyMissing':
      'Server nevrátil manager_key (zastaralá verze Apps Scriptu nebo chyba odpovědi). Aktualizujte nasazený skript a přihlaste se znovu jako správce.',
    'err.userOnlySubmit': 'Checklist mohou odesílat pouze přihlášení žadatelé.',
    'validate.applicant_name': 'Jméno žadatele',
    'validate.applicant_email': 'E-mail žadatele',
    'validate.applicant_unit': 'Součást / fakulta / útvar',
    'validate.cooperation_type': 'Typ spolupráce',
    'validate.cooperation_stage': 'Fáze spolupráce',
    'validate.partner_name': 'Název partnera',
    'validate.partner_country': 'Země partnera / zapojené země',
    'validate.intent_description': 'Popis záměru',
    'validate.fill': 'Vyplňte pole: {field}',
    'submit.sending': 'Odesílání checklistu do systému IRIS UHK…',
    'submit.fail': 'Nepodařilo se odeslat formulář.',
    'submit.escalation': 'Checklist byl přijat. Případ vyžaduje eskalaci nebo rozšířenou DD.',
    'submit.success': 'Checklist byl úspěšně odeslán a případ byl založen.',
    'submit.error': 'Došlo k chybě při odeslání.',
    'demo.filled': 'Ukázková data byla doplněna.',
    'file.readFail': 'Soubor se nepodařilo načíst.',
    'file.tooBig': 'Soubor je příliš velký (max. cca 8 MB). Vložte odkaz ručně.',
    'file.readErr': 'Chyba při čtení souboru.',
    'case.saveFail': 'Uložení se nezdařilo.',
    'case.saved': 'Případ byl uložen.',
    'case.editPrefix': 'Úprava případu:',
    'dash.loadFail': 'Nepodařilo se načíst dashboard.',
    'cases.loadFail': 'Nepodařilo se načíst případy.',
    'cases.userLoadFail': 'Nepodařilo se načíst vaše podání.',
    'user.requestRefHint':
      'Toto jednoznačné ID (UUID) najdete v aplikaci v „Moje podání“ – zadejte ho do vyhledávání. Case ID může být u starších záznamů zdvojené; referenční ID je vždy unikátní.',
    'user.copyRequestRef': 'Zkopírovat referenční ID',
    'user.downloadRefTxt': 'Stáhnout .txt',
    'user.refDownloadTitle': 'IRIS UHK – potvrzení podání',
    'user.refDownloadUidLabel': 'Jednoznačné referenční ID (vyhledání v aplikaci → Moje podání):',
    'user.refDownloadHint':
      'Do pole „Hledat“ v sekci Moje podání vložte celé referenční ID – zobrazí se přesně jeden záznam.',
    'user.casesSearchPh': 'Hledat (referenční ID, Case ID, název…)',
    'user.casesSearchAria': 'Hledat v mých podáních',
    'user.copied': 'Referenční ID bylo zkopírováno do schránky.',
    'user.copyFail': 'Kopírování se nezdařilo. Vyberte a zkopírujte kód ručně (Ctrl+C).',
    'manager.reminder.body':
      'Metodika IRIS předpokládá pravidelnou aktualizaci rizikové analýzy (obnova / follow-up při změně okolností). Analytické zprávy doplňujte strukturovaně (předmět, rozsah, závěr, doporučení, plán obnovy).',
    'manager.reminder.counts':
      'Otevřené případy: po lhůtě milníku {mOverdue}, blíží se termín {mSoon}. Plánovaná další analýza: po termínu {aOverdue}, blíží se {aSoon}.',
    'manager.workflowSuggestTitle': 'Návrh postupu podle vstupního checklistu',
    'manager.workflowRecommendStatus': 'Doporučený stav',
    'manager.suggest.review':
      'Nízké skóre a bez povinné DD – standardní vstupní posouzení; pokračujte ve stavu <strong>V posouzení</strong> nebo <strong>Řeší se</strong> dle metodiky.',
    'manager.suggest.analysis':
      'Střední riziko / indikátory – zvažte posun na stav <strong>Probíhá analýza</strong> a vypracování analytické zprávy v obvyklé struktuře (srov. typové zprávy IRIS UHK).',
    'manager.suggest.deep':
      'Vyžadována rozšířená prověrka (DD) – zvažte stav <strong>Probíhá DD</strong> (hlubší analýza, rozšířené šetření dle metodiky IRIS).',
    'manager.quickClose': 'Uzavřít případ',
    'manager.quickAnalysis': 'Posunout k analýze',
    'manager.quickDeep': 'Posunout k hluboké analýze (DD)',
    'manager.riskFieldsetLegend': 'Vyhodnocení rizika po prověrce',
    'manager.riskFieldsetHint':
      'Po interní prověrce můžete upravit údaje z checklistu. Hodnota v sloupci „Riziko“ v přehledu odpovídá zvolené úrovni níže.',
    'manager.lblRiskLevel': 'Úroveň rizika',
    'manager.lblPreliminaryScore': 'Skóre z checklistu (0–99)',
    'manager.phRiskScore': 'např. 6',
    'manager.lblPreliminaryResult': 'Předběžné vyhodnocení (automatický text z podání)',
    'manager.phPreliminaryResult': 'Text z podání; po prověrce ho můžete upravit.',
    'manager.lblFinalOutcome': 'Závěr IRIS po prověrce',
    'manager.phFinalOutcome': 'Stručný závěr pro evidenci (sloupec final_outcome v listu Cases).',
    'manager.riskLow': 'nízké',
    'manager.riskMed': 'střední',
    'manager.riskHigh': 'vysoké',
    'manager.riskNA': 'nehodnoceno',
    'manager.quickActionDone': 'Stav, další postup a termín byly nastaveny. Uložte změny tlačítkem „Uložit změny“.',
    'manager.milestonesLegend': 'Procesní milníky (návrh dle metodiky)',
    'manager.milestonesHint':
      'Orientační termíny – upravte podle případu. Pole „Termín / lhůta“ se předvyplní nejbližším milníkem, pokud v evidenci chybí termín.',
    'manager.milestoneClosure': 'Cílový termín uzavření / rozhodnutí (orientačně)',
    'manager.milestoneRecurrence': 'Opakovaná kontrola / obnova analýzy',
    'manager.milestoneDeep': 'Hlubší due diligence (DD)',
    'manager.milestoneSuggested': 'návrh data',
    'manager.riskDomainsHint': 'Odhad rizika podle oblastí pro správu případu (uloží se do listu Cases).',
    'manager.lblRiskReputational': 'Reputační riziko',
    'manager.lblRiskLegal': 'Právní riziko',
    'manager.lblRiskFinancial': 'Finanční riziko',
    'manager.lblRiskSecurity': 'Bezpečnostní riziko',
    'manager.lblRiskEthical': 'Etické riziko',
    'manager.lblRiskOther': 'Jiné riziko (IP / compliance / GDPR)',
    'manager.riskColHint': 'Barva odpovídá uložené úrovni rizika v panelu Úprava případu (po uložení a obnovení seznamu).',
    'manager.sectionBadgeIntake': 'Check-list',
    'manager.sectionBadgePrompts': 'Prompty / AI',
    'manager.sectionBadgeAdmin': 'Správce IRIS',
    'manager.sectionBadgeOutput': 'Analýza / DD',
    'manager.sectionAdminTitle': 'Úpravy správce a komunikace s žadatelem',
    'manager.sectionAdminLead':
      'Rychlé posuny stavu, termíny, vyjádření a doplnění rizika po interní prověrce (odděleně od vstupu z check-listu).',
    'manager.sectionOutputTitle': 'Analytická zpráva a závěry',
    'manager.sectionOutputLead': 'Strukturovaná zpráva dle metodiky IRIS, závěr do evidence a plán obnovy analýzy.',
    'manager.intakeScoreHint': 'hodnota z podání',
    'manager.intakeSummaryTitle': 'Shrnutí podaného podnětu',
    'manager.intakePrelimFieldHint': 'Úprava pro evidenci (pole preliminary_result v listu Cases).',
    'manager.intakeSummaryEmpty': 'K tomuto případu nejsou v aplikaci k dispozici další údaje z check-listu (zkontrolujte list Intake v tabulce).',
    'manager.sumCaseId': 'Case ID',
    'manager.sumSourceIntake': 'Intake ID',
    'manager.sumCaseTitle': 'Předmět / název případu',
    'manager.sumApplicant': 'Žadatel',
    'manager.sumUnit': 'Jednotka / ústav',
    'manager.sumPartner': 'Partner',
    'manager.sumCountry': 'Země partnera',
    'manager.sumPartnerWeb': 'Web partnera',
    'manager.sumCoopType': 'Typ spolupráce',
    'manager.sumCoopStage': 'Fáze spolupráce',
    'manager.sumIntent': 'Záměr spolupráce',
    'manager.sumIndicators': 'Indikátory z check-listu',
    'manager.sumCountryRisk': 'Kategorie rizika země',
    'manager.sumCountryMatch': 'Shody země',
    'manager.sumAutoFlags': 'Automatické příznaky',
    'manager.sumPreliminaryAuto': 'Předběžný výsledek (z podání)',
    'manager.sumScoreAuto': 'Skóre z podání (0–99)',
    'methodology.applicantInstSummary':
      'Chcete zobrazit metodické pokyny pro žadatele? (check-list institucí a organizací)',
    'methodology.applicantPersonSummary':
      'Chcete zobrazit metodické pokyny pro žadatele? (check-list fyzických osob)',
    'methodology.managerInstSummary':
      'Chcete zobrazit metodické pokyny pro správce IRIS? (check-list institucí a organizací)',
    'methodology.managerPersonSummary':
      'Chcete zobrazit metodické pokyny pro správce IRIS? (check-list fyzických osob)',
    'manager.promptUiTitle': 'Prompt pro AI (ChatGPT / Claude)',
    'manager.promptUiLead':
      'Otevře okno s celým textem promptu. Do textu se doplní údaje případu z tabulky i z polí tohoto panelu (i před uložením).',
    'manager.promptUiBtnGpt': 'ChatGPT – předběžná prověrka partnera',
    'manager.promptUiBtnClaude': 'Claude – finální analytická zpráva',
    'manager.promptUiBtnSanctions': 'Claude – sankční screening',
    'manager.promptDialogTitleGpt': 'Prompt pro ChatGPT',
    'manager.promptDialogTitleClaude': 'Prompt pro Claude – analytická zpráva',
    'manager.promptDialogTitleSanctions': 'Prompt pro Claude – sankční screening',
    'manager.promptDialogTip':
      'Označte celý text (Ctrl+A) a zkopírujte, nebo použijte tlačítko níže.',
    'manager.promptDialogCopy': 'Kopírovat do schránky',
    'manager.promptDialogClose': 'Zavřít',
    'manager.promptCopied': 'Zkopírováno do schránky.',
    'manager.promptCopyFail': 'Kopírování se nezdařilo (oprávnění prohlížeče?).',
    'manager.promptMissingTemplates':
      'Chybí soubor iris-prompts.js nebo šablony. Nahrajte iris-prompts.js spolu s index.html, nebo kontaktujte správce.',
    'manager.promptNeedCase': 'Nejprve otevřete případ v tabulce (tlačítko Spravovat).',
    'manager.preset.close':
      'Případ byl uzavřen. Dokumentaci a případné podmínky naleznete u odkazu na analýzu v systému IRIS.',
    'manager.preset.analysis':
      'Případ předán k vypracování analytické zprávy v standardním rozsahu dle metodiky IRIS UHK.',
    'manager.preset.deep':
      'Zahájena rozšířená prověrka / due diligence (hlubší analýza dle metodiky IRIS UHK).',
    'manager.lblAnalysisSubject': 'Předmět prověrky / věc',
    'manager.phAnalysisSubject': 'Stručně: partner, předmět spolupráce, kontext…',
    'manager.lblAnalysisScope': 'Rozsah posouzení a metodika',
    'manager.phAnalysisScope': 'Rámcová metodika IRIS, rozsah šetření, použité zdroje (OpenSanctions, veřejné registry…).',
    'manager.lblAnalysisConclusion': 'Závěr k rizikovosti',
    'manager.phAnalysisConclusion': 'Kategorizace rizika v kontextu UHK a navazujících předpisů.',
    'manager.lblAnalysisRecs': 'Doporučení a podmínky',
    'manager.phAnalysisRecs': 'Mitigace, podmínky pro pokračování spolupráce, vazba na smluvní dokumentaci.',
    'manager.lblAnalysisRecurrence': 'Obnova analýzy / follow-up',
    'manager.phAnalysisRecurrence':
      'Kdy provést analýzu znovu (změna partnera, nová smlouva, uplynutí platnosti závěru…).',
    'manager.lblNextAnalysisDue': 'Plánovaný termín další analýzy',
    'manager.analysisFieldsetLegend': 'Analytická zpráva (struktura dle metodiky IRIS)',
    'manager.analysisFieldsetHint':
      'Struktura odpovídá běžným prověrkám a analytickým zprávám IRIS UHK (předmět, rozsah, závěr, doporučení, plán obnovy).',
    'manager.reminderRegion': 'Připomenutí pro správce IRIS',
    'session.adminSuffix': 'Admin',
    'admin.subNavAria': 'Navigace správce',
    'admin.navIris': 'Přehled IRIS',
    /** Zpětná kompatibilita: starší index.html používal data-i18n="admin.navInstitutions" / "admin.navVetting". */
    'admin.navInstitutions': 'Instituce a organizace',
    'admin.navVetting': 'Osoby',
    'manager.hubTitle': 'Rozcestník',
    'manager.hubLead':
      'Metodické check-listy pro prověřování subjektů. Přehled případů a dashboard IRIS otevřete záložkou „Přehled IRIS“.',
    'manager.hubLeadAdmin':
      'Přehled případů IRIS a evidence prověrek osob (PAR). Pracujte ve správě případů a v tabulce PAR podle oprávnění účtu.',
    'manager.hubDashTileTitle': 'Přehled případů (IRIS)',
    'manager.hubDashTileDesc': 'Dashboard, seznam případů a úpravy záznamů v režimu IRIS.',
    'manager.hubParTileTitle': 'Evidence prověrek osob (PAR)',
    'manager.hubParTileDesc': 'Záznamy z listu Person_Analysis_Requests.',
    'manager.navPar': 'Evidence PAR',
    'manager.hubInstitutionsTitle': 'Check-list institucí a organizací',
    'manager.hubInstitutionsDesc': 'Základní rámec DD a OSINT pro právnické osoby a partnery.',
    'manager.hubPersonsTitle': 'Check-list osob',
    'manager.hubPersonsDesc': 'Základy prověrky fyzických osob (OSINT, due diligence).',
    'manager.navInstitutions': 'Instituce a organizace',
    'manager.navPersons': 'Osoby',
    'manager.hubPersonAnalysisTitle': 'Podněty k analýze osob',
    'manager.hubPersonAnalysisDesc': 'Formulář: osoba, veřejné identifikátory, uložení do tabulky Person_Analysis_Requests.',
    'manager.navPersonAnalysis': 'Podněty k analýze',
    'manager.paTitle': 'Podněty k analýze osob (správce)',
    'manager.paLead':
      'Interní záznam pro koordinaci analýzy fyzické osoby (list Person_Analysis_Requests; sloupec submission_channel = manager). Žadatelé mají vlastní formulář „Podání prověrky fyzické osoby“.',
    'manager.paHintIdentifiers':
      'Vyplňte pouze údaje legálně dostupné z otevřených zdrojů (metodika OSINT). Citlivé osobní údaje nad rámec veřejného profilu zde neuvádějte.',
    'manager.paLegendLink': 'Vazba na případ (nepovinné)',
    'manager.paLblCaseId': 'Case ID',
    'manager.paPhCaseId': 'např. CASE-2026-042',
    'manager.paLblRecordUid': 'Referenční ID',
    'manager.paLegendSubject': 'Prověřovaná osoba',
    'manager.paLblLegalName': 'Jméno a příjmení (oficiální zápis) *',
    'manager.paLblAltNames': 'Alternativní zápisy / příjmení / transliterace',
    'manager.paLblDob': 'Rok nebo datum narození (pokud je veřejně známé)',
    'manager.paLblCitizenship': 'Státní příslušnost (veřejně uváděná)',
    'manager.paLblResidence': 'Země / region obvyklého působení',
    'manager.paLblAffiliation': 'Instituce / zaměstnavatel v kontextu věci',
    'manager.paLblRole': 'Role vůči UHK (např. hostující výzkumník, řešitel, expert)',
    'manager.paLegendIds': 'Veřejné identifikátory a profily (OSINT)',
    'manager.paHintIds':
      'Typicky dohledatelné: ORCID, Scopus Author ID, ResearcherID (WoS), Google Scholar, LinkedIn, oficiální profil na webu instituce.',
    'manager.paLblOrcid': 'ORCID',
    'manager.paLblScopus': 'Scopus Author ID',
    'manager.paLblWos': 'Web of Science ResearcherID',
    'manager.paLblScholar': 'URL profilu Google Scholar',
    'manager.paLblLinkedin': 'URL veřejného profilu LinkedIn',
    'manager.paLblInstProfiles': 'URL institucionálních profilů (jeden na řádek)',
    'manager.paLblOtherUrls': 'Další veřejné URL (jedna na řádek)',
    'manager.paLegendRequest': 'Podnět',
    'manager.paLblSummary': 'Co má být ověřeno / kontext a cíl analýzy *',
    'manager.paLblUrgency': 'Důležitost / naléhavost',
    'manager.paUrgLow': 'Nízká',
    'manager.paUrgMed': 'Střední',
    'manager.paUrgHigh': 'Vysoká',
    'manager.paLblIdSource': 'Odkud pocházejí identifikátory (publikace, smlouva, web UHK, …)',
    'manager.paSubmit': 'Odeslat do evidence',
    'manager.paReset': 'Vymazat formulář',
    'manager.paOk': 'Podnět byl uložen. ID záznamu: {id}',
    'manager.paFail': 'Podnět se nepodařilo uložit.',
    'manager.instTitle': 'Check-list institucí a organizací',
    'manager.instLead':
      'Orientační rámec pro prověřování partnerů, institucí a právnických osob v kontextu IRIS UHK. Doplňuje vstupní checklist; nenahrazuje právní posouzení.',
    'user.saveDraft': 'Uložit rozpracované',
    'user.loadDraft': 'Načíst rozpracované',
    'user.finalizeSubmit': 'Odeslat definitivně',
    'user.draftSaved': 'Rozpracované podání uloženo v tomto prohlížeči.',
    'user.draftLoaded': 'Načten rozpracovaný koncept.',
    'user.draftNone': 'Není uložen žádný koncept pro tento účet.',
    'user.draftFail': 'Koncept se nepodařilo uložit (blokované úložiště prohlížeče?).',
    'user.hubTitle': 'Rozcestník',
    'user.hubLeadApplicant':
      'Kachlíky níže otevřou přímo formulář check-listu. Metodické pokyny si můžete rozkliknout u formuláře; v liště je také přehled vašich požadavků.',
    'user.subNavAria': 'Navigace žadatele',
    'user.navInstMethod': 'Metodika – instituce',
    'user.navPersonMethod': 'Metodika – osoby',
    'user.navInstForm': 'Check-list institucí (formulář)',
    'user.navPersonForm': 'Check-list osob (formulář)',
    'user.navRequests': 'Moje požadavky',
    'user.personMethodLead':
      'Orientační metodický podklad pro žadatele. Doplňuje rámec institucionální bezpečnosti; nenahrazuje právní posouzení ani interní směrnice Ústavu.',
    'user.requestsTitle': 'Moje požadavky',
    'user.requestsDesc':
      'Přehled checklistu institucí (případy v IRIS) a checklistu osob. Rozpracované koncepty (draft) jsou jen v tomto prohlížeči.',
    'user.requestsInstSection': 'Check-list institucí a organizací',
    'user.requestsPersonSection': 'Check-list osob',
    'tbl.typeCol': 'Typ',
    'tbl.actions': 'Akce',
    'user.parIdCol': 'ID požadavku',
    'user.parSubjectCol': 'Prověřovaná osoba',
    'user.reqTypeInst': 'Check-list institucí',
    'user.reqTypeInstDraft': 'Koncept (prohlížeč)',
    'user.reqTypePerson': 'Check-list osob',
    'user.reqTypePersonDraft': 'Koncept (prohlížeč)',
    'user.draftRowHintInst': 'Rozpracovaný formulář – uložte nebo odešlete z karty „Check-list institucí“.',
    'user.draftRowHintPerson': 'Rozpracovaný formulář – uložte nebo odešlete z karty „Check-list osob“.',
    'user.continueDraft': 'Pokračovat',
    'user.statusDraft': 'draft',
    'user.statusSubmitted': 'podáno',
    'parStatus.new': 'přijato / nový',
    'parStatus.in_progress': 'zpracovává se',
    'parStatus.analyzed': 'analyzováno',
    'parStatus.closed': 'uzavřeno',
    'parStatus.rejected': 'zamítnuto',
    'parStatus.cancelled': 'zrušeno',
    'parStatus.default': 've zpracování',
    'manager.parListTitle': 'Evidence prověrek osob (PAR)',
    'manager.parListDesc':
      'Záznamy z listu Person_Analysis_Requests. Smazání: účty s oprávněním admin / iris_manager.',
    'manager.parColChannel': 'Kanál',
    'manager.parDelete': 'Smazat PAR',
    'admin.parDeleteConfirm': 'Opravdu trvale smazat tento záznam PAR z tabulky?',
    'admin.parDeleteOk': 'Záznam PAR byl smazán.',
    'user.personReqEmpty': 'Zatím žádné podané požadavky.',
    'user.personReqLoadFail': 'Nepodařilo se načíst požadavky na prověrku osob.',
    'admin.deleteSubmission': 'Smazat podání a případ',
    'admin.deleteConfirm':
      'Opravdu trvale smazat tento případ a související řádky (podání, události, notifikace) z tabulky? Akci nelze vrátit.',
    'admin.deleteOk': 'Záznamy byly smazány.',
    'admin.deleteFail': 'Smazání se nezdařilo.',
    'admin.vettingTitle': 'Prověrky osob – základy OSINT a Due diligence',
    'admin.vettingLead':
      'Interní metodický podklad pro administrátory IRIS. Doplňuje obecný rámec institucionální bezpečnosti; nenahrazuje právní posouzení ani interní směrnice Ústavu.',
  },
  en: {
    'page.title': 'IRIS UHK – Intake checklist',
    'aria.lang': 'Language / Jazyk',
    'login.eyebrow': 'Institutional security',
    'login.h1': 'IRIS UHK',
    'login.leadHtml':
      '<strong>First-time access:</strong> request access with your own password → account type <em>applicant (User)</em>. The manager role is assigned only by an IRIS Manager in the Users table.',
    'login.step1': 'Access request + password',
    'login.step2': 'Applicant sign-in',
    'login.step3': 'Checklist and status / deadline tracking',
    'login.tabRegister': 'Request access',
    'login.tabUser': 'Applicant sign-in',
    'login.tabManager': 'IRIS Manager',
    'login.labelName': 'Full name *',
    'login.phName': 'e.g. Jan Novák',
    'login.labelEmail': 'E-mail (work @uhk.cz) *',
    'login.phEmail': 'name@uhk.cz',
    'login.labelPassword': 'Password *',
    'login.labelPassword2': 'Confirm password *',
    'login.hintPassword':
      'At least 8 characters. The account is created as <strong>User</strong> immediately; use the same credentials for applicant sign-in.',
    'login.submitRegister': 'Submit access request',
    'login.labelUserEmail': 'E-mail (same as in the request)',
    'login.hintUser': 'Use the e-mail and password from your access request.',
    'login.submitUser': 'Sign in',
    'login.labelMgrEmail': 'E-mail (manager account)',
    'login.phMgrEmail': 'iris.manager@uhk.cz',
    'login.submitManager': 'Sign in as manager',
    'app.eyebrow': 'Institutional security',
    'app.title': 'IRIS UHK – intake checklist',
    'app.subtitle':
      'Preliminary assessment of international activity risk and opening a case in the register.',
    'app.logout': 'Sign out',
    'user.intakeTitle': 'Submission',
    'user.intakeDesc': 'Enter basic information about the planned activity and partner.',
    'user.pvTitle': 'Natural person vetting request',
    'user.pvLead':
      'Request to initiate or register vetting of a natural person under IRIS. Enter publicly known details about the person and a short description of the matter.',
    'user.pvHintOsint':
      'Prefer information lawfully available from open sources. Do not enter sensitive personal data beyond what is already public.',
    'user.pvLegendRequester': 'Requesting party',
    'user.pvLblRequesterName': 'Requester full name *',
    'user.pvLblRequesterEmail': 'Requester e-mail *',
    'user.pvLegendLink': 'Link to existing case (optional)',
    'user.pvLblSummary': 'Reason and scope of vetting requested *',
    'user.pvSubmit': 'Submit vetting request',
    'user.pvReset': 'Clear form',
    'user.pvOk': 'Request received. Record ID: {id}',
    'user.pvFail': 'Could not submit the request.',
    'user.lblApplicantName': 'Applicant name *',
    'user.lblApplicantEmail': 'Applicant e-mail *',
    'user.titleEmailReadonly': 'E-mail is tied to your sign-in',
    'user.lblUnit': 'Faculty / department / unit *',
    'user.lblCoopType': 'Type of cooperation *',
    'user.lblStage': 'Stage of cooperation *',
    'user.lblPartner': 'Partner name *',
    'user.lblCountry': 'Partner countries / involved countries *',
    'user.phCountry': 'e.g. China; Germany',
    'user.hintCountry': 'If there are several countries, separate them with a comma, semicolon or slash.',
    'user.lblWebsite': 'Partner website',
    'user.phUrl': 'https://…',
    'user.lblIntent': 'Description of intent *',
    'user.legendRisk': 'Risk indicators',
    'user.riskFunding': 'External funding',
    'user.riskSystems': 'Access to UHK systems',
    'user.riskShare': 'Data / know-how sharing',
    'user.riskSensitive': 'Sensitive outputs / sensitive area',
    'user.riskNonEu': 'Transfer outside the EU',
    'user.riskTraining': 'Technical assistance / training',
    'user.riskPhd': 'Infrastructure / doctoral students involved',
    'user.submit': 'Submit checklist',
    'user.demo': 'Fill demo data',
    'user.clear': 'Clear',
    'user.casesTitle': 'My submissions',
    'user.casesDesc': 'Only cases under your signed-in e-mail.',
    'user.resultTitle': 'Submission result',
    'user.resultDesc': 'Immediate feedback after submitting the checklist.',
    'user.statusNone': 'The form has not been submitted yet.',
    'user.lblCaseId': 'Case ID',
    'user.lblRecordUid': 'Unique reference ID',
    'user.lblIntakeId': 'Intake ID',
    'user.lblPrelim': 'Preliminary outcome',
    'user.lblScore': 'Score',
    'user.workflowTitle': 'Workflow',
    'user.workflowDesc': 'Checklist → Case → Review',
    'user.workflowDeadlines': 'Deadlines',
    'user.workflowDeadlinesVal': 'per case in the table; per IRIS methodology',
    'tbl.caseId': 'Case ID',
    'tbl.refUid': 'Reference ID',
    'tbl.refUidShort': 'Ref. ID',
    'tbl.created': 'Created',
    'tbl.name': 'Title',
    'tbl.partner': 'Partner',
    'tbl.status': 'Status',
    'tbl.due': 'Deadline',
    'tbl.next': 'Next steps',
    'tbl.iris': 'IRIS statement',
    'tbl.analysis': 'Analysis',
    'tbl.dueShort': 'Due',
    'tbl.applicant': 'Applicant',
    'tbl.priority': 'Priority',
    'tbl.risk': 'Risk',
    'tbl.actions': '',
    'common.select': 'Select',
    'common.open': 'open',
    'common.loading': 'Loading…',
    'common.emDash': '—',
    'coop.research': 'Research collaboration',
    'coop.education': 'Educational collaboration',
    'coop.mou': 'Memorandum / MoU',
    'coop.mobility': 'Mobility / hosting',
    'coop.gift': 'Donation / sponsorship',
    'coop.data': 'Data / know-how sharing',
    'coop.other': 'Other',
    'stage.idea': 'Initial idea',
    'stage.prelim': 'Preliminary discussion',
    'stage.mouPrep': 'MoU preparation',
    'stage.contractPrep': 'Contract preparation',
    'stage.impl': 'Implementation',
    'manager.title': 'Case overview',
    'manager.desc': 'Basic dashboard and case list across the organisation.',
    'manager.statTotal': 'Total',
    'manager.statOpen': 'Open',
    'manager.statDueSoon': 'Due soon',
    'manager.statClosed': 'Closed',
    'manager.statOverdue': 'Overdue',
    'manager.statAnalysisOverdue': 'Next analysis: overdue',
    'manager.statAnalysisSoon': 'Next analysis: due soon',
    'manager.searchPh': 'Search (reference ID, case ID, title…)',
    'manager.searchAria': 'Search cases',
    'filter.allStatus': 'All statuses',
    'filter.allPri': 'All priorities',
    'pri.low': 'Low',
    'pri.mid': 'Medium',
    'pri.high': 'High',
    'manager.refresh': 'Refresh',
    'manager.loadingCases': 'Loading cases…',
    'manager.empty': 'No cases found.',
    'manager.manage': 'Manage',
    'user.empty': 'You have no submissions yet.',
    'user.loadingRow': 'Loading…',
    'manager.panelTitle': 'Edit case',
    'manager.lblStatus': 'Case status',
    'manager.lblDue': 'Deadline / next milestone',
    'manager.lblNext': 'Next steps for the applicant (what to expect and when)',
    'manager.phNext': 'Per IRIS methodology – briefly: deadlines and next step.',
    'manager.lblStatement': 'IRIS statement on the case',
    'manager.phStatement': 'Summary for the applicant, link to methodology.',
    'manager.lblAnalysisUrl': 'Link to report / analysis (Drive, SharePoint…)',
    'manager.lblFile': 'Or upload a file (PDF; requires Drive folder in the script)',
    'manager.save': 'Save changes',
    'manager.close': 'Close',
    'status.new': 'New',
    'status.under_review': 'Under review',
    'status.dd_in_progress': 'Due diligence in progress',
    'status.case_handling': 'In progress',
    'status.analysis_in_progress': 'Analysis in progress',
    'status.closed': 'Closed',
    'status.waiting_internal_opinion': 'Awaiting internal opinion',
    'status.ready_for_decision': 'Ready for decision',
    'next.new': 'The case is registered; IRIS will set the next step within the usual deadline (see methodology).',
    'next.under_review': 'Under review; please wait for a statement or the deadline in the row above.',
    'next.dd_in_progress': 'Due diligence / extended screening in progress per methodology.',
    'next.case_handling': 'The case is being actively handled by IRIS / the vice-rectorate.',
    'next.analysis_in_progress': 'Analysis in progress; you will receive a link or statement when complete.',
    'next.closed': 'The case is closed; supporting materials are linked from the analysis link.',
    'next.waiting_internal_opinion': 'Awaiting an internal opinion from the unit.',
    'next.ready_for_decision': 'The case is ready for a decision; watch the deadline and IRIS statement.',
    'next.default': 'Watch the case status and e-mail notifications from IRIS.',
    'due.overdue': 'overdue',
    'due.today': 'today',
    'due.inDays': 'in {n} d',
    'session.manager': 'IRIS Manager',
    'session.applicant': 'Applicant',
    'session.testerSuffix': 'applicant test mode',
    'manager.enterTesterMode': 'Applicant mode (test)',
    'manager.exitTesterMode': 'Back to manager dashboard',
    'manager.testerBanner':
      'Test mode: the checklist is submitted as a test intake. The manager key is created automatically on first manager sign-in in Apps Script; if errors persist, sign out and sign in again as IRIS Manager. You can edit the applicant e-mail (e.g. a test @uhk.cz account).',
    'err.testIntakeNoKey':
      'Cannot submit test intake: manager_key missing from the session. Deploy the latest Apps Script, sign out and sign in again as IRIS Manager (or with PIN mode set MANAGER_STATIC_KEY to match IRIS_MANAGER_KEY in the script).',
    'err.passwordMismatch': 'Passwords do not match.',
    'err.passwordShort': 'Password must be at least 8 characters.',
    'reg.successDefault':
      'Account created. Switch to “Applicant sign-in” and sign in with the same e-mail and password.',
    'reg.fail': 'Registration failed.',
    'reg.network': 'Connection error. Try again or contact the IRIS administrator.',
    'login.userFail':
      'Sign-in failed. Check your credentials or whether the login action is implemented in Apps Script.',
    'login.mgrFailPin': 'Invalid password or server error.',
    'login.mgrFailSetup':
      'Manager sign-in failed. Set MANAGER_FALLBACK_CODE in app.js (temporary) or implement login in Apps Script.',
    'login.mgrKeyMissing':
      'Server did not return manager_key (outdated Apps Script or bad response). Deploy the updated script and sign in again as manager.',
    'err.userOnlySubmit': 'Only signed-in applicants can submit the checklist.',
    'validate.applicant_name': 'Applicant name',
    'validate.applicant_email': 'Applicant e-mail',
    'validate.applicant_unit': 'Faculty / department / unit',
    'validate.cooperation_type': 'Type of cooperation',
    'validate.cooperation_stage': 'Stage of cooperation',
    'validate.partner_name': 'Partner name',
    'validate.partner_country': 'Partner / involved countries',
    'validate.intent_description': 'Description of intent',
    'validate.fill': 'Please fill in: {field}',
    'submit.sending': 'Sending checklist to IRIS UHK…',
    'submit.fail': 'Could not submit the form.',
    'submit.escalation': 'Checklist received. The case requires escalation or extended due diligence.',
    'submit.success': 'Checklist submitted successfully and the case was created.',
    'submit.error': 'An error occurred while submitting.',
    'demo.filled': 'Demo data filled in.',
    'file.readFail': 'Could not read the file.',
    'file.tooBig': 'File is too large (max. about 8 MB). Paste a link manually.',
    'file.readErr': 'Error reading the file.',
    'case.saveFail': 'Save failed.',
    'case.saved': 'Case saved.',
    'case.editPrefix': 'Edit case:',
    'dash.loadFail': 'Could not load the dashboard.',
    'cases.loadFail': 'Could not load cases.',
    'cases.userLoadFail': 'Could not load your submissions.',
    'user.requestRefHint':
      'This unique ID (UUID) appears under “My submissions” — paste it into the search field. Case ID may be duplicated on older rows; the reference ID is always unique.',
    'user.copyRequestRef': 'Copy reference ID',
    'user.downloadRefTxt': 'Download .txt',
    'user.refDownloadTitle': 'IRIS UHK – submission confirmation',
    'user.refDownloadUidLabel': 'Unique reference ID (find it in the app under My submissions):',
    'user.refDownloadHint':
      'Paste the full reference ID into the search box in My submissions to show exactly one record.',
    'user.casesSearchPh': 'Search (reference ID, case ID, title…)',
    'user.casesSearchAria': 'Search my submissions',
    'user.copied': 'Reference ID copied to clipboard.',
    'user.copyFail': 'Copy failed. Select and copy the code manually (Ctrl+C).',
    'manager.reminder.body':
      'IRIS methodology expects periodic updates to the risk analysis (renewal / follow-up when circumstances change). Complete analytical reports using the standard structure (subject, scope, conclusion, recommendations, renewal plan).',
    'manager.reminder.counts':
      'Open cases: past milestone deadline {mOverdue}, deadline approaching {mSoon}. Next planned analysis: overdue {aOverdue}, approaching {aSoon}.',
    'manager.workflowSuggestTitle': 'Suggested next step from the intake checklist',
    'manager.workflowRecommendStatus': 'Suggested status',
    'manager.suggest.review':
      'Low score and no mandatory DD – continue with <strong>Under review</strong> or <strong>In progress</strong> per methodology.',
    'manager.suggest.analysis':
      'Medium risk / indicators – consider moving to <strong>Analysis in progress</strong> and preparing an analytical report (see typical IRIS UHK report structure).',
    'manager.suggest.deep':
      'Extended screening (DD) required – consider <strong>Due diligence in progress</strong> (deeper analysis per IRIS methodology).',
    'manager.quickClose': 'Close case',
    'manager.quickAnalysis': 'Move to analysis',
    'manager.quickDeep': 'Move to deep analysis (DD)',
    'manager.riskFieldsetLegend': 'Risk assessment after vetting',
    'manager.riskFieldsetHint':
      'After internal vetting you can adjust checklist values. The Risk column in the case list matches the level selected below.',
    'manager.lblRiskLevel': 'Risk level',
    'manager.lblPreliminaryScore': 'Checklist score (0–99)',
    'manager.phRiskScore': 'e.g. 6',
    'manager.lblPreliminaryResult': 'Preliminary outcome (auto-generated from submission)',
    'manager.phPreliminaryResult': 'From the submission; you can edit after review.',
    'manager.lblFinalOutcome': 'IRIS conclusion after vetting',
    'manager.phFinalOutcome': 'Short conclusion for the register (final_outcome column in Cases).',
    'manager.riskLow': 'Low',
    'manager.riskMed': 'Medium',
    'manager.riskHigh': 'High',
    'manager.riskNA': 'Not assessed',
    'manager.quickActionDone':
      'Status, next steps, and due date were set. Save with “Save changes” to persist.',
    'manager.milestonesLegend': 'Process milestones (methodology suggestion)',
    'manager.milestonesHint':
      'Indicative dates — adjust per case. The due field is prefilled with the nearest milestone when no due date is stored.',
    'manager.milestoneClosure': 'Target closure / decision (indicative)',
    'manager.milestoneRecurrence': 'Recurrent review / analysis renewal',
    'manager.milestoneDeep': 'Deep due diligence (DD)',
    'manager.milestoneSuggested': 'suggested date',
    'manager.riskDomainsHint': 'Per-domain risk for case management (saved to the Cases sheet).',
    'manager.lblRiskReputational': 'Reputational risk',
    'manager.lblRiskLegal': 'Legal risk',
    'manager.lblRiskFinancial': 'Financial risk',
    'manager.lblRiskSecurity': 'Security risk',
    'manager.lblRiskEthical': 'Ethical risk',
    'manager.lblRiskOther': 'Other risk (IP / compliance / GDPR)',
    'manager.riskColHint': 'Colour reflects the saved risk level in Edit case (after save and refresh).',
    'manager.sectionBadgeIntake': 'Checklist',
    'manager.sectionBadgePrompts': 'AI prompts',
    'manager.sectionBadgeAdmin': 'IRIS manager',
    'manager.sectionBadgeOutput': 'Analysis / DD',
    'manager.sectionAdminTitle': 'Manager edits and applicant communication',
    'manager.sectionAdminLead':
      'Quick status moves, deadlines, statements, and post-vetting risk (separate from checklist intake).',
    'manager.sectionOutputTitle': 'Analytical report and conclusions',
    'manager.sectionOutputLead': 'Structured report per IRIS methodology, formal conclusion, and renewal planning.',
    'manager.intakeScoreHint': 'from submission',
    'manager.intakeSummaryTitle': 'Submission summary',
    'manager.intakePrelimFieldHint': 'Edit for the register (preliminary_result column in Cases).',
    'manager.intakeSummaryEmpty': 'No extra checklist fields are available for this case in the app (check the Intake sheet).',
    'manager.sumCaseId': 'Case ID',
    'manager.sumSourceIntake': 'Intake ID',
    'manager.sumCaseTitle': 'Subject / case title',
    'manager.sumApplicant': 'Applicant',
    'manager.sumUnit': 'Unit / institute',
    'manager.sumPartner': 'Partner',
    'manager.sumCountry': 'Partner country',
    'manager.sumPartnerWeb': 'Partner website',
    'manager.sumCoopType': 'Cooperation type',
    'manager.sumCoopStage': 'Cooperation stage',
    'manager.sumIntent': 'Intended cooperation',
    'manager.sumIndicators': 'Checklist indicators',
    'manager.sumCountryRisk': 'Country risk category',
    'manager.sumCountryMatch': 'Country matches',
    'manager.sumAutoFlags': 'Automatic flags',
    'manager.sumPreliminaryAuto': 'Preliminary outcome (from submission)',
    'manager.sumScoreAuto': 'Submission score (0–99)',
    'methodology.applicantInstSummary':
      'Show applicant methodology? (institutions and organisations checklist)',
    'methodology.applicantPersonSummary': 'Show applicant methodology? (natural persons checklist)',
    'methodology.managerInstSummary':
      'Show IRIS manager methodology? (institutions and organisations checklist)',
    'methodology.managerPersonSummary': 'Show IRIS manager methodology? (natural persons checklist)',
    'manager.promptUiTitle': 'AI prompt (ChatGPT / Claude)',
    'manager.promptUiLead':
      'Opens a window with the full prompt text. Case data is taken from the table and from this panel (including unsaved edits).',
    'manager.promptUiBtnGpt': 'ChatGPT – preliminary partner review',
    'manager.promptUiBtnClaude': 'Claude – final analytical report',
    'manager.promptUiBtnSanctions': 'Claude – sanctions screening',
    'manager.promptDialogTitleGpt': 'Prompt for ChatGPT',
    'manager.promptDialogTitleClaude': 'Prompt for Claude – analytical report',
    'manager.promptDialogTitleSanctions': 'Prompt for Claude – sanctions',
    'manager.promptDialogTip': 'Select all (Ctrl+A) and copy, or use the button below.',
    'manager.promptDialogCopy': 'Copy to clipboard',
    'manager.promptDialogClose': 'Close',
    'manager.promptCopied': 'Copied to clipboard.',
    'manager.promptCopyFail': 'Copy failed (browser permissions?).',
    'manager.promptMissingTemplates':
      'Missing iris-prompts.js or templates. Deploy iris-prompts.js with index.html or contact your administrator.',
    'manager.promptNeedCase': 'Open a case from the table first (Manage).',
    'manager.preset.close':
      'The case is closed. Documentation and any conditions are available via the analysis link in IRIS.',
    'manager.preset.analysis':
      'The case is moved to analytical reporting in the standard scope per IRIS UHK methodology.',
    'manager.preset.deep':
      'Extended due diligence / deep analysis has been started per IRIS UHK methodology.',
    'manager.lblAnalysisSubject': 'Subject of review / matter',
    'manager.phAnalysisSubject': 'Briefly: partner, subject of cooperation, context…',
    'manager.lblAnalysisScope': 'Scope and methodology',
    'manager.phAnalysisScope': 'IRIS framework, scope of review, sources used (OpenSanctions, public registers…).',
    'manager.lblAnalysisConclusion': 'Risk conclusion',
    'manager.phAnalysisConclusion': 'Risk categorisation in the UHK and regulatory context.',
    'manager.lblAnalysisRecs': 'Recommendations and conditions',
    'manager.phAnalysisRecs': 'Mitigation, conditions for continuing cooperation, link to contractual documentation.',
    'manager.lblAnalysisRecurrence': 'Analysis renewal / follow-up',
    'manager.phAnalysisRecurrence':
      'When to repeat the analysis (partner change, new contract, expiry of conclusions…).',
    'manager.lblNextAnalysisDue': 'Planned date of next analysis',
    'manager.analysisFieldsetLegend': 'Analytical report (IRIS methodology structure)',
    'manager.analysisFieldsetHint':
      'Structure aligns with typical IRIS UHK reviews and analytical reports (subject, scope, conclusion, recommendations, renewal plan).',
    'manager.reminderRegion': 'Reminder for IRIS managers',
    'session.adminSuffix': 'Admin',
    'admin.subNavAria': 'Manager navigation',
    'admin.navIris': 'IRIS overview',
    /** Back-compat for older markup: data-i18n="admin.navInstitutions" / "admin.navVetting". */
    'admin.navInstitutions': 'Institutions & organisations',
    'admin.navVetting': 'Individuals',
    'manager.hubTitle': 'Directory',
    'manager.hubLead':
      'Methodology checklists for vetting subjects. Open the case dashboard with “IRIS overview”.',
    'manager.hubLeadAdmin':
      'IRIS case overview and person vetting records (PAR). Work in case management and the PAR table according to your account permissions.',
    'manager.hubDashTileTitle': 'Case overview (IRIS)',
    'manager.hubDashTileDesc': 'Dashboard, case list, and record updates in IRIS mode.',
    'manager.hubParTileTitle': 'Person vetting records (PAR)',
    'manager.hubParTileDesc': 'Rows from the Person_Analysis_Requests sheet.',
    'manager.navPar': 'PAR records',
    'manager.hubInstitutionsTitle': 'Institutions and organisations checklist',
    'manager.hubInstitutionsDesc': 'Basic DD and OSINT framework for legal entities and partners.',
    'manager.hubPersonsTitle': 'Individuals checklist',
    'manager.hubPersonsDesc': 'Basics for vetting natural persons (OSINT, due diligence).',
    'manager.navInstitutions': 'Institutions & organisations',
    'manager.navPersons': 'Individuals',
    'manager.hubPersonAnalysisTitle': 'Person analysis requests',
    'manager.hubPersonAnalysisDesc': 'Form: subject, public identifiers, saved to Person_Analysis_Requests.',
    'manager.navPersonAnalysis': 'Analysis requests',
    'manager.paTitle': 'Person analysis requests (manager)',
    'manager.paLead':
      'Internal record for coordinating natural-person analysis (Person_Analysis_Requests; submission_channel = manager). Applicants use the separate “Natural person vetting request” form.',
    'manager.paHintIdentifiers':
      'Enter only information lawfully available from open sources (OSINT methodology). Do not enter sensitive personal data beyond what is already public.',
    'manager.paLegendLink': 'Link to case (optional)',
    'manager.paLblCaseId': 'Case ID',
    'manager.paPhCaseId': 'e.g. CASE-2026-042',
    'manager.paLblRecordUid': 'Reference ID',
    'manager.paLegendSubject': 'Subject to be assessed',
    'manager.paLblLegalName': 'Full legal name *',
    'manager.paLblAltNames': 'Alternate spellings / maiden name / transliteration',
    'manager.paLblDob': 'Year or date of birth (if publicly known)',
    'manager.paLblCitizenship': 'Nationality (as publicly stated)',
    'manager.paLblResidence': 'Country / region of usual activity',
    'manager.paLblAffiliation': 'Institution / employer in context',
    'manager.paLblRole': 'Role vis-à-vis UHK (e.g. visiting researcher, PI, expert)',
    'manager.paLegendIds': 'Public identifiers and profiles (OSINT)',
    'manager.paHintIds':
      'Often discoverable: ORCID, Scopus Author ID, Web of Science ResearcherID, Google Scholar, LinkedIn, official institutional profile pages.',
    'manager.paLblOrcid': 'ORCID',
    'manager.paLblScopus': 'Scopus Author ID',
    'manager.paLblWos': 'Web of Science ResearcherID',
    'manager.paLblScholar': 'Google Scholar profile URL',
    'manager.paLblLinkedin': 'Public LinkedIn profile URL',
    'manager.paLblInstProfiles': 'Institutional profile URLs (one per line)',
    'manager.paLblOtherUrls': 'Other public URLs (one per line)',
    'manager.paLegendRequest': 'Request',
    'manager.paLblSummary': 'What to verify / context and aim of analysis *',
    'manager.paLblUrgency': 'Priority / urgency',
    'manager.paUrgLow': 'Low',
    'manager.paUrgMed': 'Medium',
    'manager.paUrgHigh': 'High',
    'manager.paLblIdSource': 'Where identifiers come from (publication, contract, UHK website, …)',
    'manager.paSubmit': 'Submit to register',
    'manager.paReset': 'Clear form',
    'manager.paOk': 'Request saved. Record ID: {id}',
    'manager.paFail': 'Could not save the request.',
    'manager.instTitle': 'Institutions and organisations checklist',
    'manager.instLead':
      'Orientation framework for vetting partners and legal entities in IRIS UHK. Complements the intake checklist; not legal advice.',
    'user.saveDraft': 'Save draft',
    'user.loadDraft': 'Load draft',
    'user.finalizeSubmit': 'Submit as final',
    'user.draftSaved': 'Draft saved in this browser.',
    'user.draftLoaded': 'Draft loaded.',
    'user.draftNone': 'No saved draft for this account.',
    'user.draftFail': 'Could not save draft (browser storage blocked?).',
    'user.hubTitle': 'Directory',
    'user.hubLeadApplicant':
      'Tiles below open the checklist form directly. You can expand methodology on the form page; the bar also lists your requests.',
    'user.subNavAria': 'Applicant navigation',
    'user.navInstMethod': 'Methodology – institutions',
    'user.navPersonMethod': 'Methodology – individuals',
    'user.navInstForm': 'Institution checklist (form)',
    'user.navPersonForm': 'Person checklist (form)',
    'user.navRequests': 'My requests',
    'user.personMethodLead':
      'Orientation methodology for applicants. Complements institutional security; not legal advice or a substitute for university policies.',
    'user.requestsTitle': 'My requests',
    'user.requestsDesc':
      'Institution checklist (IRIS cases) and person checklist. Drafts are stored only in this browser.',
    'user.requestsInstSection': 'Institution and organisation checklist',
    'user.requestsPersonSection': 'Person checklist',
    'tbl.typeCol': 'Type',
    'tbl.actions': 'Action',
    'user.parIdCol': 'Request ID',
    'user.parSubjectCol': 'Subject (person)',
    'user.reqTypeInst': 'Institution checklist',
    'user.reqTypeInstDraft': 'Draft (browser)',
    'user.reqTypePerson': 'Person checklist',
    'user.reqTypePersonDraft': 'Draft (browser)',
    'user.draftRowHintInst': 'Draft form – finish or submit from the “Institution checklist” tab.',
    'user.draftRowHintPerson': 'Draft form – finish or submit from the “Person checklist” tab.',
    'user.continueDraft': 'Continue',
    'user.statusDraft': 'draft',
    'user.statusSubmitted': 'submitted',
    'parStatus.new': 'received / new',
    'parStatus.in_progress': 'in progress',
    'parStatus.analyzed': 'analysed',
    'parStatus.closed': 'closed',
    'parStatus.rejected': 'rejected',
    'parStatus.cancelled': 'cancelled',
    'parStatus.default': 'in progress',
    'manager.parListTitle': 'Person vetting records (PAR)',
    'manager.parListDesc':
      'Rows from Person_Analysis_Requests. Delete: accounts with admin / iris_manager permission.',
    'manager.parColChannel': 'Channel',
    'manager.parDelete': 'Delete PAR',
    'admin.parDeleteConfirm': 'Permanently delete this PAR row from the sheet?',
    'admin.parDeleteOk': 'PAR record deleted.',
    'user.personReqEmpty': 'No submitted requests yet.',
    'user.personReqLoadFail': 'Could not load person vetting requests.',
    'admin.deleteSubmission': 'Delete submission and case',
    'admin.deleteConfirm':
      'Permanently delete this case and related rows (intake, events, notifications)? This cannot be undone.',
    'admin.deleteOk': 'Records deleted.',
    'admin.deleteFail': 'Delete failed.',
    'admin.vettingTitle': 'Personnel vetting – OSINT and due diligence basics',
    'admin.vettingLead':
      'Internal methodology note for IRIS administrators. Complements institutional security; it is not legal advice or a substitute for university policies.',
  },
};

/**
 * Záložní řetězce pro rozcestník a navigaci žadatele – použijí se, pokud v nasazeném STRINGS
 * chybí novější klíče (jinak by se na stránce zobrazoval samotný klíč).
 */
const I18N_FALLBACK_CS = {
  'tbl.refUidShort': 'Ref. ID',
  'manager.riskFieldsetLegend': 'Vyhodnocení rizika po prověrce',
  'manager.riskFieldsetHint':
    'Po interní prověrce můžete upravit údaje z checklistu. Hodnota v sloupci „Riziko“ v přehledu odpovídá zvolené úrovni níže.',
  'manager.lblRiskLevel': 'Úroveň rizika',
  'manager.lblPreliminaryScore': 'Skóre z checklistu (0–99)',
  'manager.phRiskScore': 'např. 6',
  'manager.lblPreliminaryResult': 'Předběžné vyhodnocení (automatický text z podání)',
  'manager.phPreliminaryResult': 'Text z podání; po prověrce ho můžete upravit.',
  'manager.lblFinalOutcome': 'Závěr IRIS po prověrce',
  'manager.phFinalOutcome': 'Stručný závěr pro evidenci (sloupec final_outcome v listu Cases).',
  'manager.riskLow': 'nízké',
  'manager.riskMed': 'střední',
  'manager.riskHigh': 'vysoké',
  'manager.hubLeadAdmin':
    'Přehled případů IRIS a evidence prověrek osob (PAR). Pracujte ve správě případů a v tabulce PAR podle oprávnění účtu.',
  'manager.hubDashTileTitle': 'Přehled případů (IRIS)',
  'manager.hubDashTileDesc': 'Dashboard, seznam případů a úpravy záznamů v režimu IRIS.',
  'manager.hubParTileTitle': 'Evidence prověrek osob (PAR)',
  'manager.hubParTileDesc': 'Záznamy z listu Person_Analysis_Requests.',
  'manager.navPar': 'Evidence PAR',
  'user.hubTitle': 'Rozcestník',
  'user.hubLeadApplicant':
    'Kachlíky níže otevřou přímo formulář check-listu. Metodické pokyny si můžete rozkliknout u formuláře; v liště je také přehled vašich požadavků.',
  'user.navInstMethod': 'Metodika – instituce',
  'user.navPersonMethod': 'Metodika – osoby',
  'user.navInstForm': 'Check-list institucí (formulář)',
  'user.navPersonForm': 'Check-list osob (formulář)',
  'user.navRequests': 'Moje požadavky',
  'user.personMethodLead':
    'Orientační metodický podklad pro žadatele. Doplňuje rámec institucionální bezpečnosti; nenahrazuje právní posouzení ani interní směrnice Ústavu.',
  'methodology.applicantInstSummary':
    'Chcete zobrazit metodické pokyny pro žadatele? (check-list institucí a organizací)',
  'methodology.applicantPersonSummary':
    'Chcete zobrazit metodické pokyny pro žadatele? (check-list fyzických osob)',
  'methodology.managerInstSummary':
    'Chcete zobrazit metodické pokyny pro správce IRIS? (check-list institucí a organizací)',
  'methodology.managerPersonSummary':
    'Chcete zobrazit metodické pokyny pro správce IRIS? (check-list fyzických osob)',
  'manager.promptUiTitle': 'Prompt pro AI (ChatGPT / Claude)',
  'manager.promptUiLead':
    'Otevře okno s celým textem promptu. Do textu se doplní údaje případu z tabulky i z polí tohoto panelu (i před uložením).',
  'manager.promptUiBtnGpt': 'ChatGPT – předběžná prověrka partnera',
  'manager.promptUiBtnClaude': 'Claude – finální analytická zpráva',
  'manager.promptUiBtnSanctions': 'Claude – sankční screening',
  'manager.promptDialogTitleGpt': 'Prompt pro ChatGPT',
  'manager.promptDialogTitleClaude': 'Prompt pro Claude – analytická zpráva',
  'manager.promptDialogTitleSanctions': 'Prompt pro Claude – sankční screening',
  'manager.promptDialogTip':
    'Označte celý text (Ctrl+A) a zkopírujte, nebo použijte tlačítko níže.',
  'manager.promptDialogCopy': 'Kopírovat do schránky',
  'manager.promptDialogClose': 'Zavřít',
  'manager.promptCopied': 'Zkopírováno do schránky.',
  'manager.promptCopyFail': 'Kopírování se nezdařilo (oprávnění prohlížeče?).',
  'manager.promptMissingTemplates':
    'Chybí soubor iris-prompts.js nebo šablony. Nahrajte iris-prompts.js spolu s index.html, nebo kontaktujte správce.',
  'manager.promptNeedCase': 'Nejprve otevřete případ v tabulce (tlačítko Spravovat).',
};
const I18N_FALLBACK_EN = {
  'tbl.refUidShort': 'Ref. ID',
  'manager.riskFieldsetLegend': 'Risk assessment after vetting',
  'manager.riskFieldsetHint':
    'After internal vetting you can adjust checklist values. The Risk column in the case list matches the level selected below.',
  'manager.lblRiskLevel': 'Risk level',
  'manager.lblPreliminaryScore': 'Checklist score (0–99)',
  'manager.phRiskScore': 'e.g. 6',
  'manager.lblPreliminaryResult': 'Preliminary outcome (auto-generated from submission)',
  'manager.phPreliminaryResult': 'From the submission; you can edit after review.',
  'manager.lblFinalOutcome': 'IRIS conclusion after vetting',
  'manager.phFinalOutcome': 'Short conclusion for the register (final_outcome column in Cases).',
  'manager.riskLow': 'Low',
  'manager.riskMed': 'Medium',
  'manager.riskHigh': 'High',
  'manager.hubLeadAdmin':
    'IRIS case overview and person vetting records (PAR). Work in case management and the PAR table according to your account permissions.',
  'manager.hubDashTileTitle': 'Case overview (IRIS)',
  'manager.hubDashTileDesc': 'Dashboard, case list, and record updates in IRIS mode.',
  'manager.hubParTileTitle': 'Person vetting records (PAR)',
  'manager.hubParTileDesc': 'Rows from the Person_Analysis_Requests sheet.',
  'manager.navPar': 'PAR records',
  'user.hubTitle': 'Directory',
  'user.hubLeadApplicant':
    'Tiles below open the checklist form directly. You can expand methodology on the form page; the bar also lists your requests.',
  'user.navInstMethod': 'Methodology – institutions',
  'user.navPersonMethod': 'Methodology – individuals',
  'user.navInstForm': 'Institution checklist (form)',
  'user.navPersonForm': 'Person checklist (form)',
  'user.navRequests': 'My requests',
  'user.personMethodLead':
    'Orientation methodology for applicants. Complements institutional security; not legal advice or a substitute for university policies.',
  'methodology.applicantInstSummary':
    'Show applicant methodology? (institutions and organisations checklist)',
  'methodology.applicantPersonSummary': 'Show applicant methodology? (natural persons checklist)',
  'methodology.managerInstSummary':
    'Show IRIS manager methodology? (institutions and organisations checklist)',
  'methodology.managerPersonSummary': 'Show IRIS manager methodology? (natural persons checklist)',
  'manager.promptUiTitle': 'AI prompt (ChatGPT / Claude)',
  'manager.promptUiLead':
    'Opens a window with the full prompt text. Case data is taken from the table and from this panel (including unsaved edits).',
  'manager.promptUiBtnGpt': 'ChatGPT – preliminary partner review',
  'manager.promptUiBtnClaude': 'Claude – final analytical report',
  'manager.promptUiBtnSanctions': 'Claude – sanctions screening',
  'manager.promptDialogTitleGpt': 'Prompt for ChatGPT',
  'manager.promptDialogTitleClaude': 'Prompt for Claude – analytical report',
  'manager.promptDialogTitleSanctions': 'Prompt for Claude – sanctions',
  'manager.promptDialogTip': 'Select all (Ctrl+A) and copy, or use the button below.',
  'manager.promptDialogCopy': 'Copy to clipboard',
  'manager.promptDialogClose': 'Close',
  'manager.promptCopied': 'Copied to clipboard.',
  'manager.promptCopyFail': 'Copy failed (browser permissions?).',
  'manager.promptMissingTemplates':
    'Missing iris-prompts.js or templates. Deploy iris-prompts.js with index.html or contact your administrator.',
  'manager.promptNeedCase': 'Open a case from the table first (Manage).',
};

function t(key, vars) {
  let s = STRINGS[currentLang]?.[key];
  if (s === undefined || s === '') s = STRINGS.cs[key];
  if (s === undefined || s === '') {
    s = currentLang === 'en' ? I18N_FALLBACK_EN[key] : I18N_FALLBACK_CS[key];
  }
  if (s === undefined || s === '') s = key;
  if (vars && typeof s === 'string') {
    Object.entries(vars).forEach(([k, v]) => {
      s = s.split(`{${k}}`).join(String(v));
    });
  }
  return s;
}

/**
 * Texty bloku „riziko po prověrce“ ve správci – přes getElementById (ne data-i18n),
 * aby se při jakékoli chybě v STRINGS/t() nikdy nevypsaly klíče.
 */
const IRIS_MGR_RISK_LABELS = {
  cs: {
    intakeLegend: 'Údaje z podání (check-list)',
    intakeHint:
      'Shrnutí podaného podnětu je v rámečku níže (jen ke čtení). Pod ním upravíte předběžné vyhodnocení a skóre pro evidenci případu.',
    adminLegend: 'Riziko po prověrce (správce)',
    adminHint:
      'Úroveň a oblasti rizika po interní prověrce. Po uložení se celková úroveň promítne do sloupce Riziko v přehledu případů.',
    lblLevel: 'Úroveň rizika',
    lblScore: 'Skóre z checklistu (0–99)',
    phScore: 'např. 6',
    lblPrelim: 'Předběžné vyhodnocení (úprava pro evidenci)',
    phPrelim: 'Text z podání; po prověrce ho můžete upravit.',
    lblFinal: 'Závěr IRIS po prověrce',
    phFinal: 'Stručný závěr pro evidenci (sloupec final_outcome v listu Cases).',
    riskLow: 'nízké',
    riskMed: 'střední',
    riskHigh: 'vysoké',
  },
  en: {
    intakeLegend: 'Submission data (checklist)',
    intakeHint:
      'A read-only summary of the submission is in the box below. Under it, edit the preliminary outcome and score for the case file.',
    adminLegend: 'Risk after vetting (manager)',
    adminHint:
      'Overall level and per-domain risk after internal review. The overall level updates the Risk column in the case list after save.',
    lblLevel: 'Risk level',
    lblScore: 'Checklist score (0–99)',
    phScore: 'e.g. 6',
    lblPrelim: 'Preliminary outcome (edit for register)',
    phPrelim: 'From the submission; you can edit after review.',
    lblFinal: 'IRIS conclusion after vetting',
    phFinal: 'Short conclusion for the register (final_outcome column in Cases).',
    riskLow: 'Low',
    riskMed: 'Medium',
    riskHigh: 'High',
  },
};

function applyManagerRiskFieldsetLabels() {
  const L = IRIS_MGR_RISK_LABELS[currentLang] || IRIS_MGR_RISK_LABELS.cs;
  const setText = (id, text) => {
    const n = document.getElementById(id);
    if (n && text != null) n.textContent = text;
  };
  const setPh = (id, text) => {
    const n = document.getElementById(id);
    if (n && 'placeholder' in n && text != null) n.placeholder = text;
  };
  setText('irisMgrIntakeLegend', L.intakeLegend);
  setText('irisMgrIntakeHint', L.intakeHint);
  setText('irisMgrIntakeLblScore', L.lblScore);
  setText('irisMgrIntakeLblPrelim', L.lblPrelim);
  setPh('managerCaseRiskScore', L.phScore);
  setPh('managerCasePreliminaryResult', L.phPrelim);

  setText('irisMgrAdminRiskLegend', L.adminLegend);
  setText('irisMgrAdminRiskHint', L.adminHint);
  setText('irisMgrRiskLblLevel', L.lblLevel);

  setText('irisMgrRiskLblFinal', L.lblFinal);
  setPh('managerCaseFinalOutcome', L.phFinal);
  setText('irisMgrRiskOptLow', L.riskLow);
  setText('irisMgrRiskOptMed', L.riskMed);
  setText('irisMgrRiskOptHigh', L.riskHigh);
}

/** Metodické stránky v index.html (data-iris-lang); přepíná se jazykem. */
function syncMethodologyBodyLang() {
  document.querySelectorAll('[data-iris-lang]').forEach((el) => {
    const lang = el.getAttribute('data-iris-lang');
    el.classList.toggle('hidden', lang !== currentLang);
  });
}

function applyStaticI18n() {
  document.documentElement.lang = currentLang === 'en' ? 'en' : 'cs';
  const titleEl = document.querySelector('title');
  if (titleEl) titleEl.textContent = t('page.title');

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    const key = el.getAttribute('data-i18n-html');
    if (key) el.innerHTML = t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key && 'placeholder' in el) el.placeholder = t(key);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (key) el.title = t(key);
  });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    const key = el.getAttribute('data-i18n-aria');
    if (key) el.setAttribute('aria-label', t(key));
  });
  document.querySelectorAll('option[data-i18n-opt]').forEach((opt) => {
    const key = opt.getAttribute('data-i18n-opt');
    if (key) opt.textContent = t(key);
  });
  syncMethodologyBodyLang();
  applyManagerRiskFieldsetLabels();
  refreshManagerPromptUi();
}

/** Dočasné řešení: prázdné = vypnuto. Pokud máte v Apps Scriptu IRIS_MANAGER_KEY, nastavte stejnou hodnotu do MANAGER_STATIC_KEY, aby fungovalo PIN přihlášení správce. */
const MANAGER_FALLBACK_CODE = '';
const MANAGER_STATIC_KEY = '';
/** U PIN přihlášení: zda zobrazit admin sekci Prověrky (bez ověření z listu Users). */
const MANAGER_PIN_AS_ADMIN = false;

function resolveManagerKeyForRequest(session) {
  if (!session) return '';
  const mk = String(session.managerKey || '').trim();
  if (mk) return mk;
  return String(MANAGER_STATIC_KEY || '').trim();
}

const form = document.getElementById('intakeForm');
const submitButton = document.getElementById('submitButton');
const saveDraftButton = document.getElementById('saveDraftButton');
const loadDraftButton = document.getElementById('loadDraftButton');
const fillDemoButton = document.getElementById('fillDemoButton');
const applicantPersonVettingForm = document.getElementById('applicantPersonVettingForm');
const pvSubmit = document.getElementById('pvSubmit');
const pvFormMessage = document.getElementById('pvFormMessage');
const pvApplicantEmail = document.getElementById('pv_applicant_email');
const pvSaveDraftButton = document.getElementById('pvSaveDraftButton');
const pvLoadDraftButton = document.getElementById('pvLoadDraftButton');
const userPersonRequestsTableBody = document.getElementById('userPersonRequestsTableBody');
const userHubBtnInstitutions = document.getElementById('userHubBtnInstitutions');
const userHubBtnPersons = document.getElementById('userHubBtnPersons');
const navUserInstForm = document.getElementById('navUserInstForm');
const navUserPersonForm = document.getElementById('navUserPersonForm');
const navUserRequests = document.getElementById('navUserRequests');
const userViewInstForm = document.getElementById('userViewInstForm');
const userViewPersonForm = document.getElementById('userViewPersonForm');
const userViewRequests = document.getElementById('userViewRequests');
const managerParListSection = document.getElementById('managerParListSection');
const managerParTableBody = document.getElementById('managerParTableBody');
const managerParListMessage = document.getElementById('managerParListMessage');

const statusMessage = document.getElementById('statusMessage');
const resultDetails = document.getElementById('resultDetails');
const caseIdValue = document.getElementById('caseIdValue');
const intakeIdValue = document.getElementById('intakeIdValue');
const recordUidValue = document.getElementById('recordUidValue');
const resultValue = document.getElementById('resultValue');
const scoreValue = document.getElementById('scoreValue');

const statTotal = document.getElementById('statTotal');
const statOpen = document.getElementById('statOpen');
const statClosed = document.getElementById('statClosed');
const statOverdue = document.getElementById('statOverdue');
const statDueSoon = document.getElementById('statDueSoon');

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
const managerSubNav = document.getElementById('managerSubNav');
const navManagerDashboard = document.getElementById('navManagerDashboard');
const navManagerPar = document.getElementById('navManagerPar');
const managerHub = document.getElementById('managerHub');
const hubBtnDashboard = document.getElementById('hubBtnDashboard');
const hubBtnPar = document.getElementById('hubBtnPar');
const managerViewDashboard = document.getElementById('managerViewDashboard');
const managerDashboardMain = document.getElementById('managerDashboardMain');
const managerViewInstitutions = document.getElementById('managerViewInstitutions');
const managerViewPersons = document.getElementById('managerViewPersons');
const managerViewPersonAnalysis = document.getElementById('managerViewPersonAnalysis');
const personAnalysisForm = document.getElementById('personAnalysisForm');
const personAnalysisFormMessage = document.getElementById('personAnalysisFormMessage');
const personAnalysisSubmit = document.getElementById('personAnalysisSubmit');
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
const managerCaseDelete = document.getElementById('managerCaseDelete');
const managerCaseCancel = document.getElementById('managerCaseCancel');
const managerCaseFormMessage = document.getElementById('managerCaseFormMessage');

const requestRefBlock = document.getElementById('requestRefBlock');
const requestRefCode = document.getElementById('requestRefCode');
const copyRequestRefBtn = document.getElementById('copyRequestRefBtn');
const downloadRefTxtBtn = document.getElementById('downloadRefTxtBtn');
const copyRequestRefFeedback = document.getElementById('copyRequestRefFeedback');
const userCasesSearch = document.getElementById('userCasesSearch');

/** Poslední úspěšná odpověď po odeslání checklistu (stažení .txt). */
let lastSubmitResponse = null;

const managerReminderBanner = document.getElementById('managerReminderBanner');
const statAnalysisOverdue = document.getElementById('statAnalysisOverdue');
const statAnalysisSoon = document.getElementById('statAnalysisSoon');
const managerWorkflowSuggest = document.getElementById('managerWorkflowSuggest');
const managerAnalysisSubject = document.getElementById('managerAnalysisSubject');
const managerAnalysisScope = document.getElementById('managerAnalysisScope');
const managerAnalysisConclusion = document.getElementById('managerAnalysisConclusion');
const managerAnalysisRecs = document.getElementById('managerAnalysisRecs');
const managerAnalysisRecurrence = document.getElementById('managerAnalysisRecurrence');
const managerNextAnalysisDue = document.getElementById('managerNextAnalysisDue');
const managerCaseRiskLevel = document.getElementById('managerCaseRiskLevel');
const managerCaseRiskScore = document.getElementById('managerCaseRiskScore');
const managerCasePreliminaryResult = document.getElementById('managerCasePreliminaryResult');
const managerCaseFinalOutcome = document.getElementById('managerCaseFinalOutcome');
const managerQuickActionFeedback = document.getElementById('managerQuickActionFeedback');
const managerMilestonesList = document.getElementById('managerMilestonesList');
const managerRiskReputational = document.getElementById('managerRiskReputational');
const managerRiskLegal = document.getElementById('managerRiskLegal');
const managerRiskFinancial = document.getElementById('managerRiskFinancial');
const managerRiskSecurity = document.getElementById('managerRiskSecurity');
const managerRiskEthical = document.getElementById('managerRiskEthical');
const managerRiskOther = document.getElementById('managerRiskOther');

const btnEnterTesterMode = document.getElementById('btnEnterTesterMode');
const btnExitTesterMode = document.getElementById('btnExitTesterMode');
const testerModeBanner = document.getElementById('testerModeBanner');

/** @type {Record<string, unknown>} */
let lastDashboardSummary = {};

/** @type {Array<Record<string, unknown>>} */
let managerCasesCache = [];

const OPEN_CASE_STATUSES = [
  'new',
  'under_review',
  'dd_in_progress',
  'case_handling',
  'analysis_in_progress',
  'waiting_internal_opinion',
  'ready_for_decision',
];

function isManagerTesterSession(session) {
  return Boolean(session && session.role === 'manager' && session.viewAs === 'tester');
}

function isSessionAdmin(session) {
  return Boolean(session && session.role === 'manager' && session.isAdmin === true);
}

/** Smazání případu v UI: API vrací can_delete_submissions pro role admin a iris_manager. */
function isSessionCanDeleteSubmissions(session) {
  return Boolean(session && session.role === 'manager' && session.canDeleteSubmissions === true);
}

function showManagerView(which) {
  const w = String(which || 'dashboard');
  const dash = w === 'dashboard';
  const par = w === 'par';
  const inIrisOrPar = dash || par;

  if (managerViewDashboard) {
    managerViewDashboard.classList.toggle('hidden', !inIrisOrPar);
  }
  if (managerDashboardMain) {
    managerDashboardMain.classList.toggle('hidden', !dash);
  }
  if (managerParListSection) {
    managerParListSection.classList.toggle('hidden', !par);
  }
  if (managerViewInstitutions) {
    managerViewInstitutions.classList.add('hidden');
  }
  if (managerViewPersons) {
    managerViewPersons.classList.add('hidden');
  }
  if (managerViewPersonAnalysis) {
    managerViewPersonAnalysis.classList.toggle('hidden', !par);
  }
  if (navManagerDashboard) {
    navManagerDashboard.classList.toggle('is-active', dash);
  }
  if (navManagerPar) {
    navManagerPar.classList.toggle('is-active', par);
  }
  if (!dash) {
    closeManagerCasePanel();
  }
  if (par) {
    loadManagerPersonAnalysisList().catch(() => {});
  }
}

function updateManagerSubNav(session) {
  const show = Boolean(session && session.role === 'manager' && !isManagerTesterSession(session));
  if (managerSubNav) {
    managerSubNav.classList.toggle('hidden', !show);
  }
  if (managerHub) {
    managerHub.classList.toggle('hidden', !show);
  }
  if (!show) {
    showManagerView('dashboard');
  }
}

function formatSessionBadge(session) {
  if (!session) return '';
  if (isManagerTesterSession(session)) {
    return `${t('session.manager')} · ${session.email} · ${t('session.testerSuffix')}`;
  }
  if (session.role === 'manager') {
    const adm = session.isAdmin ? ` · ${t('session.adminSuffix')}` : '';
    return `${t('session.manager')} · ${session.email}${adm}`;
  }
  return `${t('session.applicant')} · ${session.email}`;
}

function updateTesterModeButtons(session) {
  if (!btnEnterTesterMode || !btnExitTesterMode) return;
  const isMgr = Boolean(session && session.role === 'manager');
  const isTester = isManagerTesterSession(session);
  btnEnterTesterMode.classList.toggle('hidden', !isMgr || isTester);
  btnExitTesterMode.classList.toggle('hidden', !isTester);
}

function persistTesterApplicantEmail() {
  const session = getSession();
  if (!isManagerTesterSession(session) || !form || !form.elements.applicant_email) return;
  const em = form.elements.applicant_email.value.trim();
  if (!em) return;
  setSession({ ...session, testerApplicantEmail: em });
  if (pvApplicantEmail) {
    pvApplicantEmail.value = em;
  }
}

function persistTesterApplicantEmailFromPv() {
  const session = getSession();
  if (!isManagerTesterSession(session) || !pvApplicantEmail || !form?.elements?.applicant_email) return;
  const em = pvApplicantEmail.value.trim();
  if (!em) return;
  setSession({ ...session, testerApplicantEmail: em });
  form.elements.applicant_email.value = em;
}

function enterTesterMode() {
  const session = getSession();
  if (!session || session.role !== 'manager') return;
  setSession({
    email: session.email,
    role: 'manager',
    managerKey: resolveManagerKeyForRequest(session) || '',
    isAdmin: session.isAdmin === true,
    canDeleteSubmissions: session.canDeleteSubmissions === true,
    viewAs: 'tester',
    testerApplicantEmail: session.testerApplicantEmail || session.email,
  });
  showApp(getSession());
  refreshForRole().catch(() => {});
}

function exitTesterMode() {
  const session = getSession();
  if (!session || session.role !== 'manager') return;
  setSession({
    email: session.email,
    role: 'manager',
    managerKey: resolveManagerKeyForRequest(session) || '',
    isAdmin: session.isAdmin === true,
    canDeleteSubmissions: session.canDeleteSubmissions === true,
  });
  showApp(getSession());
  refreshForRole().catch(() => {});
}

function getSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.email || !s.role) return null;
    if (s.role !== 'user' && s.role !== 'manager') return null;
    if (s.role === 'manager') {
      const mk = String(s.managerKey || '').trim();
      const stat = String(MANAGER_STATIC_KEY || '').trim();
      if (!mk && stat) {
        s.managerKey = stat;
        try {
          sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
        } catch (_) {
          /* ignore */
        }
      }
    }
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

function syncApplicantPersonVettingFromSession(session) {
  if (!session || !pvApplicantEmail) return;
  if (session.role !== 'user' && !isManagerTesterSession(session)) return;
  const tester = isManagerTesterSession(session);
  pvApplicantEmail.value = tester
    ? String(session.testerApplicantEmail || session.email || '')
    : session.email;
  pvApplicantEmail.readOnly = !tester;
  pvApplicantEmail.classList.toggle('input-readonly', !tester);
  pvApplicantEmail.title = tester ? '' : t('user.titleEmailReadonly');
}

function showApp(session) {
  loginScreen.classList.add('hidden');
  appRoot.classList.remove('hidden');
  sessionBadge.textContent = formatSessionBadge(session);
  updateTesterModeButtons(session);
  updateManagerSubNav(session);

  if (testerModeBanner) {
    testerModeBanner.classList.toggle('hidden', !isManagerTesterSession(session));
    if (isManagerTesterSession(session)) {
      testerModeBanner.textContent = t('manager.testerBanner');
    }
  }

  if (session.role === 'user' || isManagerTesterSession(session)) {
    layoutUser.classList.remove('hidden');
    layoutManager.classList.add('hidden');
    const emailInput = form.elements.applicant_email;
    if (emailInput) {
      const tester = isManagerTesterSession(session);
      emailInput.value = tester
        ? String(session.testerApplicantEmail || session.email || '')
        : session.email;
      emailInput.readOnly = !tester;
      emailInput.classList.toggle('input-readonly', !tester);
      emailInput.title = tester ? '' : t('user.titleEmailReadonly');
    }
    syncApplicantPersonVettingFromSession(session);
    showUserView('instForm');
    if (resultDetails.classList.contains('hidden')) {
      setStatus(t('user.statusNone'), 'neutral');
    }
  } else {
    layoutUser.classList.add('hidden');
    layoutManager.classList.remove('hidden');
  }

  applyStaticI18n();
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
    registerMessage.textContent = t('err.passwordMismatch');
    registerMessage.classList.remove('hidden');
    return;
  }
  if (password.length < 8) {
    registerMessage.textContent = t('err.passwordShort');
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
      registerMessage.textContent = data.message || t('reg.successDefault');
      registerMessage.classList.remove('hidden');
      registerMessage.classList.add('login-success');
      document.getElementById('loginUserEmail').value = email;
      registerForm.reset();
      return;
    }
    registerMessage.textContent = data.message || t('reg.fail');
    registerMessage.classList.remove('hidden');
  } catch {
    registerMessage.textContent = t('reg.network');
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

  userLoginError.textContent = t('login.userFail');
  userLoginError.classList.remove('hidden');
});

managerLoginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  managerLoginError.classList.add('hidden');
  const email = document.getElementById('loginManagerEmail').value.trim();
  const password = document.getElementById('loginManagerPassword').value;

  if (MANAGER_FALLBACK_CODE && password === MANAGER_FALLBACK_CODE) {
    setSession({
      email,
      role: 'manager',
      managerKey: MANAGER_STATIC_KEY || '',
      isAdmin: MANAGER_PIN_AS_ADMIN === true,
      canDeleteSubmissions: MANAGER_PIN_AS_ADMIN === true,
    });
    showApp(getSession());
    await refreshForRole();
    return;
  }

  try {
    const { response, data } = await apiLogin(email, password, 'manager');
    if (response.ok && data.ok && (data.role === 'manager' || data.role === 'iris_manager')) {
      const mk = String(data.manager_key || '').trim();
      if (!mk) {
        managerLoginError.textContent = t('login.mgrKeyMissing');
        managerLoginError.classList.remove('hidden');
        return;
      }
      setSession({
        email: data.email || email,
        role: 'manager',
        managerKey: mk,
        isAdmin: data.is_admin === true,
        canDeleteSubmissions:
          data.can_delete_submissions === true ||
          data.is_admin === true,
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

  managerLoginError.textContent = MANAGER_FALLBACK_CODE ? t('login.mgrFailPin') : t('login.mgrFailSetup');
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

function downloadSubmissionRefTxt(data) {
  if (!data) return;
  const uid = String(data.record_uid || '').trim();
  const lines = [
    t('user.refDownloadTitle'),
    '',
    t('user.refDownloadUidLabel'),
    uid || t('common.emDash'),
    '',
    t('user.refDownloadHint'),
    '',
    '—',
    `${t('user.lblCaseId')}: ${data.case_id || t('common.emDash')}`,
    `${t('user.lblIntakeId')}: ${data.intake_id || t('common.emDash')}`,
    `${t('user.lblPrelim')}: ${data.preliminary_result ?? t('common.emDash')}`,
    `${t('user.lblScore')}: ${data.preliminary_risk_score ?? t('common.emDash')}`,
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safe = uid ? uid.replace(/[^0-9a-f-]/gi, '').slice(0, 13) : 'podani';
  a.href = url;
  a.download = `IRIS-UHK-reference-${safe}.txt`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function showResult(data) {
  lastSubmitResponse = data && data.ok ? data : null;
  const dash = t('common.emDash');
  if (recordUidValue) {
    recordUidValue.textContent = data.record_uid || dash;
  }
  caseIdValue.textContent = data.case_id || dash;
  intakeIdValue.textContent = data.intake_id || dash;
  resultValue.textContent = data.preliminary_result || dash;
  scoreValue.textContent = data.preliminary_risk_score ?? dash;
  resultDetails.classList.remove('hidden');
  const refCode = String(data.record_uid || data.case_id || data.intake_id || '').trim();
  if (requestRefBlock && requestRefCode && refCode) {
    requestRefCode.textContent = refCode;
    requestRefBlock.classList.remove('hidden');
    if (copyRequestRefFeedback) {
      copyRequestRefFeedback.classList.add('hidden');
      copyRequestRefFeedback.textContent = '';
    }
  } else if (requestRefBlock) {
    requestRefBlock.classList.add('hidden');
  }
}

function hideResult() {
  lastSubmitResponse = null;
  resultDetails.classList.add('hidden');
  if (recordUidValue) recordUidValue.textContent = t('common.emDash');
  if (requestRefBlock) requestRefBlock.classList.add('hidden');
  if (copyRequestRefFeedback) {
    copyRequestRefFeedback.classList.add('hidden');
    copyRequestRefFeedback.textContent = '';
  }
}

function checkboxToYesNo(checkboxName) {
  return form.elements[checkboxName].checked ? 'ano' : 'ne';
}

function collectFormData() {
  const session = getSession();
  const applicantEmail =
    session && session.role === 'user'
      ? session.email
      : String(form.applicant_email.value || '').trim();
  return {
    applicant_name: form.applicant_name.value.trim(),
    applicant_email: applicantEmail,
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

function intakeDraftStorageKey(email) {
  return INTAKE_DRAFT_PREFIX + String(email || '').trim().toLowerCase();
}

function saveIntakeDraftToStorage() {
  const session = getSession();
  if (!session || (session.role !== 'user' && !isManagerTesterSession(session)) || !form) return;
  const payload = collectFormData();
  const raw = {
    v: 2,
    savedAt: new Date().toISOString(),
    fields: {
      applicant_name: payload.applicant_name,
      applicant_unit: payload.applicant_unit,
      cooperation_type: form.cooperation_type.value,
      cooperation_stage: form.cooperation_stage.value,
      partner_name: payload.partner_name,
      partner_country: payload.partner_country,
      partner_website: payload.partner_website,
      intent_description: payload.intent_description,
    },
    checks: {
      external_funding: form.external_funding.checked,
      access_to_uhk_systems: form.access_to_uhk_systems.checked,
      sharing_data_knowhow: form.sharing_data_knowhow.checked,
      sensitive_outputs: form.sensitive_outputs.checked,
      transfer_outside_eu: form.transfer_outside_eu.checked,
      training_or_technical_assistance: form.training_or_technical_assistance.checked,
      involves_doctoral_students_or_infrastructure: form.involves_doctoral_students_or_infrastructure.checked,
    },
  };
  if (isManagerTesterSession(session)) {
    raw.fields.applicant_email_override = String(form.applicant_email.value || '').trim();
  }
  try {
    localStorage.setItem(intakeDraftStorageKey(payload.applicant_email), JSON.stringify(raw));
    setStatus(t('user.draftSaved'), 'success');
  } catch (_) {
    setStatus(t('user.draftFail'), 'error');
  }
}

function loadIntakeDraftFromStorage() {
  const session = getSession();
  if (!session || (session.role !== 'user' && !isManagerTesterSession(session)) || !form) return;
  const email =
    session.role === 'user'
      ? session.email
      : String(form.applicant_email.value || session.testerApplicantEmail || session.email || '').trim();
  let raw;
  try {
    raw = localStorage.getItem(intakeDraftStorageKey(email));
  } catch (_) {
    raw = null;
  }
  if (!raw) {
    setStatus(t('user.draftNone'), 'neutral');
    return;
  }
  let d;
  try {
    d = JSON.parse(raw);
  } catch {
    setStatus(t('user.draftNone'), 'neutral');
    return;
  }
  const f = d.fields || {};
  if (f.applicant_name != null) form.applicant_name.value = f.applicant_name;
  if (f.applicant_unit != null) form.applicant_unit.value = f.applicant_unit;
  if (f.cooperation_type) {
    form.cooperation_type.value = f.cooperation_type;
  }
  if (f.cooperation_stage) form.cooperation_stage.value = f.cooperation_stage;
  if (f.partner_name != null) form.partner_name.value = f.partner_name;
  if (f.partner_country != null) form.partner_country.value = f.partner_country;
  if (f.partner_website != null) form.partner_website.value = f.partner_website;
  if (f.intent_description != null) form.intent_description.value = f.intent_description;
  if (isManagerTesterSession(session) && f.applicant_email_override) {
    form.applicant_email.value = f.applicant_email_override;
  }
  const c = d.checks || {};
  const names = [
    'external_funding',
    'access_to_uhk_systems',
    'sharing_data_knowhow',
    'sensitive_outputs',
    'transfer_outside_eu',
    'training_or_technical_assistance',
    'involves_doctoral_students_or_infrastructure',
  ];
  names.forEach((n) => {
    if (form.elements[n] && typeof c[n] === 'boolean') {
      form.elements[n].checked = c[n];
    }
  });
  setStatus(t('user.draftLoaded'), 'success');
}

function clearIntakeDraftForCurrentUser() {
  const session = getSession();
  if (!session || !form) return;
  const email =
    session.role === 'user'
      ? session.email
      : String(form.applicant_email.value || session.testerApplicantEmail || session.email || '').trim();
  try {
    localStorage.removeItem(intakeDraftStorageKey(email));
  } catch (_) {
    /* ignore */
  }
}

function getApplicantEmailForDrafts(session) {
  if (!session) return '';
  if (session.role === 'user') return String(session.email || '').trim();
  if (isManagerTesterSession(session)) {
    return String(
      (form && form.elements.applicant_email && form.elements.applicant_email.value) ||
        session.testerApplicantEmail ||
        session.email ||
        ''
    ).trim();
  }
  return '';
}

function readIntakeDraftSavedAt(email) {
  try {
    const raw = localStorage.getItem(intakeDraftStorageKey(email));
    if (!raw) return null;
    const d = JSON.parse(raw);
    return d.savedAt || null;
  } catch {
    return null;
  }
}

function personVettingDraftStorageKey(email) {
  return PERSON_VETTING_DRAFT_PREFIX + String(email || '').trim().toLowerCase();
}

function readPersonVettingDraftSavedAt(email) {
  try {
    const raw = localStorage.getItem(personVettingDraftStorageKey(email));
    if (!raw) return null;
    const d = JSON.parse(raw);
    return d.savedAt || null;
  } catch {
    return null;
  }
}

function savePersonVettingDraftToStorage() {
  const session = getSession();
  if (!session || (session.role !== 'user' && !isManagerTesterSession(session)) || !applicantPersonVettingForm) {
    return;
  }
  const email = getApplicantEmailForDrafts(session);
  if (!email) {
    setPvFormMessage(t('user.draftFail'), true);
    return;
  }
  const fd = new FormData(applicantPersonVettingForm);
  const fields = {};
  fd.forEach((value, key) => {
    if (typeof value === 'string' && key.startsWith('pv_')) {
      fields[key.replace(/^pv_/, '')] = value;
    }
  });
  const raw = { v: 1, savedAt: new Date().toISOString(), fields };
  try {
    localStorage.setItem(personVettingDraftStorageKey(email), JSON.stringify(raw));
    setPvFormMessage(t('user.draftSaved'), false);
  } catch (_) {
    setPvFormMessage(t('user.draftFail'), true);
  }
}

function loadPersonVettingDraftFromStorage() {
  const session = getSession();
  if (!session || (session.role !== 'user' && !isManagerTesterSession(session)) || !applicantPersonVettingForm) {
    return;
  }
  const email = getApplicantEmailForDrafts(session);
  let raw;
  try {
    raw = localStorage.getItem(personVettingDraftStorageKey(email));
  } catch (_) {
    raw = null;
  }
  if (!raw) {
    setPvFormMessage(t('user.draftNone'), false);
    return;
  }
  let d;
  try {
    d = JSON.parse(raw);
  } catch {
    setPvFormMessage(t('user.draftNone'), false);
    return;
  }
  const f = d.fields || {};
  const map = [
    ['applicant_name', 'pv_applicant_name'],
    ['applicant_email', 'pv_applicant_email'],
    ['related_case_id', 'pv_related_case_id'],
    ['related_record_uid', 'pv_related_record_uid'],
    ['subject_legal_name', 'pv_subject_legal_name'],
    ['subject_alternate_names', 'pv_subject_alternate_names'],
    ['subject_dob_or_year', 'pv_subject_dob_or_year'],
    ['subject_citizenships', 'pv_subject_citizenships'],
    ['subject_country_residence', 'pv_subject_country_residence'],
    ['subject_affiliation', 'pv_subject_affiliation'],
    ['subject_role_in_matter', 'pv_subject_role_in_matter'],
    ['id_orcid', 'pv_id_orcid'],
    ['id_scopus_author_id', 'pv_id_scopus'],
    ['id_wos_researcher_id', 'pv_id_wos'],
    ['id_google_scholar_url', 'pv_id_scholar'],
    ['id_linkedin_url', 'pv_id_linkedin'],
    ['id_institutional_profiles', 'pv_id_inst_profiles'],
    ['id_other_public_urls', 'pv_id_other_urls'],
    ['request_summary', 'pv_request_summary'],
    ['urgency', 'pv_urgency'],
    ['identifier_source_note', 'pv_identifier_source_note'],
  ];
  map.forEach(([k, elId]) => {
    if (f[k] == null) return;
    const el = document.getElementById(elId);
    if (el) el.value = f[k];
  });
  setPvFormMessage(t('user.draftLoaded'), false);
}

function clearPersonVettingDraftForCurrentUser() {
  const session = getSession();
  const email = getApplicantEmailForDrafts(session);
  if (!email) return;
  try {
    localStorage.removeItem(personVettingDraftStorageKey(email));
  } catch (_) {
    /* ignore */
  }
}

function parStatusLabel(st) {
  const key = String(st || 'new')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  const tr = t(`parStatus.${key}`);
  if (tr !== `parStatus.${key}`) return tr;
  return t('parStatus.default');
}

let userMethodologyCloned = false;
function ensureUserMethodologyCloned() {
  if (userMethodologyCloned) return;
  const instSrc = document.querySelector('#managerViewInstitutions .vetting-content');
  const personSrc = document.querySelector('#managerViewPersons .vetting-content');
  const instMount = document.getElementById('userMethodologyInstMount');
  const personMount = document.getElementById('userMethodologyPersonMount');
  if (instSrc && instMount && !instMount.childElementCount) {
    const c = instSrc.cloneNode(true);
    c.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    instMount.appendChild(c);
  }
  if (personSrc && personMount && !personMount.childElementCount) {
    const c = personSrc.cloneNode(true);
    c.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    personMount.appendChild(c);
  }
  userMethodologyCloned = Boolean(
    instMount && instMount.childElementCount && personMount && personMount.childElementCount
  );
}

function updateUserSubNavActive(which) {
  const w = String(which || 'instForm');
  const map = [
    ['instForm', navUserInstForm],
    ['personForm', navUserPersonForm],
    ['requests', navUserRequests],
  ];
  map.forEach(([key, btn]) => {
    if (btn) btn.classList.toggle('is-active', key === w);
  });
}

let currentUserMainView = 'instForm';

function showUserView(which) {
  const w = String(which || 'instForm');
  currentUserMainView = w;
  const instF = w === 'instForm';
  const persF = w === 'personForm';
  const req = w === 'requests';

  ensureUserMethodologyCloned();
  if (userViewInstForm) userViewInstForm.classList.toggle('hidden', !instF);
  if (userViewPersonForm) userViewPersonForm.classList.toggle('hidden', !persF);
  if (userViewRequests) userViewRequests.classList.toggle('hidden', !req);
  updateUserSubNavActive(w);
  syncMethodologyBodyLang();
  if (req) {
    loadUserCases().catch(() => {});
    loadApplicantPersonRequests().catch(() => {});
  }
}

function validateFormData(data) {
  const requiredFields = [
    ['applicant_name', 'validate.applicant_name'],
    ['applicant_email', 'validate.applicant_email'],
    ['applicant_unit', 'validate.applicant_unit'],
    ['cooperation_type', 'validate.cooperation_type'],
    ['cooperation_stage', 'validate.cooperation_stage'],
    ['partner_name', 'validate.partner_name'],
    ['partner_country', 'validate.partner_country'],
    ['intent_description', 'validate.intent_description'],
  ];

  for (const [key, labelKey] of requiredFields) {
    if (!String(data[key] || '').trim()) {
      throw new Error(t('validate.fill', { field: t(labelKey) }));
    }
  }
}

function dateLocaleTag() {
  return currentLang === 'en' ? 'en-GB' : 'cs-CZ';
}

function formatDate(value) {
  if (!value) return t('common.emDash');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat(dateLocaleTag(), {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function formatDateOnly(value) {
  if (!value) return t('common.emDash');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(dateLocaleTag(), { dateStyle: 'long' }).format(date);
}

function toDatetimeLocalValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function addCalendarDays(base, days) {
  const d = new Date(base);
  if (Number.isNaN(d.getTime())) return new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function parseCaseDateValue(v) {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const MANAGER_RISK_DIM_VALUES = ['nízké', 'střední', 'vysoké', 'nehodnoceno'];

function setManagerRiskDimensionSelect(el, stored) {
  if (!el) return;
  const raw = String(stored || '').trim();
  el.value = MANAGER_RISK_DIM_VALUES.includes(raw) ? raw : 'nehodnoceno';
}

function riskLevelCellClass(label) {
  const n = String(label || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (n === 'nizke') return 'cell-risk--low';
  if (n === 'stredni') return 'cell-risk--med';
  if (n === 'vysoke') return 'cell-risk--high';
  return 'cell-risk--none';
}

function riskLevelCellHtml(item) {
  const label = String(item.risk_level || '').trim();
  const shown = label || t('common.emDash');
  const cls = riskLevelCellClass(label);
  return `<td class="cell-risk ${cls}"><span class="cell-risk-inner">${escapeHtml(shown)}</span></td>`;
}

function computeMilestoneSuggestions(item) {
  const created = parseCaseDateValue(item.created_at) || new Date();
  const closure = addCalendarDays(created, 45);
  const existingNext = parseCaseDateValue(item.next_analysis_due);
  const recurring = existingNext || addCalendarDays(created, 365);
  const deep = addCalendarDays(new Date(), 21);
  const now = Date.now();
  const candidates = [
    { key: 'closure', label: t('manager.milestoneClosure'), date: closure },
    { key: 'recurring', label: t('manager.milestoneRecurrence'), date: recurring },
    { key: 'deep', label: t('manager.milestoneDeep'), date: deep },
  ];
  let nearest = candidates[0];
  let minDelta = Math.abs(nearest.date.getTime() - now);
  candidates.forEach((c) => {
    const d = Math.abs(c.date.getTime() - now);
    if (d < minDelta) {
      minDelta = d;
      nearest = c;
    }
  });
  return { closure, recurring, deep, nearest, candidates };
}

function renderManagerMilestones(item) {
  if (!managerMilestonesList) return;
  const m = computeMilestoneSuggestions(item);
  const sug = escapeHtml(t('manager.milestoneSuggested'));
  managerMilestonesList.innerHTML = m.candidates
    .map(
      (c) =>
        `<li><strong>${escapeHtml(c.label)}</strong> — ${escapeHtml(formatDateOnly(c.date.toISOString()))} <span class="manager-milestone-hint">(${sug})</span></li>`,
    )
    .join('');
}

function buildPreliminaryFromIntake(item) {
  let p = String(item.preliminary_result || '').trim();
  if (p) return p;
  const L = currentLang === 'en';
  const score = item.preliminary_risk_score;
  const flags = String(item.intake_auto_flags || '').trim();
  const cat = String(item.intake_country_risk_category || '').trim();
  const parts = [];
  if (score !== undefined && score !== null && String(score).trim() !== '') {
    parts.push((L ? 'Score (checklist): ' : 'Skóre (check-list): ') + String(score).trim());
  }
  if (flags) parts.push((L ? 'Auto flags: ' : 'Automatické indikátory: ') + flags);
  if (cat) parts.push((L ? 'Country risk category: ' : 'Kategorie země: ') + cat);
  const outline = parts.join('\n');
  if (outline) return outline;
  return String(item.intake_intent_description || item.description || '').trim();
}

/** Popisy indikátorů z řádku Intake (shodně pro shrnutí v panelu i návrh analýzy). */
function intakeChecklistIndicatorMeta() {
  const L = currentLang === 'en';
  return [
    ['intake_external_funding', L ? 'External funding' : 'Externí financování'],
    ['intake_access_to_uhk_systems', L ? 'Access to UHK systems' : 'Přístup k systémům UHK'],
    ['intake_sharing_data_knowhow', L ? 'Data / know-how sharing' : 'Sdílení dat / know-how'],
    ['intake_sensitive_outputs', L ? 'Sensitive outputs' : 'Citlivé výstupy'],
    ['intake_transfer_outside_eu', L ? 'Transfer outside EU' : 'Přenos mimo EU'],
    ['intake_training_or_technical_assistance', L ? 'Training / technical assistance' : 'Školení / technická asistence'],
    [
      'intake_involves_doctoral_students_or_infrastructure',
      L ? 'Doctoral students / infrastructure' : 'Doktorandi / infrastruktura',
    ],
  ];
}

function formatIntakeIndicatorsLines(item) {
  const lines = [];
  intakeChecklistIndicatorMeta().forEach(([k, lab]) => {
    const v = item[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      lines.push(`${lab}: ${String(v).trim()}`);
    }
  });
  return lines;
}

function pushIntakeSummaryRow(rows, labelKey, value) {
  const v = String(value ?? '').trim();
  if (!v) return;
  rows.push({ label: t(labelKey), value: v });
}

function buildManagerIntakeSummaryRows(item) {
  const rows = [];
  pushIntakeSummaryRow(rows, 'manager.sumCaseId', item.case_id);
  pushIntakeSummaryRow(rows, 'manager.sumSourceIntake', item.source_intake_id);
  pushIntakeSummaryRow(rows, 'manager.sumCaseTitle', item.title);
  pushIntakeSummaryRow(rows, 'manager.sumApplicant', item.applicant_name);
  pushIntakeSummaryRow(rows, 'manager.sumUnit', item.applicant_unit);
  pushIntakeSummaryRow(rows, 'manager.sumPartner', item.partner_name);
  pushIntakeSummaryRow(rows, 'manager.sumCountry', item.partner_country);
  pushIntakeSummaryRow(rows, 'manager.sumPartnerWeb', item.intake_partner_website);
  pushIntakeSummaryRow(rows, 'manager.sumCoopType', item.intake_cooperation_type || item.case_type);
  pushIntakeSummaryRow(rows, 'manager.sumCoopStage', item.intake_cooperation_stage);
  pushIntakeSummaryRow(rows, 'manager.sumIntent', item.intake_intent_description || item.description);
  const indLines = formatIntakeIndicatorsLines(item);
  if (indLines.length) {
    rows.push({ label: t('manager.sumIndicators'), value: indLines.join('\n') });
  }
  pushIntakeSummaryRow(rows, 'manager.sumCountryRisk', item.intake_country_risk_category);
  pushIntakeSummaryRow(rows, 'manager.sumCountryMatch', item.intake_country_matches);
  pushIntakeSummaryRow(rows, 'manager.sumAutoFlags', item.intake_auto_flags);
  pushIntakeSummaryRow(rows, 'manager.sumPreliminaryAuto', item.preliminary_result);
  const sc = item.preliminary_risk_score;
  if (sc !== undefined && sc !== null && String(sc).trim() !== '' && !Number.isNaN(Number(sc))) {
    rows.push({ label: t('manager.sumScoreAuto'), value: String(sc) });
  }
  return rows;
}

function renderManagerIntakeSummary(item) {
  const mount = document.getElementById('managerIntakeSummaryBody');
  if (!mount) return;
  const rows = buildManagerIntakeSummaryRows(item);
  if (!rows.length) {
    mount.innerHTML = `<p class="manager-intake-summary__empty">${escapeHtml(t('manager.intakeSummaryEmpty'))}</p>`;
    return;
  }
  mount.innerHTML = `<dl class="manager-intake-summary__dl">${rows
    .map(
      (r) =>
        `<div class="manager-intake-summary__row"><dt>${escapeHtml(r.label)}</dt><dd class="manager-intake-summary__dd">${escapeHtml(r.value)}</dd></div>`,
    )
    .join('')}</dl>`;
}

function composeAnalysisDraftFromCase(item) {
  const L = currentLang === 'en';
  const partner = String(item.partner_name || '').trim();
  const country = String(item.partner_country || '').trim();
  const title = String(item.title || '').trim();
  const subject = [partner, title].filter(Boolean).join(' – ') || title || partner;

  const scopeParts = [];
  if (item.intake_cooperation_type) {
    scopeParts.push(`${L ? 'Cooperation type' : 'Typ spolupráce'}: ${item.intake_cooperation_type}`);
  }
  if (item.intake_cooperation_stage) {
    scopeParts.push(`${L ? 'Stage' : 'Fáze spolupráce'}: ${item.intake_cooperation_stage}`);
  }
  if (partner || country) {
    scopeParts.push(`${L ? 'Partner' : 'Partner'}: ${partner || '—'} (${country || '—'})`);
  }
  const intent = String(item.intake_intent_description || item.description || '').trim();
  if (intent) {
    scopeParts.push(`${L ? 'Intended cooperation (intake)' : 'Záměr spolupráce (check-list)'}:\n${intent}`);
  }
  const flags = formatIntakeIndicatorsLines(item);
  if (flags.length) {
    scopeParts.push(`${L ? 'Checklist indicators' : 'Indikátory check-listu'}:\n${flags.join('\n')}`);
  }
  if (item.intake_country_risk_category) {
    scopeParts.push(
      `${L ? 'Country risk category' : 'Kategorie rizika země'}: ${item.intake_country_risk_category}`,
    );
  }
  if (item.intake_country_matches) {
    scopeParts.push(`${L ? 'Country matches' : 'Shody země'}: ${item.intake_country_matches}`);
  }
  if (item.intake_auto_flags) {
    scopeParts.push(`${L ? 'Automatic flags' : 'Automatické příznaky'}: ${item.intake_auto_flags}`);
  }

  return {
    subject: subject || (L ? 'IRIS case review' : 'Prověrka případu IRIS'),
    scope: scopeParts.join('\n\n'),
    conclusion: String(item.preliminary_result || '').trim(),
    recs: String(item.conditions_summary || '').trim(),
    recurrence: String(item.analysis_recurrence_note || '').trim(),
  };
}

function getManagerPanelCaseSnapshot() {
  const id = managerEditCaseId.value.trim();
  const base = managerCasesCache.find((c) => String(c.case_id) === id) || {};
  let dueIso = base.due_date;
  const dueVal = managerCaseDue && managerCaseDue.value;
  if (dueVal) {
    const d = new Date(dueVal);
    if (!Number.isNaN(d.getTime())) dueIso = d.toISOString();
  }
  return {
    ...base,
    status: managerCaseStatus ? managerCaseStatus.value : base.status,
    next_step_note: managerCaseNextStep ? managerCaseNextStep.value : base.next_step_note,
    due_date: dueIso,
  };
}

function dateInputFromCellValue(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function ddRequiredFromItem(item) {
  const v = item.dd_required;
  if (v === true) return true;
  const s = String(v || '').trim().toLowerCase();
  return s === 'true' || s === 'ano' || s === 'yes' || s === '1';
}

function suggestWorkflowForCase(item) {
  const score = Number(item.preliminary_risk_score);
  const risk = String(item.risk_level || '');
  const high = /vysok|high/i.test(risk);
  const ddReq = ddRequiredFromItem(item);
  if (ddReq || high || (Number.isFinite(score) && score >= 6)) {
    return { recommended: 'dd_in_progress', reasonKey: 'manager.suggest.deep' };
  }
  if (Number.isFinite(score) && score >= 4) {
    return { recommended: 'analysis_in_progress', reasonKey: 'manager.suggest.analysis' };
  }
  return { recommended: 'under_review', reasonKey: 'manager.suggest.review' };
}

function renderManagerWorkflowSuggest(item) {
  if (!managerWorkflowSuggest) return;
  const { recommended, reasonKey } = suggestWorkflowForCase(item);
  const title = escapeHtml(t('manager.workflowSuggestTitle'));
  const reasonHtml = t(reasonKey);
  const recLabel = escapeHtml(t('manager.workflowRecommendStatus'));
  const recStatus = escapeHtml(caseStatusLabel(recommended));
  managerWorkflowSuggest.innerHTML = `<h4 class="workflow-suggest-title">${title}</h4><div class="workflow-suggest-reason">${reasonHtml}</div><p class="field-hint">${recLabel}: <strong>${recStatus}</strong></p>`;
}

function applyManagerQuickAction(kind) {
  if (!managerCaseStatus) return;
  if (kind === 'close') {
    managerCaseStatus.value = 'closed';
    if (managerCaseNextStep) managerCaseNextStep.value = t('manager.preset.close');
    if (managerCaseDue) managerCaseDue.value = '';
  } else if (kind === 'analysis') {
    managerCaseStatus.value = 'analysis_in_progress';
    if (managerCaseNextStep) managerCaseNextStep.value = t('manager.preset.analysis');
    if (managerCaseDue) managerCaseDue.value = toDatetimeLocalValue(addCalendarDays(new Date(), 14));
  } else if (kind === 'deep') {
    managerCaseStatus.value = 'dd_in_progress';
    if (managerCaseNextStep) managerCaseNextStep.value = t('manager.preset.deep');
    if (managerCaseDue) managerCaseDue.value = toDatetimeLocalValue(addCalendarDays(new Date(), 21));
  } else {
    return;
  }
  try {
    renderManagerWorkflowSuggest(getManagerPanelCaseSnapshot());
  } catch (_) {
    /* ignore */
  }
  if (managerQuickActionFeedback) {
    managerQuickActionFeedback.textContent = t('manager.quickActionDone');
    managerQuickActionFeedback.classList.remove('hidden');
    window.clearTimeout(managerQuickActionFeedback._irisT);
    managerQuickActionFeedback._irisT = window.setTimeout(() => {
      managerQuickActionFeedback.classList.add('hidden');
    }, 5000);
  }
  managerCaseStatus.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function updateManagerReminderBanner(summary) {
  if (!managerReminderBanner) return;
  const s = summary || {};
  managerReminderBanner.textContent = '';
  const p1 = document.createElement('p');
  p1.textContent = t('manager.reminder.body');
  const p2 = document.createElement('p');
  p2.className = 'manager-reminder-counts';
  p2.textContent = t('manager.reminder.counts', {
    mOverdue: s.overdue_cases ?? 0,
    mSoon: s.due_soon_cases ?? 0,
    aOverdue: s.next_analysis_overdue ?? 0,
    aSoon: s.next_analysis_soon ?? 0,
  });
  managerReminderBanner.appendChild(p1);
  managerReminderBanner.appendChild(p2);
}

function caseStatusLabel(status) {
  const k = String(status || '').trim();
  if (!k) return t('common.emDash');
  const key = `status.${k}`;
  if (STRINGS.cs[key] === undefined && STRINGS.en[key] === undefined) return k;
  return t(key);
}

function nextStepForUser(item) {
  const custom = String(item.next_step_note || '').trim();
  if (custom) return custom;
  const st = String(item.status || '').trim();
  const key = `next.${st}`;
  if (STRINGS.cs[key] === undefined && STRINGS.en[key] === undefined) return t('next.default');
  return t(key);
}

function analysisUrlForItem(item) {
  const u = String(item.analysis_document_url || item.final_statement_link || '').trim();
  return /^https:\/\//i.test(u) ? u : '';
}

function isCaseOpen(status) {
  return OPEN_CASE_STATUSES.includes(String(status || '').trim());
}

function isCaseOverdue(item) {
  if (item.due_overdue_flag === true) return true;
  if (!item.due_date || !isCaseOpen(item.status)) return false;
  const due = new Date(item.due_date);
  return !Number.isNaN(due.getTime()) && due.getTime() < Date.now();
}

function isCaseDueSoon(item) {
  if (item.due_soon === true) return true;
  const d = item.days_until_due;
  if (d === null || d === undefined || !isCaseOpen(item.status)) return false;
  return d >= 0 && d <= 3;
}

function dueDateCellHtml(item) {
  const base = formatDateOnly(item.due_date);
  const d = item.days_until_due;
  if (d === null || d === undefined || Number.isNaN(d)) {
    return escapeHtml(base);
  }
  let badge = '';
  if (isCaseOpen(item.status)) {
    if (d < 0) {
      badge = ` <span class="due-badge due-badge-overdue">${escapeHtml(t('due.overdue'))}</span>`;
    } else if (item.due_soon) {
      if (d === 0) {
        badge = ` <span class="due-badge due-badge-soon">${escapeHtml(t('due.today'))}</span>`;
      } else {
        badge = ` <span class="due-badge due-badge-soon">${escapeHtml(t('due.inDays', { n: d }))}</span>`;
      }
    }
  }
  return `${escapeHtml(base)}${badge}`;
}

function cellPreview(text, maxLen) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return t('common.emDash');
  if (s.length <= maxLen) return escapeHtml(s);
  return `${escapeHtml(s.slice(0, maxLen))}…`;
}

function analysisLinkCell(url) {
  const u = String(url || '').trim();
  if (!/^https:\/\//i.test(u)) return t('common.emDash');
  const safe = u.replace(/"/g, '%22');
  return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${escapeHtml(t('common.open'))}</a>`;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const i = result.indexOf(',');
      resolve(i >= 0 ? result.slice(i + 1) : result);
    };
    reader.onerror = () => reject(new Error(t('file.readFail')));
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
  lastDashboardSummary = summary || {};
  statTotal.textContent = summary.total ?? 0;
  statOpen.textContent = summary.open_cases ?? 0;
  statClosed.textContent = summary.closed_cases ?? 0;
  statOverdue.textContent = summary.overdue_cases ?? 0;
  if (statDueSoon) {
    statDueSoon.textContent = summary.due_soon_cases ?? 0;
  }
  if (statAnalysisOverdue) {
    statAnalysisOverdue.textContent = summary.next_analysis_overdue ?? 0;
  }
  if (statAnalysisSoon) {
    statAnalysisSoon.textContent = summary.next_analysis_soon ?? 0;
  }
  updateManagerReminderBanner(lastDashboardSummary);
}

const UUID_LIKE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function refUidShortDisplay(uid) {
  const s = String(uid || '').trim();
  if (!s) return t('common.emDash');
  if (UUID_LIKE.test(s)) return `${s.slice(0, 8)}…`;
  return s.length > 14 ? `${s.slice(0, 12)}…` : s;
}

function renderManagerCases(items) {
  if (!items || !items.length) {
    casesTableBody.innerHTML = `<tr><td colspan="10" class="empty-row">${escapeHtml(t('manager.empty'))}</td></tr>`;
    return;
  }

  const manageLabel = escapeHtml(t('manager.manage'));
  casesTableBody.innerHTML = items
    .map((item) => {
      let rowCls = '';
      if (isCaseOverdue(item)) rowCls = 'row-overdue';
      else if (isCaseDueSoon(item)) rowCls = 'row-due-soon';
      const ruid = String(item.record_uid || '').trim();
      const ruidAttr = ruid ? escapeAttr(ruid) : '';
      const refShown = escapeHtml(refUidShortDisplay(ruid));
      return `
    <tr class="${rowCls}">
      <td>${escapeHtml(item.case_id)}</td>
      <td class="cell-record-uid"><code translate="no" title="${ruidAttr}">${ruid ? refShown : escapeHtml(t('common.emDash'))}</code></td>
      <td>${dueDateCellHtml(item)}</td>
      <td>${escapeHtml(formatDate(item.created_at))}</td>
      <td>${escapeHtml(item.title)}</td>
      <td>${escapeHtml(item.partner_name)}</td>
      <td>${escapeHtml(caseStatusLabel(item.status))}</td>
      <td>${escapeHtml(item.priority)}</td>
      ${riskLevelCellHtml(item)}
      <td><button type="button" class="btn-secondary btn-compact" data-manage-case="${escapeHtml(item.case_id)}" data-record-uid="${escapeAttr(ruid)}">${manageLabel}</button></td>
    </tr>`;
    })
    .join('');
}

function renderUserInstitutionRequests(items) {
  if (!userCasesTableBody) return;
  const session = getSession();
  const email = getApplicantEmailForDrafts(session);
  const draftAt = email ? readIntakeDraftSavedAt(email) : null;
  const rows = [];

  if (draftAt) {
    rows.push(`<tr class="row-draft">
      <td>${escapeHtml(t('user.reqTypeInstDraft'))}</td>
      <td colspan="9">${escapeHtml(t('user.draftRowHintInst'))}</td>
      <td>${escapeHtml(t('user.statusDraft'))}</td>
      <td><button type="button" class="btn-secondary btn-compact" data-user-continue-intake-draft="1">${escapeHtml(t('user.continueDraft'))}</button></td>
    </tr>`);
  }

  (items || []).forEach((item) => {
    let rowCls = '';
    if (isCaseOverdue(item)) rowCls = 'row-overdue';
    else if (isCaseDueSoon(item)) rowCls = 'row-due-soon';
    const nextText = nextStepForUser(item);
    const stmt = cellPreview(item.iris_statement, 120);
    const ruid = String(item.record_uid || '').trim();
    rows.push(`
    <tr class="${rowCls}">
      <td>${escapeHtml(t('user.reqTypeInst'))}</td>
      <td>${escapeHtml(item.case_id)}</td>
      <td class="cell-record-uid"><code translate="no" title="${escapeAttr(ruid)}">${escapeHtml(ruid || t('common.emDash'))}</code></td>
      <td>${escapeHtml(formatDate(item.created_at))}</td>
      <td>${escapeHtml(item.title)}</td>
      <td>${escapeHtml(item.partner_name)}</td>
      <td>${escapeHtml(caseStatusLabel(item.status))}</td>
      <td>${dueDateCellHtml(item)}</td>
      <td title="${escapeAttr(nextText)}">${cellPreview(nextText, 80)}</td>
      <td title="${escapeAttr(String(item.iris_statement || ''))}">${stmt}</td>
      <td>${analysisLinkCell(analysisUrlForItem(item))}</td>
      <td>${escapeHtml(t('common.emDash'))}</td>
    </tr>`);
  });

  if (!rows.length) {
    userCasesTableBody.innerHTML = `<tr><td colspan="12" class="empty-row">${escapeHtml(t('user.empty'))}</td></tr>`;
    return;
  }
  userCasesTableBody.innerHTML = rows.join('');
}

function renderUserPersonRequests(items) {
  if (!userPersonRequestsTableBody) return;
  const session = getSession();
  const email = getApplicantEmailForDrafts(session);
  const draftAt = email ? readPersonVettingDraftSavedAt(email) : null;
  const rows = [];

  if (draftAt) {
    rows.push(`<tr class="row-draft">
      <td>${escapeHtml(t('user.reqTypePersonDraft'))}</td>
      <td colspan="2">${escapeHtml(t('user.draftRowHintPerson'))}</td>
      <td>${escapeHtml(t('user.statusDraft'))}</td>
      <td>${escapeHtml(formatDate(draftAt))}</td>
      <td><button type="button" class="btn-secondary btn-compact" data-user-continue-pv-draft="1">${escapeHtml(t('user.continueDraft'))}</button></td>
    </tr>`);
  }

  (items || []).forEach((item) => {
    const pid = String(item.person_analysis_id || '').trim();
    rows.push(`<tr>
      <td>${escapeHtml(t('user.reqTypePerson'))}</td>
      <td><code translate="no">${escapeHtml(pid || t('common.emDash'))}</code></td>
      <td>${escapeHtml(item.subject_legal_name || t('common.emDash'))}</td>
      <td>${escapeHtml(parStatusLabel(item.status))}</td>
      <td>${escapeHtml(formatDate(item.submitted_at))}</td>
      <td>${escapeHtml(t('common.emDash'))}</td>
    </tr>`);
  });

  if (!rows.length) {
    userPersonRequestsTableBody.innerHTML = `<tr><td colspan="6" class="empty-row">${escapeHtml(t('user.personReqEmpty'))}</td></tr>`;
    return;
  }
  userPersonRequestsTableBody.innerHTML = rows.join('');
}

async function loadApplicantPersonRequests() {
  if (!userPersonRequestsTableBody) return;
  const session = getSession();
  const userLike = session && (session.role === 'user' || isManagerTesterSession(session));
  if (!userLike) return;
  const em = getApplicantEmailForDrafts(session);
  if (!em) {
    renderUserPersonRequests([]);
    return;
  }
  userPersonRequestsTableBody.innerHTML = `<tr><td colspan="6" class="empty-row">${escapeHtml(t('user.loadingRow'))}</td></tr>`;
  try {
    const params = new URLSearchParams({
      action: 'applicant_person_requests',
      applicant_email: em,
    });
    const response = await fetch(`${API_URL}?${params.toString()}`);
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || t('user.personReqLoadFail'));
    }
    renderUserPersonRequests(data.items || []);
  } catch (e) {
    userPersonRequestsTableBody.innerHTML = `<tr><td colspan="6" class="empty-row">${escapeHtml(e.message || t('user.personReqLoadFail'))}</td></tr>`;
  }
}

async function loadManagerPersonAnalysisList() {
  if (!managerParTableBody) return;
  const session = getSession();
  const mk = resolveManagerKeyForRequest(session);
  if (!session || session.role !== 'manager' || !mk || isManagerTesterSession(session)) {
    return;
  }
  managerParTableBody.innerHTML = `<tr><td colspan="7" class="empty-row">${escapeHtml(t('manager.loadingCases'))}</td></tr>`;
  try {
    const params = new URLSearchParams({
      action: 'person_analysis_list',
      manager_key: mk,
    });
    const response = await fetch(`${API_URL}?${params.toString()}`);
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || t('cases.loadFail'));
    }
    const items = data.items || [];
    if (!items.length) {
      managerParTableBody.innerHTML = `<tr><td colspan="7" class="empty-row">${escapeHtml(t('user.personReqEmpty'))}</td></tr>`;
      return;
    }
    const canDel = isSessionCanDeleteSubmissions(session);
    managerParTableBody.innerHTML = items
      .map((item) => {
        const pid = escapeHtml(item.person_analysis_id);
        const delBtn = canDel
          ? `<button type="button" class="btn-danger btn-compact" data-delete-par-id="${escapeAttr(item.person_analysis_id)}">${escapeHtml(t('manager.parDelete'))}</button>`
          : escapeHtml(t('common.emDash'));
        return `<tr>
          <td><code translate="no">${pid}</code></td>
          <td>${escapeHtml(item.submission_channel || t('common.emDash'))}</td>
          <td>${escapeHtml(item.submitter_email || '')}</td>
          <td>${escapeHtml(item.subject_legal_name || t('common.emDash'))}</td>
          <td>${escapeHtml(parStatusLabel(item.status))}</td>
          <td>${escapeHtml(formatDate(item.submitted_at))}</td>
          <td>${delBtn}</td>
        </tr>`;
      })
      .join('');
  } catch (e) {
    managerParTableBody.innerHTML = `<tr><td colspan="7" class="empty-row">${escapeHtml(e.message)}</td></tr>`;
  }
}

function setManagerParListMessage(text, isError = false) {
  if (!managerParListMessage) return;
  managerParListMessage.textContent = text || '';
  managerParListMessage.classList.toggle('hidden', !text);
  managerParListMessage.classList.toggle('manager-status--error', Boolean(isError));
  managerParListMessage.classList.toggle('manager-status--success', Boolean(text) && !isError);
}

async function loadDashboard() {
  const session = getSession();
  const q = new URLSearchParams({ action: 'dashboard' });
  const mk = resolveManagerKeyForRequest(session);
  if (session && session.role === 'manager' && mk) {
    q.set('manager_key', mk);
  }
  const response = await fetch(`${API_URL}?${q.toString()}`);
  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(data.message || t('dash.loadFail'));
  }

  renderDashboard(data.summary || {});
}

function buildCasesParams() {
  const params = new URLSearchParams();
  params.set('action', 'cases');
  const session = getSession();

  if (session && session.role === 'user') {
    params.set('applicant_email', session.email);
  } else if (isManagerTesterSession(session)) {
    let em =
      (form && form.elements.applicant_email && String(form.elements.applicant_email.value || '').trim()) ||
      String(session.testerApplicantEmail || session.email || '').trim();
    if (!em) em = String(session.email || '').trim();
    if (em) params.set('applicant_email', em);
  }

  const mkCases = resolveManagerKeyForRequest(session);
  if (session && session.role === 'manager' && mkCases) {
    params.set('manager_key', mkCases);
  }

  const userLike = session && (session.role === 'user' || isManagerTesterSession(session));
  if (userLike && userCasesSearch && userCasesSearch.value.trim()) {
    params.set('search', userCasesSearch.value.trim());
  } else if (searchCases && searchCases.value.trim()) {
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
  casesTableBody.innerHTML = `<tr><td colspan="10" class="empty-row">${escapeHtml(t('manager.loadingCases'))}</td></tr>`;

  const response = await fetch(`${API_URL}?${buildCasesParams().toString()}`);
  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(data.message || t('cases.loadFail'));
  }

  managerCasesCache = data.items || [];
  renderManagerCases(managerCasesCache);
}

async function loadUserCases() {
  if (!userCasesTableBody) return;
  userCasesTableBody.innerHTML = `<tr><td colspan="12" class="empty-row">${escapeHtml(t('user.loadingRow'))}</td></tr>`;

  const params = buildCasesParams();
  const response = await fetch(`${API_URL}?${params.toString()}`);
  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(data.message || t('cases.userLoadFail'));
  }

  renderUserInstitutionRequests(data.items || []);
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
      if (isManagerTesterSession(session)) {
        await loadUserCases();
        await loadApplicantPersonRequests();
      } else {
        await loadDashboard();
        await loadManagerCases();
        await loadManagerPersonAnalysisList();
      }
    } else {
      await loadUserCases();
      await loadApplicantPersonRequests();
    }
  } catch (error) {
    if (session.role === 'manager' && !isManagerTesterSession(session)) {
      setManagerStatus(error.message || t('cases.loadFail'), true);
    } else {
      if (userCasesTableBody) {
        userCasesTableBody.innerHTML = `<tr><td colspan="12" class="empty-row">${escapeHtml(
          error.message || t('cases.userLoadFail')
        )}</td></tr>`;
      }
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
  const asTester = isManagerTesterSession(session);
  if (!session || (session.role !== 'user' && !asTester)) {
    setStatus(t('err.userOnlySubmit'), 'error');
    return;
  }
  if (asTester && !resolveManagerKeyForRequest(session)) {
    setStatus(t('err.testIntakeNoKey'), 'error');
    return;
  }

  const payload = collectFormData();
  if (asTester) {
    payload.test_intake = true;
    payload.manager_key = resolveManagerKeyForRequest(session);
  }

  try {
    validateFormData(payload);

    submitButton.disabled = true;
    setStatus(t('submit.sending'), 'neutral');

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.message || t('submit.fail'));
    }

    showResult(data);
    await refreshForRole();

    if (typeof data.preliminary_risk_score === 'number' && data.preliminary_risk_score >= 6) {
      setStatus(t('submit.escalation'), 'warning');
    } else {
      setStatus(t('submit.success'), 'success');
    }

    clearIntakeDraftForCurrentUser();
    form.reset();
    const sAfter = getSession();
    if (sAfter.role === 'user') {
      form.elements.applicant_email.value = sAfter.email;
      form.elements.applicant_email.readOnly = true;
      form.elements.applicant_email.classList.add('input-readonly');
    } else if (isManagerTesterSession(sAfter)) {
      form.elements.applicant_email.value = sAfter.testerApplicantEmail || sAfter.email;
      form.elements.applicant_email.readOnly = false;
      form.elements.applicant_email.classList.remove('input-readonly');
    }
    syncApplicantPersonVettingFromSession(sAfter);
  } catch (error) {
    setStatus(error.message || t('submit.error'), 'error');
  } finally {
    submitButton.disabled = false;
  }
}

function fillDemoData() {
  const session = getSession();
  if (!session || (session.role !== 'user' && !isManagerTesterSession(session))) return;

  form.applicant_name.value = 'Jan Novák';
  form.applicant_email.value = isManagerTesterSession(session)
    ? session.testerApplicantEmail || session.email
    : session.email;
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

  setStatus(t('demo.filled'), 'neutral');
}

form.addEventListener('submit', submitForm);
fillDemoButton.addEventListener('click', fillDemoData);
if (saveDraftButton) {
  saveDraftButton.addEventListener('click', (ev) => {
    ev.preventDefault();
    saveIntakeDraftToStorage();
  });
}
if (loadDraftButton) {
  loadDraftButton.addEventListener('click', (ev) => {
    ev.preventDefault();
    loadIntakeDraftFromStorage();
  });
}

if (form.elements.applicant_email) {
  form.elements.applicant_email.addEventListener('blur', persistTesterApplicantEmail);
}
if (pvApplicantEmail) {
  pvApplicantEmail.addEventListener('blur', persistTesterApplicantEmailFromPv);
}

if (userHubBtnInstitutions) {
  userHubBtnInstitutions.addEventListener('click', (ev) => {
    ev.preventDefault();
    showUserView('instForm');
  });
}
if (userHubBtnPersons) {
  userHubBtnPersons.addEventListener('click', (ev) => {
    ev.preventDefault();
    showUserView('personForm');
  });
}
if (navUserInstForm) {
  navUserInstForm.addEventListener('click', (ev) => {
    ev.preventDefault();
    showUserView('instForm');
  });
}
if (navUserPersonForm) {
  navUserPersonForm.addEventListener('click', (ev) => {
    ev.preventDefault();
    showUserView('personForm');
  });
}
if (navUserRequests) {
  navUserRequests.addEventListener('click', (ev) => {
    ev.preventDefault();
    showUserView('requests');
  });
}

if (userCasesTableBody) {
  userCasesTableBody.addEventListener('click', (ev) => {
    if (!ev.target.closest('[data-user-continue-intake-draft]')) return;
    showUserView('instForm');
    loadIntakeDraftFromStorage();
  });
}
if (userPersonRequestsTableBody) {
  userPersonRequestsTableBody.addEventListener('click', (ev) => {
    if (!ev.target.closest('[data-user-continue-pv-draft]')) return;
    showUserView('personForm');
    loadPersonVettingDraftFromStorage();
  });
}

if (pvSaveDraftButton) {
  pvSaveDraftButton.addEventListener('click', (ev) => {
    ev.preventDefault();
    savePersonVettingDraftToStorage();
  });
}
if (pvLoadDraftButton) {
  pvLoadDraftButton.addEventListener('click', (ev) => {
    ev.preventDefault();
    loadPersonVettingDraftFromStorage();
  });
}

if (managerParTableBody) {
  managerParTableBody.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-delete-par-id]');
    if (!btn) return;
    const session = getSession();
    const mkPar = resolveManagerKeyForRequest(session);
    if (!isSessionCanDeleteSubmissions(session) || !mkPar) return;
    const id = btn.getAttribute('data-delete-par-id');
    if (!id || !window.confirm(t('admin.parDeleteConfirm'))) return;
    btn.disabled = true;
    setManagerParListMessage('', false);
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'delete_person_analysis',
          manager_key: mkPar,
          admin_email: session.email,
          person_analysis_id: id,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        throw new Error(data.message || t('admin.deleteFail'));
      }
      setManagerParListMessage(data.message || t('admin.parDeleteOk'), false);
      await loadManagerPersonAnalysisList();
    } catch (e) {
      setManagerParListMessage(e.message || t('admin.deleteFail'), true);
    } finally {
      btn.disabled = false;
    }
  });
}

if (btnEnterTesterMode) {
  btnEnterTesterMode.addEventListener('click', (ev) => {
    ev.preventDefault();
    enterTesterMode();
  });
}
if (btnExitTesterMode) {
  btnExitTesterMode.addEventListener('click', (ev) => {
    ev.preventDefault();
    exitTesterMode();
  });
}

refreshCasesButton.addEventListener('click', refreshOverview);
filterStatus.addEventListener('change', loadManagerCases);
filterPriority.addEventListener('change', loadManagerCases);

let searchTimeout;
if (searchCases) {
  searchCases.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(loadManagerCases, 300);
  });
}

let userSearchTimeout;
if (userCasesSearch) {
  userCasesSearch.addEventListener('input', () => {
    clearTimeout(userSearchTimeout);
    userSearchTimeout = setTimeout(loadUserCases, 300);
  });
}

if (navManagerDashboard) {
  navManagerDashboard.addEventListener('click', (ev) => {
    ev.preventDefault();
    showManagerView('dashboard');
  });
}
if (navManagerPar) {
  navManagerPar.addEventListener('click', (ev) => {
    ev.preventDefault();
    if (isManagerTesterSession(getSession())) return;
    showManagerView('par');
  });
}
if (hubBtnDashboard) {
  hubBtnDashboard.addEventListener('click', (ev) => {
    ev.preventDefault();
    showManagerView('dashboard');
  });
}
if (hubBtnPar) {
  hubBtnPar.addEventListener('click', (ev) => {
    ev.preventDefault();
    if (isManagerTesterSession(getSession())) return;
    showManagerView('par');
  });
}

function setPersonAnalysisFormMessage(text, isError) {
  if (!personAnalysisFormMessage) return;
  personAnalysisFormMessage.textContent = text || '';
  personAnalysisFormMessage.classList.toggle('hidden', !text);
  personAnalysisFormMessage.classList.toggle('login-success', Boolean(text) && !isError);
  personAnalysisFormMessage.style.color = isError ? 'var(--danger-text)' : '';
}

if (personAnalysisForm && personAnalysisSubmit) {
  personAnalysisForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setPersonAnalysisFormMessage('', false);
    const session = getSession();
    const mkPa = resolveManagerKeyForRequest(session);
    if (!session || session.role !== 'manager' || !mkPa || isManagerTesterSession(session)) {
      setPersonAnalysisFormMessage(t('manager.paFail'), true);
      return;
    }
    const fd = new FormData(personAnalysisForm);
    const payload = {
      action: 'submit_person_analysis',
      manager_key: mkPa,
      manager_email: session.email,
    };
    fd.forEach((value, key) => {
      if (typeof value === 'string') payload[key] = value.trim();
    });
    personAnalysisSubmit.disabled = true;
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        throw new Error(data.message || t('manager.paFail'));
      }
      const pid = String(data.person_analysis_id || '').trim();
      setPersonAnalysisFormMessage(t('manager.paOk', { id: pid || '—' }), false);
      personAnalysisForm.reset();
    } catch (err) {
      setPersonAnalysisFormMessage(err.message || t('manager.paFail'), true);
    } finally {
      personAnalysisSubmit.disabled = false;
    }
  });
}

function setPvFormMessage(text, isError) {
  if (!pvFormMessage) return;
  pvFormMessage.textContent = text || '';
  pvFormMessage.classList.toggle('hidden', !text);
  pvFormMessage.classList.toggle('login-success', Boolean(text) && !isError);
  pvFormMessage.style.color = isError ? 'var(--danger-text)' : '';
}

if (applicantPersonVettingForm && pvSubmit) {
  applicantPersonVettingForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setPvFormMessage('', false);
    const session = getSession();
    const asTester = isManagerTesterSession(session);
    if (!session || (session.role !== 'user' && !asTester)) {
      setPvFormMessage(t('user.pvFail'), true);
      return;
    }
    const fd = new FormData(applicantPersonVettingForm);
    const payload = { action: 'submit_applicant_person_vetting' };
    fd.forEach((value, key) => {
      if (typeof value !== 'string') return;
      if (key.startsWith('pv_')) {
        payload[key.replace(/^pv_/, '')] = value.trim();
      }
    });
    if (
      !payload.applicant_email ||
      !payload.applicant_name ||
      !payload.subject_legal_name ||
      !payload.request_summary
    ) {
      setPvFormMessage(t('user.pvFail'), true);
      return;
    }
    pvSubmit.disabled = true;
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        throw new Error(data.message || t('user.pvFail'));
      }
      const pid = String(data.person_analysis_id || '').trim();
      setPvFormMessage(t('user.pvOk', { id: pid || '—' }), false);
      applicantPersonVettingForm.reset();
      syncApplicantPersonVettingFromSession(getSession());
      clearPersonVettingDraftForCurrentUser();
      if (currentUserMainView === 'requests') {
        loadApplicantPersonRequests().catch(() => {});
      }
    } catch (err) {
      setPvFormMessage(err.message || t('user.pvFail'), true);
    } finally {
      pvSubmit.disabled = false;
    }
  });
}

function closeManagerCasePanel() {
  if (!managerCasePanel) return;
  closeManagerPromptDialog();
  managerCasePanel.classList.add('hidden');
  managerCasePanel.setAttribute('aria-hidden', 'true');
  managerEditCaseId.value = '';
  if (managerWorkflowSuggest) managerWorkflowSuggest.innerHTML = '';
  const intakeSummaryBody = document.getElementById('managerIntakeSummaryBody');
  if (intakeSummaryBody) intakeSummaryBody.innerHTML = '';
  if (managerCaseFile) managerCaseFile.value = '';
  if (managerCaseFormMessage) {
    managerCaseFormMessage.classList.add('hidden');
    managerCaseFormMessage.textContent = '';
    managerCaseFormMessage.classList.remove('login-success');
    managerCaseFormMessage.classList.remove('manager-case-form-msg--error');
  }
}

function getIrisPrompts() {
  return typeof globalThis.IRIS_PROMPTS !== 'undefined' ? globalThis.IRIS_PROMPTS : null;
}

function getCurrentManagerCaseItem() {
  const id = managerEditCaseId?.value?.trim();
  if (!id) return null;
  return managerCasesCache.find((c) => String(c.case_id) === String(id)) || null;
}

function buildCasePromptContext() {
  const item = getCurrentManagerCaseItem();
  const lines = [];
  lines.push('=== KONTEXT PŘÍPADU IRIS UHK ===');
  if (item) {
    const pick = (k) => String(item[k] ?? '').trim();
    lines.push(`Case ID: ${pick('case_id') || '—'}`);
    lines.push(`Referenční ID: ${pick('record_uid') || '—'}`);
    lines.push(`Název / předmět: ${pick('title') || '—'}`);
    lines.push(`Partner: ${pick('partner_name') || '—'}`);
    lines.push(`Země partnera: ${pick('partner_country') || pick('countries') || '—'}`);
    lines.push(`Web partnera: ${pick('partner_website') || '—'}`);
    lines.push(`Žadatel: ${pick('applicant_name') || '—'}`);
    lines.push(`E-mail žadatele: ${pick('applicant_email') || '—'}`);
    lines.push(`Součást UHK: ${pick('applicant_unit') || '—'}`);
    lines.push(`Typ spolupráce: ${pick('cooperation_type') || '—'}`);
    lines.push(`Fáze spolupráce: ${pick('cooperation_stage') || '—'}`);
    lines.push(`Popis záměru: ${pick('intent_description') || '—'}`);
    lines.push(`Stav případu: ${pick('status') || '—'}`);
    lines.push(`Úroveň rizika (evidence): ${pick('risk_level') || '—'}`);
    lines.push(`Skóre (checklist): ${pick('preliminary_risk_score') || '—'}`);
    lines.push(`Předběžný výsledek: ${pick('preliminary_result') || '—'}`);
    lines.push(`Závěr po prověrce (final_outcome): ${pick('final_outcome') || '—'}`);
    lines.push(`Priorita: ${pick('priority') || '—'}`);
  } else {
    lines.push('(Řádek případu v tabulce nebyl nalezen – doplňte identifikaci ručně.)');
  }
  lines.push('');
  lines.push('--- Vyplnění v panelu správce (může obsahovat neuložené úpravy) ---');
  if (managerCaseRiskLevel) lines.push(`Úroveň rizika (panel): ${managerCaseRiskLevel.value || '—'}`);
  if (managerCaseRiskScore) lines.push(`Skóre (panel): ${managerCaseRiskScore.value.trim() || '—'}`);
  if (managerCasePreliminaryResult) {
    lines.push(`Předběžný výsledek (panel): ${managerCasePreliminaryResult.value.trim() || '—'}`);
  }
  if (managerCaseFinalOutcome) lines.push(`Závěr po prověrce (panel): ${managerCaseFinalOutcome.value.trim() || '—'}`);
  if (managerCaseStatement) lines.push(`Vyjádření IRIS: ${managerCaseStatement.value.trim() || '—'}`);
  if (managerCaseNextStep) lines.push(`Další postup pro žadatele: ${managerCaseNextStep.value.trim() || '—'}`);
  if (managerAnalysisSubject) lines.push(`Analytika – předmět: ${managerAnalysisSubject.value.trim() || '—'}`);
  if (managerAnalysisScope) lines.push(`Analytika – rozsah / metodika: ${managerAnalysisScope.value.trim() || '—'}`);
  if (managerAnalysisConclusion) lines.push(`Analytika – závěr: ${managerAnalysisConclusion.value.trim() || '—'}`);
  if (managerAnalysisRecs) lines.push(`Analytika – doporučení: ${managerAnalysisRecs.value.trim() || '—'}`);
  if (managerAnalysisRecurrence) lines.push(`Analytika – obnova / follow-up: ${managerAnalysisRecurrence.value.trim() || '—'}`);
  if (managerCaseAnalysisUrl) lines.push(`Odkaz na dokument analýzy: ${managerCaseAnalysisUrl.value.trim() || '—'}`);
  lines.push('');
  lines.push(`Datum sestavení kontextu: ${new Date().toISOString()}`);
  return lines.join('\n');
}

async function copyManagerPromptToClipboard(text) {
  const msg = managerCaseFormMessage || document.getElementById('managerCaseFormMessage');
  try {
    await navigator.clipboard.writeText(String(text || ''));
    if (msg) {
      msg.textContent = t('manager.promptCopied');
      msg.classList.remove('hidden');
      msg.classList.add('login-success');
      msg.classList.remove('manager-case-form-msg--error');
    }
  } catch (_) {
    if (msg) {
      msg.textContent = t('manager.promptCopyFail');
      msg.classList.remove('hidden');
      msg.classList.remove('login-success');
      msg.classList.add('manager-case-form-msg--error');
    }
  }
}

function buildManagerPromptGpt() {
  const p = getIrisPrompts();
  const body = p && p.gptPartnerChecklistCs ? p.gptPartnerChecklistCs : '';
  if (!body) return `${t('manager.promptMissingTemplates')}\n\n${buildCasePromptContext()}`;
  return `${body}\n\n${buildCasePromptContext()}`;
}

function buildManagerPromptClaude() {
  const p = getIrisPrompts();
  const body = p && p.claudeAnalystCs ? p.claudeAnalystCs : '';
  if (!body) return `${t('manager.promptMissingTemplates')}\n\n${buildCasePromptContext()}`;
  return `${buildCasePromptContext()}\n\n---\nINSTRUKCE PRO MODEL (finální analytická zpráva):\n\n${body}`;
}

function buildManagerPromptClaudeSanctions() {
  const p = getIrisPrompts();
  const body = p && p.claudeSanctionsCs ? p.claudeSanctionsCs : '';
  if (!body) return `${t('manager.promptMissingTemplates')}\n\n${buildCasePromptContext()}`;
  return `${buildCasePromptContext()}\n\n---\nINSTRUKCE PRO MODEL (sankční prověrka):\n\n${body}`;
}

function refreshManagerPromptUi() {
  const elTitle = document.getElementById('managerPromptBlockTitle');
  if (elTitle) elTitle.textContent = t('manager.promptUiTitle');
  const elLead = document.getElementById('managerPromptBlockLead');
  if (elLead) elLead.textContent = t('manager.promptUiLead');
  const gpt = document.getElementById('managerPromptGptBtn');
  if (gpt) gpt.textContent = t('manager.promptUiBtnGpt');
  const cl = document.getElementById('managerPromptClaudeBtn');
  if (cl) cl.textContent = t('manager.promptUiBtnClaude');
  const san = document.getElementById('managerPromptClaudeSanctionsBtn');
  if (san) san.textContent = t('manager.promptUiBtnSanctions');
  const tip = document.getElementById('managerPromptDialogTip');
  if (tip) tip.textContent = t('manager.promptDialogTip');
  const copyBtn = document.getElementById('managerPromptDialogCopyBtn');
  if (copyBtn) copyBtn.textContent = t('manager.promptDialogCopy');
  const closeBtn = document.getElementById('managerPromptDialogCloseBtn');
  if (closeBtn) closeBtn.textContent = t('manager.promptDialogClose');
}

function closeManagerPromptDialog() {
  const dlg = document.getElementById('managerPromptDialog');
  if (!dlg) return;
  dlg.classList.remove('iris-prompt-dialog--open');
  if (typeof dlg.close === 'function') {
    try {
      dlg.close();
    } catch (_) {
      /* ignore */
    }
  }
}

function openManagerPromptDialog(title, text) {
  const dlg = document.getElementById('managerPromptDialog');
  const ta = document.getElementById('managerPromptDialogText');
  const h = document.getElementById('managerPromptDialogTitle');
  if (!dlg || !ta || !h) return;
  closeManagerPromptDialog();
  h.textContent = title;
  ta.value = text;
  if (typeof dlg.showModal === 'function') {
    try {
      dlg.showModal();
    } catch (_) {
      dlg.classList.add('iris-prompt-dialog--open');
    }
  } else {
    dlg.classList.add('iris-prompt-dialog--open');
  }
  window.requestAnimationFrame(() => {
    try {
      ta.focus();
      ta.select();
    } catch (_) {
      /* ignore */
    }
  });
}

function showManagerPromptNeedCaseError() {
  const msg = document.getElementById('managerCaseFormMessage');
  if (!msg) return;
  msg.textContent = t('manager.promptNeedCase');
  msg.classList.remove('hidden');
  msg.classList.remove('login-success');
  msg.classList.add('manager-case-form-msg--error');
}

function handleManagerPromptOpen(kind) {
  if (!managerEditCaseId?.value?.trim()) {
    showManagerPromptNeedCaseError();
    return;
  }
  let title;
  let body;
  if (kind === 'gpt') {
    title = t('manager.promptDialogTitleGpt');
    body = buildManagerPromptGpt();
  } else if (kind === 'claude') {
    title = t('manager.promptDialogTitleClaude');
    body = buildManagerPromptClaude();
  } else {
    title = t('manager.promptDialogTitleSanctions');
    body = buildManagerPromptClaudeSanctions();
  }
  openManagerPromptDialog(title, body);
}

function openManagerCasePanel(caseId, recordUid) {
  const wantUid = String(recordUid || '').trim();
  let item = null;
  if (wantUid) {
    item = managerCasesCache.find((c) => String(c.record_uid || '').trim() === wantUid);
  }
  if (!item) {
    item = managerCasesCache.find((c) => String(c.case_id) === String(caseId));
  }
  if (!item || !managerCasePanel) return;

  managerEditCaseId.value = String(item.case_id);
  managerCasePanelTitle.textContent = `${t('case.editPrefix')} ${item.case_id}`;
  const refLine = String(item.record_uid || '').trim()
    ? `${t('tbl.refUidShort')}: ${refUidShortDisplay(item.record_uid)} (${item.record_uid})`
    : '';
  managerCasePanelSubtitle.textContent = [refLine, item.title, item.applicant_name].filter(Boolean).join(' · ');

  const st = String(item.status || 'new');
  managerCaseStatus.value = [...managerCaseStatus.options].some((o) => o.value === st) ? st : 'new';

  const allowedRisk = ['nízké', 'střední', 'vysoké'];
  const rlRaw = String(item.risk_level || '').trim();
  if (managerCaseRiskLevel) {
    managerCaseRiskLevel.value = allowedRisk.includes(rlRaw) ? rlRaw : 'střední';
  }
  if (managerCaseRiskScore) {
    const sc = item.preliminary_risk_score;
    managerCaseRiskScore.value =
      sc !== undefined && sc !== null && String(sc).trim() !== '' && !Number.isNaN(Number(sc)) ? String(sc) : '';
  }
  if (managerCasePreliminaryResult) {
    managerCasePreliminaryResult.value = buildPreliminaryFromIntake(item);
  }
  renderManagerIntakeSummary(item);
  if (managerCaseFinalOutcome) {
    managerCaseFinalOutcome.value = String(item.final_outcome || '');
  }

  setManagerRiskDimensionSelect(managerRiskReputational, item.risk_reputational);
  setManagerRiskDimensionSelect(managerRiskLegal, item.risk_legal);
  setManagerRiskDimensionSelect(managerRiskFinancial, item.risk_financial);
  setManagerRiskDimensionSelect(managerRiskSecurity, item.risk_security);
  setManagerRiskDimensionSelect(managerRiskEthical, item.risk_ethical);
  setManagerRiskDimensionSelect(managerRiskOther, item.risk_other);

  const hasStoredDue = item.due_date != null && String(item.due_date).trim() !== '';
  if (managerCaseDue) {
    if (hasStoredDue) {
      managerCaseDue.value = toDatetimeLocalValue(item.due_date);
    } else {
      const mile = computeMilestoneSuggestions(item);
      managerCaseDue.value = toDatetimeLocalValue(mile.nearest.date.toISOString());
    }
  }
  renderManagerMilestones(item);

  if (managerCaseNextStep) managerCaseNextStep.value = String(item.next_step_note || '');
  managerCaseStatement.value = String(item.iris_statement || '');
  managerCaseAnalysisUrl.value = analysisUrlForItem(item) || '';
  managerCaseFile.value = '';
  managerCaseFormMessage.classList.add('hidden');

  renderManagerWorkflowSuggest(item);
  const analysisDraft = composeAnalysisDraftFromCase(item);
  if (managerAnalysisSubject) {
    managerAnalysisSubject.value = String(item.analysis_subject || '').trim() || analysisDraft.subject;
  }
  if (managerAnalysisScope) {
    managerAnalysisScope.value = String(item.analysis_scope_methodology || '').trim() || analysisDraft.scope;
  }
  if (managerAnalysisConclusion) {
    managerAnalysisConclusion.value = String(item.analysis_conclusion || '').trim() || analysisDraft.conclusion;
  }
  if (managerAnalysisRecs) {
    managerAnalysisRecs.value = String(item.analysis_recommendations || '').trim() || analysisDraft.recs;
  }
  if (managerAnalysisRecurrence) {
    managerAnalysisRecurrence.value =
      String(item.analysis_recurrence_note || '').trim() || analysisDraft.recurrence;
  }
  if (managerNextAnalysisDue) managerNextAnalysisDue.value = dateInputFromCellValue(item.next_analysis_due);

  if (managerCaseDelete) {
    managerCaseDelete.classList.toggle('hidden', !isSessionCanDeleteSubmissions(getSession()));
  }

  if (managerQuickActionFeedback) {
    managerQuickActionFeedback.classList.add('hidden');
    managerQuickActionFeedback.textContent = '';
  }

  managerCasePanel.classList.remove('hidden');
  managerCasePanel.setAttribute('aria-hidden', 'false');
  applyStaticI18n();
  managerCasePanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

casesTableBody.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-manage-case]');
  if (!btn) return;
  openManagerCasePanel(btn.getAttribute('data-manage-case'), btn.getAttribute('data-record-uid'));
});

managerCaseCancel.addEventListener('click', () => closeManagerCasePanel());

(function bindManagerPromptDialog() {
  const dlg = document.getElementById('managerPromptDialog');
  if (dlg) {
    dlg.addEventListener('close', () => dlg.classList.remove('iris-prompt-dialog--open'));
  }
  document.getElementById('managerPromptDialogCloseBtn')?.addEventListener('click', () => closeManagerPromptDialog());
  document.getElementById('managerPromptDialogCopyBtn')?.addEventListener('click', async () => {
    const ta = document.getElementById('managerPromptDialogText');
    await copyManagerPromptToClipboard(ta ? ta.value : '');
  });
})();

if (managerCasePanel) {
  managerCasePanel.addEventListener('click', (ev) => {
    const quickBtn = ev.target.closest('[data-manager-quick]');
    if (quickBtn && managerCasePanel.contains(quickBtn)) {
      const qk = quickBtn.getAttribute('data-manager-quick');
      if (qk) {
        ev.preventDefault();
        applyManagerQuickAction(qk);
        return;
      }
    }
    const btn = ev.target.closest('button');
    if (!btn || !managerCasePanel.contains(btn)) return;
    if (btn.id === 'managerPromptGptBtn') {
      ev.preventDefault();
      handleManagerPromptOpen('gpt');
    } else if (btn.id === 'managerPromptClaudeBtn') {
      ev.preventDefault();
      handleManagerPromptOpen('claude');
    } else if (btn.id === 'managerPromptClaudeSanctionsBtn') {
      ev.preventDefault();
      handleManagerPromptOpen('sanctions');
    }
  });
}

if (managerCaseDelete) {
  managerCaseDelete.addEventListener('click', async () => {
    const session = getSession();
    const mkDel = resolveManagerKeyForRequest(session);
    if (!session || !isSessionCanDeleteSubmissions(session) || !mkDel) return;
    const caseId = managerEditCaseId.value.trim();
    if (!caseId) return;
    if (!window.confirm(t('admin.deleteConfirm'))) return;
    managerCaseDelete.disabled = true;
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'delete_submission',
          manager_key: mkDel,
          admin_email: session.email,
          case_id: caseId,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message || t('admin.deleteFail'));
      }
      setManagerStatus(data.message || t('admin.deleteOk'), false);
      closeManagerCasePanel();
      await loadManagerCases();
      await loadDashboard();
    } catch (e) {
      setManagerStatus(e.message || t('admin.deleteFail'), true);
    } finally {
      managerCaseDelete.disabled = false;
    }
  });
}

if (copyRequestRefBtn && requestRefCode) {
  copyRequestRefBtn.addEventListener('click', async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const text = requestRefCode.textContent.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      if (copyRequestRefFeedback) {
        copyRequestRefFeedback.textContent = t('user.copied');
        copyRequestRefFeedback.classList.remove('hidden');
      }
    } catch (_) {
      if (copyRequestRefFeedback) {
        copyRequestRefFeedback.textContent = t('user.copyFail');
        copyRequestRefFeedback.classList.remove('hidden');
      }
    }
  });
}

if (downloadRefTxtBtn) {
  downloadRefTxtBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    if (lastSubmitResponse) {
      downloadSubmissionRefTxt(lastSubmitResponse);
    }
  });
}

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

  const mkSave = resolveManagerKeyForRequest(session);
  if (mkSave) {
    payload.manager_key = mkSave;
  }

  if (managerCaseRiskLevel) {
    payload.risk_level = managerCaseRiskLevel.value;
  }
  if (managerCaseRiskScore) {
    payload.preliminary_risk_score = managerCaseRiskScore.value.trim();
  }
  if (managerCasePreliminaryResult) {
    payload.preliminary_result = managerCasePreliminaryResult.value;
  }
  if (managerCaseFinalOutcome) {
    payload.final_outcome = managerCaseFinalOutcome.value;
  }

  if (managerRiskReputational) {
    payload.risk_reputational = managerRiskReputational.value;
    payload.risk_legal = managerRiskLegal.value;
    payload.risk_financial = managerRiskFinancial.value;
    payload.risk_security = managerRiskSecurity.value;
    payload.risk_ethical = managerRiskEthical.value;
    payload.risk_other = managerRiskOther.value;
  }

  const dueVal = managerCaseDue ? managerCaseDue.value : '';
  if (dueVal) {
    payload.due_date = new Date(dueVal).toISOString();
  }

  const urlVal = managerCaseAnalysisUrl.value.trim();
  if (urlVal) {
    payload.analysis_document_url = urlVal;
  }

  if (managerAnalysisSubject) {
    payload.analysis_subject = managerAnalysisSubject.value.trim();
    payload.analysis_scope_methodology = managerAnalysisScope.value.trim();
    payload.analysis_conclusion = managerAnalysisConclusion.value.trim();
    payload.analysis_recommendations = managerAnalysisRecs.value.trim();
    payload.analysis_recurrence_note = managerAnalysisRecurrence.value.trim();
  }
  if (managerNextAnalysisDue && managerNextAnalysisDue.value) {
    payload.next_analysis_due = new Date(`${managerNextAnalysisDue.value}T12:00:00`).toISOString();
  }

  const file = managerCaseFile.files && managerCaseFile.files[0];
  if (file) {
    if (file.size > 8 * 1024 * 1024) {
      managerCaseFormMessage.textContent = t('file.tooBig');
      managerCaseFormMessage.classList.remove('hidden');
      return;
    }
    try {
      payload.analysis_file_base64 = await readFileAsBase64(file);
      payload.analysis_file_name = file.name;
      payload.analysis_file_mime = file.type || 'application/pdf';
    } catch (err) {
      managerCaseFormMessage.textContent = err.message || t('file.readErr');
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
      throw new Error(data.message || t('case.saveFail'));
    }

    await loadManagerCases();
    await loadDashboard();
    closeManagerCasePanel();
    setManagerStatus(data.message || t('case.saved'), false);
  } catch (err) {
    managerCaseFormMessage.textContent = err.message || t('case.saveFail');
    managerCaseFormMessage.classList.remove('hidden');
    managerCaseFormMessage.classList.remove('login-success');
  } finally {
    managerCaseSave.disabled = false;
  }
});

function setLang(lang) {
  if (lang !== 'cs' && lang !== 'en') return;
  currentLang = lang;
  try {
    localStorage.setItem(LANG_STORAGE, lang);
  } catch (_) {
    /* ignore */
  }
  applyStaticI18n();
  document.querySelectorAll('[data-set-lang]').forEach((btn) => {
    const l = btn.getAttribute('data-set-lang');
    const active = l === lang;
    btn.classList.toggle('lang-btn--active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  const session = getSession();
  if (session) {
    sessionBadge.textContent = formatSessionBadge(session);
    updateTesterModeButtons(session);
    updateManagerSubNav(session);
    refreshForRole().catch(() => {});
  }
  const sessBanner = getSession();
  if (isManagerTesterSession(sessBanner) && testerModeBanner) {
    testerModeBanner.textContent = t('manager.testerBanner');
  }
  if (resultDetails && statusMessage) {
    if (resultDetails.classList.contains('hidden')) {
      const cur = statusMessage.textContent.trim();
      if (cur === STRINGS.cs['user.statusNone'] || cur === STRINGS.en['user.statusNone']) {
        setStatus(t('user.statusNone'), 'neutral');
      }
    }
  }
  const sessAfter = getSession();
  if (sessAfter && sessAfter.role === 'manager' && !isManagerTesterSession(sessAfter)) {
    updateManagerReminderBanner(lastDashboardSummary);
  }
}

function bindLangButtons() {
  document.querySelectorAll('[data-set-lang]').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const lang = btn.getAttribute('data-set-lang');
      if (lang) setLang(lang);
    });
  });
}

(function init() {
  try {
    const saved = localStorage.getItem(LANG_STORAGE);
    if (saved === 'en' || saved === 'cs') currentLang = saved;
  } catch (_) {
    /* ignore */
  }
  applyStaticI18n();
  document.querySelectorAll('[data-set-lang]').forEach((btn) => {
    const l = btn.getAttribute('data-set-lang');
    const active = l === currentLang;
    btn.classList.toggle('lang-btn--active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  bindLangButtons();

  const session = getSession();
  if (session) {
    showApp(session);
    refreshForRole();
  } else {
    showLogin();
  }
})();
