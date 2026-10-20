/* Questionnaire import: workbook parsing, header detection, column mapping. */
(function (g) {
  'use strict';
  const PDA = (g.PDA = g.PDA || {});
  const T = PDA.text;

  const FIELDS = [
    { key: 'id', label: 'Identifiant / Référence', multi: false, required: false },
    { key: 'domain', label: 'Domaine / Thème', multi: false, required: false },
    { key: 'requirement', label: 'Exigence (obligatoire)', multi: false, required: true },
    { key: 'comments', label: 'Commentaires des interviewés', multi: true, required: false },
    { key: 'score', label: 'Réponse / Score de maturité', multi: false, required: false },
    { key: 'recommendation', label: 'Recommandation / Mesure', multi: false, required: false },
    { key: 'criticality', label: 'Criticité / Poids', multi: false, required: false }
  ];

  const GUESS = {
    requirement: /exigence|requirement|question|controle|control|critere|point de controle|objectif/,
    comments: /commentaire|comment|remarque|observation|constat|justification|preuve|evidence|precision|detail/,
    score: /maturit|score|niveau|note|statut|status|reponse|answer|conformit|evaluation/,
    recommendation: /recommandation|recommendation|preconisation|remediation|action|mesure/,
    id: /^(id|ref|reference|n°|no|num|numero|#|code)\b|^ref|^id\b/,
    domain: /domaine|theme|chapitre|categorie|category|section|famille|rubrique|domain/,
    criticality: /criticit|poids|weight|priorit|importance|risque|severit/
  };

  function readWorkbook(arrayBuffer) {
    if (!g.XLSX) throw new Error('Librairie XLSX non chargée.');
    return g.XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  }

  function sheetRows(wb, sheetName) {
    const ws = wb.Sheets[sheetName];
    if (!ws) return [];
    return g.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: false });
  }

  // Header row = row among the first 20 with the most non-empty textual cells.
  function detectHeaderRow(rows) {
    let best = 0, bestScore = -1;
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const cells = rows[i] || [];
      const filled = cells.filter((c) => String(c).trim() !== '');
      const textual = filled.filter((c) => isNaN(Number(String(c).replace(',', '.'))));
      const score = textual.length * 2 + filled.length;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  function buildTable(rows, headerIdx) {
    const raw = rows[headerIdx] || [];
    const width = rows.reduce((m, r) => Math.max(m, r.length), raw.length);
    const seen = {};
    const headers = [];
    for (let c = 0; c < width; c++) {
      let h = String(raw[c] == null ? '' : raw[c]).replace(/\s+/g, ' ').trim() || 'Colonne ' + (c + 1);
      if (seen[h]) h = h + ' (' + ++seen[h] + ')'; else seen[h] = 1;
      headers.push(h);
    }
    const records = [];
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const cells = headers.map((_, c) => String(rows[r][c] == null ? '' : rows[r][c]).trim());
      if (cells.some((v) => v !== '')) records.push({ row: r + 1, cells });
    }
    return { headers, records };
  }

  function guessMapping(headers) {
    const norm = headers.map((h) => T.normalize(h));
    const used = new Set();
    const mapping = { id: null, domain: null, requirement: null, comments: [], score: null, recommendation: null, criticality: null };
    const order = ['requirement', 'recommendation', 'comments', 'criticality', 'domain', 'id', 'score'];
    for (const key of order) {
      for (let i = 0; i < norm.length; i++) {
        if (used.has(i) || !GUESS[key].test(norm[i])) continue;
        if (key === 'comments') { mapping.comments.push(i); used.add(i); continue; }
        mapping[key] = i; used.add(i); break;
      }
    }
    return mapping;
  }

  function cell(record, idx) {
    return idx == null || idx < 0 ? '' : record.cells[idx] || '';
  }

  // Turns a raw record into a normalized questionnaire item according to the mapping.
  function toItem(record, mapping) {
    const comments = (mapping.comments || []).map((i) => cell(record, i)).filter(Boolean);
    return {
      row: record.row,
      id: cell(record, mapping.id),
      domain: cell(record, mapping.domain),
      requirement: cell(record, mapping.requirement),
      comments,
      score: cell(record, mapping.score),
      recommendation: cell(record, mapping.recommendation),
      criticality: cell(record, mapping.criticality)
    };
  }

  function validateMapping(mapping) {
    const errors = [];
    if (mapping.requirement == null || mapping.requirement < 0) errors.push('Sélectionnez la colonne « Exigence ».');
    if (!(mapping.comments || []).length && (mapping.score == null || mapping.score < 0)) {
      errors.push('Sélectionnez au moins une colonne de commentaires ou de score pour évaluer la maturité.');
    }
    return errors;
  }

  function headerSignature(headers) {
    return headers.map((h) => T.normalize(h)).join('|');
  }

  PDA.importer = { FIELDS, readWorkbook, sheetRows, detectHeaderRow, buildTable, guessMapping, toItem, validateMapping, headerSignature };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDA.importer;
})(typeof window !== 'undefined' ? window : globalThis);
