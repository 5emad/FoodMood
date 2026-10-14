const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const { getSettingsLean } = require('./SettingsService');
const {
  readPaymentConfig,
  isPaymentActive,
  methodReady,
  billableStatuses,
} = require('../helpers/PaymentConfigHelper');
const { getGateway, bale } = require('./PaymentGatewayService');
const { buildOrderOwnerFilter, isLdapAuth } = require('../helpers/AuthUserHelper');
const { formatJalaliDate, daysInJalaliMonth, startOfDay } = require('../helpers/DateHelper');
const { resolvePublicUrl, buildAbsoluteUrl } = require('../helpers/AppUrlHelper');
const {
  clampPercent,
  splitAmount,
  financeUserKeyFromUser,
  summarizeUserOrdersInRange,
  buildUserStatement,
  orderFoodName,
  reportDateOfOrder,
} = require('./UserStatementService');

const RECEIPT_DIR = path.join(__dirname, '..', '..', 'storage', 'payment-receipts');
const LOCKING_STATUSES = ['paid', 'review'];
const MAX_CART_ITEMS = 200;

const STATUS_LABELS = {
  initiated: 'در انتظار پرداخت',
  review: 'در انتظار تایید مدیر',
  paid: 'پرداخت شده',
  rejected: 'رد شده',
  failed: 'ناموفق',
  cancelled: 'لغو شده',
};

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function formatPaymentNumber(paymentNumber) {
  return paymentNumber ? `PAY-${paymentNumber}` : '—';
}

function orderOwnerKey(order = {}) {
  if (order.ldapUsername) return `ldap:${order.ldapUsername}`;
  if (order.guestId) return `guest:${order.guestId?._id || order.guestId}`;
  return String(order.userId?._id || order.userId || '');
}

/** همهٔ کلیدهای مالکی که ممکن است سفارش‌های این کاربر زیر آن ثبت شده باشد */
function ownerKeysOfUser(user = {}) {
  const keys = new Set([financeUserKeyFromUser(user)]);
  if (user.username) keys.add(`ldap:${user.username}`);
  if (!isLdapAuth(user) && (user.id || user._id)) keys.add(String(user.id || user._id));
  return [...keys].filter(Boolean);
}

function payerFields(user = {}) {
  const ldap = isLdapAuth(user);
  return {
    userKey: financeUserKeyFromUser(user),
    userId: ldap ? null : (user.id || user._id || null),
    ldapUsername: ldap ? user.username : null,
    payerUsername: user.username || '',
    payerName: user.fullName || user.username || '',
    payerDepartment: typeof user.department === 'object' ? (user.department?.name || '') : (user.department || ''),
  };
}

async function loadPaymentConfig() {
  const settings = await getSettingsLean();
  return { settings, config: readPaymentConfig(settings) };
}

function assertPaymentActive(config, scope, method) {
  if (!isPaymentActive(config)) throw httpError('پرداخت در حال حاضر فعال نیست', 403);
  if (scope && !config.scopes[scope]) throw httpError('پرداخت برای این بخش فعال نیست', 403);
  if (method && !methodReady(config, method)) throw httpError('این روش پرداخت فعال نیست', 403);
}

/** مجموع پرداخت‌شده/در انتظار تایید به ازای هر سفارش */
async function coverageByOrder(orderIds = []) {
  const ids = orderIds.filter(Boolean);
  const map = new Map();
  if (!ids.length) return map;
  const rows = await Payment.aggregate([
    { $match: { status: { $in: LOCKING_STATUSES }, 'items.orderId': { $in: ids } } },
    { $unwind: '$items' },
    { $match: { 'items.orderId': { $in: ids } } },
    { $group: { _id: { orderId: '$items.orderId', status: '$status' }, amount: { $sum: '$items.amount' } } },
  ]);
  for (const row of rows) {
    const key = String(row._id.orderId);
    const current = map.get(key) || { paid: 0, review: 0 };
    if (row._id.status === 'paid') current.paid += row.amount;
    else current.review += row.amount;
    map.set(key, current);
  }
  return map;
}

/** همان روزبندی صورتحساب‌ها (UserStatementService.summarizeUserOrdersInRange) */
function dayBounds(rangeStart, rangeEnd) {
  return { start: startOfDay(rangeStart), end: startOfDay(rangeEnd) };
}

function paymentStatusOf(due, paid, review) {
  if (due <= 0) return paid > 0 || review > 0 ? 'paid' : 'none';
  if (paid >= due) return 'paid';
  if (paid + review >= due) return 'review';
  if (paid > 0 || review > 0) return 'partial';
  return 'unpaid';
}

