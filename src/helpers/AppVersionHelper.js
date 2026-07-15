const fs = require('fs');
const path = require('path');

const PACKAGE_PATH = path.join(__dirname, '../../package.json');

let cachedVersion = null;

function readPackageVersion() {
  const raw = fs.readFileSync(PACKAGE_PATH, 'utf8');
  const pkg = JSON.parse(raw);
  const version = String(pkg.version || '0.0.0').trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid package.json version: ${version}`);
  }
  return version;
}

function getAppVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    cachedVersion = readPackageVersion();
  } catch {
    cachedVersion = '0.0.0';
  }
  return cachedVersion;
}

function getAppVersionMajor() {
  return getAppVersion().split('.')[0];
}

function toPersianDigits(value) {
  const map = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return String(value).replace(/\d/g, (d) => map[Number(d)]);
}

function getVersionViewModel() {
  const appVersion = getAppVersion();
  const appVersionMajor = getAppVersionMajor();
  return {
    appVersion,
    appVersionMajor,
    appVersionFa: toPersianDigits(appVersion),
    appVersionMajorFa: toPersianDigits(appVersionMajor),
  };
}

/** Call after deploy/update if the process stays running without restart. */
function refreshAppVersion() {
  cachedVersion = null;
  return getAppVersion();
}

const { jsAsset } = require('./AssetHelper');
const { safeJsonForHtml } = require('./ClientErrorHelper');

function versionMiddleware(req, res, next) {
  Object.assign(res.locals, getVersionViewModel(), { jsAsset, safeJsonForHtml });
  next();
}

module.exports = {
  getAppVersion,
  getAppVersionMajor,
  toPersianDigits,
  getVersionViewModel,
  refreshAppVersion,
  versionMiddleware,
};
