const fs = require('fs');
const path = require('path');

const PACKAGE_PATH = path.join(__dirname, '../../../package.json');
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

let cachedVersion = null;
/** Optional override from AppSetting.appVersion (set after DB sync). */
let dbVersionOverride = null;

function readPackageVersion() {
  const raw = fs.readFileSync(PACKAGE_PATH, 'utf8');
  const pkg = JSON.parse(raw);
  const version = String(pkg.version || '0.0.0').trim();
  if (!SEMVER_RE.test(version)) {
    throw new Error(`Invalid package.json version: ${version}`);
  }
  return version;
}

function normalizeSemver(value) {
  const v = String(value || '').trim();
  return SEMVER_RE.test(v) ? v : '';
}

function getAppVersion() {
  const fromDb = normalizeSemver(dbVersionOverride);
  if (fromDb) return fromDb;
  if (cachedVersion) return cachedVersion;
  try {
    cachedVersion = readPackageVersion();
  } catch {
    cachedVersion = '0.0.0';
  }
  return cachedVersion;
}

function getPackageVersion() {
  try {
    return readPackageVersion();
  } catch {
    return '0.0.0';
  }
}

function setDbVersionOverride(version) {
  dbVersionOverride = normalizeSemver(version) || null;
}

function getAppVersionMajor() {
  return getAppVersion().split('.')[0];
}

function toPersianDigits(value) {
  const map = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return String(value).replace(/\d/g, (d) => map[Number(d)]);
}

function getVersionViewModel(extra = {}) {
  const appVersion = normalizeSemver(extra.appVersion) || getAppVersion();
  const appVersionMajor = appVersion.split('.')[0];
  const previousAppVersion = normalizeSemver(extra.previousAppVersion) || '';
  return {
    appVersion,
    appVersionMajor,
    appVersionFa: toPersianDigits(appVersion),
    appVersionMajorFa: toPersianDigits(appVersionMajor),
    previousAppVersion: previousAppVersion || undefined,
    previousAppVersionFa: previousAppVersion ? toPersianDigits(previousAppVersion) : undefined,
    appVersionUpdatedAt: extra.appVersionUpdatedAt || undefined,
  };
}

/** Call after deploy/update if the process stays running without restart. */
function refreshAppVersion() {
  cachedVersion = null;
  return getAppVersion();
}

/**
 * Persist package.json version into AppSetting and prefer it for API responses.
 * Returns the synced version string.
 */
async function syncInstalledVersionToDb() {
  const AppSetting = require('../models/AppSetting');
  const pkgVersion = getPackageVersion();
  const existing = await AppSetting.findOne({ key: 'default' }).select('appVersion').lean();
  const prev = normalizeSemver(existing?.appVersion);
  const $set = {
    appVersion: pkgVersion,
    appVersionUpdatedAt: new Date(),
    updatedAt: new Date(),
  };
  if (prev && prev !== pkgVersion) {
    $set.previousAppVersion = prev;
  }
  await AppSetting.updateOne({ key: 'default' }, { $set }, { upsert: true });
  setDbVersionOverride(pkgVersion);
  refreshAppVersion();
  return pkgVersion;
}

const { jsAsset } = require('./AssetHelper');
const { safeJsonForHtml } = require('./ClientErrorHelper');

function versionMiddleware(req, res, next) {
  Object.assign(res.locals, getVersionViewModel(), { jsAsset, safeJsonForHtml });
  next();
}

module.exports = {
  getAppVersion,
  getPackageVersion,
  getAppVersionMajor,
  toPersianDigits,
  getVersionViewModel,
  refreshAppVersion,
  setDbVersionOverride,
  syncInstalledVersionToDb,
  versionMiddleware,
};