/** تقسیم مبلغ بین سفارش‌ها به نسبت مانده هر سفارش (جمع دقیقاً برابر amount) */
function allocate(amount, rows) {
  const open = rows.filter((row) => row.open > 0);
  const totalOpen = open.reduce((sum, row) => sum + row.open, 0);
  if (!open.length || totalOpen <= 0 || amount <= 0) return [];
  let left = amount;
  return open.map((row, index) => {
    const share = index === open.length - 1
      ? left
      : Math.min(left, Math.round(amount * row.open / totalOpen));
    left -= share;
    return { ...row.item, amount: share };
  }).filter((item) => item.amount > 0);
}

function itemFromOrder(order) {
  const reportDate = reportDateOfOrder(order);
  return {
    orderId: order._id,
    ownerKey: orderOwnerKey(order),
    reportDate,
    orderNumber: order.orderNumber || null,
    foodName: orderFoodName(order),
  };
}

// ── سبد خرید ────────────────────────────────────────────────────────────────

async function buildCart(user, settings) {
  const organizationSharePercent = clampPercent(settings.organizationSharePercent);
  const ownerFilter = await buildOrderOwnerFilter(user);
  const orders = await Order.find({ $and: [ownerFilter, { status: { $ne: 'cancelled' } }] })
    .sort({ orderDate: -1 })
    .limit(MAX_CART_ITEMS)
    .populate('items.foodId', 'name')
    .populate({
      path: 'menuItemId',
      populate: [{ path: 'foodId', select: 'name image' }, { path: 'dailyMenuId', select: 'date' }],
    })
    .lean();

  const coverage = await coverageByOrder(orders.map((o) => o._id));
  const items = [];
  let reviewCount = 0;
  for (const order of orders) {
    const personal = splitAmount(order.totalPrice, organizationSharePercent).personalAmount;
    if (personal <= 0) continue;
    const covered = coverage.get(String(order._id)) || { paid: 0, review: 0 };
    if (covered.paid >= personal) continue;
    if (covered.paid + covered.review >= personal) {
      reviewCount += 1;
      continue;
    }
    const base = itemFromOrder(order);
    items.push({
      ...base,
      jalaliDate: formatJalaliDate(base.reportDate),
      status: order.status,
      grossTotal: Number(order.totalPrice || 0),
      amount: personal - covered.paid - covered.review,
    });
  }
  items.sort((a, b) => new Date(a.reportDate) - new Date(b.reportDate));
  return {
    items,
    reviewCount,
    total: items.reduce((sum, item) => sum + item.amount, 0),
    split: { organizationSharePercent, personalSharePercent: 100 - organizationSharePercent },
  };
}

// ── صورتحساب هفتگی/ماهیانه ──────────────────────────────────────────────────

function monthQueryFromKey(periodKey) {
  const match = String(periodKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) throw httpError('ماه صورتحساب نامعتبر است');
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw httpError('ماه صورتحساب نامعتبر است');
  const mm = String(month).padStart(2, '0');
  return {
    type: 'month',
    jalaliFrom: `${year}/${mm}/01`,
    jalaliTo: `${year}/${mm}/${String(daysInJalaliMonth(year, month)).padStart(2, '0')}`,
  };
}

async function buildStatementQuote(user, scope, periodKey, settings) {
  if (scope === 'week' && !/^[a-f0-9]{24}$/i.test(String(periodKey || ''))) {
    throw httpError('هفته صورتحساب نامعتبر است');
  }
  const query = scope === 'month' ? monthQueryFromKey(periodKey) : { weekId: String(periodKey) };
  const statement = await buildUserStatement(user, query, settings);
  const organizationSharePercent = clampPercent(settings.organizationSharePercent);
  const { orders } = await summarizeUserOrdersInRange(
    user,
    statement.range.start,
    statement.range.end,
    organizationSharePercent,
    billableStatuses(settings),
  );

  const coverage = await coverageByOrder(orders.map((o) => o._id));
  let paidAmount = 0;
  let reviewAmount = 0;
  const rows = orders.map((order) => {
    const personal = splitAmount(order.totalPrice, organizationSharePercent).personalAmount;
    const covered = coverage.get(String(order._id)) || { paid: 0, review: 0 };
    paidAmount += covered.paid;
    reviewAmount += covered.review;
    return { item: itemFromOrder(order), open: Math.max(0, personal - covered.paid - covered.review) };
  });

  const due = Number(statement.summary?.personalAmount || 0);
  const remaining = Math.max(0, due - paidAmount - reviewAmount);
  return {
    scope,
    periodKey: statement.periodKey,
    periodLabel: `${statement.range.jalaliStart} تا ${statement.range.jalaliEnd}`,
    statementNumber: statement.statementNumber,
    personalAmount: due,
    paidAmount,
    reviewAmount,
    remaining,
    paymentStatus: paymentStatusOf(due, paidAmount, reviewAmount),
    allocation: allocate(remaining, rows),
  };
}

