// End-to-end smoke test in Chromium on file:// (dev only, not needed to use the app).
// Run: NODE_PATH=$(npm root -g) node tests/e2e.smoke.mjs   (requires the "playwright" package)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const XLSX = require(path.join(ROOT, 'vendor/xlsx-js-style/xlsx.min.js'));
const KEY = 'sk-test-E2EFAKEKEY0123456789abcdefXYZ';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pda-e2e-'));

// Minimal one-page PDF with real text, to exercise pdf.js extraction.
function makePdf(file) {
  const lines = ['1. Journalisation', 'Centraliser les journaux de securite dans un SIEM et conserver un an.', '', '2. Sauvegardes', 'Tester la restauration des sauvegardes chaque trimestre.'];
  const stream = 'BT /F1 11 Tf 50 780 Td 14 TL ' + lines.map((l) => '(' + l + ') Tj T*').join(' ') + ' ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xref = out.length;
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
  fs.writeFileSync(file, out, 'latin1');
}

const step = (s) => console.log('✓', s);

const browser = await chromium.launch();
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const external = [];
const pageErrors = [];
page.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) external.push(r.method() + ' ' + r.url()); });
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) pageErrors.push(m.text()); if (m.text().includes(KEY)) throw new Error('key logged'); });

let openaiMode = 'models';
await context.route('https://api.openai.com/**', async (route) => {
  const url = route.request().url();
  if (openaiMode === 'error401') return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Incorrect API key provided: ' + KEY, code: 'invalid_api_key' } }) });
  if (openaiMode === 'error500') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"message":"server down"}}' });
  if (url.endsWith('/models')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'gpt-5' }, { id: 'gpt-4.1' }, { id: 'text-embedding-3-large' }] }) });
  const body = JSON.parse(route.request().postData());
  assert.ok(!JSON.stringify(body).includes('admin@exemple.local'), 'email should be pseudonymised');
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ situation_actuelle: 'Synthèse IA.', maturite_estimee: 1, justification_maturite: 'ok', mesures: ['Mesure IA 1', 'Mesure IA 2'], effort: 'Moyen', justification_priorite: 'car' }) } }] }) });
});

await page.goto(pathToFileURL(path.resolve(ROOT, process.env.PDA_E2E_PAGE || 'index.html')).href);
assert.equal(await page.title(), 'Plan d\'action maturité');

// 1. Questionnaire
await page.setInputFiles('#q-file', path.join(ROOT, 'sample/questionnaire-exemple.xlsx'));
await page.waitForSelector('#q-mapping-card:not(.hidden)');
assert.match(await page.textContent('#q-count'), /14 ligne/);
step('questionnaire imported and mapped');

// 2. Referentials: catalogue + PDF
await page.click('[data-tab="referentials"]');
await page.setInputFiles('#ref-file', path.join(ROOT, 'sample/referentiel-mesures-exemple.xlsx'));
await page.waitForSelector('#ref-mapping-card:not(.hidden)');
await page.click('#ref-add');
const pdf = path.join(tmp, 'guide.pdf');
makePdf(pdf);
await page.setInputFiles('#ref-file', pdf);
await page.waitForFunction(() => document.querySelectorAll('#ref-list tbody tr').length === 2, null, { timeout: 15000 });
assert.match(await page.textContent('#ref-list'), /guide\.pdf/);
step('referentials imported (catalogue + PDF via pdf.js on file://)');

// 3. Generate
await page.click('[data-tab="settings"]');
await page.click('#generate');
await page.waitForSelector('#plan-table tbody tr');
const rows = await page.$$eval('#plan-table tbody tr[data-uid]', (r) => r.length);
assert.ok(rows >= 8, 'rows: ' + rows);
step(rows + ' actions generated deterministically');

// 4. AI settings: provider switching updates fields
await page.click('[data-tab="ai"]');
const visible = async (f) => page.$eval('#tab-ai label[data-field="' + f + '"]', (el) => !el.classList.contains('hidden'));
await page.selectOption('#ai-provider', 'azure');
assert.ok(await visible('endpoint') && await visible('deployment') && await visible('apiVersion') && !(await visible('baseUrl')));
await page.selectOption('#ai-azureMode', 'foundry');
assert.ok(await visible('model') && !(await visible('deployment')));
await page.selectOption('#ai-provider', 'ollama');
assert.ok(await visible('baseUrl') && !(await visible('endpoint')));
assert.equal(await page.inputValue('#ai-baseUrl'), 'https://ollama.com');
await page.selectOption('#ai-provider', 'openai');
assert.ok(!(await visible('baseUrl')) && await visible('apiKey'));
step('provider switching updates fields');

