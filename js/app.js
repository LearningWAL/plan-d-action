/* UI controller: wires the deterministic pipeline, the optional AI layer and the exports. */
(function (g) {
  'use strict';
  const PDA = g.PDA;
  const T = PDA.text;
  const esc = T.escapeHtml;
  const $ = (id) => document.getElementById(id);

  const PROJECT_KEY = 'pda.project.v1';
  const AI_PREFS_KEY = 'pda.aiprefs.v1';
  const MAPPINGS_KEY = 'pda.mappings.v1';
  const AI_PREF_FIELDS = ['provider', 'model', 'baseUrl', 'endpoint', 'deployment', 'apiVersion', 'azureMode', 'proxyUrl', 'pseudonymize', 'terms'];

  const state = {
    questionnaire: null,
    mapping: null,
    referentials: [],
    settings: Object.assign({}, PDA.planBuilder.DEFAULT_SETTINGS),
    actions: [],
    ai: { provider: 'openai', model: '', baseUrl: '', endpoint: '', deployment: '', apiVersion: '', azureMode: 'openai', proxyUrl: '', pseudonymize: true, terms: '' }
  };
  let qWorkbook = null, qRows = null;
  let aiAuthorized = false;           // memory only: must be re-confirmed in every session
  let lastTest = null;                // { sig, ok, text }
  let aiBusy = false;
  let planEdited = false;
  const selection = new Set();
  const openDetails = new Set();

  // ---------- storage helpers (never used for secrets) ----------
  function store(kind) { try { return g[kind]; } catch (e) { return null; } }
  function readJson(kind, key) { try { const s = store(kind); const v = s && s.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function writeJson(kind, key, obj) { try { const s = store(kind); if (s) s.setItem(key, JSON.stringify(obj)); } catch (e) { /* quota or blocked */ } }

  let saveTimer = null;
  function persistProject() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const json = PDA.exporter.exportProjectJson(state);
        const s = store('sessionStorage');
        if (s) s.setItem(PROJECT_KEY, json);
      } catch (e) { /* secret detected or quota exceeded: skip autosave */ }
    }, 400);
  }

  function saveAiPrefs() {
    const p = {};
    for (const f of AI_PREF_FIELDS) p[f] = state.ai[f];
    writeJson('localStorage', AI_PREFS_KEY, p);
  }

  function toast(msg, isError) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (isError ? ' error' : '');
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, isError ? 9000 : 4000);
  }

  function switchTab(name) {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
  }

  // ---------- 1. Questionnaire ----------
  async function onQuestionnaireFile(file) {
    try {
      qWorkbook = PDA.importer.readWorkbook(await file.arrayBuffer());
      const sheets = qWorkbook.SheetNames;
      const best = sheets.reduce((b, n) => (PDA.importer.sheetRows(qWorkbook, n).length > PDA.importer.sheetRows(qWorkbook, b).length ? n : b), sheets[0]);
      state.questionnaire = { fileName: file.name, sheetName: best, sheets, headerRow: 1, headers: [], records: [] };
      loadSheet(best, true);
    } catch (e) {
      toast('Lecture du fichier impossible : ' + e.message, true);
    }
  }

  function loadSheet(name, autoHeader) {
    qRows = PDA.importer.sheetRows(qWorkbook, name);
    state.questionnaire.sheetName = name;
    const idx = autoHeader ? PDA.importer.detectHeaderRow(qRows) : state.questionnaire.headerRow - 1;
    applyHeader(idx);
  }

  function applyHeader(idx) {
    const table = PDA.importer.buildTable(qRows, Math.max(0, idx));
    Object.assign(state.questionnaire, { headerRow: idx + 1, headers: table.headers, records: table.records });
    const remembered = readJson('localStorage', MAPPINGS_KEY) || {};
    const sig = PDA.importer.headerSignature(table.headers);
    state.mapping = remembered[sig] || PDA.importer.guessMapping(table.headers);
    renderQuestionnaire();
    persistProject();
  }

  function rememberMapping() {
    const all = readJson('localStorage', MAPPINGS_KEY) || {};
    all[PDA.importer.headerSignature(state.questionnaire.headers)] = state.mapping;
    const keys = Object.keys(all);
    if (keys.length > 30) delete all[keys[0]];
    writeJson('localStorage', MAPPINGS_KEY, all);
  }

  function renderQuestionnaire() {
    const q = state.questionnaire;
    $('q-meta').classList.toggle('hidden', !q);
    $('q-mapping-card').classList.toggle('hidden', !q);
    if (!q) return;
    const sheets = q.sheets || [q.sheetName];
    $('q-sheet').innerHTML = sheets.map((s) => '<option' + (s === q.sheetName ? ' selected' : '') + '>' + esc(s) + '</option>').join('');
    $('q-sheet').disabled = !qWorkbook;
    $('q-header').value = q.headerRow;
    $('q-header').disabled = !qWorkbook;
    $('q-count').textContent = (q.fileName || '') + ' — ' + q.records.length + ' ligne(s) de données' + (qWorkbook ? '' : ' (restauré depuis le projet)');
    renderMapping();
  }

  function headerOptions(selected) {
    return '<option value="-1">— Aucune —</option>' + state.questionnaire.headers
      .map((h, i) => '<option value="' + i + '"' + (i === selected ? ' selected' : '') + '>' + esc(h) + '</option>').join('');
  }

  function renderMapping() {
    const m = state.mapping;
    $('q-mapping').innerHTML = PDA.importer.FIELDS.map((f) => {
      if (f.multi) {
        const boxes = state.questionnaire.headers.map((h, i) =>
          '<label><input type="checkbox" data-map="' + f.key + '" value="' + i + '"' + ((m[f.key] || []).includes(i) ? ' checked' : '') + '> ' + esc(h) + '</label>').join('');
        return '<div><label>' + esc(f.label) + '</label><div class="multi">' + boxes + '</div></div>';
      }
      return '<label>' + esc(f.label) + '<select data-map="' + f.key + '">' + headerOptions(m[f.key]) + '</select></label>';
    }).join('');
    $('q-mapping-errors').textContent = PDA.importer.validateMapping(m).join(' ');
    renderPreview();
  }

  function renderPreview() {
    const q = state.questionnaire, m = state.mapping;
    const labels = {};
    for (const f of PDA.importer.FIELDS) {
      const v = m[f.key];
      (Array.isArray(v) ? v : [v]).forEach((i) => { if (i != null && i >= 0) labels[i] = f.label.replace(' (obligatoire)', ''); });
    }
    const head = '<tr>' + q.headers.map((h, i) => '<th class="' + (labels[i] ? 'mapped' : '') + '" title="' + esc(labels[i] || '') + '">' + esc(h) + (labels[i] ? '<br><small>→ ' + esc(labels[i]) + '</small>' : '') + '</th>').join('') + '</tr>';
    const body = q.records.slice(0, 5).map((r) => '<tr>' + r.cells.map((c) => '<td title="' + esc(c) + '">' + esc(T.truncate(c, 80)) + '</td>').join('') + '</tr>').join('');
    $('q-preview').innerHTML = '<thead>' + head + '</thead><tbody>' + body + '</tbody>';
  }

  function onMappingChange(e) {
    const el = e.target;
    const key = el.dataset.map;
    if (!key) return;
    if (el.type === 'checkbox') {
      const set = new Set(state.mapping[key] || []);
      if (el.checked) set.add(Number(el.value)); else set.delete(Number(el.value));
      state.mapping[key] = Array.from(set).sort((a, b) => a - b);
    } else {
      const v = Number(el.value);
      state.mapping[key] = v < 0 ? null : v;
    }
    rememberMapping();
    $('q-mapping-errors').textContent = PDA.importer.validateMapping(state.mapping).join(' ');
    renderPreview();
    persistProject();
  }

  // ---------- 2. Referentials ----------
  let pendingRef = null; // { name, wb, rows, resolve }

  async function onRefFiles(files) {
    for (const file of Array.from(files)) {
      try {
        if (/\.pdf$/i.test(file.name)) {
          $('ref-progress').textContent = 'Extraction du texte de « ' + file.name + ' »…';
          const pages = await PDA.referential.extractPdfPages(await file.arrayBuffer());
          const ref = PDA.referential.fromPdfPages(file.name, pages);
          state.referentials.push(ref);
          toast(file.name + ' : ' + ref.measures.length + ' extrait(s) indexé(s) sur ' + pages.length + ' page(s).');
        } else {
          const wb = PDA.importer.readWorkbook(await file.arrayBuffer());
          await askRefMapping(file.name, wb);
        }
      } catch (e) {
        toast('« ' + file.name + ' » : ' + e.message, true);
      }
      renderReferentials();
      persistProject();
    }
    $('ref-progress').textContent = '';
    $('ref-file').value = '';
  }

  function askRefMapping(name, wb) {
    return new Promise((resolve) => {
      pendingRef = { name, wb, resolve };
      $('ref-mapping-name').textContent = '— ' + name;
      $('ref-sheet').innerHTML = wb.SheetNames.map((s) => '<option>' + esc(s) + '</option>').join('');
      loadRefSheet(true);
      $('ref-mapping-card').classList.remove('hidden');
    });
  }

  function loadRefSheet(autoHeader) {
    const p = pendingRef;
    p.rows = PDA.importer.sheetRows(p.wb, $('ref-sheet').value);
    const idx = autoHeader ? PDA.importer.detectHeaderRow(p.rows) : Math.max(0, Number($('ref-header').value) - 1);
    $('ref-header').value = idx + 1;
    p.table = PDA.importer.buildTable(p.rows, idx);
    p.mapping = PDA.referential.guessRefMapping(p.table.headers);
    const fields = [['id', 'Identifiant'], ['title', 'Titre de la mesure'], ['description', 'Description'], ['domain', 'Domaine']];
    $('ref-mapping').innerHTML = fields.map(([k, label]) =>
      '<label>' + label + '<select data-refmap="' + k + '"><option value="-1">— Aucune —</option>' +
      p.table.headers.map((h, i) => '<option value="' + i + '"' + (p.mapping[k] === i ? ' selected' : '') + '>' + esc(h) + '</option>').join('') +
      '</select></label>').join('') + '<p class="muted small">' + p.table.records.length + ' ligne(s).</p>';
  }

  function closeRefMapping(add) {
    const p = pendingRef;
    if (!p) return;
    if (add) {
      document.querySelectorAll('[data-refmap]').forEach((s) => { const v = Number(s.value); p.mapping[s.dataset.refmap] = v < 0 ? null : v; });
      if (p.mapping.title == null && p.mapping.description == null) { toast('Choisissez au moins la colonne titre ou description.', true); return; }
      const ref = PDA.referential.fromTable(p.name, p.table, p.mapping);
      state.referentials.push(ref);
      toast(p.name + ' : ' + ref.measures.length + ' mesure(s) importée(s).');
    }
    $('ref-mapping-card').classList.add('hidden');
    pendingRef = null;
    p.resolve();
  }

  function renderReferentials() {
    const refs = state.referentials;
    if (!refs.length) {
      $('ref-list').innerHTML = '<p class="muted">Aucun référentiel : les mesures proviendront de la colonne recommandation du questionnaire.</p>';
      return;
    }
    $('ref-list').innerHTML = '<div class="table-wrap"><table class="table"><thead><tr><th>Actif</th><th>Nom</th><th>Type</th><th>Mesures / extraits</th><th>Aperçu</th><th></th></tr></thead><tbody>' +
      refs.map((r) => '<tr><td><input type="checkbox" data-ref-toggle="' + r.id + '"' + (r.enabled ? ' checked' : '') + ' aria-label="Activer"></td>' +
        '<td>' + esc(r.name) + '</td><td>' + (r.type === 'pdf' ? 'PDF' : 'Catalogue') + '</td><td>' + r.measures.length + '</td>' +
        '<td class="small">' + r.measures.slice(0, 3).map((m) => esc(T.truncate(m.title || m.text, 90))).join('<br>') + '</td>' +
        '<td><button class="btn btn-ghost" data-ref-del="' + r.id + '" type="button">Retirer</button></td></tr>').join('') +
      '</tbody></table></div>';
  }

  // ---------- 3. Settings & generation ----------
  const SETTING_FIELDS = ['scaleMax', 'target', 'unknownLevel', 'measureSource', 'topK', 'threshold', 'includeCompliant'];

  function renderSettings() {
    for (const f of SETTING_FIELDS) {
      const el = $('s-' + f);
      if (el.type === 'checkbox') el.checked = !!state.settings[f]; else el.value = state.settings[f];
    }
    const max = state.settings.scaleMax;
    const scale = max === 5 ? PDA.maturity.DEFAULT_SCALE : Array.from({ length: max + 1 }, (_, i) => ({ level: i, label: 'Niveau ' + i }));
    $('s-scale').innerHTML = scale.map((s) => '<span>' + s.level + ' — ' + esc(s.label) + '</span>').join('');
  }

  function onSettingChange(e) {
    const f = e.target.id.replace(/^s-/, '');
    if (!SETTING_FIELDS.includes(f)) return;
    const el = e.target;
    let v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
    if (el.type === 'number') {
      if (!Number.isFinite(v)) return;
      v = Math.min(Number(el.max || v), Math.max(Number(el.min || v), v));
    }
    state.settings[f] = v;
    if (state.settings.target > state.settings.scaleMax) state.settings.target = state.settings.scaleMax;
    if (state.settings.unknownLevel > state.settings.scaleMax) state.settings.unknownLevel = state.settings.scaleMax;
    renderSettings();
    persistProject();
  }

  function generate() {
    const errs = [];
    if (!state.questionnaire || !state.questionnaire.records.length) errs.push('Importez d\'abord un questionnaire.');
    else errs.push(...PDA.importer.validateMapping(state.mapping));
    $('generate-errors').textContent = errs.join(' ');
    if (errs.length) return;
    if (planEdited && state.actions.length && !g.confirm('Regénérer le plan remplacera les modifications manuelles et les enrichissements IA. Continuer ?')) return;
    const items = state.questionnaire.records.map((r) => PDA.importer.toItem(r, state.mapping));
    const measures = PDA.referential.allEnabledMeasures(state.referentials);
    state.actions = PDA.planBuilder.buildPlan(items, measures, state.settings);
    planEdited = false;
    selection.clear(); openDetails.clear();
    renderPlan();
    persistProject();
    switchTab('plan');
    toast(state.actions.length + ' action(s) générée(s) à partir de ' + items.length + ' exigence(s).');
  }

  // ---------- 4. Plan ----------
  function filteredActions() {
    const p = $('f-priority').value, d = $('f-domain').value, qw = $('f-quickwin').checked;
    const q = T.normalize($('f-search').value);
    return state.actions.filter((a) =>
      (!p || a.priority === p) && (!d || (a.domain || 'Non classé') === d) && (!qw || a.quickWin) &&
      (!q || T.normalize([a.actionId, a.reqId, a.domain, a.requirement, a.currentSituation, a.action, a.owner].join(' ')).includes(q)));
  }

  function opt(values, current) {
    return values.map((v) => '<option' + (String(v) === String(current) ? ' selected' : '') + '>' + esc(v) + '</option>').join('');
  }

  function renderPlan() {
    const actions = state.actions;
    $('plan-empty').classList.toggle('hidden', actions.length > 0);
    const domains = Array.from(new Set(actions.map((a) => a.domain || 'Non classé'))).sort();
    const cur = $('f-domain').value;
    $('f-domain').innerHTML = '<option value="">Tous</option>' + domains.map((d) => '<option' + (d === cur ? ' selected' : '') + '>' + esc(d) + '</option>').join('');
    const s = PDA.planBuilder.summary(actions);
    $('plan-summary').innerHTML = actions.length ? [
      ['Actions', s.total], ['P1', s.byPriority.P1], ['P2', s.byPriority.P2], ['P3', s.byPriority.P3], ['Quick wins', s.quickWins],
      ['Sélection', selection.size]
    ].map(([l, v]) => '<div class="stat"><b>' + v + '</b>' + l + '</div>').join('') : '';
    const rows = filteredActions();
    const levels = Array.from({ length: state.settings.scaleMax + 1 }, (_, i) => i);
    const head = '<thead><tr><th><input type="checkbox" id="sel-all" aria-label="Tout sélectionner"' + (rows.length && rows.every((a) => selection.has(a.uid)) ? ' checked' : '') + '></th>' +
      '<th>ID</th><th>Domaine / Réf.</th><th>Exigence</th><th>Situation actuelle</th><th>Maturité</th><th>Mesure(s) à mettre en place</th>' +
      '<th>Priorité</th><th>Effort</th><th>Horizon</th><th>Responsable</th><th>Échéance</th><th>Statut</th><th>Origine</th></tr></thead>';
    const body = rows.map((a) => {
      const tags = (a.quickWin ? '<span class="tag qw">Quick win</span>' : '') + (/IA/.test(a.origin) ? '<span class="tag ai">IA</span>' : '');
      const main = '<tr class="' + a.priority.toLowerCase() + '" data-uid="' + a.uid + '">' +
        '<td><input type="checkbox" data-sel="' + a.uid + '"' + (selection.has(a.uid) ? ' checked' : '') + ' aria-label="Sélectionner"></td>' +
        '<td>' + esc(a.actionId) + '<br>' + tags + '</td>' +
        '<td>' + esc(a.domain) + (a.reqId ? '<br><span class="muted small">' + esc(a.reqId) + '</span>' : '') + '</td>' +
        '<td class="req">' + esc(a.requirement) + '</td>' +
        '<td><textarea data-f="currentSituation">' + esc(a.currentSituation) + '</textarea></td>' +
        '<td class="lvl"><select data-f="currentLevel" aria-label="Maturité actuelle">' + opt(levels, a.currentLevel) + '</select> → ' + a.targetLevel +
          '<br><span class="small muted">écart ' + a.gap + ' · ' + esc(a.maturitySource) + '</span></td>' +
        '<td><textarea data-f="action">' + esc(a.action) + '</textarea><span class="small muted">' + esc(a.measureSource) + '</span></td>' +
        '<td class="prio"><select data-f="priority">' + opt(PDA.planBuilder.PRIORITIES, a.priority) + '</select></td>' +
        '<td><select data-f="effort">' + opt(PDA.planBuilder.EFFORTS, a.effort) + '</select></td>' +
        '<td class="small">' + esc(a.horizon) + '</td>' +
        '<td><input type="text" data-f="owner" value="' + esc(a.owner) + '"></td>' +
        '<td><input type="date" data-f="dueDate" value="' + esc(a.dueDate) + '"></td>' +
        '<td><select data-f="status">' + opt(PDA.planBuilder.STATUSES, a.status) + '</select></td>' +
        '<td class="small">' + esc(a.origin) + '<br><button class="linkish" data-details="' + a.uid + '" type="button">' + (openDetails.has(a.uid) ? 'Masquer' : 'Détails') + '</button></td></tr>';
      if (!openDetails.has(a.uid)) return main;
      const cands = (a.measures || []).map((m) => '<li>' + esc(m.text) + ' <span class="muted">— ' + esc(m.source) + (m.ref ? ' · ' + esc(m.ref) : '') + (m.score < 1 ? ' · pertinence ' + m.score : '') + '</span></li>').join('');
      return main + '<tr class="details"><td></td><td colspan="13">' +
        '<b>Commentaires des interviewés (ligne ' + a.sourceRow + ')</b><ul>' + ((a.comments || []).map((c) => '<li>' + esc(c) + '</li>').join('') || '<li class="muted">Aucun</li>') + '</ul>' +
        '<b>Évaluation de la maturité</b> : source ' + esc(a.maturitySource) + ', confiance ' + esc(a.maturityConfidence || '—') + (a.maturityNote ? ' — ' + esc(a.maturityNote) : '') +
        '<br><b>Mesures candidates</b><ul>' + (cands || '<li class="muted">Aucune</li>') + '</ul>' +
        (a.aiRationale ? '<b>Justification IA</b> : ' + esc(a.aiRationale) + '<br>' : '') +
        (a.aiError ? '<span class="errors">Dernière erreur IA : ' + esc(a.aiError) + '</span>' : '') + '</td></tr>';
    }).join('');
    $('plan-table').innerHTML = actions.length ? head + '<tbody>' + body + '</tbody>' : '';
  }

  function findAction(uid) { return state.actions.find((a) => a.uid === uid); }

  function onPlanEdit(e) {
    const el = e.target;
    const f = el.dataset.f;
    const tr = el.closest('tr[data-uid]');
    if (!f || !tr) return;
    const a = findAction(tr.dataset.uid);
    if (!a) return;
    planEdited = true;
    if (f === 'currentLevel') {
      a.currentLevel = Number(el.value);
      a.gap = Math.max(0, a.targetLevel - a.currentLevel);
      a.maturitySource = 'manuel';
      a.priority = a.gap === 0 ? 'P3' : PDA.planBuilder.priorityOf(a.gap, a.criticality);
      a.quickWin = a.gap >= 2 && a.effort === 'Faible';
      a.horizon = PDA.planBuilder.horizonOf(a.priority, a.quickWin);
    } else if (f === 'effort') {
      a.effort = el.value;
      a.quickWin = a.gap >= 2 && a.effort === 'Faible';
      a.horizon = PDA.planBuilder.horizonOf(a.priority, a.quickWin);
    } else if (f === 'priority') {
      a.priority = el.value;
      a.horizon = PDA.planBuilder.horizonOf(a.priority, a.quickWin);
    } else {
      a[f] = el.value;
    }
    if (e.type === 'change' && el.tagName === 'SELECT') renderPlan();
    persistProject();
  }

  function onPlanClick(e) {
    const el = e.target;
    if (el.id === 'sel-all') {
      for (const a of filteredActions()) { if (el.checked) selection.add(a.uid); else selection.delete(a.uid); }
      renderPlan();
    } else if (el.dataset.sel) {
      if (el.checked) selection.add(el.dataset.sel); else selection.delete(el.dataset.sel);
      renderPlan();
    } else if (el.dataset.details) {
      const id = el.dataset.details;
      if (openDetails.has(id)) openDetails.delete(id); else openDetails.add(id);
      renderPlan();
    }
  }

  function exportXlsx() {
    if (!state.actions.length) { toast('Aucune action à exporter.', true); return; }
    try {
      const date = new Date().toISOString().slice(0, 10);
      const base = (state.questionnaire && state.questionnaire.fileName || 'questionnaire').replace(/\.[^.]+$/, '');
      PDA.exporter.exportXlsx(state, 'Plan d\'action - ' + base + ' - ' + date + '.xlsx');
    } catch (e) { toast(e.message, true); }
  }

  // ---------- 5. AI settings ----------
  const AI_FIELD_IDS = ['azureMode', 'endpoint', 'baseUrl', 'deployment', 'apiVersion', 'model', 'proxyUrl', 'terms'];

  function aiConfig() { return Object.assign({}, state.ai, { authorized: aiAuthorized }); }
  function provider() { return PDA.providers.get(state.ai.provider); }

  const client = new PDA.LLMClient({
    getConfig: aiConfig,
    getKey: (id) => PDA.secrets.get(id),
    consent: (info) => PDA.consent.request(info)
  });

  function visibleFields() {
    const p = provider();
    let fields = p.fields.slice();
    if (p.kind === 'azure') {
      fields = fields.filter((f) => (state.ai.azureMode === 'foundry' ? f !== 'deployment' : f !== 'model'));
    }
    return fields;
  }

  function renderAi() {
    const p = provider();
    $('ai-provider').innerHTML = PDA.providers.list().map((x) => '<option value="' + x.id + '"' + (x.id === state.ai.provider ? ' selected' : '') + '>' + esc(x.label) + '</option>').join('');
    const fields = visibleFields();
    document.querySelectorAll('#tab-ai [data-field]').forEach((el) => el.classList.toggle('hidden', !fields.includes(el.dataset.field)));
    for (const f of AI_FIELD_IDS) { const el = $('ai-' + f); if (el && document.activeElement !== el) el.value = state.ai[f] || ''; }
    $('ai-baseUrl').placeholder = p.defaultBaseUrl || 'https://mon-endpoint/v1';
    $('ai-pseudonymize').checked = !!state.ai.pseudonymize;
    $('ai-authorized').checked = aiAuthorized;
    $('ai-remember').checked = PDA.secrets.isRemembered(state.ai.provider);
    const key = PDA.secrets.get(state.ai.provider);
    $('ai-apiKey').placeholder = key ? 'Clé enregistrée (' + PDA.secrets.mask(key) + ') — saisir pour remplacer' : (p.keyRequired ? 'Obligatoire' : 'Optionnelle');
    $('ai-key-state').textContent = key ? (PDA.secrets.isRemembered(state.ai.provider) ? 'Mémorisée sur ce navigateur.' : 'Conservée pour cette session uniquement.') : 'Aucune clé enregistrée.';
    if (!$('ai-models').children.length) setModelOptions(p.fallbackModels, 'Liste par défaut (cliquez sur « Charger les modèles » pour interroger le fournisseur).');
    renderAiStatus();
  }

  function setModelOptions(models, text) {
    $('ai-models').innerHTML = models.map((m) => '<option value="' + esc(m) + '">').join('');
    $('ai-models-state').textContent = text;
  }

  function configSig() {
    const c = aiConfig();
    return JSON.stringify([AI_PREF_FIELDS.map((f) => c[f]), c.authorized, PDA.secrets.mask(PDA.secrets.get(c.provider))]);
  }

  function renderAiStatus(busyText) {
    const pill = $('ai-pill');
    let cls = 'pill-off', text;
    if (busyText) { cls = 'pill-busy'; text = busyText; }
    else if (!aiAuthorized) text = 'IA : non autorisée';
    else if (PDA.validation.validate(aiConfig(), PDA.secrets.get(state.ai.provider)).length) text = 'IA : configuration incomplète';
    else if (lastTest && lastTest.sig === configSig()) { cls = lastTest.ok ? 'pill-ok' : 'pill-error'; text = lastTest.ok ? 'IA : connectée' : 'IA : erreur'; }
    else { cls = 'pill-ready'; text = 'IA : prête à tester'; }
    pill.className = 'pill ' + cls;
    pill.textContent = text;
    $('ai-enrich').disabled = !aiAuthorized || aiBusy;
    $('ai-test').disabled = aiBusy;
    $('ai-load-models').disabled = aiBusy;
  }

  function aiMessage(text, kind) {
    const el = $('ai-message');
    el.textContent = text || '';
    el.className = 'message' + (kind ? ' ' + kind : '');
  }

  function onProviderChange(id) {
    const p = PDA.providers.get(id);
    if (!p) return;
    state.ai.provider = id;
    state.ai.model = '';
    state.ai.baseUrl = p.defaultBaseUrl || '';
    if (p.kind === 'azure') state.ai.apiVersion = state.ai.azureMode === 'foundry' ? p.defaultFoundryApiVersion : p.defaultApiVersion;
    $('ai-models').innerHTML = '';
    lastTest = null;
    aiMessage('');
    saveAiPrefs();
    renderAi();
  }

  function onAiFieldInput(e) {
    const f = e.target.id.replace(/^ai-/, '');
    if (f === 'azureMode') {
      state.ai.azureMode = e.target.value;
      const p = provider();
      const known = [p.defaultApiVersion, p.defaultFoundryApiVersion, ''];
      if (known.includes(state.ai.apiVersion)) state.ai.apiVersion = e.target.value === 'foundry' ? p.defaultFoundryApiVersion : p.defaultApiVersion;
      saveAiPrefs(); renderAi(); return;
    }
    if (f === 'pseudonymize') { state.ai.pseudonymize = e.target.checked; saveAiPrefs(); return; }
    if (!AI_FIELD_IDS.includes(f)) return;
    state.ai[f] = e.target.value.trim();
    saveAiPrefs();
    renderAiStatus();
  }

  function onKeyChange() {
    const input = $('ai-apiKey');
    const v = input.value.trim();
    input.value = '';
    if (!v) return;
    PDA.secrets.set(state.ai.provider, v, $('ai-remember').checked);
    aiMessage('Clé enregistrée ' + ($('ai-remember').checked ? 'sur ce navigateur' : 'pour cette session') + '.', 'ok');
    renderAi();
  }

  async function loadModels() {
    if (!aiAuthorized) {
      aiMessage('Cochez la confirmation d\'autorisation avant tout appel au fournisseur. Liste par défaut affichée.', 'error');
      setModelOptions(provider().fallbackModels, 'Liste par défaut (aucun appel effectué).');
      return;
    }
    aiBusy = true; renderAiStatus('IA : chargement des modèles…');
    try {
      const r = await client.getAvailableModels();
      if (r.source === 'api') {
        setModelOptions(r.models, r.models.length + ' modèle(s) chargé(s) depuis le fournisseur.');
        aiMessage('');
      } else {
        setModelOptions(r.models, 'Liste par défaut utilisée' + (r.models.length ? '' : ' (vide : saisissez le modèle)') + '.');
        aiMessage('Chargement des modèles impossible : ' + r.reason, 'error');
      }
      if (!state.ai.model && r.models.length) { state.ai.model = r.models[0]; saveAiPrefs(); }
    } finally {
      aiBusy = false; renderAi();
    }
  }

  async function testConnection() {
    const sig = configSig();
    aiBusy = true; renderAiStatus('IA : test en cours…');
    aiMessage('Test en cours…');
    try {
      const r = await client.testConnection();
      lastTest = { sig, ok: true };
      if (r.models && r.models.length) setModelOptions(r.models, r.models.length + ' modèle(s) chargé(s) depuis le fournisseur.');
      aiMessage(r.message, 'ok');
    } catch (e) {
      lastTest = { sig, ok: false };
      aiMessage(e.toUserMessage ? e.toUserMessage() : PDA.llmErrors.redact(e.message), 'error');
    } finally {
      aiBusy = false; renderAi();
    }
  }

  let aiCancel = false;
  async function enrichSelection() {
    const targets = state.actions.filter((a) => selection.has(a.uid));
    if (!targets.length) { toast('Sélectionnez au moins une action (cases à cocher).', true); return; }
    if (!aiAuthorized) { toast('Usage de l\'IA non autorisé : cochez la confirmation dans Paramètres IA.', true); switchTab('ai'); return; }
    const opts = { pseudonymize: state.ai.pseudonymize, terms: String(state.ai.terms || '').split(',').map((s) => s.trim()).filter(Boolean), scaleMax: state.settings.scaleMax };
    const prompts = targets.map((a) => PDA.aiAssist.buildPrompt(a, opts));
    let token;
    try {
      token = await client.requestApproval({
        operation: 'Enrichissement du plan d\'action',
        count: targets.length,
        preview: prompts[0].system + '\n\n' + prompts[0].user,
        chars: prompts.reduce((s, p) => s + p.system.length + p.user.length, 0)
      });
    } catch (e) {
      toast(e.toUserMessage ? e.toUserMessage() : e.message, e.code !== 'CONSENT_DENIED');
      return;
    }
    aiBusy = true; aiCancel = false; renderAiStatus('IA : génération…');
    const progress = $('ai-progress');
    let ok = 0, ko = 0, lastErr = '';
    try {
      for (let i = 0; i < targets.length && !aiCancel; i++) {
        progress.innerHTML = 'IA : ' + (i + 1) + ' / ' + targets.length + '… <button class="linkish" id="ai-stop" type="button">Interrompre</button>';
        const a = targets[i];
        try {
          const obj = await client.generateJSON(Object.assign({ operation: 'Enrichissement ' + a.actionId, maxTokens: 1500 }, prompts[i]), token);
          const merged = PDA.aiAssist.merge(a, obj, state.settings);
          delete merged.aiError;
          state.actions[state.actions.indexOf(a)] = merged;
          ok++;
        } catch (e) {
          ko++;
          lastErr = e.toUserMessage ? e.toUserMessage() : PDA.llmErrors.redact(e.message);
          a.aiError = lastErr;
          if (['NOT_AUTHORIZED', 'MISSING_KEY', 'INVALID_ENDPOINT', 'NETWORK_OR_CORS', 'VALIDATION'].includes(e.code) || [401, 403, 404].includes(e.httpStatus)) break;
        }
      }
    } finally {
      aiBusy = false;
      progress.textContent = '';
      planEdited = true;
      renderPlan(); renderAiStatus(); persistProject();
    }
    toast('IA : ' + ok + ' action(s) enrichie(s)' + (ko ? ', ' + ko + ' en erreur.\n' + lastErr : '.') + (aiCancel ? ' (interrompu)' : ''), ko > 0);
  }

  // ---------- project save / load ----------
  function saveProject() {
    try {
      const json = PDA.exporter.exportProjectJson(state);
      PDA.exporter.downloadText(json, 'projet-plan-d-action-' + new Date().toISOString().slice(0, 10) + '.json');
    } catch (e) { toast(e.message, true); }
  }

  function applyProject(obj) {
    state.questionnaire = obj.questionnaire || null;
    state.mapping = obj.mapping || (state.questionnaire ? PDA.importer.guessMapping(state.questionnaire.headers) : null);
    state.referentials = Array.isArray(obj.referentials) ? obj.referentials : [];
    state.settings = Object.assign({}, PDA.planBuilder.DEFAULT_SETTINGS, obj.settings || {});
    state.actions = Array.isArray(obj.actions) ? obj.actions : [];
    if (obj.ai && PDA.providers.get(obj.ai.provider)) {
      for (const f of AI_PREF_FIELDS) if (obj.ai[f] != null) state.ai[f] = obj.ai[f];
    }
    qWorkbook = null; qRows = null;
    selection.clear(); openDetails.clear();
    renderAll();
  }

  async function openProject(file) {
    try {
      applyProject(PDA.exporter.parseProjectJson(await file.text()));
      persistProject();
      toast('Projet « ' + file.name + ' » chargé.');
    } catch (e) { toast(e.message, true); }
  }

  function renderAll() {
    renderQuestionnaire();
    renderReferentials();
    renderSettings();
    renderPlan();
    renderAi();
  }

  // ---------- init ----------
  function init() {
    PDA.secrets.init();
    PDA.secrets.migrateLegacy();
    const prefs = readJson('localStorage', AI_PREFS_KEY);
    if (prefs && PDA.providers.get(prefs.provider)) for (const f of AI_PREF_FIELDS) if (prefs[f] != null) state.ai[f] = prefs[f];
    const saved = readJson('sessionStorage', PROJECT_KEY);
    if (saved && saved.app === 'plan-d-action') { PDA.secrets.stripKeys(saved); applyProject(saved); } else renderAll();

    document.querySelector('.tabs').addEventListener('click', (e) => { if (e.target.dataset.tab) switchTab(e.target.dataset.tab); });
    $('q-file').addEventListener('change', (e) => { if (e.target.files[0]) onQuestionnaireFile(e.target.files[0]); });
    $('q-sheet').addEventListener('change', (e) => loadSheet(e.target.value, true));
    $('q-header').addEventListener('change', (e) => applyHeader(Math.max(0, Number(e.target.value) - 1)));
    $('q-mapping').addEventListener('change', onMappingChange);
    $('q-next').addEventListener('click', () => switchTab('referentials'));

    $('ref-file').addEventListener('change', (e) => { if (e.target.files.length) onRefFiles(e.target.files); });
    $('ref-sheet').addEventListener('change', () => loadRefSheet(true));
    $('ref-header').addEventListener('change', () => loadRefSheet(false));
    $('ref-add').addEventListener('click', () => closeRefMapping(true));
    $('ref-cancel').addEventListener('click', () => closeRefMapping(false));
    $('ref-list').addEventListener('change', (e) => {
      const id = e.target.dataset.refToggle;
      const r = id && state.referentials.find((x) => x.id === id);
      if (r) { r.enabled = e.target.checked; persistProject(); }
    });
    $('ref-list').addEventListener('click', (e) => {
      const id = e.target.dataset.refDel;
      if (!id) return;
      state.referentials = state.referentials.filter((x) => x.id !== id);
      renderReferentials(); persistProject();
    });

    $('tab-settings').addEventListener('change', onSettingChange);
    $('generate').addEventListener('click', generate);

    ['f-priority', 'f-domain', 'f-quickwin'].forEach((id) => $(id).addEventListener('change', renderPlan));
    $('f-search').addEventListener('input', renderPlan);
    $('plan-table').addEventListener('change', onPlanEdit);
    $('plan-table').addEventListener('input', (e) => { if (e.target.tagName === 'TEXTAREA' || e.target.type === 'text') onPlanEdit(e); });
    $('plan-table').addEventListener('click', onPlanClick);
    $('export-xlsx').addEventListener('click', exportXlsx);
    $('ai-enrich').addEventListener('click', enrichSelection);
    $('ai-progress').addEventListener('click', (e) => { if (e.target.id === 'ai-stop') aiCancel = true; });

    $('ai-authorized').addEventListener('change', (e) => { aiAuthorized = e.target.checked; lastTest = null; renderAiStatus(); });
    $('ai-provider').addEventListener('change', (e) => onProviderChange(e.target.value));
    $('tab-ai').addEventListener('input', onAiFieldInput);
    $('ai-azureMode').addEventListener('change', onAiFieldInput);
    $('ai-pseudonymize').addEventListener('change', onAiFieldInput);
    $('ai-apiKey').addEventListener('change', onKeyChange);
    $('ai-remember').addEventListener('change', (e) => { PDA.secrets.setRemember(state.ai.provider, e.target.checked); renderAi(); });
    $('ai-load-models').addEventListener('click', loadModels);
    $('ai-test').addEventListener('click', testConnection);
    $('ai-clear-keys').addEventListener('click', () => { PDA.secrets.clearAll(); lastTest = null; aiMessage('Toutes les clés API ont été effacées de ce navigateur.', 'ok'); renderAi(); });

    $('save-project').addEventListener('click', saveProject);
    $('project-file').addEventListener('change', (e) => { if (e.target.files[0]) openProject(e.target.files[0]); e.target.value = ''; });
  }

  PDA.app = { state, init, client };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window);