/**
 * وضعیت پرداخت برای فهرست صورتحساب‌های کاربر.
 * پرداخت هر سفارش (از سبد، هفته یا ماه) در هر بازه‌ای که آن سفارش داخلش است حساب می‌شود.
 */
async function annotateUserStatements(user, statements = []) {
  if (!statements.length) return statements;
  const payments = await Payment.find({
    status: { $in: LOCKING_STATUSES },
    'items.ownerKey': { $in: ownerKeysOfUser(user) },
  }).select('status items').lean();
  if (!payments.length) {
    return statements.map((s) => ({
      ...s,
      payment: {
        paidAmount: 0,
        reviewAmount: 0,
        remaining: Number(s.summary?.personalAmount || 0),
        status: paymentStatusOf(Number(s.summary?.personalAmount || 0), 0, 0),
      },
    }));
  }

  const orderIds = [...new Set(payments.flatMap((p) => p.items.map((i) => String(i.orderId))))];
  const confirmed = new Set((await Order.find({
    _id: { $in: orderIds },
    status: { $in: billableStatuses(await getSettingsLean()) },
  }).select('_id').lean()).map((o) => String(o._id)));

  const entries = payments.flatMap((p) => p.items
    .filter((i) => confirmed.has(String(i.orderId)))
    .map((i) => ({ status: p.status, amount: i.amount, date: new Date(i.reportDate).getTime() })));

  return statements.map((s) => {
    const bounds = dayBounds(s.range?.start, s.range?.end);
    const start = bounds.start.getTime();
    const end = bounds.end.getTime();
    let paid = 0;
    let review = 0;
    for (const entry of entries) {
      if (entry.date < start || entry.date > end) continue;
      if (entry.status === 'paid') paid += entry.amount;
      else review += entry.amount;
    }
    const due = Number(s.summary?.personalAmount || 0);
    return {
      ...s,
      payment: {
        paidAmount: paid,
        reviewAmount: review,
        remaining: Math.max(0, due - paid - review),
        status: paymentStatusOf(due, paid, review),
      },
    };
  });
}

/** ستون پرداخت‌شده/نشده در گزارش مالی مدیر */
async function annotateFinanceRows(rows = [], rangeStart, rangeEnd) {
  const { start, end } = dayBounds(rangeStart, rangeEnd);
  const agg = await Payment.aggregate([
    { $match: { status: { $in: LOCKING_STATUSES }, 'items.reportDate': { $gte: start, $lte: end } } },
    { $unwind: '$items' },
    { $match: { 'items.reportDate': { $gte: start, $lte: end } } },
    { $project: { status: 1, orderId: '$items.orderId', ownerKey: '$items.ownerKey', amount: '$items.amount' } },
  ]);

  const confirmed = agg.length
    ? new Set((await Order.find({
      _id: { $in: [...new Set(agg.map((r) => String(r.orderId)))] },
      status: { $in: billableStatuses(await getSettingsLean()) },
    }).select('_id').lean()).map((o) => String(o._id)))
    : new Set();

  const byOwner = new Map();
  for (const row of agg) {
    if (!confirmed.has(String(row.orderId))) continue;
    const current = byOwner.get(row.ownerKey) || { paid: 0, review: 0 };
    if (row.status === 'paid') current.paid += row.amount;
    else current.review += row.amount;
    byOwner.set(row.ownerKey, current);
  }

  return rows.map((row) => {
    const covered = byOwner.get(String(row.userKey)) || { paid: 0, review: 0 };
    const due = Number(row.personalAmount || 0);
    return {
      ...row,
      paidAmount: covered.paid,
      reviewAmount: covered.review,
      unpaidAmount: Math.max(0, due - covered.paid - covered.review),
      paymentStatus: paymentStatusOf(due, covered.paid, covered.review),
    };
  });
}

