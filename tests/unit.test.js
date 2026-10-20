// Unit tests for the pure logic. Run: node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
globalThis.XLSX = require(path.join(ROOT, 'vendor/xlsx-js-style/xlsx.min.js'));
for (const f of ['text', 'importer', 'maturity', 'matcher', 'referential', 'planBuilder', 'llm/errors', 'llm/providers', 'llm/secrets', 'llm/validation', 'llm/llmClient', 'aiAssist', 'exporter']) {
  require(path.join(ROOT, 'js', f + '.js'));
}
const P = globalThis.PDA;

class MemStorage {
  constructor() { this.m = new Map(); }
  get length() { return this.m.size; }
  key(i) { return Array.from(this.m.keys())[i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

const FAKE_KEY = 'sk-test-THISISAFAKEKEY1234567890abcd';

function samplePlan() {
  const wb = P.importer.readWorkbook(fs.readFileSync(path.join(ROOT, 'sample/questionnaire-exemple.xlsx')));
  const rows = P.importer.sheetRows(wb, wb.SheetNames[0]);
  const table = P.importer.buildTable(rows, P.importer.detectHeaderRow(rows));
  const mapping = P.importer.guessMapping(table.headers);
  const items = table.records.map((r) => P.importer.toItem(r, mapping));
  return { table, mapping, items, actions: P.planBuilder.buildPlan(items, [], {}) };
}

test('importer detects header row and guesses mapping', () => {
  const { table, mapping } = samplePlan();
  assert.equal(table.headers[2], 'Exigence');
  assert.equal(mapping.requirement, 2);
  assert.deepEqual(mapping.comments, [4]);
  assert.equal(mapping.score, 3);
  assert.equal(mapping.recommendation, 5);
  assert.deepEqual(P.importer.validateMapping(mapping), []);
});

test('maturity: explicit scores', () => {
  const s = P.maturity.parseScore;
  assert.equal(s('3', 5).level, 3);
  assert.equal(s('1/5', 5).level, 1);
  assert.equal(s('60 %', 5).level, 3);
  assert.equal(s('Non', 5).level, 0);
  assert.equal(s('Non conforme', 5).level, 0);
  assert.equal(s('Partiel', 5).level, 2);
  assert.equal(s('Oui', 5).level, 4);
  assert.equal(s('N/A', 5).na, true);
  assert.equal(s('', 5), null);
});

test('maturity: comment inference handles negation', () => {
  const inf = (t) => P.maturity.inferFromComments([t], 5).level;
  assert.equal(inf('Aucune procédure, rien n\'existe.'), 0);
  assert.ok(inf('Processus non formalisé, au cas par cas.') <= 1);
  assert.equal(inf('Partiellement déployé, en cours sur la messagerie.') >= 2, true);
  assert.ok(inf('Procédure documentée et appliquée, revue annuelle avec indicateurs.') >= 3);
  assert.ok(inf('Sauvegardes automatisées, amélioration continue.') >= 4);
  assert.equal(inf('Le sujet a été évoqué.'), null);
});

test('maturity: score wins over comments, divergence flagged', () => {
  const r = P.maturity.assess({ score: '4', comments: ['Aucune procédure, pas de contrôle'] }, { scaleMax: 5 });
  assert.equal(r.level, 4);
  assert.equal(r.source, 'score');
  assert.match(r.note, /confirmer/);
});

test('matcher ranks the relevant measure first', () => {
  const idx = P.matcher.buildIndex([
    { id: 'a', text: 'Authentification multifacteur pour les accès distants' },
    { id: 'b', text: 'Sauvegardes testées régulièrement' },
    { id: 'c', text: 'Cloisonnement du réseau en zones' }
  ]);
  const hits = P.matcher.search(idx, 'Mettre en œuvre l\'authentification multifacteur', 2, 0.05);
  assert.equal(hits[0].doc.id, 'a');
});

test('plan builder: gaps, priorities, exclusions', () => {
  const { actions } = samplePlan();
  assert.ok(actions.length >= 8);
  const ids = actions.map((a) => a.reqId);
  assert.ok(!ids.includes('FOU-01'), 'N/A excluded');
  assert.ok(!ids.includes('OPS-02'), 'compliant excluded');
  for (const a of actions) {
    assert.ok(a.gap > 0);
    assert.ok(['P1', 'P2', 'P3'].includes(a.priority));
    assert.ok(a.action.length > 0);
  }
  const gov = actions.find((a) => a.reqId === 'GOV-01');
  assert.match(gov.action, /PSSI/);
  assert.equal(gov.measureSource, 'Recommandation (questionnaire)');
  // P1 first
  assert.equal(actions[0].priority, 'P1');
});

test('plan builder uses referential measures when no recommendation', () => {
  const { items } = samplePlan();
  const refs = [{ name: 'Cat', type: 'table', enabled: true, measures: [
    { id: 'M1', title: 'Centralisation des journaux', text: 'Centralisation des journaux — Centraliser les journaux d\'événements dans un SIEM', location: 'ligne 2' }] }];
  const actions = P.planBuilder.buildPlan(items, P.referential.allEnabledMeasures(refs), {});
  const ops = actions.find((a) => a.reqId === 'OPS-03');
  assert.match(ops.action, /journaux/i);
  assert.equal(ops.measures[0].ref, 'M1');
  assert.equal(ops.effort, 'Élevé');
});

test('referential PDF chunking keeps page numbers', () => {
  const pages = [{ page: 1, text: '1. Politique\n\n' + 'La politique de sécurité doit être revue. '.repeat(20) }, { page: 2, text: '2. Accès\n\n' + 'Les accès sont revus annuellement. '.repeat(30) }];
  const ref = P.referential.fromPdfPages('doc.pdf', pages);
  assert.ok(ref.measures.length >= 2);
  assert.ok(ref.measures.some((m) => m.location === 'page 2'));
});

test('validation: HTTPS, loopback, normalisation', () => {
  const n = P.validation.normalizeBaseUrl;
  assert.equal(n('https://api.example.com/v1/chat/completions/', { stripSuffixes: ['/chat/completions'] }).url, 'https://api.example.com/v1');
  assert.ok(n('http://api.example.com/v1').error);
  assert.ok(n('http://localhost:11434', { allowLoopbackHttp: true }).url);
  assert.ok(n('http://192.168.1.2:11434', { allowLoopbackHttp: true }).error);
  assert.ok(n('https://user:pw@example.com').error);
  assert.equal(n('ollama.com/api/', { stripSuffixes: ['/api'] }).url, 'https://ollama.com');
});

test('validation: authorization, key, Azure fields', () => {
  const v = P.validation.validate;
  const codes = (cfg, key) => v(cfg, key).map((e) => e.code);
  assert.ok(codes({ provider: 'openai', model: 'gpt-x', authorized: false }, FAKE_KEY).includes('NOT_AUTHORIZED'));
  assert.ok(codes({ provider: 'openai', model: 'gpt-x', authorized: true }, '').includes('MISSING_KEY'));
  assert.deepEqual(codes({ provider: 'openai', model: 'gpt-x', authorized: true }, FAKE_KEY), []);
  const az = { provider: 'azure', authorized: true, azureMode: 'openai', endpoint: 'https://x.openai.azure.com', deployment: 'gpt4o', apiVersion: '2024-10-21' };
  assert.deepEqual(codes(az, FAKE_KEY), []);
  assert.ok(codes(Object.assign({}, az, { endpoint: 'http://x.openai.azure.com' }), FAKE_KEY).includes('INVALID_ENDPOINT'));
  assert.ok(codes(Object.assign({}, az, { endpoint: 'https://evil.example.com' }), FAKE_KEY).includes('INVALID_ENDPOINT'));
  assert.ok(codes(Object.assign({}, az, { apiVersion: 'latest' }), FAKE_KEY).includes('VALIDATION'));
  // local Ollama does not need a key, Ollama Cloud does
  assert.deepEqual(codes({ provider: 'ollama', authorized: true, baseUrl: 'http://localhost:11434', model: 'llama3' }, ''), []);
  assert.ok(codes({ provider: 'ollama', authorized: true, baseUrl: 'https://ollama.com', model: 'gpt-oss:20b' }, '').includes('MISSING_KEY'));
});

test('secrets: session by default, local only when remembered, migration', () => {
  const session = new MemStorage(), local = new MemStorage();
  P.secrets.init({ session, local });
  P.secrets.set('openai', FAKE_KEY, false);
  assert.equal(session.getItem(P.secrets.NS + 'openai'), FAKE_KEY);
  assert.equal(local.length, 0);
  P.secrets.setRemember('openai', true);
  assert.equal(local.getItem(P.secrets.NS + 'openai'), FAKE_KEY);
  assert.equal(session.getItem(P.secrets.NS + 'openai'), null);
  assert.ok(!P.secrets.mask(FAKE_KEY).includes(FAKE_KEY.slice(0, 10)));
  local.setItem('pda.apiKey', 'sk-legacy-123456789012345678');
  local.setItem('pda.project.v1', JSON.stringify({ app: 'plan-d-action', ai: { provider: 'openai', apiKey: 'x' } }));
  P.secrets.migrateLegacy();
  assert.equal(local.getItem('pda.apiKey'), null);
  assert.ok(!local.getItem('pda.project.v1').includes('apiKey'));
  P.secrets.clearAll();
  assert.equal(P.secrets.get('openai'), '');
});

test('exports never contain secrets', () => {
  P.secrets.init({ session: new MemStorage(), local: new MemStorage() });
  P.secrets.set('openai', FAKE_KEY, false);
  const { actions } = samplePlan();
  const state = { questionnaire: { fileName: 'q.xlsx', headers: [], records: [] }, mapping: {}, referentials: [], settings: P.planBuilder.DEFAULT_SETTINGS, actions,
    ai: { provider: 'openai', model: 'gpt-x', apiKey: FAKE_KEY, token: 'abc' } };
  const json = P.exporter.exportProjectJson(state);
  assert.ok(!json.includes(FAKE_KEY));
  assert.ok(!/apiKey|"token"/.test(json));
  // a key pasted into a field must block the export
  const leaky = Object.assign({}, state, { actions: [Object.assign({}, actions[0], { owner: FAKE_KEY })] });
  assert.throws(() => P.exporter.exportProjectJson(leaky), /Export bloqué/);
  // workbook content
  const wb = P.exporter.buildWorkbook(state);
  const csv = wb.SheetNames.map((n) => globalThis.XLSX.utils.sheet_to_csv(wb.Sheets[n])).join('\n');
  assert.ok(!csv.includes(FAKE_KEY));
  assert.match(csv, /PSSI/);
  P.secrets.clearAll();
});

test('project import strips keys', () => {
  const obj = P.exporter.parseProjectJson(JSON.stringify({ app: 'plan-d-action', ai: { provider: 'openai', apiKey: FAKE_KEY } }));
  assert.equal(obj.ai.apiKey, undefined);
});

test('errors are redacted', () => {
  const e = new P.LLMError({ operation: 'x', provider: 'OpenAI', model: 'm', httpStatus: 401, code: 'invalid_api_key', providerMessage: 'Incorrect API key provided: ' + FAKE_KEY });
  assert.ok(!e.toUserMessage().includes(FAKE_KEY));
  assert.match(e.toUserMessage(), /HTTP 401/);
});

test('aiAssist pseudonymises and merges JSON safely', () => {
  const s = P.aiAssist.pseudonymize('Contact admin@client.fr sur 10.0.0.12, tel 01 23 45 67 89, ACME', ['ACME']);
  assert.ok(!/admin@|10\.0\.0\.12|01 23|ACME/.test(s));
  const { actions } = samplePlan();
  const m = P.aiAssist.merge(actions[0], { situation_actuelle: 'Situation.', maturite_estimee: 9, mesures: ['Faire A', 'Faire B'], effort: 'Faible' }, { scaleMax: 5 });
  assert.equal(m.currentLevel, 5);
  assert.equal(m.gap, 0);
  assert.match(m.action, /1\. Faire A/);
  assert.equal(m.origin, 'IA (à relire)');
});
