const fs = require('fs');
const path = require('path');

const PACKAGE_PATH = path.join(__dirname, '../../package.json');
const PUBLIC_JS_DIR = path.join(__dirname, '../../public/js');

let cachedVersion = null;

function getAssetVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));
    cachedVersion = String(pkg.version || '0.0.0');
  } catch {
    cachedVersion = '0.0.0';
  }
  return cachedVersion;
}

function jsAsset(name) {
  const version = getAssetVersion();
  const base = String(name || '').replace(/\.js$/i, '');
  const isProd = process.env.NODE_ENV === 'production';
  const minName = `${base}.min.js`;
  const useMin = isProd && fs.existsSync(path.join(PUBLIC_JS_DIR, minName));
  return `/js/${useMin ? minName : `${base}.js`}?v=${version}`;
}

module.exports = {
  jsAsset,
  getAssetVersion,
};
