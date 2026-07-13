/**
 * Copies frontend vendor assets from node_modules into public/vendor.
 * Run after npm install: npm run vendor:sync
 */
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const pairs = [
  ['node_modules/sweetalert2/dist/sweetalert2.min.js', 'public/vendor/sweetalert2/sweetalert2.min.js'],
  ['node_modules/sweetalert2/dist/sweetalert2.min.css', 'public/vendor/sweetalert2/sweetalert2.min.css'],
  ['node_modules/@fortawesome/fontawesome-free/css/all.min.css', 'public/vendor/fontawesome/css/all.min.css'],
  ['node_modules/@majidh1/jalalidatepicker/dist/jalalidatepicker.min.js', 'public/vendor/jalalidatepicker/jalalidatepicker.min.js'],
  ['node_modules/@majidh1/jalalidatepicker/dist/jalalidatepicker.min.css', 'public/vendor/jalalidatepicker/jalalidatepicker.min.css'],
];

function copyDir(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of fs.readdirSync(srcDir)) {
    fs.copyFileSync(path.join(srcDir, name), path.join(destDir, name));
  }
}

fs.mkdirSync(path.join(root, 'public/vendor/vazirmatn'), { recursive: true });
fs.mkdirSync(path.join(root, 'public/vendor/sweetalert2'), { recursive: true });
fs.mkdirSync(path.join(root, 'public/vendor/fontawesome/css'), { recursive: true });
fs.mkdirSync(path.join(root, 'public/vendor/fontawesome/webfonts'), { recursive: true });
fs.mkdirSync(path.join(root, 'public/vendor/jalalidatepicker'), { recursive: true });

for (const [src, dest] of pairs) {
  fs.copyFileSync(path.join(root, src), path.join(root, dest));
}

copyDir(
  path.join(root, 'node_modules/@fortawesome/fontawesome-free/webfonts'),
  path.join(root, 'public/vendor/fontawesome/webfonts')
);

const vazDir = path.join(root, 'node_modules/vazirmatn/fonts/webfonts');
for (const name of fs.readdirSync(vazDir)) {
  if (name.endsWith('.woff2')) {
    fs.copyFileSync(path.join(vazDir, name), path.join(root, 'public/vendor/vazirmatn', name));
  }
}

console.log('Vendor assets synced to public/vendor/');
