/* Contextual, secret-free errors for every LLM operation. */
(function (g) {
  'use strict';
  const PDA = (g.PDA = g.PDA || {});

  const SECRET_PATTERNS = [
    /\bsk-ant-[A-Za-z0-9_\-]{8,}/g,
    /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_\-]{16,}/g,
    /\bBearer\s+[A-Za-z0-9._\-~+/=]{8,}/gi,
    /\b(?:api[-_]?key|x-api-key|authorization)\s*[:=]\s*["']?[^\s"',;]{6,}/gi
  ];

  // Removes known secret values and anything that looks like a credential.
  function redact(text, knownSecrets) {
    let s = String(text == null ? '' : text);
    for (const k of knownSecrets || (PDA.secrets ? PDA.secrets.knownValues() : [])) {
      if (k && k.length >= 4) s = s.split(k).join('[clé masquée]');
    }
    for (const re of SECRET_PATTERNS) s = s.replace(re, '[clé masquée]');
    return s;
  }

  function containsSecret(text, knownSecrets) {
    const s = String(text == null ? '' : text);
    for (const k of knownSecrets || []) if (k && k.length >= 4 && s.includes(k)) return true;
    return SECRET_PATTERNS.some((re) => { re.lastIndex = 0; const hit = re.test(s); re.lastIndex = 0; return hit; });
  }

  const CODE_HINTS = {
    NOT_AUTHORIZED: 'Cochez la confirmation d\'autorisation d\'usage de l\'IA dans les Paramètres IA.',
    CONSENT_DENIED: 'Envoi annulé par l\'utilisateur.',
    VALIDATION: 'Vérifiez les paramètres du fournisseur.',
    MISSING_KEY: 'Renseignez la clé API du fournisseur.',
    INVALID_ENDPOINT: 'L\'URL doit être en HTTPS (http accepté uniquement pour localhost).',
    NETWORK_OR_CORS: 'Requête bloquée (réseau, pare-feu ou CORS). Voir docs/CORS.md : utilisez un endpoint compatible ou le proxy local optionnel.',
    TIMEOUT: 'Délai dépassé : réessayez ou réduisez la taille de la requête.',
    HTTP_ERROR: 'Le fournisseur a renvoyé une erreur.',
    EMPTY_RESPONSE: 'Le fournisseur a renvoyé une réponse vide.',
    MALFORMED_JSON: 'La réponse n\'est pas un JSON exploitable.',
    MODELS_UNAVAILABLE: 'Liste des modèles indisponible : liste par défaut utilisée.'
  };

  class LLMError extends Error {
    constructor(info) {
      const i = info || {};
      const providerMessage = redact(i.providerMessage || '');
      super(redact(i.message || CODE_HINTS[i.code] || 'Erreur IA'));
      this.name = 'LLMError';
      this.operation = i.operation || '';
      this.provider = i.provider || '';
      this.model = i.model || '';
      this.httpStatus = i.httpStatus || null;
      this.code = i.code || 'UNKNOWN';
      this.providerMessage = providerMessage;
    }

    // One-line, user-facing description; never contains secrets.
    toUserMessage() {
      const parts = [this.message];
      const ctx = [];
      if (this.operation) ctx.push('opération : ' + this.operation);
      if (this.provider) ctx.push('fournisseur : ' + this.provider);
      if (this.model) ctx.push('modèle : ' + this.model);
      if (this.httpStatus) ctx.push('HTTP ' + this.httpStatus);
      if (this.code) ctx.push('code : ' + this.code);
      if (ctx.length) parts.push('(' + ctx.join(', ') + ')');
      if (this.providerMessage) parts.push('— message fournisseur : ' + this.providerMessage);
      if (CODE_HINTS[this.code] && this.message !== CODE_HINTS[this.code]) parts.push('→ ' + CODE_HINTS[this.code]);
      return redact(parts.join(' '));
    }
  }

  PDA.LLMError = LLMError;
  PDA.llmErrors = { LLMError, redact, containsSecret, CODE_HINTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDA.llmErrors;
})(typeof window !== 'undefined' ? window : globalThis);
