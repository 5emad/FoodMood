const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '../views/admin/dashboard.ejs');
const dest = path.join(__dirname, '../views/admin/dashboard-fragment.ejs');
const lines = fs.readFileSync(src, 'utf8').split(/\r?\n/);
const fragment = lines.slice(41, 542).join('\n');
fs.writeFileSync(dest, fragment, 'utf8');
console.log('wrote', dest, 'lines:', fragment.split('\n').length);