function summarizePaymentColumns(rows = []) {
  return rows.reduce((acc, row) => {
    acc.paidAmount += Number(row.paidAmount || 0);
    acc.reviewAmount += Number(row.reviewAmount || 0);
    acc.unpaidAmount += Number(row.unpaidAmount || 0);
    if (row.paymentStatus === 'paid') acc.paidCount += 1;
    else if (row.paymentStatus !== 'none') acc.unpaidCount += 1;
    return acc;
  }, { paidAmount: 0, reviewAmount: 0, unpaidAmount: 0, paidCount: 0, unpaidCount: 0 });
}

// ── ثبت پرداخت ──────────────────────────────────────────────────────────────

async function prepareCheckout(user, { scope, periodKey, orderIds }, settings) {
  if (scope === 'cart') {
    const cart = await buildCart(user, settings);
    const wanted = Array.isArray(orderIds) && orderIds.length
      ? new Set(orderIds.map(String))
      : null;
    const chosen = cart.items.filter((item) => !wanted || wanted.has(String(item.orderId)));
    if (!chosen.length) throw httpError('موردی برای پرداخت در سبد خرید نیست');
    return {
      scope: 'cart',
      periodKey: '',
      periodLabel: `سبد خرید — ${chosen.length} سفارش`,
      statementNumber: '',
      amount: chosen.reduce((sum, item) => sum + item.amount, 0),
      items: chosen.map(({ orderId, ownerKey, reportDate, orderNumber, foodName, amount }) => ({
        orderId, ownerKey, reportDate, orderNumber, foodName, amount,
      })),
    };
  }

  if (scope !== 'week' && scope !== 'month') throw httpError('نوع پرداخت نامعتبر است');
  const quote = await buildStatementQuote(user, scope, periodKey, settings);
  if (quote.remaining <= 0 || !quote.allocation.length) {
    throw httpError(quote.reviewAmount > 0
      ? 'پرداخت این صورتحساب در انتظار تایید مدیر است'
      : 'این صورتحساب مبلغ قابل پرداختی ندارد');
  }
  return {
    scope,
    periodKey: quote.periodKey,
    periodLabel: `${scope === 'month' ? 'صورتحساب ماهیانه' : 'صورتحساب هفتگی'} ${quote.periodLabel}`,
    statementNumber: quote.statementNumber,
    amount: quote.remaining,
    items: quote.allocation,
  };
}

/** پرداخت‌های نیمه‌کارهٔ قبلی روی همین سفارش‌ها باطل می‌شوند تا دوبار پرداخت نشود */
async function cancelOverlappingInitiated(userKey, orderIds) {
  await Payment.updateMany(
    { userKey, status: 'initiated', 'items.orderId': { $in: orderIds } },
    { $set: { status: 'cancelled', failureReason: 'جایگزین با پرداخت جدید' } },
  );
}

async function quote(user, params) {
  const { settings, config } = await loadPaymentConfig();
  assertPaymentActive(config, params.scope);
  if (params.scope === 'cart') return buildCart(user, settings);
  return buildStatementQuote(user, params.scope, params.periodKey, settings);
}

async function submitCardPayment(user, params, file) {
  const { settings, config } = await loadPaymentConfig();
  assertPaymentActive(config, params.scope, 'card');
  if (!file?.filename) throw httpError('تصویر رسید پرداخت را بارگذاری کنید');

  const checkout = await prepareCheckout(user, params, settings);
  const payer = payerFields(user);
  await cancelOverlappingInitiated(payer.userKey, checkout.items.map((i) => i.orderId));
  return Payment.create({
    ...payer,
    ...checkout,
    method: 'card',
    provider: 'card',
    status: 'review',
    receiptFile: file.filename,
    trackingCode: String(params.trackingCode || '').trim().slice(0, 64),
    payerNote: String(params.note || '').trim().slice(0, 300),
  });
}

