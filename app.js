/**
 * IRIS UHK – frontend
 *
 * Očekávané rozšíření Google Apps Script (stejný deploy URL jako dosud):
 *
 * 1) POST JSON: { "action": "login", "email": "...", "password": "...", "role": "user" | "manager" }
 *    → { "ok": true, "role": "user"|"manager", "email": "...", "manager_key"?, "is_admin"? }
 *    (is_admin: true jen pokud sloupec role v Users = admin – zobrazí se interní stránka Prověrky.)
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
 * 6) POST { action: 'delete_submission', manager_key, admin_email, case_id } – smazání případu/podání (jen role admin v Users).
 */

const API_URL =
  'https://script.google.com/macros/s/AKfycbyN8uGoqSqqH26K7eBzTx-QmE08e-27fWJRws5QcM6Dm6dl2NEGAygFak9T7X0rzYpZ6Q/exec';

const SESSION_KEY = 'iris_uhk_session';
const INTAKE_DRAFT_PREFIX = 'iris_intake_draft_v2_';

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
    'manager.hubTitle': 'Rozcestník',
    'manager.hubLead':
      'Metodické check-listy pro prověřování subjektů. Přehled případů a dashboard IRIS otevřete záložkou „Přehled IRIS“.',
    'manager.hubInstitutionsTitle': 'Check-list institucí a organizací',
    'manager.hubInstitutionsDesc': 'Základní rámec DD a OSINT pro právnické osoby a partnery.',
    'manager.hubPersonsTitle': 'Check-list osob',
    'manager.hubPersonsDesc': 'Základy prověrky fyzických osob (OSINT, due diligence).',
    'manager.navInstitutions': 'Instituce a organizace',
    'manager.navPersons': 'Osoby',
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
    'manager.hubTitle': 'Directory',
    'manager.hubLead':
      'Methodology checklists for vetting subjects. Open the case dashboard with “IRIS overview”.',
    'manager.hubInstitutionsTitle': 'Institutions and organisations checklist',
    'manager.hubInstitutionsDesc': 'Basic DD and OSINT framework for legal entities and partners.',
    'manager.hubPersonsTitle': 'Individuals checklist',
    'manager.hubPersonsDesc': 'Basics for vetting natural persons (OSINT, due diligence).',
    'manager.navInstitutions': 'Institutions & organisations',
    'manager.navPersons': 'Individuals',
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

function t(key, vars) {
  let s = STRINGS[currentLang]?.[key];
  if (s === undefined || s === '') s = STRINGS.cs[key];
  if (s === undefined) s = key;
  if (vars && typeof s === 'string') {
    Object.entries(vars).forEach(([k, v]) => {
      s = s.split(`{${k}}`).join(String(v));
    });
  }
  return s;
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
}

/** Dočasné řešení: prázdné = vypnuto. Pokud máte v Apps Scriptu IRIS_MANAGER_KEY, nastavte stejnou hodnotu do MANAGER_STATIC_KEY, aby fungovalo PIN přihlášení správce. */
const MANAGER_FALLBACK_CODE = '';
const MANAGER_STATIC_KEY = '';
/** U PIN přihlášení: zda zobrazit admin sekci Prověrky (bez ověření z listu Users). */
const MANAGER_PIN_AS_ADMIN = false;

const form = document.getElementById('intakeForm');
const submitButton = document.getElementById('submitButton');
const saveDraftButton = document.getElementById('saveDraftButton');
const loadDraftButton = document.getElementById('loadDraftButton');
const fillDemoButton = document.getElementById('fillDemoButton');

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
const navManagerInstitutions = document.getElementById('navManagerInstitutions');
const navManagerPersons = document.getElementById('navManagerPersons');
const managerHub = document.getElementById('managerHub');
const hubBtnInstitutions = document.getElementById('hubBtnInstitutions');
const hubBtnPersons = document.getElementById('hubBtnPersons');
const managerViewDashboard = document.getElementById('managerViewDashboard');
const managerViewInstitutions = document.getElementById('managerViewInstitutions');
const managerViewPersons = document.getElementById('managerViewPersons');
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
const managerQuickClose = document.getElementById('managerQuickClose');
const managerQuickAnalysis = document.getElementById('managerQuickAnalysis');
const managerQuickDeep = document.getElementById('managerQuickDeep');
const managerAnalysisSubject = document.getElementById('managerAnalysisSubject');
const managerAnalysisScope = document.getElementById('managerAnalysisScope');
const managerAnalysisConclusion = document.getElementById('managerAnalysisConclusion');
const managerAnalysisRecs = document.getElementById('managerAnalysisRecs');
const managerAnalysisRecurrence = document.getElementById('managerAnalysisRecurrence');
const managerNextAnalysisDue = document.getElementById('managerNextAnalysisDue');

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

