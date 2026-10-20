// LLMClient tests with a mocked fetch: gating, request shapes, fallbacks, error mapping.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ROOT = path.join(__dirname, '..');
for (const f of ['text', 'llm/errors', 'llm/providers', 'llm/secrets', 'llm/validation', 'llm/llmClient']) require(path.join(ROOT, 'js', f + '.js'));
const P = globalThis.PDA;
P.secrets.init({ session: null, local: null }); // in-memory only

const KEY = 'sk-test-FAKEKEY0123456789abcdefXYZ';

function setup(cfg, responder, consent) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const r = await responder(url, init);
    if (r instanceof Error) throw r;
    return { ok: r.status < 400, status: r.status, statusText: '', text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
  };
  const consents = [];
  const client = new P.LLMClient({
    getConfig: () => cfg,
    getKey: () => cfg._key || '',
    consent: async (info) => { consents.push(info); return consent !== false; },
    fetch
  });
  return { client, calls, consents };
}

const base = (o) => Object.assign({ provider: 'openai', model: 'gpt-x', authorized: true, _key: KEY }, o);

test('no network call before authorization', async () => {
  const { client, calls } = setup(base({ authorized: false }), () => ({ status: 200, body: {} }));
  await assert.rejects(client.generate({ system: 's', user: 'u' }), (e) => e.code === 'NOT_AUTHORIZED');
  await assert.rejects(client.testConnection(), (e) => e.code === 'NOT_AUTHORIZED');
  const r = await client.getAvailableModels();
  assert.equal(r.source, 'fallback');
  assert.equal(calls.length, 0);
});

test('generate requires approval; refusal sends nothing', async () => {
  const { client, calls, consents } = setup(base(), () => ({ status: 200, body: { choices: [{ message: { content: 'ok' } }] } }), false);
  await assert.rejects(client.generate({ system: 's', user: 'données client' }), (e) => e.code === 'CONSENT_DENIED');
  assert.equal(calls.length, 0);
  assert.equal(consents.length, 1);
  assert.match(consents[0].preview, /données client/);
});

test('batch approval token covers exactly N calls', async () => {
  const { client, calls, consents } = setup(base(), () => ({ status: 200, body: { choices: [{ message: { content: '{"a":1}' } }] } }));
  const token = await client.requestApproval({ operation: 'lot', count: 2, preview: 'p', chars: 1 });
  await client.generateJSON({ system: 's', user: 'u' }, token);
  await client.generateJSON({ system: 's', user: 'u' }, token);
  assert.equal(consents.length, 1);
  await client.generateJSON({ system: 's', user: 'u' }, token); // exhausted → asks again
  assert.equal(consents.length, 2);
  assert.equal(calls.length, 3);
  // forged tokens are ignored
  await client.generate({ system: 's', user: 'u' }, { remaining: 99 });
  assert.equal(consents.length, 3);
});

