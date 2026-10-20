/* Explicit approval dialog shown before any content is sent to an AI provider. */
(function (g) {
  'use strict';
  const PDA = (g.PDA = g.PDA || {});

  // info: { operation, provider, model, host, proxy, count, preview, chars } → Promise<boolean>
  function request(info) {
    const dlg = document.getElementById('consent-dialog');
    if (!dlg || typeof dlg.showModal !== 'function') return Promise.resolve(false);
    const set = (id, v) => { const el = dlg.querySelector('[data-c="' + id + '"]'); if (el) el.textContent = v; };
    set('operation', info.operation || 'Génération');
    set('provider', info.provider || '—');
    set('model', info.model || '—');
    set('host', info.host + (info.proxy ? ' (via proxy ' + info.proxy + ')' : ''));
    set('count', String(info.count || 1));
    set('chars', (info.chars || 0).toLocaleString('fr-FR'));
    const preview = PDA.llmErrors.redact(String(info.preview || ''));
    set('preview', preview.length > 6000 ? preview.slice(0, 6000) + '\n… (' + (preview.length - 6000) + ' caractères supplémentaires)' : preview);
    return new Promise((resolve) => {
      const ok = dlg.querySelector('[data-c="approve"]');
      const ko = dlg.querySelector('[data-c="cancel"]');
      const done = (v) => {
        ok.removeEventListener('click', onOk); ko.removeEventListener('click', onKo); dlg.removeEventListener('cancel', onKo);
        dlg.close();
        resolve(v);
      };
      const onOk = () => done(true);
      const onKo = (e) => { if (e) e.preventDefault(); done(false); };
      ok.addEventListener('click', onOk);
      ko.addEventListener('click', onKo);
      dlg.addEventListener('cancel', onKo);
      dlg.showModal();
      ko.focus();
    });
  }

  PDA.consent = { request };
})(typeof window !== 'undefined' ? window : globalThis);
