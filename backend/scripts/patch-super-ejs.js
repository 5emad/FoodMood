const fs = require('fs');
const path = require('path');

const files = [
  'views/admin/super-security.ejs',
  'views/admin/super-settings.ejs',
  'views/admin/super-backup.ejs',
];

const scriptMap = {
  'views/admin/super-security.ejs': 'admin-super-security',
  'views/admin/super-settings.ejs': 'admin-super-settings',
  'views/admin/super-backup.ejs': 'admin-super-backup',
};

for (const rel of files) {
  const file = path.join(__dirname, '..', rel);
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(
    '<script src="/js/security.js?v=5" defer></script>',
    '<%- include(\'../partials/app-base-meta\') %>\n  <script src="<%= jsAsset(\'app-base\') %>" defer></script>\n  <script src="<%= jsAsset(\'security\') %>" defer></script>',
  );

  const asset = scriptMap[rel];
  const replacement = `<script src="/vendor/sweetalert2/sweetalert2.min.js"></script>
<script src="<%= jsAsset('admin-core') %>"></script>
<script src="<%= jsAsset('${asset}') %>" defer></script>`;

  const start = content.indexOf('<script src="/vendor/sweetalert2/sweetalert2.min.js"></script>');
  const end = content.indexOf('</script>', start);
  const open = content.indexOf('<script>', start);
  if (start < 0 || open < 0) throw new Error(`markers missing in ${rel}`);
  const close = content.indexOf('</script>', open);
  content = content.slice(0, start) + replacement + content.slice(close + '</script>'.length);
  fs.writeFileSync(file, content, 'utf8');
  console.log('patched', rel);
}