test('OpenAI request shape and model listing', async () => {
  const { client, calls } = setup(base(), (url) => url.endsWith('/models')
    ? { status: 200, body: { data: [{ id: 'gpt-5' }, { id: 'text-embedding-3-small' }, { id: 'gpt-4.1' }] } }
    : { status: 200, body: { choices: [{ message: { content: '{"x":1}' } }] } });
  const m = await client.getAvailableModels();
  assert.equal(m.source, 'api');
  assert.deepEqual(m.models, ['gpt-4.1', 'gpt-5']);
  const token = await client.requestApproval({ count: 1, preview: '' });
  assert.deepEqual(await client.generateJSON({ system: 's', user: 'u' }, token), { x: 1 });
  const post = calls[1];
  assert.equal(post.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(post.init.headers.Authorization, 'Bearer ' + KEY);
  assert.equal(JSON.parse(post.init.body).response_format.type, 'json_object');
  assert.equal(post.init.credentials, 'omit');
});

test('Anthropic headers and response parsing', async () => {
  const { client, calls } = setup(base({ provider: 'anthropic', model: 'claude-sonnet-5-5' }), () => ({ status: 200, body: { content: [{ type: 'text', text: 'bonjour' }] } }));
  const t = await client.requestApproval({ count: 1, preview: '' });
  assert.equal(await client.generate({ system: 's', user: 'u' }, t), 'bonjour');
  const h = calls[0].init.headers;
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(h['x-api-key'], KEY);
  assert.equal(h['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(JSON.parse(calls[0].init.body).system, 's');
});

test('Azure OpenAI deployment URL and api-key header', async () => {
  const cfg = base({ provider: 'azure', azureMode: 'openai', endpoint: 'https://res.openai.azure.com/', deployment: 'gpt4o-prod', apiVersion: '2024-10-21', model: '' });
  const { client, calls } = setup(cfg, () => ({ status: 200, body: { choices: [{ message: { content: 'pong' } }] } }));
  const r = await client.testConnection();
  assert.equal(r.ok, true);
  assert.equal(calls[0].url, 'https://res.openai.azure.com/openai/deployments/gpt4o-prod/chat/completions?api-version=2024-10-21');
  assert.equal(calls[0].init.headers['api-key'], KEY);
  const models = await client.getAvailableModels();
  assert.equal(models.source, 'fallback');
});

test('Ollama Cloud uses /api/chat and /api/tags', async () => {
  const cfg = base({ provider: 'ollama', baseUrl: 'https://ollama.com/api', model: 'gpt-oss:20b' });
  const { client, calls } = setup(cfg, (url) => url.endsWith('/api/tags') ? { status: 200, body: { models: [{ name: 'gpt-oss:20b' }] } } : { status: 200, body: { message: { content: '{"ok":true}' } } });
  assert.deepEqual((await client.getAvailableModels()).models, ['gpt-oss:20b']);
  const t = await client.requestApproval({ count: 1, preview: '' });
  await client.generateJSON({ system: 's', user: 'u' }, t);
  assert.equal(calls[1].url, 'https://ollama.com/api/chat');
  assert.equal(JSON.parse(calls[1].init.body).format, 'json');
});

test('optional proxy rewrites the URL', async () => {
  const { client, calls } = setup(base({ proxyUrl: 'http://127.0.0.1:8787' }), () => ({ status: 200, body: { data: [{ id: 'gpt-5' }] } }));
  await client.getAvailableModels();
  assert.equal(calls[0].url, 'http://127.0.0.1:8787/https/api.openai.com/v1/models');
});

test('model listing failure falls back with a clear reason', async () => {
  const { client } = setup(base({ provider: 'mistral', model: '' }), () => ({ status: 500, body: { message: 'boom' } }));
  const r = await client.getAvailableModels();
  assert.equal(r.source, 'fallback');
  assert.ok(r.models.includes('mistral-large-latest'));
  assert.match(r.reason, /HTTP 500/);
});

test('contextual errors: HTTP, network/CORS, empty, malformed — never with the key', async () => {
  const cases = [
    [() => ({ status: 401, body: { error: { message: 'Incorrect API key provided: ' + KEY, code: 'invalid_api_key' } } }), (e) => e.httpStatus === 401 && e.code === 'invalid_api_key'],
    [() => new TypeError('Failed to fetch'), (e) => e.code === 'NETWORK_OR_CORS'],
    [() => ({ status: 200, body: '' }), (e) => e.code === 'EMPTY_RESPONSE'],
    [() => ({ status: 200, body: '<html>' }), (e) => e.code === 'MALFORMED_JSON'],
    [() => ({ status: 200, body: { choices: [{ message: { content: '' } }] } }), (e) => e.code === 'EMPTY_RESPONSE'],
    [() => ({ status: 200, body: { choices: [{ message: { content: 'pas du json' } }] } }), (e) => e.code === 'MALFORMED_JSON']
  ];
  for (const [responder, check] of cases) {
    const { client } = setup(base(), responder);
    const t = await client.requestApproval({ count: 1, preview: '' });
    await assert.rejects(client.generateJSON({ operation: 'Test', system: 's', user: 'u' }, t), (e) => {
      assert.ok(check(e), 'unexpected ' + e.code);
      const msg = e.toUserMessage();
      assert.ok(!msg.includes(KEY), 'key leaked: ' + msg);
      assert.match(msg, /OpenAI/);
      return true;
    });
  }
});

test('provider switching changes required fields and validation', () => {
  const v = (cfg) => P.validation.validate(cfg, KEY).map((e) => e.code);
  assert.deepEqual(v(base()), []);
  assert.ok(v(base({ provider: 'compatible', baseUrl: '' })).includes('INVALID_ENDPOINT'));
  assert.deepEqual(v(base({ provider: 'compatible', baseUrl: 'https://llm.example.com/v1' })), []);
  assert.ok(v(base({ provider: 'azure', endpoint: '', deployment: '', apiVersion: '' })).length >= 2);
});
