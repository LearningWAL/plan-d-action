/* Referential sources: measure catalogues (Excel/CSV) and PDF documents split into chunks. */
(function (g) {
  'use strict';
  const PDA = (g.PDA = g.PDA || {});
  const T = PDA.text;

  const REF_GUESS = {
    id: /^(id|ref|reference|code|n°|numero|mesure id|control id)\b|^ref/,
    title: /titre|title|intitule|nom|name|mesure|measure|controle|control/,
    description: /description|detail|libelle|contenu|guidance|recommandation|objectif|texte/,
    domain: /domaine|theme|chapitre|categorie|category|famille|section|domain/
  };

  function guessRefMapping(headers) {
    const norm = headers.map((h) => T.normalize(h));
    const used = new Set();
    const m = { id: null, title: null, description: null, domain: null };
    for (const key of ['description', 'title', 'domain', 'id']) {
      const i = norm.findIndex((h, idx) => !used.has(idx) && REF_GUESS[key].test(h));
      if (i >= 0) { m[key] = i; used.add(i); }
    }
    if (m.title == null && m.description == null && headers.length) m.description = 0;
    return m;
  }

  function fromTable(name, table, mapping) {
    const c = (rec, i) => (i == null || i < 0 ? '' : rec.cells[i] || '');
    const measures = table.records.map((rec, k) => {
      const title = c(rec, mapping.title);
      const description = c(rec, mapping.description);
      return {
        id: c(rec, mapping.id) || 'M' + (k + 1),
        title: title || T.truncate(description, 120),
        text: [title, description].filter(Boolean).join(' — '),
        domain: c(rec, mapping.domain),
        location: 'ligne ' + rec.row
      };
    }).filter((m) => m.text.trim());
    return { id: 'ref-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, type: 'table', enabled: true, measures };
  }

  // pages: [{ page, text }] → chunks of ~400-1200 characters, cut on paragraphs / numbered headings.
  function chunkPages(pages, opts) {
    const minLen = (opts && opts.minLen) || 400;
    const maxLen = (opts && opts.maxLen) || 1200;
    const chunks = [];
    let buf = '', bufPage = null;
    const flush = () => {
      const text = buf.replace(/\s+/g, ' ').trim();
      if (text.length > 40) chunks.push({ text, page: bufPage });
      buf = ''; bufPage = null;
    };
    for (const p of pages) {
      const paragraphs = String(p.text || '')
        .split(/\n\s*\n|\n(?=\s*(?:\d+(?:\.\d+)*[.)]?\s+[A-ZÀ-Ý]|[-•▪]\s))/)
        .map((s) => s.trim()).filter(Boolean);
      for (const para of paragraphs) {
        const heading = /^\d+(?:\.\d+)*[.)]?\s+[A-ZÀ-Ý]/.test(para);
        if (buf && (heading && buf.length >= minLen || buf.length + para.length > maxLen)) flush();
        if (bufPage == null) bufPage = p.page;
        buf += (buf ? '\n' : '') + para;
        while (buf.length > maxLen * 1.5) {
          const cut = buf.lastIndexOf('. ', maxLen) > minLen ? buf.lastIndexOf('. ', maxLen) + 1 : maxLen;
          const rest = buf.slice(cut);
          buf = buf.slice(0, cut);
          flush();
          buf = rest; bufPage = p.page;
        }
      }
    }
    flush();
    return chunks;
  }

  function fromPdfPages(name, pages) {
    const measures = chunkPages(pages).map((c, k) => ({
      id: 'P' + c.page + '-' + (k + 1),
      title: T.truncate(c.text.split(/(?<=[.:])\s/)[0], 120),
      text: c.text,
      domain: '',
      location: 'page ' + c.page
    }));
    return { id: 'ref-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, type: 'pdf', enabled: true, measures };
  }

  let pdfReady = null;
  function loadScript(src) {
    // Single-file build: the library is embedded as an inert block and executed on demand.
    const inline = document.getElementById(src.endsWith('pdf.worker.min.js') ? 'pda-inline-pdfjs-worker' : 'pda-inline-pdfjs');
    if (inline) {
      const s = document.createElement('script');
      s.textContent = inline.textContent;
      document.head.appendChild(s);
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Impossible de charger ' + src));
      document.head.appendChild(s);
    });
  }

  // pdf.js is loaded lazily; the worker script is included as a classic script so that pdf.js
  // runs its "fake worker" on the main thread (works from file:// without a server).
  function ensurePdfJs() {
    if (!pdfReady) {
      pdfReady = loadScript('vendor/pdfjs/pdf.worker.min.js')
        .then(() => loadScript('vendor/pdfjs/pdf.min.js'))
        .then(() => {
          if (!g.pdfjsLib) throw new Error('pdf.js indisponible.');
          return g.pdfjsLib;
        });
      pdfReady.catch(() => { pdfReady = null; });
    }
    return pdfReady;
  }

  async function extractPdfPages(arrayBuffer) {
    const pdfjs = await ensurePdfJs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer), isEvalSupported: false, disableFontFace: true }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let text = '', lastY = null;
      for (const it of content.items) {
        const y = it.transform ? it.transform[5] : null;
        if (lastY != null && y != null && Math.abs(y - lastY) > 1) text += Math.abs(y - lastY) > 14 ? '\n\n' : '\n';
        else if (text && !text.endsWith(' ')) text += ' ';
        text += it.str;
        if (it.hasEOL) text += '\n';
        lastY = y;
      }
      pages.push({ page: i, text });
    }
    if (!pages.some((p) => p.text.trim())) throw new Error('Aucun texte extractible (PDF scanné ?). L\'OCR n\'est pas pris en charge.');
    return pages;
  }

  function allEnabledMeasures(referentials) {
    const out = [];
    for (const ref of referentials || []) {
      if (!ref.enabled) continue;
      for (const m of ref.measures) out.push(Object.assign({ source: ref.name, sourceType: ref.type }, m));
    }
    return out;
  }

  PDA.referential = { guessRefMapping, fromTable, chunkPages, fromPdfPages, extractPdfPages, allEnabledMeasures };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDA.referential;
})(typeof window !== 'undefined' ? window : globalThis);
