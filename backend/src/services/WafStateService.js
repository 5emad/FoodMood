/**
 * WAF Runtime State Service
 *
 * مدیریت وضعیت فعال/غیرفعال WAF در runtime بدون نیاز به ریستارت سرور.
 * اولویت: مقدار DB (پنل سوپرادمین) ؛ env فقط وقتی سند تنظیمات هنوز نیست.
 */

let _wafEnabled = false;
let _synced = false;

function isWafRuntimeEnabled() {
  return _wafEnabled;
}

async function setWafRuntimeEnabled(enabled) {
  const AppSetting = require('../models/AppSetting');
  const val = Boolean(enabled);
  await AppSetting.updateOne(
    { key: 'default' },
    { $set: { wafEnabled: val, updatedAt: new Date() } },
    { upsert: true },
  );
  _wafEnabled = val;
  return val;
}

async function syncWafStateFromDb() {
  const envVal = String(process.env.WAF_ENABLED ?? '').trim().toLowerCase();
  const envForcesOff = ['false', '0', 'off', 'no'].includes(envVal)
    && String(process.env.WAF_LOCK_ENV || '').trim() === '1';

  if (envForcesOff) {
    _wafEnabled = false;
    _synced = true;
    console.warn('[WAF] قفل env: غیرفعال (WAF_LOCK_ENV=1)');
    return;
  }

  try {
    const AppSetting = require('../models/AppSetting');
    const settings = await AppSetting.findOne({ key: 'default' }).select('wafEnabled').lean();
    if (settings && typeof settings.wafEnabled === 'boolean') {
      _wafEnabled = settings.wafEnabled;
      _synced = true;
      return;
    }
  } catch (err) {
    console.warn('[WAF] خطا در خواندن وضعیت از DB:', err.message);
  }

  // بدون سند DB: از env یا پیش‌فرض خاموش
  if (['true', '1', 'on', 'yes'].includes(envVal)) {
    _wafEnabled = true;
  } else {
    _wafEnabled = false;
  }
  _synced = true;
}

function isWafStateSynced() {
  return _synced;
}

module.exports = {
  isWafRuntimeEnabled,
  setWafRuntimeEnabled,
  syncWafStateFromDb,
  isWafStateSynced,
};
