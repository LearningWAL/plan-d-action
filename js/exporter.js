/* Exports: action plan as XLSX and project as JSON. Both go through a secret check. */
(function (g) {
  'use strict';
  const PDA = (g.PDA = g.PDA || {});

  const PROJECT_VERSION = 1;
  const AI_PUBLIC_FIELDS = ['provider', 'model', 'baseUrl', 'endpoint', 'deployment', 'apiVersion', 'azureMode', 'proxyUrl', 'pseudonymize'];
  const FORBIDDEN_KEY = /api.?key|apikey|secret|token|password|authorization|bearer|credential/i;

  const COLUMNS = [
    ['actionId', 'ID action', 10], ['reqId', 'Réf. exigence', 12], ['domain', 'Domaine', 20],
    ['requirement', 'Exigence', 50], ['currentSituation', 'Situation actuelle', 55],
    ['currentLevel', 'Maturité actuelle', 11], ['targetLevel', 'Maturité cible', 11], ['gap', 'Écart', 8],
    ['action', 'Mesure(s) à mettre en place', 60], ['measureSource', 'Source de la mesure', 28],
    ['priority', 'Priorité', 9], ['effort', 'Effort', 10], ['quickWin', 'Quick win', 10], ['horizon', 'Horizon', 22],
    ['owner', 'Responsable', 18], ['dueDate', 'Échéance', 12], ['status', 'Statut', 12],
    ['origin', 'Origine', 14], ['maturityNote', 'Remarques', 40], ['sourceRow', 'Ligne source', 10]
  ];

  class SecretLeakError extends Error {
    constructor(where) { super('Export bloqué : une valeur ressemblant à une clé API a été détectée (' + where + ').'); this.name = 'SecretLeakError'; }
  }

  // Deep-copies obj, dropping credential-like properties, and throws if any string still contains a secret.
  function sanitizeForExport(obj, knownSecrets) {
    const secrets = knownSecrets || (PDA.secrets ? PDA.secrets.knownValues() : []);
    const walk = (v, path) => {
      if (Array.isArray(v)) return v.map((x, i) => walk(x, path + '[' + i + ']'));
      if (v && typeof v === 'object') {
        const out = {};
        for (const k of Object.keys(v)) {
          if (FORBIDDEN_KEY.test(k) && k !== 'hasKey') continue;
          out[k] = walk(v[k], path + '.' + k);
        }
        return out;
      }
      if (typeof v === 'string' && PDA.llmErrors.containsSecret(v, secrets)) throw new SecretLeakError(path);
      return v;
    };
    return walk(obj, '$');
  }

  function projectPayload(state) {
    const ai = {};
    for (const f of AI_PUBLIC_FIELDS) if (state.ai && state.ai[f] != null) ai[f] = state.ai[f];
    return {
      app: 'plan-d-action',
      version: PROJECT_VERSION,
      savedAt: new Date().toISOString(),
      questionnaire: state.questionnaire,
      mapping: state.mapping,
      referentials: state.referentials,
      settings: state.settings,
      actions: state.actions,
      ai
    };
  }

  function exportProjectJson(state, knownSecrets) {
    return JSON.stringify(sanitizeForExport(projectPayload(state), knownSecrets), null, 2);
  }

  // Validates and cleans an imported project file; keys are never imported.
  function parseProjectJson(text) {
    let obj;
    try { obj = JSON.parse(text); } catch (e) { throw new Error('Fichier projet invalide (JSON illisible).'); }
    if (!obj || obj.app !== 'plan-d-action') throw new Error('Ce fichier n\'est pas un projet Plan d\'action.');
    PDA.secrets && PDA.secrets.stripKeys(obj);
    return obj;
  }

  function cellValue(a, key) {
    const v = a[key];
    if (key === 'quickWin') return v ? 'Oui' : 'Non';
    return v == null ? '' : v;
  }

  const PRIORITY_FILL = { P1: 'F8D7DA', P2: 'FFF3CD', P3: 'D1E7DD' };

  function buildWorkbook(state) {
    const X = g.XLSX;
    const actions = state.actions || [];
    const header = COLUMNS.map((c) => c[1]);
    const rows = actions.map((a) => COLUMNS.map(([k]) => cellValue(a, k)));
    const ws = X.utils.aoa_to_sheet([header].concat(rows));
    ws['!cols'] = COLUMNS.map((c) => ({ wch: c[2] }));
    ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length, 1), c: COLUMNS.length - 1 } }) };
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    const border = { style: 'thin', color: { rgb: 'BFBFBF' } };
    const borders = { top: border, bottom: border, left: border, right: border };
    for (let c = 0; c < COLUMNS.length; c++) {
      const ref = X.utils.encode_cell({ r: 0, c });
      ws[ref].s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1F3864' } }, alignment: { wrapText: true, vertical: 'center' }, border: borders };
      for (let r = 1; r <= rows.length; r++) {
        const cr = X.utils.encode_cell({ r, c });
        if (!ws[cr]) continue;
        const s = { alignment: { wrapText: true, vertical: 'top' }, border: borders };
        if (COLUMNS[c][0] === 'priority' && PRIORITY_FILL[ws[cr].v]) s.fill = { fgColor: { rgb: PRIORITY_FILL[ws[cr].v] } };
        ws[cr].s = s;
      }
    }

    const sum = PDA.planBuilder.summary(actions);
    const synth = [
      ['Synthèse du plan d\'action'], [],
      ['Nombre d\'actions', sum.total],
      ['Priorité P1', sum.byPriority.P1], ['Priorité P2', sum.byPriority.P2], ['Priorité P3', sum.byPriority.P3],
      ['Quick wins', sum.quickWins], [],
      ['Domaine', 'Nombre d\'actions', 'Maturité actuelle moyenne']
    ];
    for (const [d, e] of Object.entries(sum.byDomain)) synth.push([d, e.count, Math.round((e.levelSum / e.count) * 10) / 10]);
    const ws2 = X.utils.aoa_to_sheet(synth);
    ws2['!cols'] = [{ wch: 40 }, { wch: 18 }, { wch: 26 }];
    if (ws2.A1) ws2.A1.s = { font: { bold: true, sz: 14 } };

    const s = state.settings || {};
    const params = [
      ['Paramètres de génération'], [],
      ['Date d\'export', new Date().toLocaleString('fr-FR')],
      ['Questionnaire', (state.questionnaire && state.questionnaire.fileName) || ''],
      ['Feuille', (state.questionnaire && state.questionnaire.sheetName) || ''],
      ['Échelle de maturité', '0 à ' + s.scaleMax],
      ['Maturité cible', s.target],
      ['Niveau par défaut si indéterminé', s.unknownLevel],
      ['Source des mesures', { reco: 'Colonne recommandation', ref: 'Référentiels', both: 'Recommandation + référentiels' }[s.measureSource] || ''],
      ['Référentiels utilisés', (state.referentials || []).filter((r) => r.enabled).map((r) => r.name).join(' ; ')]
    ];
    const ws3 = X.utils.aoa_to_sheet(params);
    ws3['!cols'] = [{ wch: 34 }, { wch: 60 }];

    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, 'Plan d\'action');
    X.utils.book_append_sheet(wb, ws2, 'Synthèse');
    X.utils.book_append_sheet(wb, ws3, 'Paramètres');
    return wb;
  }

  function exportXlsx(state, fileName, knownSecrets) {
    // Same secret check as the JSON export, applied to every value written to the workbook.
    sanitizeForExport({ actions: state.actions, settings: state.settings, referentials: (state.referentials || []).map((r) => r.name) }, knownSecrets);
    const wb = buildWorkbook(state);
    g.XLSX.writeFile(wb, fileName || 'plan-d-action.xlsx', { compression: true });
  }

  function downloadText(text, fileName, mime) {
    const blob = new Blob([text], { type: mime || 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  PDA.exporter = { COLUMNS, SecretLeakError, sanitizeForExport, projectPayload, exportProjectJson, parseProjectJson, buildWorkbook, exportXlsx, downloadText };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDA.exporter;
})(typeof window !== 'undefined' ? window : globalThis);
