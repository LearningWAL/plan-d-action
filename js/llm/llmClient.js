/* LLMClient: the single entry point for every AI call (models, connection test, generation).
   Every call is validated first; generation additionally requires an explicit approval. */
(function (g) {
  'use strict';
  const PDA = (g.PDA = g.PDA || {});
  const { LLMError } = PDA.llmErrors;

  const LIST_TIMEOUT = 20000;
  const GENERATE_TIMEOUT = 120000;
  const NON_CHAT = /(embed|moderation|whisper|tts|audio|realtime|transcribe|dall-e|image|search|ocr|davinci|babbage|computer-use)/i;

  function extractJson(text) {
    let s = String(text || '').trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    try { return JSON.parse(s); } catch (e) { /* try the outermost object */ }
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { /* fall through */ }
    }
    return undefined;
  }

  class LLMClient {
    // deps: { getConfig(): cfg, getKey(providerId): string, consent(info): Promise<bool>, fetch? }
    constructor(deps) {
      this.deps = deps;
      this._tokens = new WeakSet();
    }

    _ctx(operation, needs) {
      const cfg = this.deps.getConfig();
      const p = PDA.providers.get(cfg.provider);
      const model = p && p.kind === 'azure' && cfg.azureMode !== 'foundry' ? cfg.deployment : cfg.model;
      const base = { operation, provider: p ? p.label : cfg.provider || '—', model: model || '' };
      const key = cfg.provider ? this.deps.getKey(cfg.provider) : '';
      const errors = PDA.validation.validate(cfg, key, needs);
      if (errors.length) {
        throw new LLMError(Object.assign({}, base, { code: errors[0].code, message: errors.map((e) => e.message).join(' ') }));
      }
      const ep = PDA.validation.resolveEndpoint(cfg);
      const proxy = PDA.validation.validateProxy(cfg.proxyUrl).url;
      return { cfg, p, key, ep, proxy, base, model };
    }

    _url(ctx, path) {
      const target = ctx.ep.url + path;
      return ctx.proxy ? ctx.proxy + '/' + target.replace('://', '/') : target;
    }

    _headers(ctx) {
      const h = { 'Content-Type': 'application/json' };
      const { p, key, cfg } = ctx;
      if (p.kind === 'anthropic') {
        h['x-api-key'] = key;
        h['anthropic-version'] = '2023-06-01';
        h['anthropic-dangerous-direct-browser-access'] = 'true';
      } else if (p.kind === 'azure') {
        h['api-key'] = key;
        if (cfg.azureMode === 'foundry') h['Authorization'] = 'Bearer ' + key;
      } else if (key) {
        h['Authorization'] = 'Bearer ' + key;
      }
      return h;
    }

    async _fetch(ctx, url, init, timeout) {
      const doFetch = this.deps.fetch || g.fetch.bind(g);
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
      let res;
      try {
        res = await doFetch(url, Object.assign({ signal: ctrl && ctrl.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' }, init));
      } catch (e) {
        if (e && e.name === 'AbortError') throw new LLMError(Object.assign({}, ctx.base, { code: 'TIMEOUT', message: 'Délai dépassé (' + Math.round(timeout / 1000) + ' s).' }));
        throw new LLMError(Object.assign({}, ctx.base, { code: 'NETWORK_OR_CORS', message: 'Impossible de joindre ' + (ctx.ep.host || 'le fournisseur') + '.', providerMessage: e && e.message }));
      } finally {
        if (timer) clearTimeout(timer);
      }
      let text = '';
      try { text = await res.text(); } catch (e) { text = ''; }
      if (!res.ok) {
        const body = extractJson(text);
        const err = body && (body.error || body);
        const msg = err && (typeof err === 'string' ? err : err.message || err.detail || err.error) || text.slice(0, 300) || res.statusText;
        const code = err && typeof err === 'object' && (err.code || err.type) || 'HTTP_ERROR';
        throw new LLMError(Object.assign({}, ctx.base, { code: String(code), httpStatus: res.status, message: 'Le fournisseur a renvoyé une erreur HTTP ' + res.status + '.', providerMessage: typeof msg === 'string' ? msg : JSON.stringify(msg) }));
      }
      if (!text.trim()) throw new LLMError(Object.assign({}, ctx.base, { code: 'EMPTY_RESPONSE', httpStatus: res.status }));
      const json = extractJson(text);
      if (json === undefined) throw new LLMError(Object.assign({}, ctx.base, { code: 'MALFORMED_JSON', httpStatus: res.status, message: 'Réponse HTTP non JSON.' }));
      return json;
    }

    // Returns { models, source: 'api' | 'fallback', reason }. Never throws.
    async getAvailableModels() {
      const cfg = this.deps.getConfig();
      const p = PDA.providers.get(cfg.provider);
      if (!p) return { models: [], source: 'fallback', reason: 'Aucun fournisseur sélectionné.' };
      const fallback = (reason) => ({ models: p.fallbackModels.slice(), source: 'fallback', reason });
      if (!p.listModels) return fallback('Ce fournisseur ne publie pas de liste de modèles : saisissez le déploiement / modèle.');
      let ctx;
      try { ctx = this._ctx('Chargement des modèles', { model: false }); } catch (e) { return fallback(e.toUserMessage ? e.toUserMessage() : e.message); }
      try {
        const models = await this._listModels(ctx);
        if (!models.length) return fallback('Le fournisseur a renvoyé une liste vide.');
        return { models, source: 'api', reason: '' };
      } catch (e) {
        return fallback(e.toUserMessage ? e.toUserMessage() : String(e.message || e));
      }
    }

    async _listModels(ctx) {
      const { p } = ctx;
      const path = p.kind === 'ollama' ? '/api/tags' : p.kind === 'anthropic' ? '/models?limit=100' : '/models';
      const data = await this._fetch(ctx, this._url(ctx, path), { method: 'GET', headers: this._headers(ctx) }, LIST_TIMEOUT);
      let items = Array.isArray(data) ? data : data.data || data.models || [];
      if (!Array.isArray(items)) items = [];
      let ids = items.map((m) => (typeof m === 'string' ? m : m.id || m.name || m.model)).filter(Boolean);
      if (ctx.cfg.provider === 'mistral') {
        const chat = items.filter((m) => !m.capabilities || m.capabilities.completion_chat !== false).map((m) => m.id);
        if (chat.length) ids = chat;
      }
      if (p.kind === 'openai') {
        const chat = ids.filter((id) => !NON_CHAT.test(id));
        if (chat.length) ids = chat;
      }
      return Array.from(new Set(ids)).sort();
    }

    // Lightweight check with no client content: lists models, or sends "ping" when listing is unsupported.
    async testConnection() {
      const p = PDA.providers.get(this.deps.getConfig().provider);
      const ctx = this._ctx('Test de connexion', { model: !(p && p.listModels) });
      if (p.listModels) {
        try {
          const models = await this._listModels(ctx);
          return { ok: true, message: 'Connexion réussie (' + models.length + ' modèle(s) disponible(s)).', models };
        } catch (e) {
          if (ctx.cfg.provider !== 'compatible' || e.httpStatus !== 404) throw e;
        }
      }
      const token = this._token(1);
      await this.generate({ operation: 'Test de connexion', system: 'Health check.', user: 'Reply with the single word: pong', maxTokens: 16 }, token);
      return { ok: true, message: 'Connexion réussie (réponse du modèle reçue).' };
    }

    _token(count) {
      const t = { remaining: count };
      this._tokens.add(t);
      return t;
    }

    // Asks the user to approve a batch of generation calls. info: { operation, count, preview, chars }.
    async requestApproval(info) {
      const ctx = this._ctx(info.operation || 'Génération', { model: true });
      const ok = await this.deps.consent(Object.assign({}, info, { provider: ctx.base.provider, model: ctx.base.model, host: ctx.ep.host, proxy: ctx.proxy }));
      if (!ok) throw new LLMError(Object.assign({}, ctx.base, { code: 'CONSENT_DENIED' }));
      return this._token(info.count || 1);
    }

    // req: { operation, system, user, json, maxTokens }. Without a valid approval token,
    // the user is asked to approve this single call (showing the exact content sent).
    async generate(req, approval) {
      const ctx = this._ctx(req.operation || 'Génération', { model: true });
      let token = approval;
      if (!token || !this._tokens.has(token) || token.remaining <= 0) {
        token = await this.requestApproval({ operation: req.operation, count: 1, preview: req.system + '\n\n' + req.user, chars: (req.system + req.user).length });
      }
      token.remaining--;
      const { url, body } = this._request(ctx, req);
      const data = await this._fetch(ctx, url, { method: 'POST', headers: this._headers(ctx), body: JSON.stringify(body) }, GENERATE_TIMEOUT);
      const text = this._text(ctx, data);
      if (!text || !text.trim()) throw new LLMError(Object.assign({}, ctx.base, { code: 'EMPTY_RESPONSE' }));
      return text;
    }

    async generateJSON(req, approval) {
      const text = await this.generate(Object.assign({ json: true }, req), approval);
      const obj = extractJson(text);
      if (!obj || typeof obj !== 'object') {
        const ctx = this.deps.getConfig();
        throw new LLMError({ operation: req.operation || 'Génération', provider: (PDA.providers.get(ctx.provider) || {}).label, model: ctx.model, code: 'MALFORMED_JSON', providerMessage: text.slice(0, 200) });
      }
      return obj;
    }

    _request(ctx, req) {
      const { p, cfg } = ctx;
      const messages = [{ role: 'system', content: req.system || '' }, { role: 'user', content: req.user || '' }];
      const maxTokens = req.maxTokens || 2048;
      if (p.kind === 'anthropic') {
        return { url: this._url(ctx, '/messages'), body: { model: cfg.model, max_tokens: maxTokens, system: req.system || '', messages: [{ role: 'user', content: req.user || '' }] } };
      }
      if (p.kind === 'ollama') {
        const body = { model: cfg.model, messages, stream: false, options: { temperature: 0.2 } };
        if (req.json) body.format = 'json';
        return { url: this._url(ctx, '/api/chat'), body };
      }
      if (p.kind === 'azure') {
        const v = encodeURIComponent(String(cfg.apiVersion).trim());
        if (cfg.azureMode === 'foundry') {
          return { url: this._url(ctx, '/models/chat/completions?api-version=' + v), body: { model: cfg.model, messages, max_tokens: maxTokens, temperature: 0.2 } };
        }
        const body = { messages };
        if (req.json) body.response_format = { type: 'json_object' };
        return { url: this._url(ctx, '/openai/deployments/' + encodeURIComponent(String(cfg.deployment).trim()) + '/chat/completions?api-version=' + v), body };
      }
      const body = { model: cfg.model, messages };
      if (cfg.provider === 'openai') {
        if (req.json) body.response_format = { type: 'json_object' };
      } else if (cfg.provider === 'mistral') {
        body.temperature = 0.2; body.max_tokens = maxTokens;
        if (req.json) body.response_format = { type: 'json_object' };
      } else {
        body.temperature = 0.2; body.max_tokens = maxTokens;
      }
      return { url: this._url(ctx, '/chat/completions'), body };
    }

    _text(ctx, data) {
      if (ctx.p.kind === 'anthropic') {
        return (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
      }
      if (ctx.p.kind === 'ollama') return data.message && data.message.content || data.response || '';
      const choice = data.choices && data.choices[0];
      const content = choice && choice.message && choice.message.content;
      if (Array.isArray(content)) return content.map((c) => c.text || '').join('');
      return content || '';
    }
  }

  PDA.LLMClient = LLMClient;
  PDA.llm = { LLMClient, extractJson };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDA.llm;
})(typeof window !== 'undefined' ? window : globalThis);
