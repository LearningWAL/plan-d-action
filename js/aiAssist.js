/* Optional AI enrichment of actions: prompt building, pseudonymisation, result merge. */
(function (g) {
  'use strict';
  const PDA = (g.PDA = g.PDA || {});

  const SYSTEM = [
    'Tu es consultant senior en cybersécurité et rédiges un plan d\'action suite à une évaluation de maturité.',
    'Règles :',
    '- Appuie-toi uniquement sur l\'exigence, les commentaires des interviewés et les extraits de référentiel fournis.',
    '- N\'invente ni référence normative, ni outil, ni fait non présent dans les données.',
    '- La situation actuelle est factuelle et synthétique (2-4 phrases), sans jugement de valeur.',
    '- Les mesures sont concrètes, actionnables, formulées avec un verbe à l\'infinitif.',
    '- Échelle de maturité 0 (inexistant) à {MAX} (optimisé).',
    'Réponds uniquement avec un objet JSON valide de la forme :',
    '{"situation_actuelle": string, "maturite_estimee": integer, "justification_maturite": string,',
    ' "mesures": [string], "effort": "Faible"|"Moyen"|"Élevé", "justification_priorite": string}'
  ].join('\n');

  const PSEUDO = [
    [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
    [/\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/g, '[adresse IP]'],
    [/(?:\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}\b/g, '[téléphone]'],
    [/\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+(?:local|lan|corp|intra|internal)\b\S*/gi, '[hôte interne]']
  ];

  function pseudonymize(text, extraTerms) {
    let s = String(text || '');
    for (const [re, rep] of PSEUDO) s = s.replace(re, rep);
    for (const term of extraTerms || []) {
      const t = term.trim();
      if (t.length >= 2) s = s.split(t).join('[client]');
    }
    return s;
  }

  function buildPrompt(action, opts) {
    const o = opts || {};
    const p = (s) => (o.pseudonymize ? pseudonymize(s, o.terms) : String(s || ''));
    const refs = (action.measures || []).filter((m) => m.ref || m.source).slice(0, 4)
      .map((m, i) => '[' + (i + 1) + '] (' + p(m.source) + ') ' + p(m.text)).join('\n');
    const user = [
      'Domaine : ' + p(action.domain || 'non précisé'),
      'Exigence : ' + p(action.requirement),
      'Commentaires des interviewés :\n' + (action.comments && action.comments.length ? action.comments.map((c) => '- ' + p(c)).join('\n') : '- (aucun)'),
      'Maturité estimée par l\'outil : ' + action.currentLevel + ' ; cible : ' + action.targetLevel,
      'Extraits de référentiel / recommandations disponibles :\n' + (refs || '(aucun)')
    ].join('\n\n');
    return { system: SYSTEM.replace('{MAX}', String(o.scaleMax || 5)), user };
  }

  function clampInt(v, max) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : null;
  }

  // Validates the model's JSON and merges it into a copy of the action.
  function merge(action, obj, settings) {
    const max = (settings && settings.scaleMax) || 5;
    const a = Object.assign({}, action);
    const str = (v) => (typeof v === 'string' ? v.trim() : '');
    if (str(obj.situation_actuelle)) a.currentSituation = str(obj.situation_actuelle);
    const lvl = clampInt(obj.maturite_estimee, max);
    if (lvl != null) {
      a.currentLevel = lvl;
      a.gap = Math.max(0, a.targetLevel - lvl);
      a.maturitySource = 'IA';
      a.maturityNote = str(obj.justification_maturite);
    }
    const mesures = Array.isArray(obj.mesures) ? obj.mesures.map(str).filter(Boolean) : [];
    if (mesures.length) a.action = mesures.map((m, i) => (mesures.length > 1 ? (i + 1) + '. ' : '') + m).join('\n');
    if (PDA.planBuilder.EFFORTS.includes(obj.effort)) a.effort = obj.effort;
    a.priority = a.gap === 0 ? 'P3' : PDA.planBuilder.priorityOf(a.gap, a.criticality);
    a.quickWin = a.gap >= 2 && a.effort === 'Faible';
    a.horizon = PDA.planBuilder.horizonOf(a.priority, a.quickWin);
    a.aiRationale = str(obj.justification_priorite);
    a.origin = 'IA (à relire)';
    return a;
  }

  PDA.aiAssist = { SYSTEM, pseudonymize, buildPrompt, merge };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDA.aiAssist;
})(typeof window !== 'undefined' ? window : globalThis);
