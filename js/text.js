/* Text utilities shared by all modules (normalisation, tokenisation, phrases). */
(function (g) {
  'use strict';
  const PDA = (g.PDA = g.PDA || {});

  const STOPWORDS = new Set((
    // FR
    'a au aux avec ce ces cet cette dans de des du elle en et est etre eux il ils je la le les leur leurs lui ' +
    'ma mais me meme mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes ' +
    'toi ton tu un une vos votre vous y d l j m n s t c qu sont ont avoir fait faire doit doivent peut peuvent ' +
    'tous tout toute toutes afin ainsi etc selon lors entre via chaque dont plus moins tres bien ete sera ' +
    // EN
    'the of and or to in for on with by an is are be been being as at from that this these those it its ' +
    'shall should must may can will which who whom has have had not no do does all any each such than ' +
    'other into within their there where when'
  ).split(/\s+/));

  function stripAccents(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function normalize(s) {
    return stripAccents(String(s == null ? '' : s).toLowerCase())
      .replace(/[’`']/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Very light FR/EN stemmer: enough to align plural/singular and common derivations.
  function stem(w) {
    if (w.length <= 4) return w;
    const suffixes = ['issements', 'issement', 'ations', 'ation', 'ements', 'ement', 'ments', 'ment',
      'ances', 'ance', 'ences', 'ence', 'ables', 'able', 'iques', 'ique', 'ites', 'ite', 'eurs', 'eur',
      'ions', 'ion', 'ings', 'ing', 'ies', 'ees', 'ee', 'es', 'ed', 'er', 'ly', 's', 'x', 'e'];
    for (const suf of suffixes) {
      if (w.length - suf.length >= 4 && w.endsWith(suf)) return w.slice(0, -suf.length);
    }
    return w;
  }

  function tokenize(s, opts) {
    const keepStop = opts && opts.keepStopwords;
    return normalize(s)
      .split(/[^a-z0-9]+/)
      .filter((t) => t && t.length > 1 && (keepStop || !STOPWORDS.has(t)))
      .map(stem);
  }

  function splitSentences(text) {
    return String(text || '')
      .split(/(?<=[.!?;])\s+|\n+|\s+-\s+|•/)
      .map((s) => s.replace(/^[\s\-–•*]+/, '').trim())
      .filter((s) => s.length > 1);
  }

  function truncate(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  PDA.text = { STOPWORDS, stripAccents, normalize, stem, tokenize, splitSentences, truncate, escapeHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDA.text;
})(typeof window !== 'undefined' ? window : globalThis);