async function startOnlinePayment(req, params) {
  const method = params.method === 'bale' ? 'bale' : 'gateway';
  const { settings, config } = await loadPaymentConfig();
  assertPaymentActive(config, params.scope, method);

  const checkout = await prepareCheckout(req.user, params, settings);
  const payer = payerFields(req.user);
  await cancelOverlappingInitiated(payer.userKey, checkout.items.map((i) => i.orderId));

  const sandbox = method === 'bale' ? config.bale.sandbox : config.gateway.sandbox;
  const viewToken = crypto.randomBytes(24).toString('base64url');
  const payment = await Payment.create({
    ...payer,
    ...checkout,
    method,
    provider: method === 'bale' ? 'bale' : config.gateway.provider,
    sandbox,
    status: 'initiated',
    viewToken,
  });
  const checkoutPath = `/payment/checkout?pid=${payment._id}&t=${viewToken}`;

  const orgName = settings.organizationName || 'سامانه تغذیه';
  const description = `${orgName} — ${checkout.periodLabel} (${formatPaymentNumber(payment.paymentNumber)})`;

  try {
    if (method === 'bale') {
      const payload = `pay:${payment._id}`;
      if (sandbox) {
        // شبیه‌ساز داخلی: بدون فراخوانی بله؛ صفحه پیش‌فاکتور دکمه پرداخت آزمایشی دارد
        payment.gatewayRef = `sandbox:${payment._id}`;
        await payment.save();
        return { payment, redirectUrl: checkoutPath };
      }
      const link = await bale.createInvoiceLink({
        botToken: config.bale.botToken,
        providerToken: config.bale.providerToken,
        amount: payment.amount,
        title: `پرداخت ${formatPaymentNumber(payment.paymentNumber)}`,
        description,
        payload,
      });
      payment.gatewayRef = payload;
      payment.invoiceLink = link;
      await payment.save();
      // صفحه پیش‌فاکتور با قالب انتخابی؛ دکمه آن لینک فاکتور بله را باز می‌کند
      return { payment, redirectUrl: checkoutPath };
    }

    // بازگشت از درگاه با مرورگر کاربر است → همان آدرسی که کاربر با آن وارد شده
    // (آدرس عمومی تنظیم‌شده فقط با FORCE_APP_URL=true؛ مثلا localhost:3000 در حالی که سرور روی پورت دیگری است)
    const callbackUrl = await buildAbsoluteUrl(req, `/payment/callback/${config.gateway.provider}?pid=${payment._id}`);
    const gateway = getGateway(config.gateway.provider);
    const result = await gateway.request({
      merchantId: config.gateway.merchantId,
      sandbox: config.gateway.sandbox,
      amount: payment.amount,
      callbackUrl,
      description,
      orderId: String(payment.paymentNumber),
      mobile: req.user?.mobile || undefined,
    });
    payment.gatewayRef = result.ref;
    await payment.save();
    return { payment, redirectUrl: result.redirectUrl };
  } catch (error) {
    payment.status = 'failed';
    payment.failureReason = String(error.message || 'خطای درگاه').slice(0, 300);
    await payment.save();
    throw error;
  }
}

/** پرداخت تاییدشده = سفارش تاییدشده؛ دیگر نیازی به تایید دستی مدیر نیست */
async function confirmPaidOrders(payment) {
  const ids = (payment?.items || []).map((item) => item.orderId).filter(Boolean);
  if (!ids.length) return 0;
  const result = await Order.updateMany(
    { _id: { $in: ids }, status: 'pending' },
    { $set: { status: 'confirmed', updatedAt: new Date() } },
  );
  return Number(result.modifiedCount || 0);
}

async function markPaid(paymentId, fields = {}) {
  const payment = await Payment.findOneAndUpdate(
    { _id: paymentId, status: { $in: ['initiated', 'review'] } },
    { $set: { status: 'paid', paidAt: new Date(), ...fields } },
    { new: true },
  );
  if (payment) await confirmPaidOrders(payment);
  return payment;
}

/** بازگشت از درگاه بانکی — بدون نشست (کوکی strict در بازگشت بین‌سایتی ارسال نمی‌شود) */
async function handleGatewayCallback(provider, query = {}) {
  const gateway = getGateway(provider);
  const { ref, ok } = gateway.readCallback(query);
  const pid = String(query.pid || '');
  if (!/^[a-f0-9]{24}$/i.test(pid) || !ref) {
    return { ok: false, message: 'اطلاعات بازگشت از درگاه نامعتبر است' };
  }
  const payment = await Payment.findOne({ _id: pid, provider, gatewayRef: ref });
  if (!payment) return { ok: false, message: 'تراکنش یافت نشد' };
  if (payment.status === 'paid') return { ok: true, payment };
  if (payment.status !== 'initiated') {
    return { ok: false, payment, message: 'این تراکنش دیگر معتبر نیست؛ در صورت کسر وجه، مبلغ توسط درگاه برگشت داده می‌شود' };
  }
  if (!ok) {
    payment.status = 'failed';
    payment.failureReason = 'پرداخت توسط کاربر لغو شد یا ناموفق بود';
    await payment.save();
    return { ok: false, payment, message: payment.failureReason };
  }

  const { config } = await loadPaymentConfig();
  const verified = await gateway.verify({
    merchantId: config.gateway.merchantId,
    sandbox: payment.sandbox,
    amount: payment.amount,
    ref,
  });
  if (!verified.ok) {
    payment.status = 'failed';
    payment.failureReason = verified.reason;
    await payment.save();
    return { ok: false, payment, message: verified.reason };
  }
  const paid = await markPaid(payment._id, {
    referenceId: verified.referenceId,
    cardPan: verified.cardPan,
  });
  return { ok: true, payment: paid || payment };
}

