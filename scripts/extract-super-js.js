const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function extractInlineScript(ejsRel, outName, skipInclude = true) {
  const ejsPath = path.join(ROOT, ejsRel);
  const content = fs.readFileSync(ejsPath, 'utf8');
  const marker = '<script src="/vendor/sweetalert2/sweetalert2.min.js"></script>';
  const start = content.indexOf(marker);
  const open = content.indexOf('<script>', start);
  const close = content.indexOf('</script>', open);
  let js = content.slice(open + '<script>'.length, close);
  if (skipInclude) {
    js = js.replace(/<%- include\('partials\/admin-core-scripts'\) %>\s*/g, '');
  }
  const out = path.join(ROOT, 'public/js', outName);
  fs.writeFileSync(out, js.trim() + '\n', 'utf8');
  console.log('extracted', outName, fs.statSync(out).size);
}

extractInlineScript('views/admin/super-security.ejs', 'admin-super-security.js');
extractInlineScript('views/admin/super-settings.ejs', 'admin-super-settings.js');
extractInlineScript('views/admin/super-backup.ejs', 'admin-super-backup.js');
