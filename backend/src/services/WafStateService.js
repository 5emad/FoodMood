/**
 * WAF Runtime State Service
 *
 * مدیریت وضعیت فعال/غیرفعال WAF در runtime بدون نیاز به ریستارت سرور.
 * مقدار از DB خوانده و در حافظه cache می‌شود تا در هر request کوئری نزنیم.
 */

let _wafEnabled = false; // پیش‌فرض: خاموش تا sync از DB/env انجام شود
let _synced = false;

/**
 * آیا WAF در runtime فعال است؟ (از cache حافظه)
 */
function isWafRuntimeEnabled() {
  return _wafEnabled;
}

/**
 * تغییر وضعیت WAF در runtime + ذخیره در DB
 * @param {boolean} enabled
 * @returns {Promise<boolean>} وضعیت جدید
 */
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

/**
 * هنگام بوت، وضعیت WAF را از DB بخوان و cache کن.
 * اگر env صراحتاً WAF_ENABLED=false باشد، اولویت با env است.
 */
async function syncWafStateFromDb() {
  // اگر env صراحتاً غیرفعال کرده، همان را رعایت کن
  const envVal = String(process.env.WAF_ENABLED ?? '').trim().toLowerCase();
  if (['false', '0', 'off', 'no'].includes(envVal)) {
    _wafEnabled = false;
    _synced = true;
    console.warn('[WAF] غیرفعال توسط WAF_ENABLED env');
    return;
  }
  if (['true', '1', 'on', 'yes'].includes(envVal)) {
    _wafEnabled = true;
    _synced = true;
    console.warn('[WAF] فعال توسط WAF_ENABLED env');
    return;
  }

  try {
    const AppSetting = require('../models/AppSetting');
    const settings = await AppSetting.findOne({ key: 'default' }).select('wafEnabled').lean();
    if (settings && typeof settings.wafEnabled === 'boolean') {
      _wafEnabled = settings.wafEnabled;
    } else {
      // پیش‌فرض امن برای پنل: خاموش تا سوپرادمین عمداً روشن کند
      _wafEnabled = false;
    }
  } catch (err) {
    console.warn('[WAF] خطا در خواندن وضعیت از DB — پیش‌فرض خاموش:', err.message);
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
