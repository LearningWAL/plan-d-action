#!/usr/bin/env node
// OPTIONAL strict local proxy for providers that block browser CORS. Not needed for the core app.
// Usage: node proxy/strict-proxy.mjs [port]   (Node 18+, no dependencies)
// Then set "Proxy local optionnel" to http://127.0.0.1:8787 in the AI settings.
// The app calls http://127.0.0.1:8787/https/<allowlisted-host>/<path>; the proxy forwards over HTTPS only.
import http from 'node:http';

const PORT = Number(process.argv[2] || process.env.PDA_PROXY_PORT || 8787);
const MAX_BODY = 2 * 1024 * 1024;
const TIMEOUT_MS = 120000;

// Exact hosts or suffixes (leading dot). Extend via PDA_PROXY_EXTRA_HOSTS="llm.example.com,.corp-ai.example".
const ALLOWED_HOSTS = [
  'api.openai.com', 'api.anthropic.com', 'api.mistral.ai', 'ollama.com',
  '.openai.azure.com', '.cognitiveservices.azure.com', '.services.ai.azure.com', '.inference.ai.azure.com', '.models.ai.azure.com'
].concat(String(process.env.PDA_PROXY_EXTRA_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));

// Only these request headers are forwarded upstream.
const FORWARD_HEADERS = ['authorization', 'x-api-key', 'api-key', 'anthropic-version', 'content-type', 'accept'];
// Only these response headers are returned.
const RETURN_HEADERS = ['content-type', 'x-request-id', 'request-id', 'retry-after'];

// Browser origins allowed to call the proxy: file:// pages send "null"; localhost dev servers too.
function originAllowed(origin) {
  return !origin || origin === 'null' || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function hostAllowed(host) {
  const h = host.toLowerCase();
  return ALLOWED_HOSTS.some((a) => (a.startsWith('.') ? h.endsWith(a) && h.length > a.length : h === a));
}

function cors(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', origin || 'null');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', FORWARD_HEADERS.join(', '));
  res.setHeader('Access-Control-Max-Age', '600');
}

function jsonError(res, status, code, message) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: { code, message } }));
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (!originAllowed(origin)) return jsonError(res, 403, 'origin_not_allowed', 'Origin not allowed.');
  cors(res, origin);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method !== 'GET' && req.method !== 'POST') return jsonError(res, 405, 'method_not_allowed', 'Only GET and POST are allowed.');

  // /https/<host>/<path...>
  const m = /^\/https\/([^/?#]+)(\/[^#]*)?$/.exec(req.url || '');
  if (!m) return jsonError(res, 400, 'bad_target', 'Expected /https/<host>/<path>.');
  const host = m[1];
  if (!/^[a-z0-9.-]+$/i.test(host) || !hostAllowed(host)) return jsonError(res, 403, 'host_not_allowed', 'Host not in allowlist: ' + host);
  const target = 'https://' + host + (m[2] || '/');

  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) return jsonError(res, 413, 'body_too_large', 'Request body exceeds 2 MB.');
    chunks.push(c);
  }

  const headers = {};
  for (const h of FORWARD_HEADERS) if (req.headers[h]) headers[h] = req.headers[h];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(target, { method: req.method, headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined, signal: ctrl.signal, redirect: 'error' });
  } catch (e) {
    clearTimeout(timer);
    // Log only non-sensitive metadata.
    console.error(new Date().toISOString(), req.method, host, 'upstream_error', e.name);
    return jsonError(res, 502, e.name === 'AbortError' ? 'upstream_timeout' : 'upstream_unreachable', 'Upstream request failed (' + e.name + ').');
  }
  clearTimeout(timer);
  const body = Buffer.from(await upstream.arrayBuffer());
  const out = {};
  for (const h of RETURN_HEADERS) { const v = upstream.headers.get(h); if (v) out[h] = v; }
  console.log(new Date().toISOString(), req.method, host, upstream.status);
  res.writeHead(upstream.status, out);
  res.end(body);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Strict proxy listening on http://127.0.0.1:' + PORT + ' (allowlist: ' + ALLOWED_HOSTS.join(', ') + ')');
});
