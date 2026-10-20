/* Validation run before every AI call: authorization, provider, model, key, HTTPS endpoints. */
(function (g) {
  'use strict';
  const PDA = (g.PDA = g.PDA || {});

  const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/;

  // Returns { url, error }. Strips trailing slashes and known API suffixes so users can paste
  // either the base URL or a full endpoint URL.
  function normalizeBaseUrl(raw, opts) {
    const o = opts || {};
    let s = String(raw || '').trim();
    if (!s) return { url: '', error: 'URL manquante.' };
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
    let u;
    try { u = new URL(s); } catch (e) { return { url: '', error: 'URL invalide : ' + String(raw).slice(0, 80) }; }
    if (u.username || u.password) return { url: '', error: 'L\'URL ne doit pas contenir d\'identifiants.' };
    const loopback = LOOPBACK.test(u.hostname);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback && o.allowLoopbackHttp)) {
      return { url: '', error: 'HTTPS obligatoire' + (o.allowLoopbackHttp ? ' (http accepté uniquement pour localhost / 127.0.0.1).' : '.') };
    }
    if (u.search || u.hash) { u.search = ''; u.hash = ''; }
    let path = u.pathname.replace(/\/+$/, '');
    for (const suffix of o.stripSuffixes || []) {
      if (path.toLowerCase().endsWith(suffix)) { path = path.slice(0, -suffix.length).replace(/\/+$/, ''); break; }
    }
    return { url: u.origin + path, error: null, host: u.hostname, loopback };
  }

  const SUFFIXES = {
    openai: ['/chat/completions', '/models', '/completions'],
    ollama: ['/api/chat', '/api/tags', '/api/generate', '/api', '/v1/chat/completions', '/v1'],
    azure: ['/openai/deployments', '/openai', '/models/chat/completions', '/models']
  };

  // Resolves the effective endpoint for the provider, or an error message.
  function resolveEndpoint(cfg) {
    const p = PDA.providers.get(cfg.provider);
    if (!p) return { error: 'Fournisseur inconnu.' };
    if (p.kind === 'azure') {
      const r = normalizeBaseUrl(cfg.endpoint, { stripSuffixes: SUFFIXES.azure });
      if (r.error) return { error: 'Endpoint Azure : ' + r.error };
      if (!p.endpointHosts.some((re) => re.test(r.host))) {
        return { error: 'Endpoint Azure : hôte non reconnu (' + r.host + '). Attendu *.openai.azure.com, *.cognitiveservices.azure.com, *.services.ai.azure.com…' };
      }
      return { url: r.url, host: r.host };
    }
    const raw = p.fields.includes('baseUrl') ? cfg.baseUrl || p.defaultBaseUrl : p.defaultBaseUrl;
    const r = normalizeBaseUrl(raw, {
      allowLoopbackHttp: p.kind === 'ollama' || cfg.provider === 'compatible',
      stripSuffixes: p.kind === 'ollama' ? SUFFIXES.ollama : SUFFIXES.openai
    });
    if (r.error) return { error: 'URL de base : ' + r.error };
    return { url: r.url, host: r.host, loopback: r.loopback };
  }

  function validateProxy(proxyUrl) {
    if (!proxyUrl) return { url: '' };
    const r = normalizeBaseUrl(proxyUrl, { allowLoopbackHttp: true });
    if (r.error) return { error: 'Proxy : ' + r.error };
    return { url: r.url };
  }

  // needs: { model: bool } — model is not needed to list models.
  function validate(cfg, apiKey, needs) {
    const errors = [];
    const n = Object.assign({ model: true, authorization: true }, needs || {});
    if (n.authorization && !cfg.authorized) errors.push({ code: 'NOT_AUTHORIZED', message: 'Usage de l\'IA non autorisé : cochez la confirmation.' });
    const p = PDA.providers.get(cfg.provider);
    if (!p) { errors.push({ code: 'VALIDATION', message: 'Sélectionnez un fournisseur.' }); return errors; }
    const ep = resolveEndpoint(cfg);
    if (ep.error) errors.push({ code: 'INVALID_ENDPOINT', message: ep.error });
    const keyNeeded = p.keyRequired || (p.kind === 'ollama' && ep.host && !ep.loopback);
    if (keyNeeded && !apiKey) errors.push({ code: 'MISSING_KEY', message: 'Clé API manquante pour ' + p.label + '.' });
    if (apiKey && /\s/.test(apiKey)) errors.push({ code: 'MISSING_KEY', message: 'La clé API contient des espaces.' });
    if (p.kind === 'azure') {
      if (cfg.azureMode !== 'foundry' && !String(cfg.deployment || '').trim()) errors.push({ code: 'VALIDATION', message: 'Nom de déploiement Azure manquant.' });
      if (cfg.azureMode !== 'foundry' && /[^A-Za-z0-9._-]/.test(String(cfg.deployment || '').trim())) errors.push({ code: 'VALIDATION', message: 'Nom de déploiement Azure invalide.' });
      if (!/^\d{4}-\d{2}-\d{2}(-preview)?$/.test(String(cfg.apiVersion || '').trim())) errors.push({ code: 'VALIDATION', message: 'Version d\'API Azure invalide (ex. 2024-10-21).' });
      if (n.model && cfg.azureMode === 'foundry' && !String(cfg.model || '').trim()) errors.push({ code: 'VALIDATION', message: 'Sélectionnez un modèle.' });
    } else if (n.model && !String(cfg.model || '').trim()) {
      errors.push({ code: 'VALIDATION', message: 'Sélectionnez un modèle.' });
    }
    const px = validateProxy(cfg.proxyUrl);
    if (px.error) errors.push({ code: 'INVALID_ENDPOINT', message: px.error });
    return errors;
  }

  PDA.validation = { normalizeBaseUrl, resolveEndpoint, validateProxy, validate };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDA.validation;
})(typeof window !== 'undefined' ? window : globalThis);
