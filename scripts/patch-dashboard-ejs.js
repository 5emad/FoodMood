const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../views/admin/dashboard.ejs');
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  '<script src="/js/security.js?v=5" defer></script>',
  '<%- include(\'../partials/app-base-meta\') %>\n  <script src="<%= jsAsset(\'app-base\') %>" defer></script>\n  <script src="<%= jsAsset(\'security\') %>" defer></script>',
);

const replacement = `<script type="application/json" id="admin-bootstrap"><%- JSON.stringify({
  currentUserRole: user && user.role ? user.role : '',
  isSuperadmin: !!isSuperadmin,
  currentUserId: user && user.id ? user.id : '',
  appSettings: workspaceSettings || { organizationName: 'سامانه تغذیه', defaultMenuItemCapacity: 20, showPricesToUsers: true },
  reportsAccess: typeof reportsAccess !== 'undefined' ? reportsAccess : { allowed: true, pendingCount: 0, message: null }
}) %></script>
<script src="/vendor/sweetalert2/sweetalert2.min.js"></script>
<script src="/vendor/jalalidatepicker/jalalidatepicker.min.js"></script>
<script src="<%= jsAsset('admin-core') %>"></script>
<script src="<%= jsAsset('admin-dashboard') %>" defer></script>`;

const start = content.indexOf('<script src="/vendor/sweetalert2/sweetalert2.min.js"></script>');
const end = content.indexOf('</script>', content.lastIndexOf('buildMonthOptions();'));
if (start < 0 || end < 0) throw new Error('dashboard script markers not found');

content = content.slice(0, start) + replacement + content.slice(end + '</script>'.length);
fs.writeFileSync(file, content, 'utf8');
console.log('patched dashboard.ejs');
