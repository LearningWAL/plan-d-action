/* API key storage, kept apart from project data. sessionStorage by default,
   localStorage only when the user explicitly ticks "Remember this key on this browser". */
(function (g) {
  'use strict';
  const PDA = (g.PDA = g.PDA || {});

  const NS = 'pda.secret.v1.';
  const LEGACY_NAME = /api.?key|apikey|secret|token|password|bearer|credential/i;
  const LEGACY_VALUE = /^(sk-|sk-ant-|Bearer\s)/;

  let session = null, local = null, initialized = false;
  const memory = new Map(); // fallback when Web Storage is unavailable (private mode, blocked site data)

  function safeStorage(name) {
    try {
      const s = g[name];
      const probe = '__pda_probe__';
      s.setItem(probe, '1'); s.removeItem(probe);
      return s;
    } catch (e) { return null; }
  }

  function init(stores) {
    session = stores && 'session' in stores ? stores.session : safeStorage('sessionStorage');
    local = stores && 'local' in stores ? stores.local : safeStorage('localStorage');
    memory.clear();
    initialized = true;
  }

  function ensure() { if (!initialized) init(); }

  function tryGet(store, k) { try { return store ? store.getItem(k) : null; } catch (e) { return null; } }
  function trySet(store, k, v) { try { if (store) { store.setItem(k, v); return true; } } catch (e) { /* quota/blocked */ } return false; }
  function tryRemove(store, k) { try { if (store) store.removeItem(k); } catch (e) { /* ignore */ } }

  function get(provider) {
    ensure();
    const k = NS + provider;
    return tryGet(session, k) || tryGet(local, k) || memory.get(k) || '';
  }

  function isRemembered(provider) {
    ensure();
    return !!tryGet(local, NS + provider);
  }

  function set(provider, value, remember) {
    ensure();
    const k = NS + provider;
    const v = String(value || '').trim();
    tryRemove(session, k); tryRemove(local, k); memory.delete(k);
    if (!v) return;
    if (remember && trySet(local, k, v)) return;
    if (!trySet(session, k, v)) memory.set(k, v);
  }

  function setRemember(provider, remember) {
    const v = get(provider);
    if (v) set(provider, v, remember);
  }

  function clearAll() {
    ensure();
    for (const store of [session, local]) {
      if (!store) continue;
      try {
        const keys = [];
        for (let i = 0; i < store.length; i++) keys.push(store.key(i));
        keys.filter((k) => k && k.startsWith(NS)).forEach((k) => store.removeItem(k));
      } catch (e) { /* ignore */ }
    }
    memory.clear();
  }

  function knownValues() {
    ensure();
    const out = new Set(memory.values());
    for (const store of [session, local]) {
      if (!store) continue;
      try {
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i);
          if (k && k.startsWith(NS)) { const v = store.getItem(k); if (v) out.add(v); }
        }
      } catch (e) { /* ignore */ }
    }
    return Array.from(out);
  }

  function mask(value) {
    const v = String(value || '');
    if (!v) return '';
    return v.length > 12 ? '••••••••' + v.slice(-4) : '••••••••';
  }

  // Removes credentials stored outside the dedicated namespace (older versions, other tools on
  // the same file:// origin writing "apiKey" entries) and strips keys from saved project data.
  function migrateLegacy() {
    ensure();
    let removed = 0;
    for (const store of [session, local]) {
      if (!store) continue;
      try {
        const keys = [];
        for (let i = 0; i < store.length; i++) keys.push(store.key(i));
        for (const k of keys) {
          if (!k || k.startsWith(NS)) continue;
          const v = store.getItem(k) || '';
          if (k.startsWith('pda.') && (LEGACY_NAME.test(k) || LEGACY_VALUE.test(v))) { store.removeItem(k); removed++; continue; }
          if (k.startsWith('pda.') && v.startsWith('{')) {
            try {
              const obj = JSON.parse(v);
              if (stripKeys(obj)) { store.setItem(k, JSON.stringify(obj)); removed++; }
            } catch (e) { /* not JSON */ }
          }
        }
      } catch (e) { /* ignore */ }
    }
    return removed;
  }

  // Deletes credential-like properties in place; returns true when something was removed.
  function stripKeys(obj) {
    let changed = false;
    (function walk(o) {
      if (!o || typeof o !== 'object') return;
      for (const k of Object.keys(o)) {
        if (LEGACY_NAME.test(k) && k !== 'hasKey') { delete o[k]; changed = true; } else walk(o[k]);
      }
    })(obj);
    return changed;
  }

  PDA.secrets = { NS, init, get, set, setRemember, isRemembered, clearAll, knownValues, mask, migrateLegacy, stripKeys };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDA.secrets;
})(typeof window !== 'undefined' ? window : globalThis);