// Key handling: stored in sessionStorage only, never shown
await page.fill('#ai-apiKey', KEY);
await page.press('#ai-apiKey', 'Tab');
assert.equal(await page.inputValue('#ai-apiKey'), '');
assert.ok(!(await page.content()).includes(KEY), 'key must not appear in the DOM');
const stores = await page.evaluate(() => [JSON.stringify(sessionStorage), JSON.stringify(localStorage)]);
assert.ok(stores[0].includes('pda.secret.v1.openai'));
assert.ok(!stores[1].includes('sk-test'), 'key must not be in localStorage without opt-in');
step('key stored in sessionStorage only, masked in UI');

// No call before authorization
await page.click('#ai-load-models');
await page.click('#ai-test');
await page.waitForTimeout(300);
assert.equal(external.length, 0, 'unexpected requests: ' + external.join(', '));
assert.match(await page.textContent('#ai-message'), /autoris/i);
step('no network call before authorization');

// Authorized: models load from API, then fallback on failure
await page.check('#ai-authorized');
await page.click('#ai-load-models');
await page.waitForFunction(() => /chargé/.test(document.getElementById('ai-models-state').textContent));
assert.equal(await page.$$eval('#ai-models option', (o) => o.length), 2);
openaiMode = 'error500';
await page.click('#ai-load-models');
await page.waitForFunction(() => /par défaut/.test(document.getElementById('ai-models-state').textContent));
assert.match(await page.textContent('#ai-message'), /HTTP 500/);
step('model loading from API, clear fallback on failure');

// Contextual error without secret
openaiMode = 'error401';
await page.fill('#ai-model', 'gpt-5');
await page.click('#ai-test');
await page.waitForFunction(() => /HTTP 401/.test(document.getElementById('ai-message').textContent));
const msg = await page.textContent('#ai-message');
assert.ok(!msg.includes(KEY) && /invalid_api_key/.test(msg) && /OpenAI/.test(msg), msg);
assert.match(await page.textContent('#ai-pill'), /erreur/);
step('contextual error shown without secret: ' + msg.slice(0, 90) + '…');

// Enrichment needs explicit approval; cancel sends nothing
openaiMode = 'models';
await page.click('[data-tab="plan"]');
await page.check('#plan-table tbody tr[data-uid] input[data-sel]');
const before = external.length;
await page.click('#ai-enrich');
await page.waitForSelector('#consent-dialog[open]');
assert.match(await page.textContent('#consent-dialog [data-c="preview"]'), /Exigence/);
await page.click('#consent-dialog [data-c="cancel"]');
await page.waitForTimeout(200);
assert.equal(external.length, before, 'no request after cancel');
await page.click('#ai-enrich');
await page.waitForSelector('#consent-dialog[open]');
await page.click('#consent-dialog [data-c="approve"]');
await page.waitForFunction(() => /IA \(à relire\)/.test(document.getElementById('plan-table').textContent));
step('AI enrichment only after explicit approval');

// Exports contain no secrets
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-xlsx')]);
const xlsxPath = path.join(tmp, 'plan.xlsx');
await dl.saveAs(xlsxPath);
const wb = XLSX.read(fs.readFileSync(xlsxPath));
assert.deepEqual(wb.SheetNames, ['Plan d\'action', 'Synthèse', 'Paramètres']);
const all = wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n])).join('\n');
assert.ok(!all.includes(KEY) && /Mesure IA 1/.test(all));
assert.ok(!fs.readFileSync(xlsxPath).includes(Buffer.from(KEY)));
const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#save-project')]);
const jsonPath = path.join(tmp, 'p.json');
await dl2.saveAs(jsonPath);
const json = fs.readFileSync(jsonPath, 'utf8');
assert.ok(!json.includes(KEY) && !/apiKey/.test(json));
const projectSession = await page.evaluate(() => sessionStorage.getItem('pda.project.v1') || '');
assert.ok(!projectSession.includes(KEY));
step('XLSX + JSON exports and autosave contain no secret');

await page.click('[data-tab="ai"]');
await page.click('#ai-clear-keys');
const after = await page.evaluate(() => JSON.stringify(sessionStorage) + JSON.stringify(localStorage));
assert.ok(!after.includes(KEY));
step('"Effacer les clés API" removes keys');

assert.deepEqual(pageErrors, []);
await browser.close();
console.log('\nE2E smoke test passed.');
