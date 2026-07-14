const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const JS_DIR = path.join(ROOT, 'public/js');

const CLIENT_FILES = [
  'app-base.js',
  'security.js',
  'auth-login.js',
  'auth-complete-profile.js',
  'admin-core.js',
  'admin-dashboard.js',
  'admin-super-security.js',
  'admin-super-settings.js',
  'admin-super-backup.js',
  'unavailable-ambient.js',
];

function minifySimple(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\r\n/g, '\n')
    .replace(/\n+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*([{}();,=+\-*/<>!&|?:\[\]])\s*/g, '$1')
    .replace(/([{}();,=+\-*/<>!&|?:\[\]])\s+/g, '$1')
    .trim();
}

let built = 0;
for (const file of CLIENT_FILES) {
  const src = path.join(JS_DIR, file);
  if (!fs.existsSync(src)) continue;
  const code = fs.readFileSync(src, 'utf8');
  const min = minifySimple(code);
  const out = path.join(JS_DIR, file.replace(/\.js$/, '.min.js'));
  fs.writeFileSync(out, min, 'utf8');
  built += 1;
  console.log('minified', path.basename(out), `(${code.length} -> ${min.length})`);
}

console.log(`build:client done (${built} files)`);
