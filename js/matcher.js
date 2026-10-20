/* Local TF-IDF cosine retrieval between requirements and referential measures. */
(function (g) {
  'use strict';
  const PDA = (g.PDA = g.PDA || {});
  const T = PDA.text;

  function termFreq(tokens) {
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    return tf;
  }

  // docs: [{ id, text, ... }] → index usable by search().
  function buildIndex(docs) {
    const df = new Map();
    const tfs = docs.map((d) => {
      const tf = termFreq(T.tokenize(d.text));
      for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
      return tf;
    });
    const N = docs.length || 1;
    const idf = (t) => Math.log(1 + N / (1 + (df.get(t) || 0)));
    const vectors = tfs.map((tf) => weigh(tf, idf));
    return { docs, vectors, idf };
  }

  function weigh(tf, idf) {
    const v = new Map();
    let norm = 0;
    for (const [t, f] of tf) {
      const w = (1 + Math.log(f)) * idf(t);
      v.set(t, w);
      norm += w * w;
    }
    return { v, norm: Math.sqrt(norm) || 1 };
  }

  function cosine(a, b) {
    let dot = 0;
    const [small, big] = a.v.size < b.v.size ? [a, b] : [b, a];
    for (const [t, w] of small.v) {
      const o = big.v.get(t);
      if (o) dot += w * o;
    }
    return dot / (a.norm * b.norm);
  }

  // Returns the top-k docs with a similarity ≥ threshold, best first.
  function search(index, query, k, threshold) {
    if (!index || !index.docs.length) return [];
    const q = weigh(termFreq(T.tokenize(query)), index.idf);
    const scored = index.vectors.map((vec, i) => ({ doc: index.docs[i], score: cosine(q, vec) }));
    return scored
      .filter((s) => s.score >= (threshold == null ? 0.1 : threshold))
      .sort((a, b) => b.score - a.score)
      .slice(0, k || 3);
  }

  PDA.matcher = { buildIndex, search };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDA.matcher;
})(typeof window !== 'undefined' ? window : globalThis);