/** وب‌هوک بله: pre_checkout_query را تایید و successful_payment را ثبت می‌کند */
async function handleBaleUpdate(secret, update = {}) {
  const { config } = await loadPaymentConfig();
  if (!config.bale.botToken || !tokensMatch(secret, config.bale.webhookSecret)) {
    return { accepted: false };
  }

  const preCheckout = update.pre_checkout_query;
  if (preCheckout?.id) {
    const id = String(preCheckout.invoice_payload || '').replace(/^pay:/, '');
    const payment = /^[a-f0-9]{24}$/i.test(id) ? await Payment.findById(id).lean() : null;
    const valid = payment
      && payment.status === 'initiated'
      && payment.provider === 'bale'
      && !payment.sandbox
      && Number(preCheckout.total_amount) === payment.amount * 10;
    await bale.answerPreCheckout(
      config.bale.botToken,
      preCheckout.id,
      !!valid,
      valid ? '' : 'این صورتحساب منقضی یا نامعتبر است. از سامانه دوباره اقدام کنید.',
    ).catch(() => {});
    return { accepted: true };
  }

  const message = update.message || {};
  const success = message.successful_payment;
  if (success) {
    const id = String(success.invoice_payload || '').replace(/^pay:/, '');
    if (!/^[a-f0-9]{24}$/i.test(id)) return { accepted: true };
    const payment = await Payment.findById(id).lean();
    if (!payment || payment.provider !== 'bale' || payment.sandbox) return { accepted: true };
    if (Number(success.total_amount) !== payment.amount * 10) {
      await Payment.updateOne({ _id: id }, {
        $set: { failureReason: `مبلغ دریافتی از بله (${success.total_amount} ریال) با صورتحساب مغایرت دارد` },
      });
      return { accepted: true };
    }
    const paid = await markPaid(id, {
      referenceId: String(success.provider_payment_charge_id || success.telegram_payment_charge_id || ''),
    });
    // پرداخت انجام شده ولی رکورد قبلاً باطل شده بود — برای پیگیری مدیر علامت بزن
    if (!paid && payment.status !== 'paid') {
      await Payment.updateOne({ _id: id }, {
        $set: {
          status: 'paid',
          paidAt: new Date(),
          referenceId: String(success.provider_payment_charge_id || ''),
          failureReason: 'وجه پس از ابطال تراکنش در بله پرداخت شد — احتمال پرداخت تکراری، بررسی شود',
        },
      });
      await confirmPaidOrders(payment);
    }
    if (message.chat?.id) {
      const text = config.appearance.baleSuccessMessage
        .replace(/\{code\}/g, formatPaymentNumber(payment.paymentNumber))
        .replace(/\{amount\}/g, `${Number(payment.amount).toLocaleString('fa-IR')} تومان`);
      bale.sendMessage(config.bale.botToken, message.chat.id, text).catch(() => {});
    }
  }
  return { accepted: true };
}

// ── صفحه‌های پرداخت بدون نشست ─────────────────────────────────────────────