function showManagerView(which) {
  const w = String(which || 'dashboard');
  const dash = w === 'dashboard';
  const inst = w === 'institutions';
  const pers = w === 'persons';

  if (managerViewDashboard) {
    managerViewDashboard.classList.toggle('hidden', !dash);
  }
  if (managerViewInstitutions) {
    managerViewInstitutions.classList.toggle('hidden', !inst);
  }
  if (managerViewPersons) {
    managerViewPersons.classList.toggle('hidden', !pers);
  }
  if (navManagerDashboard) {
    navManagerDashboard.classList.toggle('is-active', dash);
  }
  if (navManagerInstitutions) {
    navManagerInstitutions.classList.toggle('is-active', inst);
  }
  if (navManagerPersons) {
    navManagerPersons.classList.toggle('is-active', pers);
  }
  if (!dash) {
    closeManagerCasePanel();
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
}

function enterTesterMode() {
  const session = getSession();
  if (!session || session.role !== 'manager') return;
  setSession({
    email: session.email,
    role: 'manager',
    managerKey: session.managerKey || '',
    isAdmin: session.isAdmin === true,
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
    managerKey: session.managerKey || '',
    isAdmin: session.isAdmin === true,
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
    if (resultDetails.classList.contains('hidden')) {
      setStatus(t('user.statusNone'), 'neutral');
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
  if (kind === 'close') {
    managerCaseStatus.value = 'closed';
    managerCaseNextStep.value = t('manager.preset.close');
    managerCaseDue.value = '';
  } else if (kind === 'analysis') {
    managerCaseStatus.value = 'analysis_in_progress';
    managerCaseNextStep.value = t('manager.preset.analysis');
    managerCaseDue.value = toDatetimeLocalValue(addCalendarDays(new Date(), 14));
  } else if (kind === 'deep') {
    managerCaseStatus.value = 'dd_in_progress';
    managerCaseNextStep.value = t('manager.preset.deep');
    managerCaseDue.value = toDatetimeLocalValue(addCalendarDays(new Date(), 21));
  }
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

function renderManagerCases(items) {
  if (!items || !items.length) {
    casesTableBody.innerHTML = `<tr><td colspan="11" class="empty-row">${escapeHtml(t('manager.empty'))}</td></tr>`;
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
      return `
    <tr class="${rowCls}">
      <td>${escapeHtml(item.case_id)}</td>
      <td class="cell-record-uid"><code translate="no" title="${ruidAttr}">${escapeHtml(ruid || t('common.emDash'))}</code></td>
      <td>${dueDateCellHtml(item)}</td>
      <td>${escapeHtml(formatDate(item.created_at))}</td>
      <td>${escapeHtml(item.title)}</td>
      <td>${escapeHtml(item.partner_name)}</td>
      <td>${escapeHtml(item.applicant_name)}</td>
      <td>${escapeHtml(caseStatusLabel(item.status))}</td>
      <td>${escapeHtml(item.priority)}</td>
      <td>${escapeHtml(item.risk_level)}</td>
      <td><button type="button" class="btn-secondary btn-compact" data-manage-case="${escapeHtml(item.case_id)}" data-record-uid="${escapeAttr(ruid)}">${manageLabel}</button></td>
    </tr>`;
    })
    .join('');
}

function renderUserCases(items) {
  if (!items || !items.length) {
    userCasesTableBody.innerHTML = `<tr><td colspan="10" class="empty-row">${escapeHtml(t('user.empty'))}</td></tr>`;
    return;
  }

  userCasesTableBody.innerHTML = items
    .map((item) => {
      let rowCls = '';
      if (isCaseOverdue(item)) rowCls = 'row-overdue';
      else if (isCaseDueSoon(item)) rowCls = 'row-due-soon';
      const nextText = nextStepForUser(item);
      const stmt = cellPreview(item.iris_statement, 120);
      const ruid = String(item.record_uid || '').trim();
      return `
    <tr class="${rowCls}">
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

  if (session && session.role === 'manager' && session.managerKey) {
    params.set('manager_key', session.managerKey);
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
  casesTableBody.innerHTML = `<tr><td colspan="11" class="empty-row">${escapeHtml(t('manager.loadingCases'))}</td></tr>`;

  const response = await fetch(`${API_URL}?${buildCasesParams().toString()}`);
  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(data.message || t('cases.loadFail'));
  }

  managerCasesCache = data.items || [];
  renderManagerCases(managerCasesCache);
}

async function loadUserCases() {
  userCasesTableBody.innerHTML = `<tr><td colspan="10" class="empty-row">${escapeHtml(t('user.loadingRow'))}</td></tr>`;

  const params = buildCasesParams();
  const response = await fetch(`${API_URL}?${params.toString()}`);
  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(data.message || t('cases.userLoadFail'));
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
      if (isManagerTesterSession(session)) {
        await loadUserCases();
      } else {
        await loadDashboard();
        await loadManagerCases();
      }
    } else {
      await loadUserCases();
    }
  } catch (error) {
    if (session.role === 'manager' && !isManagerTesterSession(session)) {
      setManagerStatus(error.message || t('cases.loadFail'), true);
    } else {
      userCasesTableBody.innerHTML = `<tr><td colspan="10" class="empty-row">${escapeHtml(
        error.message || t('cases.userLoadFail')
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
  const asTester = isManagerTesterSession(session);
  if (!session || (session.role !== 'user' && !asTester)) {
    setStatus(t('err.userOnlySubmit'), 'error');
    return;
  }
  if (asTester && !session.managerKey) {
    setStatus(t('err.testIntakeNoKey'), 'error');
    return;
  }

  const payload = collectFormData();
  if (asTester) {
    payload.test_intake = true;
    payload.manager_key = session.managerKey;
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
if (navManagerInstitutions) {
  navManagerInstitutions.addEventListener('click', (ev) => {
    ev.preventDefault();
    if (isManagerTesterSession(getSession())) return;
    showManagerView('institutions');
  });
}
if (navManagerPersons) {
  navManagerPersons.addEventListener('click', (ev) => {
    ev.preventDefault();
    if (isManagerTesterSession(getSession())) return;
    showManagerView('persons');
  });
}
if (hubBtnInstitutions) {
  hubBtnInstitutions.addEventListener('click', (ev) => {
    ev.preventDefault();
    if (isManagerTesterSession(getSession())) return;
    showManagerView('institutions');
  });
}
if (hubBtnPersons) {
  hubBtnPersons.addEventListener('click', (ev) => {
    ev.preventDefault();
    if (isManagerTesterSession(getSession())) return;
    showManagerView('persons');
  });
}

function closeManagerCasePanel() {
  if (!managerCasePanel) return;
  managerCasePanel.classList.add('hidden');
  managerCasePanel.setAttribute('aria-hidden', 'true');
  managerEditCaseId.value = '';
  if (managerWorkflowSuggest) managerWorkflowSuggest.innerHTML = '';
  if (managerCaseFile) managerCaseFile.value = '';
  if (managerCaseFormMessage) {
    managerCaseFormMessage.classList.add('hidden');
    managerCaseFormMessage.textContent = '';
    managerCaseFormMessage.classList.remove('login-success');
  }
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
    ? `${t('tbl.refUid')}: ${item.record_uid}`
    : '';
  managerCasePanelSubtitle.textContent = [refLine, item.title, item.applicant_name].filter(Boolean).join(' · ');

  const st = String(item.status || 'new');
  managerCaseStatus.value = [...managerCaseStatus.options].some((o) => o.value === st) ? st : 'new';

  managerCaseDue.value = toDatetimeLocalValue(item.due_date);
  managerCaseNextStep.value = String(item.next_step_note || '');
  managerCaseStatement.value = String(item.iris_statement || '');
  managerCaseAnalysisUrl.value = analysisUrlForItem(item) || '';
  managerCaseFile.value = '';
  managerCaseFormMessage.classList.add('hidden');

  renderManagerWorkflowSuggest(item);
  if (managerAnalysisSubject) managerAnalysisSubject.value = String(item.analysis_subject || '');
  if (managerAnalysisScope) managerAnalysisScope.value = String(item.analysis_scope_methodology || '');
  if (managerAnalysisConclusion) managerAnalysisConclusion.value = String(item.analysis_conclusion || '');
  if (managerAnalysisRecs) managerAnalysisRecs.value = String(item.analysis_recommendations || '');
  if (managerAnalysisRecurrence) managerAnalysisRecurrence.value = String(item.analysis_recurrence_note || '');
  if (managerNextAnalysisDue) managerNextAnalysisDue.value = dateInputFromCellValue(item.next_analysis_due);

  if (managerCaseDelete) {
    managerCaseDelete.classList.toggle('hidden', !isSessionAdmin(getSession()));
  }

  managerCasePanel.classList.remove('hidden');
  managerCasePanel.setAttribute('aria-hidden', 'false');
  managerCasePanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

casesTableBody.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-manage-case]');
  if (!btn) return;
  openManagerCasePanel(btn.getAttribute('data-manage-case'), btn.getAttribute('data-record-uid'));
});

managerCaseCancel.addEventListener('click', () => closeManagerCasePanel());

if (managerCaseDelete) {
  managerCaseDelete.addEventListener('click', async () => {
    const session = getSession();
    if (!session || !isSessionAdmin(session) || !session.managerKey) return;
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
          manager_key: session.managerKey,
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

if (managerQuickClose) {
  managerQuickClose.addEventListener('click', () => applyManagerQuickAction('close'));
}
if (managerQuickAnalysis) {
  managerQuickAnalysis.addEventListener('click', () => applyManagerQuickAction('analysis'));
}
if (managerQuickDeep) {
  managerQuickDeep.addEventListener('click', () => applyManagerQuickAction('deep'));
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
