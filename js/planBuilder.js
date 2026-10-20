/* Deterministic action-plan generation: gap, measures, priority, effort, horizon. */
(function (g) {
  'use strict';
  const PDA = (g.PDA = g.PDA || {});
  const T = PDA.text;

  const DEFAULT_SETTINGS = {
    scaleMax: 5,
    target: 3,
    unknownLevel: 1,
    measureSource: 'both',   // 'reco' | 'ref' | 'both'
    topK: 2,
    threshold: 0.12,
    includeCompliant: false
  };

  const STATUSES = ['À lancer', 'En cours', 'Terminé', 'Abandonné'];
  const PRIORITIES = ['P1', 'P2', 'P3'];
  const EFFORTS = ['Faible', 'Moyen', 'Élevé'];

  function parseCriticality(v) {
    const s = T.normalize(v);
    if (!s) return 2;
    if (/critique|critical|tres (haute|elevee)|very high|majeur|major|^4|^5/.test(s)) return 3;
    if (/haute?|high|elevee?|forte?|important|^3/.test(s)) return 3;
    if (/faible|low|basse?|mineur|minor|^1|^0/.test(s)) return 1;
    return 2;
  }

  const LOW_EFFORT = /\b(politique|procedure|charte|sensibilis|formalis|document|rediger|nommer|designer|definir|mettre a jour|revue|revoir|communiquer|inventaire|cartograph|policy|awareness|define|update|appoint|review|document)/;
  const HIGH_EFFORT = /\b(outil|solution|siem|soc|edr|xdr|bastion|pam|iam|dlp|segment|cloisonn|chiffrement|pki|migration|refonte|projet|acquerir|plateforme|infrastructure|tool|platform|encryption|redesign)/;

  function estimateEffort(text) {
    const s = T.normalize(text);
    if (HIGH_EFFORT.test(s)) return 'Élevé';
    if (LOW_EFFORT.test(s)) return 'Faible';
    return 'Moyen';
  }

  function priorityOf(gap, criticality) {
    const score = gap * criticality;
    if (score >= 6 || gap >= 3) return 'P1';
    if (score >= 3) return 'P2';
    return 'P3';
  }

  function horizonOf(priority, quickWin) {
    if (quickWin) return 'Court terme (0-3 mois)';
    if (priority === 'P1') return 'Court/moyen terme (0-6 mois)';
    if (priority === 'P2') return 'Moyen terme (6-12 mois)';
    return 'Long terme (12-24 mois)';
  }

  function measuresFor(item, index, settings) {
    const out = [];
    const useReco = settings.measureSource !== 'ref';
    const useRef = settings.measureSource !== 'reco';
    if (useReco && item.recommendation) {
      out.push({ text: item.recommendation, source: 'Recommandation (questionnaire)', ref: '', score: 1 });
    }
    if (useRef && index && (!out.length || settings.measureSource === 'both')) {
      const query = [item.domain, item.requirement, item.recommendation].filter(Boolean).join(' ');
      for (const hit of PDA.matcher.search(index, query, settings.topK, settings.threshold)) {
        const d = hit.doc;
        out.push({
          text: d.sourceType === 'pdf' ? T.truncate(d.text, 400) : d.title && d.text !== d.title ? d.text : d.title || d.text,
          source: d.source + (d.location ? ' (' + d.location + ')' : ''),
          ref: d.id,
          score: Math.round(hit.score * 100) / 100
        });
      }
    }
    return out;
  }

  function buildPlan(items, referentialMeasures, userSettings) {
    const settings = Object.assign({}, DEFAULT_SETTINGS, userSettings || {});
    const index = referentialMeasures && referentialMeasures.length ? PDA.matcher.buildIndex(referentialMeasures) : null;
    const actions = [];
    let n = 0;
    for (const item of items) {
      if (!item.requirement) continue;
      const m = PDA.maturity.assess(item, settings);
      if (m.na) continue;
      const gap = Math.max(0, settings.target - m.level);
      if (gap === 0 && !settings.includeCompliant) continue;
      const measures = measuresFor(item, index, settings);
      const crit = parseCriticality(item.criticality);
      const measureText = measures.map((x) => x.text).join('\n');
      const effort = estimateEffort(measureText || item.requirement);
      const priority = gap === 0 ? 'P3' : priorityOf(gap, crit);
      const quickWin = gap >= 2 && effort === 'Faible';
      n++;
      actions.push({
        uid: 'a' + n + '-' + item.row,
        actionId: 'A-' + String(n).padStart(3, '0'),
        reqId: item.id,
        domain: item.domain,
        requirement: item.requirement,
        currentSituation: PDA.maturity.currentSituation(item.comments) || 'Aucun commentaire recueilli : situation à confirmer.',
        currentLevel: m.level,
        targetLevel: settings.target,
        gap,
        maturitySource: m.source,
        maturityConfidence: m.confidence,
        maturityNote: m.note,
        action: gap === 0
          ? 'Maintenir et contrôler le dispositif existant.'
          : measures.length ? measures[0].text : 'Mesure à définir pour couvrir l\'exigence : ' + T.truncate(item.requirement, 160),
        measures,
        measureSource: measures.length ? measures.map((x) => x.source).filter((v, i, a) => a.indexOf(v) === i).join(' ; ') : 'À définir',
        criticality: crit,
        priority,
        effort,
        quickWin,
        horizon: horizonOf(priority, quickWin),
        owner: '',
        dueDate: '',
        status: STATUSES[0],
        origin: 'Déterministe',
        sourceRow: item.row,
        comments: item.comments
      });
    }
    const rank = { P1: 0, P2: 1, P3: 2 };
    actions.sort((a, b) => rank[a.priority] - rank[b.priority] || b.gap - a.gap || (b.quickWin - a.quickWin) || a.sourceRow - b.sourceRow);
    actions.forEach((a, i) => { a.actionId = 'A-' + String(i + 1).padStart(3, '0'); });
    return actions;
  }

  function summary(actions) {
    const s = { total: actions.length, byPriority: { P1: 0, P2: 0, P3: 0 }, quickWins: 0, byDomain: {} };
    for (const a of actions) {
      s.byPriority[a.priority] = (s.byPriority[a.priority] || 0) + 1;
      if (a.quickWin) s.quickWins++;
      const d = a.domain || 'Non classé';
      const e = (s.byDomain[d] = s.byDomain[d] || { count: 0, levelSum: 0 });
      e.count++; e.levelSum += Number(a.currentLevel) || 0;
    }
    return s;
  }

  PDA.planBuilder = { DEFAULT_SETTINGS, STATUSES, PRIORITIES, EFFORTS, parseCriticality, estimateEffort, priorityOf, horizonOf, buildPlan, summary };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDA.planBuilder;
})(typeof window !== 'undefined' ? window : globalThis);
