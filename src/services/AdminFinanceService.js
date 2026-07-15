const { formatJalaliDate } = require('../helpers/DateHelper');
const { buildReport, isSuperadminReportUser } = require('../services/ReportService');
const { clampPercent, splitAmount } = require('../services/UserStatementService');
const { buildStatementNumber } = require('../helpers/StatementNumberHelper');
const { nextReportNumber } = require('../helpers/ReportNumberHelper');

function userActorFromReportRow(row = {}) {
  const userKey = String(row.userId || '');
  if (userKey.startsWith('ldap:')) {
    const ldapUsername = row.username || userKey.replace(/^ldap:/, '');
    return { ldapUsername, username: ldapUsername };
  }
  return { id: row.userId, username: row.username };
}

function periodKeyFromQuery(query = {}, range = {}, periodType = 'week') {
  if (query.weekId) return String(query.weekId);
  if (query.jalaliFrom && query.jalaliTo) return `${query.jalaliFrom}-${query.jalaliTo}`;
  return `${periodType}:${formatJalaliDate(range.start)}-${formatJalaliDate(range.end)}`;
}

function mapUsersToFinanceRows(byUser = [], settings = {}, periodType = 'week', periodKey = '') {
  const organizationSharePercent = clampPercent(settings.organizationSharePercent);
  const personalSharePercent = 100 - organizationSharePercent;

  const users = (byUser || [])
    .filter((row) => !isSuperadminReportUser({ role: row.role, username: row.username }))
    .map((row) => {
      const split = splitAmount(row.totalPrice, organizationSharePercent);
      const actor = userActorFromReportRow(row);
      return {
        kind: 'user',
        userKey: String(row.userId),
        fullName: row.fullName || row.username || '-',
        username: row.username || '',
        department: row.department || 'بدون واحد',
        guestCode: '',
        guestTypeLabel: '',
        statementNumber: buildStatementNumber(actor, periodType, periodKey),
        mealCount: Number(row.total || 0),
        grossTotal: split.total,
        organizationAmount: split.organizationAmount,
        personalAmount: split.personalAmount,
      };
    })
    .sort((a, b) => String(a.fullName).localeCompare(String(b.fullName), 'fa'));

  return { users, organizationSharePercent, personalSharePercent };
}

function mapGuestsToFinanceRows(byGuest = [], settings = {}, periodType = 'week', periodKey = '') {
  const organizationSharePercent = clampPercent(settings.organizationSharePercent);

  return (byGuest || [])
    .filter((row) => Number(row.total || 0) > 0 || Number(row.totalPrice || 0) > 0)
    .map((row) => {
      const split = splitAmount(row.totalPrice, organizationSharePercent);
      const guestId = String(row.guestId || '');
      const guestCode = String(row.guestCode || '');
      const actor = { guestId, guestCode };
      return {
        kind: 'guest',
        userKey: `guest:${guestId || guestCode}`,
        fullName: row.fullName || 'مهمان',
        username: guestCode,
        department: row.department || 'مهمان',
        guestCode,
        guestTypeLabel: row.guestTypeLabel || (row.guestType === 'permanent' ? 'دائم' : 'موقت'),
        statementNumber: buildStatementNumber(actor, periodType, periodKey),
        mealCount: Number(row.total || 0),
        grossTotal: split.total,
        organizationAmount: split.organizationAmount,
        personalAmount: split.personalAmount,
      };
    })
    .sort((a, b) => String(a.fullName).localeCompare(String(b.fullName), 'fa'));
}

function summarizeFinanceRows(rows = []) {
  return rows.reduce((acc, row) => {
    if (row.kind === 'guest') acc.guestCount += 1;
    else acc.userCount += 1;
    acc.mealCount += row.mealCount;
    acc.grossTotal += row.grossTotal;
    acc.organizationAmount += row.organizationAmount;
    acc.personalAmount += row.personalAmount;
    return acc;
  }, {
    userCount: 0,
    guestCount: 0,
    mealCount: 0,
    grossTotal: 0,
    organizationAmount: 0,
    personalAmount: 0,
  });
}

async function buildAdminFinanceReport(rangeStart, rangeEnd, settings = {}, query = {}, meta = {}) {
  const report = await buildReport(rangeStart, rangeEnd);
  const periodType = meta.type === 'month' ? 'month' : 'week';
  const periodKey = periodKeyFromQuery(query, meta.range || {}, periodType);
  const mappedUsers = mapUsersToFinanceRows(report.byUser, settings, periodType, periodKey);
  const guests = mapGuestsToFinanceRows(report.byGuest, settings, periodType, periodKey);
  const users = [...mappedUsers.users, ...guests];
  const summary = summarizeFinanceRows(users);

  return {
    type: periodType,
    title: meta.title || 'صورتحساب مالی',
    range: meta.range || {
      start: rangeStart,
      end: rangeEnd,
      jalaliStart: formatJalaliDate(rangeStart),
      jalaliEnd: formatJalaliDate(rangeEnd),
    },
    split: {
      organizationSharePercent: mappedUsers.organizationSharePercent,
      personalSharePercent: mappedUsers.personalSharePercent,
    },
    users,
    guests,
    summary,
  };
}

async function buildAdminFinancePdfPayload(rangeStart, rangeEnd, settings = {}, query = {}, meta = {}, options = {}) {
  const base = await buildAdminFinanceReport(rangeStart, rangeEnd, settings, query, meta);
  const reportNumber = await nextReportNumber();
  const userKey = options.userKey ? String(options.userKey) : '';

  let users = base.users;
  let summary = base.summary;
  let title = base.title;

  if (userKey) {
    const user = users.find((item) => item.userKey === userKey);
    if (!user) {
      const error = new Error('صورتحساب این مورد در بازه انتخاب‌شده یافت نشد');
      error.status = 404;
      throw error;
    }
    users = [user];
    summary = {
      userCount: user.kind === 'guest' ? 0 : 1,
      guestCount: user.kind === 'guest' ? 1 : 0,
      mealCount: user.mealCount,
      grossTotal: user.grossTotal,
      organizationAmount: user.organizationAmount,
      personalAmount: user.personalAmount,
    };
    title = user.kind === 'guest'
      ? `صورتحساب مهمان ${user.fullName} — ${base.title}`
      : `صورتحساب ${user.fullName} — ${base.title}`;
  }

  return {
    ...base,
    title,
    users,
    summary,
    reportNumber,
    organizationName: settings.organizationName || 'سامانه تغذیه سازمانی',
    singleUser: Boolean(userKey),
    selectedUser: userKey ? users[0] : null,
  };
}

module.exports = {
  buildAdminFinanceReport,
  buildAdminFinancePdfPayload,
  mapUsersToFinanceRows,
  mapGuestsToFinanceRows,
};