function tokensMatch(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** پرداخت با توکن صفحه (pid + t) — بدون توکن درست چیزی برنمی‌گردد */
async function loadPaymentForView(pid, token) {
  if (!/^[a-f0-9]{24}$/i.test(String(pid || ''))) return null;
  const payment = await Payment.findById(pid).select('+viewToken').lean();
  if (!payment || !tokensMatch(payment.viewToken, token)) return null;
  return payment;
}

/** شبیه‌ساز بله: فقط وقتی هم پرداخت و هم تنظیمات فعلی در حالت آزمایشی باشند */
async function simulateBalePayment(pid, token, outcome) {
  const payment = await loadPaymentForView(pid, token);
  if (!payment) throw httpError('پرداخت یافت نشد', 404);
  const { config } = await loadPaymentConfig();
  if (payment.provider !== 'bale' || !payment.sandbox || !config.bale.sandbox) {
    throw httpError('حالت آزمایشی بله فعال نیست', 403);
  }
  if (payment.status !== 'initiated') return payment;
  if (outcome === 'paid') {
    const referenceId = `TEST-${crypto.randomInt(10000000, 99999999)}`;
    return (await markPaid(payment._id, { referenceId })) || payment;
  }
  return Payment.findOneAndUpdate(
    { _id: payment._id, status: 'initiated' },
    { $set: { status: 'failed', failureReason: 'پرداخت آزمایشی توسط کاربر لغو شد' } },
    { new: true },
  ).lean();
}

function checkoutPathOf(payment) {
  if (!payment?.viewToken) return '';
  return `/payment/checkout?pid=${payment._id}&t=${payment.viewToken}`;
}

async function registerBaleWebhook(req) {
  const { config } = await loadPaymentConfig();
  if (!config.bale.botToken) throw httpError('ابتدا توکن ربات بله را ثبت کنید');
  const base = (await resolvePublicUrl(req)).replace(/\/$/, '');
  if (!/^https:\/\//i.test(base)) {
    throw httpError('آدرس عمومی سامانه باید HTTPS باشد تا بله بتواند وب‌هوک را فراخوانی کند');
  }
  const url = `${base}/api/payments/bale/webhook/${config.bale.webhookSecret}`;
  await bale.setWebhook(config.bale.botToken, url);
  return url;
}

// ── فهرست‌ها و بررسی مدیر ──────────────────────────────────────────────────

function serializePayment(payment, { admin = false } = {}) {
  const p = payment.toObject ? payment.toObject() : payment;
  return {
    _id: p._id,
    paymentNumber: p.paymentNumber,
    code: formatPaymentNumber(p.paymentNumber),
    scope: p.scope,
    periodKey: p.periodKey,
    periodLabel: p.periodLabel,
    statementNumber: p.statementNumber,
    amount: p.amount,
    method: p.method,
    provider: p.provider,
    status: p.status,
    statusLabel: STATUS_LABELS[p.status] || p.status,
    items: (p.items || []).map((i) => ({
      orderId: i.orderId,
      orderNumber: i.orderNumber,
      foodName: i.foodName,
      jalaliDate: formatJalaliDate(i.reportDate),
      amount: i.amount,
    })),
    hasReceipt: !!p.receiptFile,
    trackingCode: p.trackingCode,
    payerNote: p.payerNote,
    referenceId: p.referenceId,
    cardPan: p.cardPan,
    invoiceLink: p.status === 'initiated' ? p.invoiceLink : '',
    failureReason: p.failureReason,
    reviewNote: p.reviewNote,
    reviewedAt: p.reviewedAt,
    paidAt: p.paidAt,
    createdAt: p.createdAt,
    payerName: p.payerName,
    payerUsername: p.payerUsername,
    payerDepartment: p.payerDepartment,
    ...(admin ? { userKey: p.userKey, reviewedBy: p.reviewedBy, sandbox: p.sandbox } : {}),
  };
}

async function listUserPayments(user, { page = 1, limit = 10 } = {}) {
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 10));
  const safePage = Math.max(1, Number(page) || 1);
  const filter = { userKey: financeUserKeyFromUser(user), status: { $ne: 'cancelled' } };
  const [rows, total] = await Promise.all([
    Payment.find(filter).select('+viewToken').sort({ createdAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
    Payment.countDocuments(filter),
  ]);
  return {
    data: rows.map((row) => ({
      ...serializePayment(row),
      checkoutUrl: row.status === 'initiated' && row.provider === 'bale' ? checkoutPathOf(row) : '',
    })),
    pagination: { page: safePage, totalPages: Math.max(1, Math.ceil(total / safeLimit)), total },
  };
}

async function getUserPayment(user, id) {
  if (!/^[a-f0-9]{24}$/i.test(String(id))) throw httpError('شناسه نامعتبر است', 404);
  const payment = await Payment.findOne({ _id: id, userKey: financeUserKeyFromUser(user) }).lean();
  if (!payment) throw httpError('پرداخت یافت نشد', 404);
  return payment;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function listAdminPayments(query = {}) {
  const filter = adminListFilter(query);

  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const page = Math.max(1, Number(query.page) || 1);
  const [rows, total, summaryRows] = await Promise.all([
    Payment.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Payment.countDocuments(filter),
    Payment.aggregate([
      { $match: { status: { $in: ['paid', 'review'] } } },
      { $group: { _id: '$status', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
  ]);
  const summary = { paidAmount: 0, paidCount: 0, reviewAmount: 0, reviewCount: 0 };
  for (const row of summaryRows) {
    if (row._id === 'paid') { summary.paidAmount = row.amount; summary.paidCount = row.count; }
    if (row._id === 'review') { summary.reviewAmount = row.amount; summary.reviewCount = row.count; }
  }
  return {
    data: rows.map((row) => serializePayment(row, { admin: true })),
    pagination: { page, totalPages: Math.max(1, Math.ceil(total / limit)), total },
    summary,
  };
}

async function reviewPayment(id, admin, approve, note = '') {
  if (!/^[a-f0-9]{24}$/i.test(String(id))) throw httpError('شناسه نامعتبر است', 404);
  const allowed = approve ? ['review', 'initiated'] : ['review'];
  const set = {
    status: approve ? 'paid' : 'rejected',
    reviewedBy: admin?.username || '',
    reviewedAt: new Date(),
    reviewNote: String(note || '').trim().slice(0, 300),
    ...(approve ? { paidAt: new Date() } : {}),
  };
  const payment = await Payment.findOneAndUpdate(
    { _id: id, status: { $in: allowed } },
    { $set: set },
    { new: true },
  );
  if (!payment) throw httpError('این پرداخت قابل بررسی نیست یا قبلاً بررسی شده است', 409);
  if (approve) await confirmPaidOrders(payment);
  return payment;
}

function removeReceiptFiles(names = []) {
  let removed = 0;
  for (const raw of names) {
    const name = path.basename(String(raw || ''));
    if (!name) continue;
    try {
      fs.unlinkSync(path.join(RECEIPT_DIR, name));
      removed += 1;
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('[payment] receipt delete failed:', name, error.message);
    }
  }
  return removed;
}

/** فیلتر فهرست مدیر (برای «حذف همه» با همان فیلترهای صفحه) */
function adminListFilter(query = {}) {
  const filter = {};
  const has = (obj, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);
  if (has(STATUS_LABELS, query.status)) filter.status = query.status;
  else filter.status = { $ne: 'cancelled' };
  if (['card', 'bale', 'gateway'].includes(query.method)) filter.method = query.method;
  if (['cart', 'week', 'month'].includes(query.scope)) filter.scope = query.scope;
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 60) : '';
  if (q) {
    const number = Number(q.replace(/^PAY-/i, ''));
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [
      { payerName: rx },
      { payerUsername: rx },
      { payerDepartment: rx },
      { trackingCode: rx },
      { referenceId: rx },
      { statementNumber: rx },
      ...(Number.isFinite(number) && number > 0 ? [{ paymentNumber: number }] : []),
    ];
  }
  return filter;
}

/**
 * حذف پرداخت‌ها (تکی، انتخابی یا همه با فیلتر فعلی) و تصویر رسیدشان.
 * سفارش‌ها دست نمی‌خورند؛ فقط سابقه پرداخت از دفتر حذف می‌شود.
 */
async function deletePayments({ ids, all = false, query = {} } = {}) {
  let filter;
  if (all) {
    filter = adminListFilter(query);
  } else {
    const valid = (Array.isArray(ids) ? ids : []).map(String).filter((id) => /^[a-f0-9]{24}$/i.test(id));
    if (!valid.length) throw httpError('هیچ صورتحسابی برای حذف انتخاب نشده است');
    filter = { _id: { $in: valid } };
  }
  const docs = await Payment.find(filter).select('_id receiptFile').lean();
  if (!docs.length) return { deletedCount: 0, filesRemoved: 0 };
  const result = await Payment.deleteMany({ _id: { $in: docs.map((d) => d._id) } });
  const filesRemoved = removeReceiptFiles(docs.map((d) => d.receiptFile).filter(Boolean));
  return { deletedCount: Number(result.deletedCount || 0), filesRemoved };
}

function receiptPath(payment) {
  const name = path.basename(String(payment?.receiptFile || ''));
  if (!name) return '';
  const full = path.join(RECEIPT_DIR, name);
  return fs.existsSync(full) ? full : '';
}

module.exports = {
  RECEIPT_DIR,
  STATUS_LABELS,
  formatPaymentNumber,
  loadPaymentConfig,
  quote,
  buildCart,
  annotateUserStatements,
  annotateFinanceRows,
  summarizePaymentColumns,
  submitCardPayment,
  startOnlinePayment,
  loadPaymentForView,
  simulateBalePayment,
  handleGatewayCallback,
  handleBaleUpdate,
  registerBaleWebhook,
  serializePayment,
  listUserPayments,
  getUserPayment,
  listAdminPayments,
  reviewPayment,
  deletePayments,
  removeReceiptFiles,
  receiptPath,
};
