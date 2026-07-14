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
  const srcPath = path.join(PUBLIC_JS_DIR, `${base}.js`);
  const minPath = path.join(PUBLIC_JS_DIR, `${base}.min.js`);
  let useMin = false;
  if (isProd && fs.existsSync(minPath)) {
    if (fs.existsSync(srcPath)) {
      // Prefer source when min bundle is stale (prevents broken onclick handlers after deploy)
      useMin = fs.statSync(minPath).mtimeMs >= fs.statSync(srcPath).mtimeMs;
    } else {
      useMin = true;
    }
  }
  return `/js/${useMin ? `${base}.min.js` : `${base}.js`}?v=${version}`;
}

module.exports = {
  jsAsset,
  getAssetVersion,
};
