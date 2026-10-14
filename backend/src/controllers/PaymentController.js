const fs = require('fs');
const { getSettingsLean, updateAppSettings } = require('../services/SettingsService');
const {
  userPaymentConfig,
  adminPaymentConfig,
  mergePaymentConfig,
  readPaymentConfig,
} = require('../helpers/PaymentConfigHelper');
const { renderPaymentPage, normalizeAppearance, previewPayment } = require('../views/PaymentPageView');
const PaymentService = require('../services/PaymentService');
const Payment = require('../models/Payment');

function sendError(res, next, error) {
  if (Number(error.status) > 0 && Number(error.status) < 500) {
    return res.status(error.status).json({ success: false, message: error.message });
  }
  if (Number(error.status) === 502) {
    return res.status(502).json({ success: false, message: error.message });
  }
  return next(error);
}

function parseCheckoutBody(body = {}) {
  let orderIds = body.orderIds;
  if (typeof orderIds === 'string') {
    try { orderIds = JSON.parse(orderIds); } catch { orderIds = []; }
  }
  return {
    scope: ['cart', 'week', 'month'].includes(body.scope) ? body.scope : '',
    periodKey: String(body.periodKey || '').trim().slice(0, 40),
    orderIds: Array.isArray(orderIds)
      ? orderIds.map(String).filter((id) => /^[a-f0-9]{24}$/i.test(id)).slice(0, 200)
      : [],
    method: String(body.method || ''),
    trackingCode: body.trackingCode,
    note: body.note,
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sendReceiptImage(res, payment) {
  const file = PaymentService.receiptPath(payment);
  if (!file) return res.status(404).json({ success: false, message: 'تصویر رسید یافت نشد' });
  res.setHeader('Cache-Control', 'private, no-store');
  return res.sendFile(file);
}

const SENSITIVE_PAYMENT_FIELDS = [
  ['card', 'cardNumber', 'شماره کارت'],
  ['card', 'cardHolder', 'نام صاحب کارت'],
  ['card', 'sheba', 'شبا'],
  ['bale', 'botToken', 'توکن ربات بله'],
  ['bale', 'providerToken', 'توکن پرداخت بله'],
  ['bale', 'sandbox', 'حالت آزمایشی بله'],
  ['gateway', 'provider', 'نوع درگاه'],
  ['gateway', 'merchantId', 'کد پذیرنده'],
  ['gateway', 'sandbox', 'حالت آزمایشی درگاه'],
];

function sensitivePaymentChanges(before, after) {
  return SENSITIVE_PAYMENT_FIELDS
    .filter(([section, key]) => String(before?.[section]?.[key] ?? '') !== String(after?.[section]?.[key] ?? ''))
    .map(([, , label]) => label);
}

function adminConfigFor(req, settings) {
  return {
    ...adminPaymentConfig(settings),
    canEditSensitive: String(req.user?.role || '').toLowerCase() === 'superadmin',
  };
}

function returnUrl(payment, ok) {
  return `/user/dashboard?payment=${encodeURIComponent(payment?._id || '')}&result=${ok ? 'ok' : 'fail'}`;
}

function sendPage(res, settings, view) {
  res.setHeader('Cache-Control', 'no-store');
  return res.type('html').send(renderPaymentPage({
    orgName: settings?.organizationName || 'سامانه تغذیه',
    appearance: readPaymentConfig(settings || {}).appearance,
    ...view,
  }));
}

function notFoundView() {
  return {
    state: 'failed',
    payment: { amount: 0 },
    message: 'این صفحه پرداخت معتبر نیست یا منقضی شده است.',
    actions: [{ kind: 'link', href: '/user/dashboard', label: 'بازگشت به سامانه' }],
  };
}

function resultView(payment, view) {
  if (payment.status === 'initiated') {
    return {
      state: 'waiting',
      payment: view,
      sandbox: !!payment.sandbox,
      actions: [{ kind: 'link', href: '/user/dashboard', label: 'بازگشت به سامانه', style: 'ghost' }],
      pollUrl: `/payment/status?pid=${payment._id}&t=${encodeURIComponent(payment.viewToken)}`,
    };
  }
  const ok = payment.status === 'paid' || payment.status === 'review';
  const target = returnUrl(payment, ok);
  return {
    state: payment.status === 'paid' ? 'paid' : payment.status === 'review' ? 'waiting' : 'failed',
    payment: view,
    message: payment.failureReason || payment.reviewNote || '',
    sandbox: !!payment.sandbox,
    actions: [{ kind: 'link', href: target, label: 'بازگشت به سامانه' }],
    redirectUrl: payment.status === 'review' ? '' : target,
    redirectSeconds: payment.status === 'review' ? 0 : 8,
  };
}

class PaymentController {
  // ── کاربر ────────────────────────────────────────────────────────────────
  static async getConfig(req, res, next) {
    try {
      const settings = await getSettingsLean();
      return res.json({ success: true, data: userPaymentConfig(settings) });
    } catch (error) {
      return next(error);
    }
  }

  static async getCart(req, res, next) {
    try {
      const data = await PaymentService.quote(req.user, { scope: 'cart' });
      return res.json({ success: true, data });
    } catch (error) {
      return sendError(res, next, error);
    }
  }

  static async getQuote(req, res, next) {
    try {
      const params = parseCheckoutBody(req.query);
      if (params.scope !== 'week' && params.scope !== 'month') {
        return res.status(400).json({ success: false, message: 'نوع صورتحساب نامعتبر است' });
      }
      const data = await PaymentService.quote(req.user, params);
      return res.json({ success: true, data });
    } catch (error) {
      return sendError(res, next, error);
    }
  }

  static async listMine(req, res, next) {
    try {
      const result = await PaymentService.listUserPayments(req.user, req.query);
      return res.json({ success: true, ...result });
    } catch (error) {
      return next(error);
    }
  }

  static async getMine(req, res, next) {
    try {
      const payment = await PaymentService.getUserPayment(req.user, req.params.id);
      return res.json({ success: true, data: PaymentService.serializePayment(payment) });
    } catch (error) {
      return sendError(res, next, error);
    }
  }

  static async getMyReceipt(req, res, next) {
    try {
      const payment = await PaymentService.getUserPayment(req.user, req.params.id);
      return sendReceiptImage(res, payment);
    } catch (error) {
      return sendError(res, next, error);
    }
  }

  static async payByCard(req, res, next) {
    try {
      const params = parseCheckoutBody(req.body);
      if (!params.scope) throw Object.assign(new Error('نوع پرداخت نامعتبر است'), { status: 400 });
      const payment = await PaymentService.submitCardPayment(req.user, params, req.file);
      return res.json({
        success: true,
        message: 'رسید پرداخت ثبت شد و پس از تایید مدیر، صورتحساب پرداخت‌شده صادر می‌شود',
        data: PaymentService.serializePayment(payment),
      });
    } catch (error) {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
      return sendError(res, next, error);
    }
  }

  static async payOnline(req, res, next) {
    try {
      const params = parseCheckoutBody(req.body);
      if (!params.scope) throw Object.assign(new Error('نوع پرداخت نامعتبر است'), { status: 400 });
      if (params.method !== 'bale' && params.method !== 'gateway') {
        throw Object.assign(new Error('روش پرداخت نامعتبر است'), { status: 400 });
      }
      const { payment, redirectUrl } = await PaymentService.startOnlinePayment(req, params);
      return res.json({
        success: true,
        data: { payment: PaymentService.serializePayment(payment), redirectUrl },
      });
    } catch (error) {
      return sendError(res, next, error);
    }
  }

  // ── بازگشت درگاه و وب‌هوک بله (عمومی) ───────────────────────────────────
  // ── صفحه‌های پرداخت با قالب انتخابی (بدون نشست) ─────────────────────────
  static async gatewayCallback(req, res) {
    let result;
    try {
      result = await PaymentService.handleGatewayCallback(String(req.params.provider || ''), req.query);
    } catch (error) {
      result = { ok: false, message: error.message || 'خطا در تایید پرداخت' };
    }
    const payment = result.payment;
    const settings = await getSettingsLean().catch(() => ({}));
    const target = returnUrl(payment, result.ok);
    // صفحهٔ واسط: بازگشت بین‌سایتی کوکی SameSite=Strict را نمی‌فرستد؛ ناوبری از همین صفحه هم‌سایت است.
    return sendPage(res, settings, {
      state: result.ok ? 'paid' : 'failed',
      payment: payment ? PaymentService.serializePayment(payment) : { amount: 0 },
      message: result.ok ? '' : result.message,
      sandbox: !!payment?.sandbox,
      actions: [{ kind: 'link', href: target, label: 'بازگشت به سامانه' }],
      redirectUrl: target,
      redirectSeconds: 8,
    });
  }

  /** پیش‌فاکتور بله (مثل مینی‌اپ): دکمه پرداخت در بله، یا دکمه‌های شبیه‌ساز در حالت آزمایشی */
  static async checkoutPage(req, res) {
    const settings = await getSettingsLean().catch(() => ({}));
    const payment = await PaymentService.loadPaymentForView(req.query.pid, req.query.t).catch(() => null);
    if (!payment) return sendPage(res.status(404), settings, notFoundView());

    const view = PaymentService.serializePayment(payment);
    if (payment.status !== 'initiated') return sendPage(res, settings, resultView(payment, view));

    const appearance = readPaymentConfig(settings).appearance;
    const fields = { pid: String(payment._id), t: payment.viewToken };
    const back = { kind: 'link', href: '/user/dashboard', label: 'بازگشت به سامانه', style: 'ghost' };
    if (payment.sandbox) {
      return sendPage(res, settings, {
        state: 'checkout',
        payment: view,
        sandbox: true,
        actions: [
          { kind: 'form', href: '/payment/checkout/simulate', fields: { ...fields, outcome: 'paid' }, label: appearance.checkoutTitle, hint: 'پرداخت آزمایشی موفق' },
          { kind: 'form', href: '/payment/checkout/simulate', fields: { ...fields, outcome: 'cancel' }, label: 'انصراف از پرداخت', style: 'danger' },
          back,
        ],
      });
    }
    return sendPage(res, settings, {
      state: 'checkout',
      payment: view,
      actions: [
        { kind: 'link', href: payment.invoiceLink, label: appearance.checkoutTitle, hint: appearance.checkoutDescription },
        back,
      ],
      pollUrl: `/payment/status?pid=${payment._id}&t=${encodeURIComponent(payment.viewToken)}`,
    });
  }

  static async simulate(req, res) {
    const body = req.body || {};
    const pid = String(body.pid || '');
    const token = String(body.t || '');
    try {
      await PaymentService.simulateBalePayment(pid, token, body.outcome === 'paid' ? 'paid' : 'cancel');
    } catch (error) {
      const settings = await getSettingsLean().catch(() => ({}));
      return sendPage(res.status(error.status || 400), settings, {
        state: 'failed', payment: { amount: 0 }, message: error.message,
        actions: [{ kind: 'link', href: '/user/dashboard', label: 'بازگشت به سامانه' }],
      });
    }
    return res.redirect(303, `/payment/result?pid=${encodeURIComponent(pid)}&t=${encodeURIComponent(token)}`);
  }

  static async resultPage(req, res) {
    const settings = await getSettingsLean().catch(() => ({}));
    const payment = await PaymentService.loadPaymentForView(req.query.pid, req.query.t).catch(() => null);
    if (!payment) return sendPage(res.status(404), settings, notFoundView());
    return sendPage(res, settings, resultView(payment, PaymentService.serializePayment(payment)));
  }

  static async statusJson(req, res) {
    const payment = await PaymentService.loadPaymentForView(req.query.pid, req.query.t).catch(() => null);
    res.setHeader('Cache-Control', 'no-store');
    if (!payment) return res.status(404).json({ status: 'unknown' });
    return res.json({ status: payment.status });
  }

  /** پیش‌نمایش زنده قالب در پنل مدیر (تنظیمات ذخیره‌نشده) */
  static async previewAppearance(req, res, next) {
    try {
      const settings = await getSettingsLean();
      const body = req.body || {};
      const state = ['checkout', 'paid', 'failed'].includes(body.state) ? body.state : 'paid';
      const appearance = normalizeAppearance({ ...readPaymentConfig(settings).appearance, ...(body.appearance || {}) });
      const html = renderPaymentPage({
        state,
        appearance,
        orgName: settings.organizationName || 'سامانه تغذیه',
        payment: previewPayment(),
        sandbox: !!body.sandbox,
        actions: state === 'checkout'
          ? [
            { kind: 'link', href: '#', label: appearance.checkoutTitle, hint: appearance.checkoutDescription },
            { kind: 'link', href: '#', label: 'بازگشت به سامانه', style: 'ghost' },
          ]
          : [{ kind: 'link', href: '#', label: 'بازگشت به سامانه' }],
      });
      return res.json({ success: true, data: { html } });
    } catch (error) {
      return next(error);
    }
  }

  static async baleWebhook(req, res) {
    try {
      const result = await PaymentService.handleBaleUpdate(String(req.params.secret || ''), req.body || {});
      if (!result.accepted) return res.status(404).json({ ok: false });
      return res.json({ ok: true });
    } catch (error) {
      console.error('[payment] bale webhook error:', error.message);
      return res.status(200).json({ ok: true });
    }
  }

  // ── مدیر ─────────────────────────────────────────────────────────────────
  static async adminList(req, res, next) {
    try {
      const result = await PaymentService.listAdminPayments(req.query);
      return res.json({ success: true, ...result });
    } catch (error) {
      return next(error);
    }
  }

  static async adminReceipt(req, res, next) {
    try {
      if (!/^[a-f0-9]{24}$/i.test(String(req.params.id))) return res.status(404).end();
      const payment = await Payment.findById(req.params.id).lean();
      if (!payment) return res.status(404).json({ success: false, message: 'پرداخت یافت نشد' });
      return sendReceiptImage(res, payment);
    } catch (error) {
      return next(error);
    }
  }

  static async adminApprove(req, res, next) {
    try {
      const payment = await PaymentService.reviewPayment(req.params.id, req.user, true, req.body?.note);
      return res.json({
        success: true,
        message: 'پرداخت تایید شد و صورتحساب پرداخت‌شده صادر شد',
        data: PaymentService.serializePayment(payment, { admin: true }),
      });
    } catch (error) {
      return sendError(res, next, error);
    }
  }

  static async adminReject(req, res, next) {
    try {
      const payment = await PaymentService.reviewPayment(req.params.id, req.user, false, req.body?.note);
      return res.json({
        success: true,
        message: 'پرداخت رد شد',
        data: PaymentService.serializePayment(payment, { admin: true }),
      });
    } catch (error) {
      return sendError(res, next, error);
    }
  }

  static async adminDelete(req, res, next) {
    try {
      const result = await PaymentService.deletePayments({ ids: [req.params.id] });
      if (!result.deletedCount) return res.status(404).json({ success: false, message: 'صورتحساب یافت نشد' });
      return res.json({ success: true, message: 'صورتحساب پرداخت و تصویر رسید آن حذف شد', ...result });
    } catch (error) {
      return sendError(res, next, error);
    }
  }

  static async adminBulkDelete(req, res, next) {
    try {
      const body = req.body || {};
      const filters = body.filters && typeof body.filters === 'object' && !Array.isArray(body.filters) ? body.filters : {};
      const result = await PaymentService.deletePayments({
        ids: Array.isArray(body.ids) ? body.ids.slice(0, 500) : [],
        all: body.all === true,
        query: filters,
      });
      return res.json({
        success: true,
        message: `${result.deletedCount.toLocaleString('fa-IR')} صورتحساب پرداخت حذف شد`,
        ...result,
      });
    } catch (error) {
      return sendError(res, next, error);
    }
  }

  static async getSettings(req, res, next) {
    try {
      const settings = await getSettingsLean();
      return res.json({ success: true, data: adminConfigFor(req, settings) });
    } catch (error) {
      return next(error);
    }
  }

  static async updateSettings(req, res, next) {
    try {
      const settings = await getSettingsLean();
      const payment = mergePaymentConfig(settings, req.body || {});
      // مقصد وجه و حالت آزمایشی (پرداخت بدون پول) فقط با سوپر ادمین قابل تغییر است
      const changed = sensitivePaymentChanges(readPaymentConfig(settings), payment);
      if (changed.length && String(req.user?.role || '').toLowerCase() !== 'superadmin') {
        return res.status(403).json({
          success: false,
          message: `تغییر این موارد فقط با سوپر ادمین ممکن است: ${changed.join('، ')}`,
        });
      }
      const saved = await updateAppSettings(payment.enabled ? { payment, showPricesToUsers: true } : { payment });
      return res.json({ success: true, message: 'تنظیمات پرداخت ذخیره شد', data: adminConfigFor(req, saved) });
    } catch (error) {
      return sendError(res, next, error);
    }
  }

  static async registerBaleWebhook(req, res, next) {
    try {
      await PaymentService.registerBaleWebhook(req);
      const settings = await getSettingsLean();
      const payment = { ...(settings.payment || {}) };
      payment.bale = { ...(payment.bale || {}), webhookRegisteredAt: new Date() };
      const saved = await updateAppSettings({ payment });
      return res.json({ success: true, message: 'وب‌هوک بله ثبت شد', data: adminConfigFor(req, saved) });
    } catch (error) {
      return sendError(res, next, error);
    }
  }
}

module.exports = PaymentController;
