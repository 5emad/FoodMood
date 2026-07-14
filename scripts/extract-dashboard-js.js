const fs = require('fs');
const path = require('path');

const dashboardPath = path.join(__dirname, '../views/admin/dashboard.ejs');
const outPath = path.join(__dirname, '../public/js/admin-dashboard.js');

const dash = fs.readFileSync(dashboardPath, 'utf8');
const startMarker = '<script src="/vendor/jalalidatepicker/jalalidatepicker.min.js"></script>';
const startIdx = dash.indexOf(startMarker);
if (startIdx < 0) throw new Error('dashboard script start not found');

const scriptOpen = dash.indexOf('<script>', startIdx);
const scriptClose = dash.indexOf('</script>', scriptOpen);
if (scriptOpen < 0 || scriptClose < 0) throw new Error('dashboard script block not found');

let js = dash.slice(scriptOpen + '<script>'.length, scriptClose);

js = js.replace(/\/\/ Fallback if Sweetalert2[\s\S]*?\n}\n\n/, '');
js = js.replace(/<% if \(isSuperadmin\) { %>[\s\S]*?<% } %>\s*/g, '');
js = js.replace(/const currentUserRole = '[^']*';\r?\n/, '');
js = js.replace(/const isSuperadmin = [^;]+;\r?\n/, '');
js = js.replace(/const currentUserId = '[^']*';\r?\n/, '');
js = js.replace(/let appSettings = <%-[\s\S]*?%>;\r?\n/, '');
js = js.replace(/let reportsAccess = <%-[\s\S]*?%>;\r?\n/, '');

const header = `(function () {
  'use strict';
  var bootEl = document.getElementById('admin-bootstrap');
  var boot = bootEl ? JSON.parse(bootEl.textContent || '{}') : {};
  var currentUserRole = boot.currentUserRole || '';
  var isSuperadmin = !!boot.isSuperadmin;
  var currentUserId = boot.currentUserId || '';
  var appSettings = boot.appSettings || {};
  var reportsAccess = boot.reportsAccess || { allowed: true, pendingCount: 0, message: null };

`;

if (!js.trimEnd().endsWith('})();') && !js.trimEnd().endsWith('}')) {
  js = js.trimEnd() + '\n})();\n';
} else if (!js.includes('(function')) {
  js = js.trimEnd() + '\n})();\n';
}

const footer = js.trimEnd().endsWith('})();') ? '' : '\n})();\n';
const body = js.trimEnd().endsWith('})();') ? js : js;

fs.writeFileSync(outPath, header + body.replace(/\r\n/g, '\n') + (body.includes('})();') ? '\n' : '\n})();\n'), 'utf8');
console.log('Wrote', outPath, fs.statSync(outPath).size, 'bytes');
