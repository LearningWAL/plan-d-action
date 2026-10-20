// Builds plan-d-action.html: a single self-contained file (CSS, scripts and pdf.js inlined)
// that works even when copied alone (e-mail, SharePoint/OneDrive/Teams, file opened from a zip).
// Usage: node tools/build-single.js [--check]
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Keeps inlined code from closing or confusing the surrounding <script>/<style> element.
// "<!--" only appears inside regex literals in the vendored code, where "<\!--" is equivalent.
function safeScript(code) {
  return code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

let html = read('index.html');

html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, href) =>
  '<style>\n' + read(href).replace(/<\/style/gi, '<\\/style') + '\n</style>');

html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) =>
  '<script>/* ' + src + ' */\n' + safeScript(read(src)) + '\n</script>');

// pdf.js is large and only needed for PDF referentials: stored inert, executed on first use.
const pdf = ['vendor/pdfjs/pdf.worker.min.js', 'vendor/pdfjs/pdf.min.js'].map((src, i) =>
  '<script type="text/plain" id="pda-inline-' + (i ? 'pdfjs' : 'pdfjs-worker') + '">' + safeScript(read(src)) + '</script>').join('\n');
// Insert before the page's own (last) </body>: the inlined libraries contain "</body>" strings.
const bodyEnd = html.lastIndexOf('</body>');
html = html.slice(0, bodyEnd) + pdf + '\n' + html.slice(bodyEnd);

html = html.replace('<html lang="fr">', () => '<html lang="fr" data-build="single-file">');

if (/<script src=|<link rel="stylesheet" href=/.test(html)) throw new Error('Unresolved external reference left in the bundle.');
const out = path.join(ROOT, 'plan-d-action.html');
if (process.argv.includes('--check')) {
  const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (current !== html) { console.error('plan-d-action.html est obsolète : lancez npm run build.'); process.exit(1); }
  console.log('plan-d-action.html est à jour.');
  process.exit(0);
}
fs.writeFileSync(out, html);
console.log('Wrote', path.relative(ROOT, out), '(' + Math.round(fs.statSync(out).size / 1024) + ' Ko)');
