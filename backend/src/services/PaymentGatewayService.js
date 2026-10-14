/**
 * اتصال به درگاه‌های بانکی و پیام‌رسان بله.
 * مبالغ داخل سامانه تومان است و برای درگاه‌ها به ریال (×۱۰) تبدیل می‌شود.
 */

const REQUEST_TIMEOUT_MS = 15000;

function toRial(toman) {
  return Math.round(Number(toman || 0)) * 10;
}

async function postJson(url, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { _raw: text, _status: res.status };
    }
  } catch (error) {
    const err = new Error(error.name === 'AbortError'
      ? 'پاسخ درگاه پرداخت به موقع دریافت نشد'
      : 'اتصال به درگاه پرداخت برقرار نشد');
    err.status = 502;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function gatewayError(message) {
  const err = new Error(message);
  err.status = 502;
  return err;
}

// ── زرین‌پال (REST v4) ────────────────────────────────────────────────────────
const ZARINPAL_SANDBOX_MERCHANT = '00000000-0000-0000-0000-000000000000';

function zarinpalBase(sandbox) {
  return sandbox ? 'https://sandbox.zarinpal.com' : 'https://payment.zarinpal.com';
}

const zarinpal = {
  async request({ merchantId, sandbox, amount, callbackUrl, description, mobile }) {
    const data = await postJson(`${zarinpalBase(sandbox)}/pg/v4/payment/request.json`, {
      merchant_id: sandbox ? (merchantId || ZARINPAL_SANDBOX_MERCHANT) : merchantId,
      amount: toRial(amount),
      currency: 'IRR',
      callback_url: callbackUrl,
      description,
      ...(mobile ? { metadata: { mobile } } : {}),
    });
    const code = Number(data?.data?.code);
    const authority = data?.data?.authority;
    if (code !== 100 || !authority) {
      const msg = data?.errors?.message || `کد ${data?.errors?.code ?? code}`;
      throw gatewayError(`درگاه زرین‌پال درخواست را نپذیرفت (${msg})`);
    }
    return {
      ref: String(authority),
      redirectUrl: `${zarinpalBase(sandbox)}/pg/StartPay/${encodeURIComponent(authority)}`,
    };
  },

  /** پارامترهای بازگشت: Authority, Status=OK|NOK */
  readCallback(query = {}) {
    return {
      ref: String(query.Authority || query.authority || ''),
      ok: String(query.Status || query.status || '').toUpperCase() === 'OK',
    };
  },

  async verify({ merchantId, sandbox, amount, ref }) {
    const data = await postJson(`${zarinpalBase(sandbox)}/pg/v4/payment/verify.json`, {
      merchant_id: sandbox ? (merchantId || ZARINPAL_SANDBOX_MERCHANT) : merchantId,
      amount: toRial(amount),
      authority: ref,
    });
    const code = Number(data?.data?.code);
    if (code === 100 || code === 101) {
      return {
        ok: true,
        referenceId: String(data.data.ref_id || ''),
        cardPan: String(data.data.card_pan || ''),
      };
    }
    return { ok: false, reason: `تایید زرین‌پال ناموفق بود (کد ${data?.errors?.code ?? code})` };
  },
};

// ── زیبال ────────────────────────────────────────────────────────────────────
const zibal = {
  async request({ merchantId, sandbox, amount, callbackUrl, description, orderId, mobile }) {
    const data = await postJson('https://gateway.zibal.ir/v1/request', {
      merchant: sandbox ? 'zibal' : merchantId,
      amount: toRial(amount),
      callbackUrl,
      description,
      orderId,
      ...(mobile ? { mobile } : {}),
    });
    if (Number(data?.result) !== 100 || !data?.trackId) {
      throw gatewayError(`درگاه زیبال درخواست را نپذیرفت (${data?.message || `کد ${data?.result}`})`);
    }
    return {
      ref: String(data.trackId),
      redirectUrl: `https://gateway.zibal.ir/start/${encodeURIComponent(data.trackId)}`,
    };
  },

  /** پارامترهای بازگشت: success=1|0, trackId, status, orderId */
  readCallback(query = {}) {
    return {
      ref: String(query.trackId || ''),
      ok: String(query.success || '') === '1',
    };
  },

  async verify({ merchantId, sandbox, amount, ref }) {
    const data = await postJson('https://gateway.zibal.ir/v1/verify', {
      merchant: sandbox ? 'zibal' : merchantId,
      trackId: Number(ref),
    });
    const result = Number(data?.result);
    if ((result === 100 || result === 201) && (!data.amount || Number(data.amount) === toRial(amount))) {
      return {
        ok: true,
        referenceId: String(data.refNumber || ''),
        cardPan: String(data.cardNumber || ''),
      };
    }
    return { ok: false, reason: `تایید زیبال ناموفق بود (${data?.message || `کد ${result}`})` };
  },
};

const GATEWAYS = { zarinpal, zibal };

function getGateway(provider) {
  const gateway = GATEWAYS[provider];
  if (!gateway) throw gatewayError('درگاه پرداخت پشتیبانی نمی‌شود');
  return gateway;
}

// ── بله (Bot API — createInvoiceLink + webhook) ─────────────────────────────
async function baleCall(botToken, method, body) {
  const data = await postJson(`https://tapi.bale.ai/bot${botToken}/${method}`, body);
  if (!data?.ok) {
    throw gatewayError(`خطای بله در ${method}: ${data?.description || data?.error_code || 'پاسخ نامعتبر'}`);
  }
  return data.result;
}

const bale = {
  async createInvoiceLink({ botToken, providerToken, amount, title, description, payload }) {
    const link = await baleCall(botToken, 'createInvoiceLink', {
      title: String(title).slice(0, 32),
      description: String(description).slice(0, 255),
      payload: String(payload).slice(0, 128),
      provider_token: providerToken,
      prices: [{ label: String(title).slice(0, 32), amount: toRial(amount) }],
    });
    if (!link || typeof link !== 'string') throw gatewayError('بله لینک پرداخت برنگرداند');
    return link;
  },

  answerPreCheckout(botToken, queryId, ok, errorMessage) {
    return baleCall(botToken, 'answerPreCheckoutQuery', {
      pre_checkout_query_id: queryId,
      ok,
      ...(ok ? {} : { error_message: errorMessage || 'پرداخت معتبر نیست' }),
    });
  },

  setWebhook(botToken, url) {
    return baleCall(botToken, 'setWebhook', { url });
  },

  sendMessage(botToken, chatId, text) {
    return baleCall(botToken, 'sendMessage', { chat_id: chatId, text });
  },
};

module.exports = {
  toRial,
  getGateway,
  bale,
};
