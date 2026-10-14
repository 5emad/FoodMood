const crypto = require('crypto');
const { isEnabledFlag } = require('./SettingFlags');
const {
  TEMPLATES,
  TEMPLATE_CATEGORIES,
  COLOR_PRESETS,
  normalizeAppearance,
} = require('../views/PaymentPageView');

const GATEWAY_PROVIDERS = {
  zarinpal: 'زرین‌پال',
  zibal: 'زیبال',
};

const METHOD_LABELS = {
  card: 'کارت به کارت',
  bale: 'پرداخت با بله',
  gateway: 'درگاه بانکی',
};

function text(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function digitsOnly(value) {
  const map = {
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  };
  return String(value ?? '').replace(/[۰-۹٠-٩]/g, (d) => map[d] || d).replace(/\D/g, '');
}

/** تنظیمات کامل (همراه اسرار) — فقط سمت سرور */
function readPaymentConfig(settings = {}) {
  const raw = settings.payment && typeof settings.payment === 'object' ? settings.payment : {};
  const scopes = raw.scopes || {};
  const card = raw.card || {};
  const bale = raw.bale || {};
  const gateway = raw.gateway || {};
  const provider = GATEWAY_PROVIDERS[gateway.provider] ? gateway.provider : 'zarinpal';

  return {
    enabled: isEnabledFlag(raw.enabled, false),
    scopes: {
      cart: isEnabledFlag(scopes.cart, true),
      week: isEnabledFlag(scopes.week, true),
      month: isEnabledFlag(scopes.month, false),
    },
    card: {
      enabled: isEnabledFlag(card.enabled, false),
      cardNumber: digitsOnly(card.cardNumber).slice(0, 16),
      cardHolder: text(card.cardHolder, 80),
      bankName: text(card.bankName, 60),
      sheba: text(card.sheba, 34).toUpperCase(),
      note: text(card.note, 300),
    },
    bale: {
      enabled: isEnabledFlag(bale.enabled, false),
      /** شبیه‌ساز داخلی بله — بدون ربات، توکن، HTTPS و وب‌هوک (برای لوکال) */
      sandbox: isEnabledFlag(bale.sandbox, false),
      botToken: text(bale.botToken, 200),
      providerToken: text(bale.providerToken, 200),
      webhookSecret: text(bale.webhookSecret, 80),
      webhookRegisteredAt: bale.webhookRegisteredAt || null,
    },
    gateway: {
      enabled: isEnabledFlag(gateway.enabled, false),
      provider,
      sandbox: isEnabledFlag(gateway.sandbox, false),
      merchantId: text(gateway.merchantId, 120),
    },
    appearance: normalizeAppearance(raw.appearance),
  };
}

/**
 * با فعال بودن پرداخت، سفارش «در انتظار» یعنی «پرداخت‌نشده» و پس از پرداخت خودکار تایید می‌شود؛
 * پس صورتحساب و گزارش مالی باید سفارش‌های در انتظار را هم ببینند.
 */
function isPaymentEnabled(settings = {}) {
  return readPaymentConfig(settings).enabled;
}

/**
 * «تایید خودکار» فقط وقتی است که پرداخت سبد خرید (بلافاصله بعد از رزرو) فعال باشد.
 * با پرداخت فقط هفتگی/ماهیانه، روال قبلی می‌ماند: مدیر تایید می‌کند و صورتحساب از سفارش‌های تاییدشده است.
 */
function isAutoConfirmMode(settings = {}) {
  const config = readPaymentConfig(settings);
  return config.enabled && config.scopes.cart;
}

function billableStatuses(settings = {}) {
  return isAutoConfirmMode(settings) ? ['pending', 'confirmed'] : ['confirmed'];
}

function methodReady(config, method) {
  if (method === 'card') return config.card.enabled && config.card.cardNumber.length === 16;
  if (method === 'bale') {
    return config.bale.enabled && (config.bale.sandbox || (!!config.bale.botToken && !!config.bale.providerToken));
  }
  if (method === 'gateway') {
    return config.gateway.enabled && (config.gateway.sandbox || !!config.gateway.merchantId);
  }
  return false;
}

function availableMethods(config) {
  return ['card', 'bale', 'gateway'].filter((method) => methodReady(config, method));
}

/** پرداخت فقط وقتی «روشن» است که حداقل یک روش آماده و یک محل پرداخت فعال باشد */
function isPaymentActive(config) {
  if (!config.enabled) return false;
  if (!availableMethods(config).length) return false;
  return Object.values(config.scopes).some(Boolean);
}

/** شکل امن برای پرتال کاربران */
function userPaymentConfig(settings = {}) {
  const config = readPaymentConfig(settings);
  const active = isPaymentActive(config);
  const methods = active ? availableMethods(config) : [];
  return {
    enabled: active,
    scopes: active ? { ...config.scopes } : { cart: false, week: false, month: false },
    methods: methods.map((method) => ({
      key: method,
      label: method === 'gateway'
        ? `${METHOD_LABELS.gateway} (${GATEWAY_PROVIDERS[config.gateway.provider]})${config.gateway.sandbox ? ' — آزمایشی' : ''}`
        : method === 'bale' && config.bale.sandbox
          ? `${METHOD_LABELS.bale} — آزمایشی`
          : METHOD_LABELS[method],
    })),
    card: methods.includes('card')
      ? {
        cardNumber: config.card.cardNumber,
        cardHolder: config.card.cardHolder,
        bankName: config.card.bankName,
        sheba: config.card.sheba,
        note: config.card.note,
      }
      : null,
  };
}

/** شکل پنل مدیریت — اسرار فقط به‌صورت «ثبت شده/نشده» */
function adminPaymentConfig(settings = {}) {
  const config = readPaymentConfig(settings);
  return {
    enabled: config.enabled,
    active: isPaymentActive(config),
    scopes: config.scopes,
    card: config.card,
    bale: {
      enabled: config.bale.enabled,
      sandbox: config.bale.sandbox,
      hasBotToken: !!config.bale.botToken,
      hasProviderToken: !!config.bale.providerToken,
      webhookRegisteredAt: config.bale.webhookRegisteredAt,
    },
    gateway: {
      enabled: config.gateway.enabled,
      provider: config.gateway.provider,
      sandbox: config.gateway.sandbox,
      hasMerchantId: !!config.gateway.merchantId,
      merchantIdHint: config.gateway.merchantId ? `…${config.gateway.merchantId.slice(-4)}` : '',
    },
    providers: Object.entries(GATEWAY_PROVIDERS).map(([key, label]) => ({ key, label })),
    appearance: config.appearance,
    appearanceCatalog: { templates: TEMPLATES, categories: TEMPLATE_CATEGORIES, colors: COLOR_PRESETS },
    readyMethods: availableMethods(config),
  };
}

/**
 * ادغام ورودی فرم مدیر با تنظیمات فعلی.
 * فیلدهای محرمانه خالی = بدون تغییر؛ clearX = true برای حذف.
 */
function mergePaymentConfig(settings = {}, body = {}) {
  const current = readPaymentConfig(settings);
  const next = JSON.parse(JSON.stringify(current));
  const flag = (value, fallback) => (value === undefined ? fallback : isEnabledFlag(value, fallback));

  next.enabled = flag(body.enabled, current.enabled);
  const scopes = body.scopes || {};
  next.scopes = {
    cart: flag(scopes.cart, current.scopes.cart),
    week: flag(scopes.week, current.scopes.week),
    month: flag(scopes.month, current.scopes.month),
  };

  const card = body.card || {};
  next.card.enabled = flag(card.enabled, current.card.enabled);
  if (card.cardNumber !== undefined) {
    const cardNumber = digitsOnly(card.cardNumber);
    if (cardNumber && cardNumber.length !== 16) {
      const err = new Error('شماره کارت باید ۱۶ رقم باشد');
      err.status = 400;
      throw err;
    }
    next.card.cardNumber = cardNumber;
  }
  if (card.cardHolder !== undefined) next.card.cardHolder = text(card.cardHolder, 80);
  if (card.bankName !== undefined) next.card.bankName = text(card.bankName, 60);
  if (card.sheba !== undefined) next.card.sheba = text(card.sheba, 34).toUpperCase().replace(/\s/g, '');
  if (card.note !== undefined) next.card.note = text(card.note, 300);

  const bale = body.bale || {};
  next.bale.enabled = flag(bale.enabled, current.bale.enabled);
  next.bale.sandbox = flag(bale.sandbox, current.bale.sandbox);
  if (text(bale.botToken)) next.bale.botToken = text(bale.botToken, 200);
  if (text(bale.providerToken)) next.bale.providerToken = text(bale.providerToken, 200);
  if (bale.clearBotToken) next.bale.botToken = '';
  if (bale.clearProviderToken) next.bale.providerToken = '';
  if (next.bale.botToken !== current.bale.botToken) next.bale.webhookRegisteredAt = null;
  if (!next.bale.webhookSecret) next.bale.webhookSecret = crypto.randomBytes(24).toString('hex');

  const gateway = body.gateway || {};
  next.gateway.enabled = flag(gateway.enabled, current.gateway.enabled);
  if (gateway.provider !== undefined && GATEWAY_PROVIDERS[gateway.provider]) {
    if (gateway.provider !== current.gateway.provider && !text(gateway.merchantId)) {
      next.gateway.merchantId = '';
    }
    next.gateway.provider = gateway.provider;
  }
  next.gateway.sandbox = flag(gateway.sandbox, current.gateway.sandbox);
  if (text(gateway.merchantId)) next.gateway.merchantId = text(gateway.merchantId, 120);
  if (gateway.clearMerchantId) next.gateway.merchantId = '';

  if (body.appearance && typeof body.appearance === 'object') {
    next.appearance = normalizeAppearance({ ...current.appearance, ...body.appearance });
  }

  return next;
}

module.exports = {
  GATEWAY_PROVIDERS,
  METHOD_LABELS,
  readPaymentConfig,
  isPaymentEnabled,
  isAutoConfirmMode,
  billableStatuses,
  methodReady,
  availableMethods,
  isPaymentActive,
  userPaymentConfig,
  adminPaymentConfig,
  mergePaymentConfig,
};
