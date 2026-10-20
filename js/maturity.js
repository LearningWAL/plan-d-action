/* Deterministic maturity assessment from score columns and interviewee comments. */
(function (g) {
  'use strict';
  const PDA = (g.PDA = g.PDA || {});
  const T = PDA.text;

  const DEFAULT_SCALE = [
    { level: 0, label: 'Inexistant' },
    { level: 1, label: 'Initial' },
    { level: 2, label: 'Reproductible' },
    { level: 3, label: 'Défini' },
    { level: 4, label: 'Géré et mesuré' },
    { level: 5, label: 'Optimisé' }
  ];

  // Ordered: negated / specific phrases first so they consume text before generic positive words.
  const LEXICON = [
    [0, /\b(aucune?s?|rien|inexistante?s?|n'existe pas|n'y a pas|pas de|pas d'|non mise? en (place|oeuvre)|absente?s?|jamais|never|none|not in place|no (formal )?(process|procedure|policy)|does not exist|nothing)\b/g],
    [1, /\b(non formalisee?s?|non documentee?s?|non ecrite?s?|informel(le)?s?|ad.hoc|au cas par cas|depend (des|de la) personne|oral(e|ement)?|savoir.faire|initial(e)?|informal|undocumented|case by case|not documented|not formali[sz]ed|reactive|reactif)\b/g],
    [2, /\b(partiel(le)?s?|partiellement|en cours|en projet|prevue?s?|planifiee?s?|a venir|quelques|certaine?s?|pas systematique|non systematique|pilote|incomplete?s?|heterogene|partial(ly)?|in progress|planned|ongoing|some|not systematic|inconsistent|limited|limitee?s?)\b/g],
    [3, /\b(formalisee?s?|documentee?s?|procedure|politique|defini(e|es|s)?|appliquee?s?|mise? en place|deployee?s?|en vigueur|valide(e|es|s)?|etablie?s?|established|documented|defined|implemented|in place|deployed|enforced|approved)\b/g],
    [4, /\b(controlee?s?|mesuree?s?|indicateurs?|kpis?|kri|audite(e|es|s)?|audits?|revue (reguliere|annuelle|periodique|trimestrielle)|revu(e|es|s)? (chaque|tous|annuellement)|suivi(e|es|s)? (regulier|mensuel)|tableaux? de bord|monitored|measured|reviewed|audited|metrics|dashboard)\b/g],
    [5, /\b(automatisee?s?|amelioration continue|optimisee?s?|automated|continuous improvement|optimi[sz]ed|best.in.class)\b/g]
  ];

  const NEGATORS = /\b(pas|non|not|no|aucun|aucune|sans|without|never|jamais|ni)\b/;

  function clampLevel(n, max) {
    return Math.max(0, Math.min(max, Math.round(n)));
  }

  // Parses an explicit answer/score: numbers ("3", "3/5", "60 %", "2,5"), yes/no, CMMI labels.
  function parseScore(value, scaleMax) {
    const max = scaleMax || 5;
    const v = T.normalize(value);
    if (!v) return null;
    if (/^(n\/?a|na|non applicable|not applicable|sans objet|s\/o)$/.test(v)) return { na: true, level: null };
    let m = v.match(/^(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)$/);
    if (m) return { level: clampLevel((parseFloat(m[1].replace(',', '.')) / parseFloat(m[2].replace(',', '.'))) * max, max) };
    m = v.match(/^(\d+(?:[.,]\d+)?)\s*%$/);
    if (m) return { level: clampLevel((parseFloat(m[1].replace(',', '.')) / 100) * max, max) };
    m = v.match(/^(?:niveau|level|n)?\s*(\d+(?:[.,]\d+)?)\b/);
    if (m) {
      const n = parseFloat(m[1].replace(',', '.'));
      if (n <= max) return { level: clampLevel(n, max) };
      if (n <= 100) return { level: clampLevel((n / 100) * max, max) };
    }
    const labels = [
      [/^(non conforme|non|no|not implemented|non mis en place|absent|inexistant|not compliant|ko)$/, 0],
      [/^(initial|ad hoc|informel)$/, 1],
      [/^(partiel(lement)?( conforme)?|partial(ly)?( compliant)?|en cours|in progress|reproductible|repeatable)$/, 2],
      [/^(defini|defined|documente|formalise)$/, 3],
      [/^(oui|yes|conforme|compliant|implemented|mis en place|ok|gere|managed|mesure|measured)$/, 4],
      [/^(optimise|optimized|optimised)$/, 5]
    ];
    for (const [re, lvl] of labels) if (re.test(v)) return { level: Math.min(lvl, max) };
    return null;
  }

  // Lexicon-based inference over comments. Returns null level when no signal was found.
  function inferFromComments(comments, scaleMax) {
    const max = scaleMax || 5;
    const original = ' ' + T.normalize((comments || []).join(' . ')) + ' ';
    let text = original; // matched spans are blanked (same length) so offsets stay aligned with original
    const hits = [];
    for (const [level, re] of LEXICON) {
      text = text.replace(re, (match, ...args) => {
        const offset = args[args.length - 2];
        let effective = level;
        if (level >= 3) {
          const before = original.slice(Math.max(0, offset - 25), offset);
          if (NEGATORS.test(before)) effective = 1;
        }
        hits.push({ level: effective, term: match });
        return ' '.repeat(match.length);
      });
    }
    if (!hits.length) return { level: null, confidence: 'aucune', hits };
    const avg = hits.reduce((s, h) => s + h.level, 0) / hits.length;
    const variance = hits.reduce((s, h) => s + (h.level - avg) ** 2, 0) / hits.length;
    let confidence = 'faible';
    if (hits.length >= 3 && variance <= 1) confidence = 'élevée';
    else if (hits.length >= 2 && variance <= 2.25) confidence = 'moyenne';
    return { level: clampLevel((avg / 5) * max, max), confidence, hits };
  }

  // Extractive "current situation" summary built from the interviewee comments.
  function currentSituation(comments, maxLen) {
    const seen = new Set();
    const out = [];
    for (const c of comments || []) {
      for (const s of T.splitSentences(c)) {
        const key = T.normalize(s).replace(/[^a-z0-9]/g, '');
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(s.replace(/[.;]+$/, ''));
      }
    }
    if (!out.length) return '';
    return T.truncate(out.join(' ; ') + '.', maxLen || 700);
  }

  function assess(item, settings) {
    const max = (settings && settings.scaleMax) || 5;
    const fromScore = parseScore(item.score, max);
    const fromComments = inferFromComments(item.comments, max);
    const res = { level: null, source: 'indéterminé', confidence: 'aucune', na: false, note: '', terms: fromComments.hits.map((h) => h.term.trim()) };
    if (fromScore && fromScore.na) {
      res.na = true; res.source = 'score'; res.note = 'Exigence non applicable.';
      return res;
    }
    if (fromScore) {
      res.level = fromScore.level; res.source = 'score'; res.confidence = 'élevée';
      if (fromComments.level != null && Math.abs(fromComments.level - fromScore.level) >= 2) {
        res.note = 'Écart entre le score déclaré (' + fromScore.level + ') et les commentaires (≈' + fromComments.level + ') : à confirmer.';
        res.confidence = 'moyenne';
      }
      return res;
    }
    if (fromComments.level != null) {
      res.level = fromComments.level; res.source = 'commentaires'; res.confidence = fromComments.confidence;
      return res;
    }
    const fallback = settings && settings.unknownLevel != null ? settings.unknownLevel : 1;
    res.level = fallback;
    res.note = 'Maturité non déterminable (niveau par défaut ' + fallback + ') : à confirmer.';
    return res;
  }

  PDA.maturity = { DEFAULT_SCALE, parseScore, inferFromComments, currentSituation, assess };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDA.maturity;
})(typeof window !== 'undefined' ? window : globalThis);
