const crypto = require('crypto');
const User = require('../models/User');
const LdapProfile = require('../models/LdapProfile');
const {
  parseLdapUserId,
  findProfile,
  updateProfileAdmin,
  deleteProfile,
  isValidPersianFullName,
} = require('../helpers/LdapProfileHelper');
const Week = require('../models/Week');
const Food = require('../models/Food');
const Order = require('../models/Order');
const Department = require('../models/Department');
const DailyMenu = require('../models/DailyMenu');
const MenuItem = require('../models/MenuItem');
const SecurityLog = require('../models/SecurityLog');
const { hashPassword, escapeRegex, hashSensitiveToken, validatePasswordPolicy } = require('../helpers/SecurityHelper');
const { testConnection: testLdapConn, validateConfig: validateLdapConfig, ldapConfig } = require('../helpers/LdapHelper');
const { mergeLdapSettings, ldapFieldsFromBody, parseBoolean } = require('../helpers/LdapSettingsHelper');
const { startOfDay, formatJalaliDate } = require('../helpers/DateHelper');
const { finalizeExpiredOrders } = require('../helpers/OrderStatusHelper');
const { htmlToPdfBuffer } = require('../helpers/PdfHelper');
const { paginationFromQuery, paginationMeta } = require('../helpers/PaginationHelper');
const { defaultSettings, publicSettings, adminWorkspaceSettings, getOrCreateSettings, updateAppSettings, getSettingsLean } = require('../services/SettingsService');
const { writeSecurityLog } = require('../services/SecurityLogService');
const { ensureDailyMenus, ensureCurrentWeek, ensureFutureWeeks, dedupeWeeks } = require('../services/WeekService');
const { resolveReportRange, buildReport, getAvailableReportMonths } = require('../services/ReportService');
const { nextReportNumber, nextSupplierReportNumber } = require('../helpers/ReportNumberHelper');
const { getReportsAccessForUser, assertReportsAccess } = require('../helpers/ReportsAccessHelper');
const { createBackupBuffer, readBackupBuffer, restoreBackup } = require('../services/BackupService');
const { renderReportHtml } = require('../views/ReportPdfView');
const { renderSupplierReportHtml } = require('../views/SupplierReportPdfView');
const { clampPercent } = require('../services/UserStatementService');
const { buildAdminFinanceReport, buildAdminFinancePdfPayload } = require('../services/AdminFinanceService');
const { renderFinanceStatementHtml } = require('../views/FinanceStatementPdfView');
const { refreshOriginPublicUrlCache } = require('../helpers/OriginPolicyHelper');
const { normalizePublicUrl, refreshPublicUrlCache, requestOrigin } = require('../helpers/AppUrlHelper');
const { getSslStatus, saveCustomCertificate, applyCustomCertificate } = require('../helpers/SslCertHelper');

function firstString(value) {
  if (Array.isArray(value)) return value.find((item) => typeof item === 'string') || '';
  return typeof value === 'string' ? value : '';
}

function optionalString(value) {
  const normalized = firstString(value).trim();
  return normalized || undefined;
}

function nullableString(value) {
  const normalized = firstString(value).trim();
  return normalized || null;
}

function passwordPolicyError(role) {
  return role === 'superadmin'
    ? 'رمز سوپر ادمین باید حداقل ۱۲ کاراکتر و شامل حرف، عدد و نماد باشد'
    : 'رمز عبور باید حداقل ۸ کاراکتر و شامل حرف و عدد باشد';
}

function meetsPasswordPolicy(password, role) {
  const isSuper = role === 'superadmin';
  return validatePasswordPolicy(password, { minLength: isSuper ? 12 : 8, requireSymbol: isSuper });
}

const ROLE_RANK = { user: 0, admin: 1, superadmin: 2 };

function isAdminRole(role) {
  return role === 'admin' || role === 'superadmin';
}

async function countActiveAdmins(excludeLocalId = null, excludeLdapUsername = null) {
  const localFilter = { role: { $in: ['admin', 'superadmin'] }, status: 'active' };
  if (excludeLocalId) localFilter._id = { $ne: excludeLocalId };
  const ldapFilter = { role: 'admin', status: 'active' };
  if (excludeLdapUsername) ldapFilter.ldapUsername = { $ne: excludeLdapUsername };

  const [localCount, ldapCount] = await Promise.all([
    User.countDocuments(localFilter),
    LdapProfile.countDocuments(ldapFilter),
  ]);
  return localCount + ldapCount;
}

function generateOneTimeSuperToken() {
  return [
    crypto.randomBytes(18).toString('base64url'),
    crypto.randomBytes(18).toString('base64url'),
    crypto.randomBytes(18).toString('base64url'),
  ].join('.');
}

class AdminController {
  static async dashboard(req, res, next) {
    try {
      await finalizeExpiredOrders();
      const today = startOfDay(new Date());
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);

      const [users, foods, todayOrders, incomeResult, recentOrders] = await Promise.all([
        User.countDocuments({ role: 'user', status: 'active' }),
        Food.countDocuments({ status: 'active' }),
        Order.countDocuments({ orderDate: { $gte: today, $lt: tomorrow } }),
        Order.aggregate([
          { $match: { orderDate: { $gte: today, $lt: tomorrow }, status: { $in: ['confirmed', 'completed'] } } },
          { $group: { _id: null, total: { $sum: '$totalPrice' } } },
        ]),
        Order.find()
          .sort({ orderDate: -1 })
          .limit(10)
          .populate('userId', 'username fullName')
          .populate({
            path: 'menuItemId',
            populate: [{ path: 'foodId', select: 'name price' }, { path: 'dailyMenuId', select: 'date' }],
          }),
      ]);

      res.json({
        success: true,
        data: {
          stats: {
            users,
            foods,
            todayOrders,
            todayIncome: incomeResult[0]?.total || 0,
          },
          recentOrders,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async getSettings(req, res, next) {
    try {
      const settings = await getOrCreateSettings();
      res.json({ success: true, data: publicSettings(settings) });
    } catch (error) {
      next(error);
    }
  }

  static async updateSettings(req, res, next) {
    try {
      const update = {};
      if (req.body.showPricesToUsers !== undefined) {
        update.showPricesToUsers = parseBoolean(req.body.showPricesToUsers);
      }
      if (req.body.organizationName !== undefined) {
        update.organizationName = String(req.body.organizationName || '').trim() || defaultSettings.organizationName;
      }
      if (req.body.publicUrl !== undefined) {
        const raw = String(req.body.publicUrl || '').trim();
        update.publicUrl = raw ? normalizePublicUrl(raw) : '';
      }
      if (req.body.maxActiveReservations !== undefined) {
        update.maxActiveReservations = Math.max(Number(req.body.maxActiveReservations || 0), 0);
      }
      if (req.body.defaultMenuItemCapacity !== undefined) {
        update.defaultMenuItemCapacity = Math.max(Number(req.body.defaultMenuItemCapacity || 0), 0);
      }
      const colorPattern = /^#[0-9a-fA-F]{6}$/;
      ['themePrimary', 'themePrimaryLight', 'themePrimaryDark', 'themeGradientFrom', 'themeGradientTo'].forEach((key) => {
        if (req.body[key] !== undefined) {
          const value = String(req.body[key] || '').trim();
          if (colorPattern.test(value)) update[key] = value;
        }
      });
      try {
        Object.assign(update, ldapFieldsFromBody(req.body));
      } catch (err) {
        if (err.status) return res.status(err.status).json({ success: false, message: err.message });
        throw err;
      }

      if (update.ldapEnabled) {
        const savedSettings = await getSettingsLean();
        const candidate = { ...savedSettings, ...update };
        const validation = validateLdapConfig(ldapConfig(candidate));
        if (!validation.valid) {
          return res.status(400).json({ success: false, message: validation.message });
        }
      }

      const settings = await updateAppSettings(update);

      // Capacity is inherited at runtime when maxCapacity is 0. Reset snapshots so
      // changing "ظرفیت پیش‌فرض" immediately applies to existing menu foods.
      if (update.defaultMenuItemCapacity !== undefined) {
        await MenuItem.updateMany({}, { $set: { maxCapacity: 0 } });
      }

      if (update.publicUrl !== undefined) {
        refreshPublicUrlCache(settings.publicUrl);
        await refreshOriginPublicUrlCache();
        const { syncPublicUrlToEnv } = require('../helpers/EnvFileHelper');
        const currentOrigin = requestOrigin(req);
        const extraOrigins = [currentOrigin];
        if (currentOrigin) {
          try {
            const { hostname } = new URL(currentOrigin);
            if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
              extraOrigins.push(`https://${hostname}`, `http://${hostname}`);
            }
          } catch { /* ignore */ }
        }
        syncPublicUrlToEnv(settings.publicUrl, { extraOrigins: extraOrigins.filter(Boolean) });
        process.env.FORCE_APP_URL = 'false';
      }
      res.json({ success: true, message: 'تنظیمات بروزرسانی شد', data: publicSettings(settings) });
    } catch (error) {
      if (Number(error?.code) === 40 || /would create a conflict/i.test(String(error?.message || ''))) {
        return res.status(409).json({
          success: false,
          message: 'ذخیره تنظیمات با تداخل انجام شد؛ لطفاً دوباره تلاش کنید',
        });
      }
      next(error);
    }
  }

  static async getUsers(req, res, next) {
    try {
      const { search, role, department } = req.query;
      const filter = {};

      if (search) {
        const safe = escapeRegex(String(search).slice(0, 100));
        filter.$or = [
          { username: { $regex: safe, $options: 'i' } },
          { fullName: { $regex: safe, $options: 'i' } },
          { phone:    { $regex: safe, $options: 'i' } },
        ];
      }
      if (req.user.role !== 'superadmin') {
        if (role === 'superadmin') {
          const pageInfo = paginationFromQuery(req.query, { limit: 20, maxLimit: 200 });
          return res.json({ success: true, data: [], pagination: paginationMeta({ ...pageInfo, total: 0 }) });
        }
        filter.role = role || { $ne: 'superadmin' };
      } else if (role) {
        filter.role = role;
      }
      if (department === 'none') filter.departmentId = null;
      else if (department) filter.departmentId = department;

      const pageInfo = paginationFromQuery(req.query, { limit: 20, maxLimit: 200 });
      const includeLdapUsers = !role || role === 'user' || role === 'admin';
      let ldapQuery = {};
      if (role === 'admin') ldapQuery = { role: 'admin' };
      else if (role === 'user') ldapQuery = { $or: [{ role: 'user' }, { role: { $exists: false } }] };

      const [localUsers, ldapProfiles, departmentDoc] = await Promise.all([
        User.find(filter)
          .select('-password')
          .populate('departmentId')
          .sort({ fullName: 1 })
          .lean(),
        includeLdapUsers
          ? LdapProfile.find(ldapQuery).populate('departmentId', 'name').sort({ fullName: 1 }).lean()
          : Promise.resolve([]),
        department && department !== 'none'
          ? Department.findById(department).select('name').lean()
          : Promise.resolve(null),
      ]);

      const searchValue = String(search || '').trim().toLowerCase();
      let ldapUsers = ldapProfiles.map((profile) => ({
        _id: `ldap:${profile.ldapUsername}`,
        username: profile.ldapUsername,
        fullName: profile.fullName,
        email: profile.email || null,
        phone: profile.phone || null,
        departmentId: profile.departmentId || null,
        role: profile.role === 'admin' ? 'admin' : 'user',
        status: profile.status || 'active',
        authSource: 'ldap',
        ldapUser: true,
        createdAt: profile.updatedAt,
      }));

      if (searchValue) {
        ldapUsers = ldapUsers.filter((user) => (
          String(user.username || '').toLowerCase().includes(searchValue)
          || String(user.fullName || '').toLowerCase().includes(searchValue)
          || String(user.email || '').toLowerCase().includes(searchValue)
          || String(user.phone || '').toLowerCase().includes(searchValue)
        ));
      }
      if (department === 'none') {
        ldapUsers = ldapUsers.filter((user) => !user.departmentId);
      } else if (departmentDoc?._id) {
        ldapUsers = ldapUsers.filter((user) => String(user.departmentId?._id || user.departmentId || '') === String(departmentDoc._id));
      }

      const merged = [
        ...localUsers.map((user) => ({ ...user, authSource: user.authSource || 'local' })),
        ...ldapUsers,
      ].sort((a, b) => String(a.fullName || a.username || '').localeCompare(String(b.fullName || b.username || ''), 'fa'));

      const total = merged.length;
      const data = merged.slice(pageInfo.skip, pageInfo.skip + pageInfo.limit);

      res.json({
        success: true,
        data,
        pagination: paginationMeta({ ...pageInfo, total }),
      });
    } catch (error) {
      next(error);
    }
  }

  static async getSystemLogs(req, res, next) {
    try {
      const { readLogsPaginated, readLifecycleStats } = require('../services/SystemLogService');
      const { getHealthStatus } = require('../helpers/HealthState');
      const page = Number(req.query.page) || 1;
      const perPage = Number(req.query.perPage) || undefined;
      const level = String(req.query.level || '').toLowerCase();
      const { logs, pagination } = readLogsPaginated({ page, perPage, level });
      res.json({
        success: true,
        data: {
          health: getHealthStatus(),
          lifecycle: readLifecycleStats(),
          logs,
          pagination,
          logDir: process.env.LOG_DIR || '',
          testMode: process.env.ALLOW_SYSTEM_TEST === 'true',
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async getSecuritySummary(req, res, next) {
    try {
      const failedPage = Math.max(1, parseInt(req.query.failedPage, 10) || 1);
      const failedLimit = Math.min(50, Math.max(5, parseInt(req.query.failedLimit, 10) || 15));
      const logsPage = Math.max(1, parseInt(req.query.logsPage, 10) || 1);
      const logsLimit = Math.min(100, Math.max(5, parseInt(req.query.logsLimit, 10) || 15));

      const lockedUsers = await User.find({ lockUntil: { $gt: new Date() } })
        .select('username fullName email role status loginAttempts lockUntil')
        .sort({ lockUntil: -1 })
        .lean();

      const failedSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const failedMatch = {
        type: { $in: ['login_failed', 'super_token_failed'] },
        createdAt: { $gte: failedSince },
        username: { $nin: [null, ''] },
      };

      const failedTotalAgg = await SecurityLog.aggregate([
        { $match: failedMatch },
        { $group: { _id: '$username' } },
        { $count: 'total' },
      ]);
      const failedTotal = failedTotalAgg[0]?.total || 0;
      const failedAttemptsAgg = await SecurityLog.aggregate([
        { $match: failedMatch },
        { $group: { _id: null, total: { $sum: 1 } } },
      ]);
      const failedAttemptsTotal = failedAttemptsAgg[0]?.total || 0;
      const failedTotalPages = Math.max(1, Math.ceil(failedTotal / failedLimit));

      const failedAgg = await SecurityLog.aggregate([
        { $match: failedMatch },
        { $group: { _id: '$username', count: { $sum: 1 }, lastAt: { $max: '$createdAt' }, ip: { $last: '$ip' } } },
        { $sort: { count: -1, lastAt: -1 } },
        { $skip: (failedPage - 1) * failedLimit },
        { $limit: failedLimit },
      ]);

      const logsTotal = await SecurityLog.countDocuments({});
      const logsTotalPages = Math.max(1, Math.ceil(logsTotal / logsLimit));
      const recentLogs = await SecurityLog.find({})
        .sort({ createdAt: -1 })
        .skip((logsPage - 1) * logsLimit)
        .limit(logsLimit)
        .lean();

      const unreadSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const unreadCount = await SecurityLog.countDocuments({
        type: { $in: ['account_locked', 'super_token_failed', 'login_failed'] },
        createdAt: { $gte: unreadSince },
      });

      res.json({
        success: true,
        data: {
          lockedUsers,
          recentLogs,
          failedSummary: failedAgg.filter((item) => item._id),
          failedAttemptsTotal,
          unreadCount,
          failedPagination: {
            page: failedPage,
            limit: failedLimit,
            total: failedTotal,
            totalPages: failedTotalPages,
          },
          logsPagination: {
            page: logsPage,
            limit: logsLimit,
            total: logsTotal,
            totalPages: logsTotalPages,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async unlockUser(req, res, next) {
    try {
      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).json({ message: 'کاربر یافت نشد' });
      user.loginAttempts = 0;
      user.lockUntil = null;
      await user.save();
      await writeSecurityLog(req, 'account_unlocked', user, 'Account unlocked by superadmin', { actorId: req.user.id });
      res.json({ success: true, message: 'قفل حساب کاربر برداشته شد' });
    } catch (error) {
      next(error);
    }
  }

  static async resetOwnSuperToken(req, res, next) {
    try {
      const user = await User.findById(req.user.id).select('+superTokenHash');
      if (!user || user.role !== 'superadmin') {
        return res.status(403).json({ message: 'فقط سوپر ادمین می‌تواند توکن امنیتی خود را تغییر دهد' });
      }
      const superToken = generateOneTimeSuperToken();
      user.superTokenHash = hashSensitiveToken(superToken);
      user.superTokenCreatedAt = new Date();
      user.superTokenLastUsedAt = null;
      await user.save();
      await writeSecurityLog(req, 'super_token_success', user, 'Superadmin rotated own second-factor token', { actorId: req.user.id });
      res.json({
        success: true,
        message: 'توکن امنیتی جدید ساخته شد. فقط همین یک بار نمایش داده می‌شود.',
        superToken,
      });
    } catch (error) {
      next(error);
    }
  }

  static async createUser(req, res, next) {
    try {
      const { username, fullName, email, phone, password, role, departmentId, mustChangePassword } = req.body;
      const normalizedUsername = firstString(username).trim();
      const normalizedFullName = firstString(fullName).trim();
      const normalizedEmail = optionalString(email);
      const normalizedPhone = optionalString(phone);
      const normalizedDepartmentId = nullableString(departmentId);
      const requestedRole = firstString(role) || 'admin';
      const normalizedPassword = firstString(password);

      if (!normalizedUsername || !normalizedPassword) {
        return res.status(400).json({ message: 'نام کاربری و رمز عبور الزامی هستند' });
      }

      const allowedCreateRoles = req.user.role === 'superadmin' ? ['admin', 'superadmin'] : ['admin'];
      if (!allowedCreateRoles.includes(requestedRole)) {
        return res.status(400).json({ message: 'ساخت حساب local فقط برای مدیر مجاز است. کاربران عادی باید با Active Directory وارد شوند.' });
      }

      if (!meetsPasswordPolicy(normalizedPassword, requestedRole)) {
        return res.status(400).json({ message: passwordPolicyError(requestedRole) });
      }

      const exists = await User.findOne({ username: normalizedUsername });
      if (exists) {
        return res.status(400).json({ message: 'نام کاربری تکراری است' });
      }

      const superToken = requestedRole === 'superadmin' ? generateOneTimeSuperToken() : '';

      const user = await User.create({
        username: normalizedUsername,
        fullName: normalizedFullName || normalizedUsername,
        ...(normalizedEmail ? { email: normalizedEmail } : {}),
        ...(normalizedPhone ? { phone: normalizedPhone } : {}),
        password: await hashPassword(normalizedPassword),
        role: requestedRole,
        ...(superToken ? { superTokenHash: hashSensitiveToken(superToken), superTokenCreatedAt: new Date() } : {}),
        departmentId: normalizedDepartmentId,
        mustChangePassword: Boolean(mustChangePassword),
        status: 'active',
      });

      res.status(201).json({
        success: true,
        message: 'کاربر ایجاد شد',
        data: { id: user._id },
        ...(superToken ? { superToken } : {}),
      });
    } catch (error) {
      next(error);
    }
  }

  static async updateUser(req, res, next) {
    try {
      const { id } = req.params;
      const ldapUsername = parseLdapUserId(id);
      if (ldapUsername) {
        const profile = await findProfile(ldapUsername);
        if (!profile) {
          return res.status(404).json({ message: 'کاربر یافت نشد' });
        }

        const { fullName, email, phone, status, departmentId, role } = req.body;
        const hasEmail = Object.prototype.hasOwnProperty.call(req.body, 'email');
        const hasPhone = Object.prototype.hasOwnProperty.call(req.body, 'phone');
        const hasDepartmentId = Object.prototype.hasOwnProperty.call(req.body, 'departmentId');
        const update = {};
        if (fullName !== undefined) update.fullName = String(fullName || '').trim();
        if (hasEmail) update.email = email ? String(email).trim() : null;
        if (hasPhone) update.phone = phone ? String(phone).trim() : null;
        if (status !== undefined) update.status = status === 'inactive' ? 'inactive' : 'active';
        if (hasDepartmentId) update.departmentId = departmentId || null;
        if (role !== undefined) {
          if (!['user', 'admin'].includes(role)) {
            return res.status(400).json({ message: 'نقش کاربر Active Directory فقط می‌تواند کاربر عادی یا مدیر باشد' });
          }
          update.role = role;
        }
        if (update.fullName !== undefined && !isValidPersianFullName(update.fullName)) {
          return res.status(400).json({ message: 'نام کامل باید فارسی و شامل نام و نام خانوادگی باشد' });
        }

        const currentRole = profile.role === 'admin' ? 'admin' : 'user';
        const nextRole = update.role || currentRole;
        const nextStatus = update.status || profile.status || 'active';
        const isSelf = String(req.user.id) === `ldap:${ldapUsername}`;

        if (isSelf) {
          if (nextStatus === 'inactive') {
            return res.status(400).json({ message: 'امکان غیرفعال‌سازی حساب خودتان وجود ندارد' });
          }
          if (update.role && ROLE_RANK[nextRole] < ROLE_RANK[currentRole]) {
            return res.status(400).json({ message: 'امکان تنزل نقش حساب خودتان وجود ندارد' });
          }
        }

        const removesAdminAccess = isAdminRole(currentRole) && (
          nextStatus === 'inactive' || !isAdminRole(nextRole)
        );
        if (removesAdminAccess) {
          const remainingAdmins = await countActiveAdmins(null, ldapUsername);
          if (remainingAdmins === 0) {
            return res.status(400).json({ message: 'حداقل یک مدیر فعال در سامانه باید باقی بماند' });
          }
        }

        await updateProfileAdmin(ldapUsername, update);
        return res.json({ success: true, message: 'کاربر Active Directory بروزرسانی شد' });
      }

      const { username, fullName, email, phone, role, status, departmentId, password, mustChangePassword } = req.body;
      const hasEmail = Object.prototype.hasOwnProperty.call(req.body, 'email');
      const hasPhone = Object.prototype.hasOwnProperty.call(req.body, 'phone');
      const hasDepartmentId = Object.prototype.hasOwnProperty.call(req.body, 'departmentId');
      const normalizedUsername = optionalString(username);
      const normalizedFullName = optionalString(fullName);
      const normalizedEmail = nullableString(email);
      const normalizedPhone = nullableString(phone);
      const normalizedRole = optionalString(role);
      const normalizedStatus = optionalString(status);
      const normalizedDepartmentId = nullableString(departmentId);
      const normalizedPassword = firstString(password);

      const user = await User.findById(id);
      if (!user) {
        return res.status(404).json({ message: 'کاربر یافت نشد' });
      }

      if ((user.role === 'superadmin' || normalizedRole === 'superadmin') && req.user.role !== 'superadmin') {
        return res.status(403).json({ message: 'فقط سوپر ادمین می‌تواند حساب سوپر ادمین را مدیریت کند' });
      }

      if (normalizedRole && !['user', 'admin', 'superadmin'].includes(normalizedRole)) {
        return res.status(400).json({ message: 'نقش کاربر معتبر نیست' });
      }

      if (normalizedUsername && normalizedUsername !== user.username) {
        const exists = await User.findOne({ username: normalizedUsername, _id: { $ne: id } });
        if (exists) {
          return res.status(400).json({ message: 'نام کاربری تکراری است' });
        }
      }

      const isSelf = String(req.user.id) === String(id);
      const nextRole = normalizedRole || user.role;
      const nextStatus = normalizedStatus || user.status;

      if (isSelf) {
        if (normalizedStatus === 'inactive') {
          return res.status(400).json({ message: 'امکان غیرفعال‌سازی حساب خودتان وجود ندارد' });
        }
        if (normalizedRole && ROLE_RANK[normalizedRole] < ROLE_RANK[user.role]) {
          return res.status(400).json({ message: 'امکان تنزل نقش حساب خودتان وجود ندارد' });
        }
      }

      const removesAdminAccess = isAdminRole(user.role) && (
        nextStatus === 'inactive' || !isAdminRole(nextRole)
      );
      if (removesAdminAccess) {
        const remainingAdmins = await countActiveAdmins(id);
        if (remainingAdmins === 0) {
          return res.status(400).json({ message: 'حداقل یک مدیر فعال در سامانه باید باقی بماند' });
        }
      }

      Object.assign(user, {
        username: normalizedUsername || user.username,
        fullName: normalizedFullName || user.fullName,
        email: hasEmail ? normalizedEmail : user.email,
        phone: hasPhone ? normalizedPhone : user.phone,
        role: normalizedRole || user.role,
        status: normalizedStatus || user.status,
        departmentId: hasDepartmentId ? normalizedDepartmentId : user.departmentId,
        mustChangePassword: mustChangePassword ?? user.mustChangePassword,
      });

      if (normalizedPassword) {
        const effectiveRole = normalizedRole || user.role;
        if (!meetsPasswordPolicy(normalizedPassword, effectiveRole)) {
          return res.status(400).json({ message: passwordPolicyError(effectiveRole) });
        }
        user.password = await hashPassword(normalizedPassword);
      }

      await user.save();
      res.json({ success: true, message: 'کاربر بروزرسانی شد' });
    } catch (error) {
      next(error);
    }
  }

  static async deleteUser(req, res, next) {
    try {
      const { id } = req.params;
      const ldapUsername = parseLdapUserId(id);
      if (ldapUsername) {
        const profile = await LdapProfile.findOne({ ldapUsername }).lean();
        if (profile?.role === 'admin' && profile.status === 'active') {
          const remainingAdmins = await countActiveAdmins(null, ldapUsername);
          if (remainingAdmins === 0) {
            return res.status(400).json({ message: 'حداقل یک مدیر فعال در سامانه باید باقی بماند' });
          }
        }
        await deleteProfile(ldapUsername);
        return res.json({ success: true, message: 'پروفایل کاربر Active Directory حذف شد' });
      }

      if (String(req.user.id) === String(id)) {
        return res.status(400).json({ message: 'امکان حذف حساب خودتان وجود ندارد' });
      }

      const user = await User.findById(id);
      if (!user) {
        return res.status(404).json({ message: 'کاربر یافت نشد' });
      }

      if (user.role === 'superadmin' && req.user.role !== 'superadmin') {
        return res.status(403).json({ message: 'فقط سوپر ادمین می‌تواند حساب سوپر ادمین را حذف کند' });
      }

      if (isAdminRole(user.role)) {
        const remainingAdmins = await countActiveAdmins(id);
        if (remainingAdmins === 0) {
          return res.status(400).json({ message: 'حداقل یک مدیر فعال در سامانه باید باقی بماند' });
        }
      }

      await User.findByIdAndDelete(id);
      await writeSecurityLog(req, 'user_deleted', user, 'User deleted by admin', { actorId: req.user.id });
      res.json({ success: true, message: 'کاربر حذف شد' });
    } catch (error) {
      next(error);
    }
  }

  static async getDepartments(req, res, next) {
    try {
      const [departments, ldapCounts] = await Promise.all([
        Department.aggregate([
          { $lookup: { from: 'users', localField: '_id', foreignField: 'departmentId', as: 'users' } },
          { $project: { name: 1, createdAt: 1, userCount: { $size: '$users' } } },
          { $sort: { name: 1 } },
        ]),
        LdapProfile.aggregate([
          { $match: { departmentId: { $ne: null }, status: 'active' } },
          { $group: { _id: '$departmentId', count: { $sum: 1 } } },
        ]),
      ]);
      const ldapMap = new Map(ldapCounts.map((row) => [String(row._id), row.count]));
      const data = departments.map((dept) => ({
        ...dept,
        userCount: Number(dept.userCount || 0) + (ldapMap.get(String(dept._id)) || 0),
      }));
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  static async createDepartment(req, res, next) {
    try {
      const { name } = req.body;
      if (!name) {
        return res.status(400).json({ message: 'نام واحد الزامی است' });
      }
      const department = await Department.create({ name: name.trim() });
      res.status(201).json({ success: true, message: 'واحد ایجاد شد', data: department });
    } catch (error) {
      next(error);
    }
  }

  static async updateDepartment(req, res, next) {
    try {
      const { id } = req.params;
      const { name } = req.body;
      if (!name) return res.status(400).json({ message: 'نام واحد الزامی است' });
      const dept = await Department.findByIdAndUpdate(id, { name: name.trim() }, { new: true });
      if (!dept) return res.status(404).json({ message: 'واحد یافت نشد' });
      res.json({ success: true, message: 'واحد بروزرسانی شد', data: dept });
    } catch (error) {
      next(error);
    }
  }

  static async deleteDepartment(req, res, next) {
    try {
      const { id } = req.params;
      await User.updateMany({ departmentId: id }, { $set: { departmentId: null } });
      await Department.findByIdAndDelete(id);
      res.json({ success: true, message: 'واحد حذف شد' });
    } catch (error) {
      next(error);
    }
  }

  static async getWeeks(req, res, next) {
    try {
      if (!req.query.noSync) {
        await ensureFutureWeeks(Number(req.query.future || 5));
      } else {
        await dedupeWeeks();
      }
      const weeks = await Week.find().sort({ startDate: 1 });
      res.json({
        success: true,
        data: weeks.map((week) => ({
          ...week.toObject(),
          jalaliStart: formatJalaliDate(week.startDate),
          jalaliEnd: formatJalaliDate(week.endDate),
        })),
      });
    } catch (error) {
      next(error);
    }
  }

  static async createWeek(req, res, next) {
    try {
      const { name, week_number, weekNumber, start_date, startDate, end_date, endDate, isActive, status } = req.body;
      const normalizedStart = start_date || startDate;
      const normalizedEnd = end_date || endDate;
      const normalizedWeekNumber = week_number || weekNumber;

      if (!normalizedWeekNumber || !normalizedStart || !normalizedEnd) {
        return res.status(400).json({ message: 'شماره هفته، تاریخ شروع و تاریخ پایان الزامی هستند' });
      }

      if (isActive || status === 'active') {
        await Week.updateMany({}, { $set: { isActive: false, status: 'inactive' } });
      }

      const week = await Week.create({
        name,
        weekNumber: normalizedWeekNumber,
        startDate: normalizedStart,
        endDate: normalizedEnd,
        isActive: Boolean(isActive || status === 'active'),
        status: isActive || status === 'active' ? 'active' : 'inactive',
      });

      await ensureDailyMenus(week);

      res.status(201).json({ success: true, message: 'هفته ایجاد شد', weekId: week._id });
    } catch (error) {
      next(error);
    }
  }

  static async createCurrentWeek(req, res, next) {
    try {
      const weeks = await ensureFutureWeeks(Number(req.body.count || 5));
      res.status(201).json({
        success: true,
        message: 'هفته جاری و هفته‌های آینده ساخته شدند',
        data: weeks.map((week) => ({
          id: week._id,
          name: week.name,
          jalaliStart: formatJalaliDate(week.startDate),
          jalaliEnd: formatJalaliDate(week.endDate),
          isActive: week.isActive,
        })),
      });
    } catch (error) {
      next(error);
    }
  }

  static async activateWeek(req, res, next) {
    try {
      const { id } = req.params;
      const week = await Week.findById(id);
      if (!week) {
        return res.status(404).json({ message: 'هفته یافت نشد' });
      }
      await Week.updateMany({}, { $set: { isActive: false, status: 'inactive' } });
      week.isActive = true;
      week.status = 'active';
      await week.save();
      await ensureDailyMenus(week);
      res.json({ success: true, message: 'هفته فعال شد' });
    } catch (error) {
      next(error);
    }
  }

  static async updateWeek(req, res, next) {
    try {
      const { id } = req.params;
      const { name, week_number, weekNumber, start_date, startDate, end_date, endDate, isActive, status } = req.body;

      const week = await Week.findById(id);
      if (!week) {
        return res.status(404).json({ message: 'هفته یافت نشد' });
      }

      if (isActive || status === 'active') {
        await Week.updateMany({ _id: { $ne: id } }, { $set: { isActive: false, status: 'inactive' } });
      }

      week.name = name ?? week.name;
      week.weekNumber = week_number || weekNumber || week.weekNumber;
      week.startDate = start_date || startDate || week.startDate;
      week.endDate = end_date || endDate || week.endDate;
      week.isActive = isActive ?? (status ? status === 'active' : week.isActive);
      week.status = week.isActive ? 'active' : 'inactive';
      await week.save();
      await ensureDailyMenus(week);

      res.json({ success: true, message: 'هفته بروزرسانی شد' });
    } catch (error) {
      next(error);
    }
  }

  static async deleteWeek(req, res, next) {
    try {
      const { id } = req.params;
      const dailyMenus = await DailyMenu.find({ weekId: id });
      const dailyMenuIds = dailyMenus.map((item) => item._id);
      const menuItems = await MenuItem.find({ dailyMenuId: { $in: dailyMenuIds } });
      const menuItemIds = menuItems.map((item) => item._id);

      await Order.deleteMany({ menuItemId: { $in: menuItemIds } });
      await MenuItem.deleteMany({ dailyMenuId: { $in: dailyMenuIds } });
      await DailyMenu.deleteMany({ weekId: id });
      await Week.findByIdAndDelete(id);

      res.json({ success: true, message: 'هفته و اطلاعات وابسته حذف شد' });
    } catch (error) {
      next(error);
    }
  }

  static async testLdapConnection(req, res, next) {
    try {
      const saved = await getSettingsLean();
      const settings = mergeLdapSettings(saved, req.body || {});
      const result = await testLdapConn(settings);
      const status = result.success ? 200 : 400;
      return res.status(status).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getFinanceSettings(req, res, next) {
    try {
      const settings = await getSettingsLean();
      const organizationSharePercent = clampPercent(settings.organizationSharePercent);
      res.json({
        success: true,
        data: {
          showFinancialStatementToUsers: settings.showFinancialStatementToUsers !== false,
          organizationSharePercent,
          personalSharePercent: 100 - organizationSharePercent,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async updateFinanceSettings(req, res, next) {
    try {
      const update = {};
      if (req.body.showFinancialStatementToUsers !== undefined) {
        update.showFinancialStatementToUsers = parseBoolean(req.body.showFinancialStatementToUsers);
      }
      if (req.body.organizationSharePercent !== undefined) {
        update.organizationSharePercent = clampPercent(req.body.organizationSharePercent);
      }

      const settings = await updateAppSettings(update);

      const organizationSharePercent = clampPercent(settings.organizationSharePercent);
      res.json({
        success: true,
        message: 'تنظیمات مالی ذخیره شد',
        data: {
          showFinancialStatementToUsers: settings.showFinancialStatementToUsers !== false,
          organizationSharePercent,
          personalSharePercent: 100 - organizationSharePercent,
        },
      });
    } catch (error) {
      if (Number(error?.code) === 40 || /would create a conflict/i.test(String(error?.message || ''))) {
        return res.status(409).json({
          success: false,
          message: 'ذخیره تنظیمات با تداخل انجام شد؛ لطفاً دوباره تلاش کنید',
        });
      }
      next(error);
    }
  }

  static async getFinanceStatements(req, res, next) {
    try {
      const settings = await getSettingsLean();
      const { type: reportType, range, title } = await resolveReportRange(req.query);
      const data = await buildAdminFinanceReport(range.start, range.end, settings, req.query, {
        type: reportType,
        title,
        range: {
          start: range.start,
          end: range.end,
          jalaliStart: formatJalaliDate(range.start),
          jalaliEnd: formatJalaliDate(range.end),
        },
      });
      res.json({ success: true, data });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ success: false, message: error.message });
      next(error);
    }
  }

  static async getFinanceMonths(req, res, next) {
    try {
      const months = await getAvailableReportMonths();
      res.json({ success: true, data: months });
    } catch (error) {
      next(error);
    }
  }

  static async getFinanceStatementPdf(req, res, next) {
    try {
      const settings = await getSettingsLean();
      const { type: reportType, range, title } = await resolveReportRange(req.query);
      const payload = await buildAdminFinancePdfPayload(
        range.start,
        range.end,
        settings,
        req.query,
        {
          type: reportType,
          title,
          range: {
            start: range.start,
            end: range.end,
            jalaliStart: formatJalaliDate(range.start),
            jalaliEnd: formatJalaliDate(range.end),
          },
        },
        { userKey: req.query.userKey || req.query.userId || '' },
      );

      const pdf = await htmlToPdfBuffer(renderFinanceStatementHtml(payload));
      const filenameUser = payload.singleUser && payload.selectedUser
        ? `finance-${payload.selectedUser.statementNumber}.pdf`
        : `finance-${payload.reportNumber}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filenameUser}"`);
      res.send(pdf);
    } catch (error) {
      if (error.status) return res.status(error.status).json({ success: false, message: error.message });
      return res.status(503).json({
        success: false,
        message: 'خطا در ساخت PDF — لطفاً دوباره تلاش کنید',
        ...(process.env.NODE_ENV !== 'production' && { detail: error.message }),
      });
    }
  }

  static async getWorkspaceSettings(req, res, next) {
    try {
      const settings = await getOrCreateSettings();
      res.json({ success: true, data: adminWorkspaceSettings(settings) });
    } catch (error) {
      next(error);
    }
  }

  static async getReportsAccess(req, res, next) {
    try {
      const data = await getReportsAccessForUser(req.user);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  static async getReportMonths(req, res, next) {
    try {
      await assertReportsAccess(req.user);
      const months = await getAvailableReportMonths();
      res.json({ success: true, data: months });
    } catch (error) {
      next(error);
    }
  }

  static async getReports(req, res, next) {
    try {
      await assertReportsAccess(req.user);
      const { type: reportType, range, title } = await resolveReportRange(req.query);
      const report = await buildReport(range.start, range.end);

      res.json({
        success: true,
        data: {
          type: reportType,
          title,
          range: {
            start: range.start,
            end: range.end,
            jalaliStart: formatJalaliDate(range.start),
            jalaliEnd: formatJalaliDate(range.end),
          },
          ...report,
        },
      });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ success: false, message: error.message });
      next(error);
    }
  }

  static async getReportPdf(req, res, next) {
    try {
      await assertReportsAccess(req.user);
      const { type: reportType, range, title } = await resolveReportRange(req.query);
      const [report, settings, reportNumber] = await Promise.all([
        buildReport(range.start, range.end),
        getSettingsLean(),
        nextReportNumber(),
      ]);
      const payload = {
        type: reportType,
        title,
        reportNumber,
        organizationName: settings?.organizationName || 'سامانه تغذیه سازمانی',
        range: {
          start: range.start,
          end: range.end,
          jalaliStart: formatJalaliDate(range.start),
          jalaliEnd: formatJalaliDate(range.end),
        },
        ...report,
      };

      const pdf = await htmlToPdfBuffer(renderReportHtml(payload));
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="food-report-${reportNumber}.pdf"`);
      res.send(pdf);
    } catch (error) {
      if (error.status && error.expose) {
        return res.status(error.status).json({ success: false, message: error.message });
      }
      if (error.status) {
        return res.status(error.status).json({ success: false, message: error.message });
      }
      return res.status(503).json({
        success: false,
        message: 'خطا در ساخت PDF — لطفاً دوباره تلاش کنید',
        ...(process.env.NODE_ENV !== 'production' && { detail: error.message }),
      });
    }
  }

  static async getSupplierReport(req, res, next) {
    try {
      await assertReportsAccess(req.user);
      const { range, title } = await resolveReportRange({
        ...req.query,
        type: 'week',
      });
      const report = await buildReport(range.start, range.end);

      res.json({
        success: true,
        data: {
          type: 'supplier',
          title: `گزارش آماده‌سازی غذا — ${title}`,
          range: {
            start: range.start,
            end: range.end,
            jalaliStart: formatJalaliDate(range.start),
            jalaliEnd: formatJalaliDate(range.end),
          },
          byDayPrep: report.byDayPrep,
          prepTotals: report.prepTotals,
        },
      });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ success: false, message: error.message });
      next(error);
    }
  }

  static async getSupplierReportPdf(req, res, next) {
    try {
      await assertReportsAccess(req.user);
      const { range, title } = await resolveReportRange({
        ...req.query,
        type: 'week',
      });
      const [report, settings, reportNumber] = await Promise.all([
        buildReport(range.start, range.end),
        getSettingsLean(),
        nextSupplierReportNumber(),
      ]);
      const payload = {
        type: 'supplier',
        title: `گزارش آماده‌سازی غذا — ${title}`,
        reportNumber,
        organizationName: settings?.organizationName || 'سامانه تغذیه سازمانی',
        range: {
          start: range.start,
          end: range.end,
          jalaliStart: formatJalaliDate(range.start),
          jalaliEnd: formatJalaliDate(range.end),
        },
        byDayPrep: report.byDayPrep,
        prepTotals: report.prepTotals,
      };

      const pdf = await htmlToPdfBuffer(renderSupplierReportHtml(payload));
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="supplier-report-${reportNumber}.pdf"`);
      res.send(pdf);
    } catch (error) {
      if (error.status && error.expose) {
        return res.status(error.status).json({ success: false, message: error.message });
      }
      if (error.status) {
        return res.status(error.status).json({ success: false, message: error.message });
      }
      return res.status(503).json({
        success: false,
        message: 'خطا در ساخت PDF — لطفاً دوباره تلاش کنید',
        ...(process.env.NODE_ENV !== 'production' && { detail: error.message }),
      });
    }
  }

  static async exportBackup(req, res, next) {
    try {
      const actor = req.user?.fullName || req.user?.username || '';
      const { buffer, counts } = await createBackupBuffer(actor);
      const stamp = new Date().toISOString().slice(0, 10);
      const filename = `sazman-food-backup-${stamp}.fzbackup`;

      await writeSecurityLog(req, 'backup_export', null, 'خروجی پشتیبان سامانه', {
        actorId: req.user?.id,
        counts,
      });

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      res.send(buffer);
    } catch (error) {
      next(error);
    }
  }

  static async restoreBackup(req, res, next) {
    try {
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ success: false, message: 'فایل پشتیبان ارسال نشده است.' });
      }

      const payload = readBackupBuffer(req.file.buffer);
      const result = await restoreBackup(payload);

      await writeSecurityLog(req, 'backup_restore', null, 'بازیابی داده از فایل پشتیبان', {
        actorId: req.user?.id,
        summary: result.summary,
        backupCreatedAt: result.createdAt,
      });

      res.json({
        success: true,
        message: 'بازیابی با موفقیت انجام شد. داده‌های سامانه از فایل پشتیبان بازگردانده شدند.',
        data: result,
      });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ success: false, message: error.message });
      next(error);
    }
  }

  static async getSslStatus(req, res, next) {
    try {
      res.json({ success: true, data: getSslStatus() });
    } catch (error) {
      next(error);
    }
  }

  static async uploadSslCertificate(req, res, next) {
    try {
      const certFile = req.files?.certificate?.[0];
      const keyFile = req.files?.privateKey?.[0];
      if (!certFile?.buffer?.length || !keyFile?.buffer?.length) {
        return res.status(400).json({ success: false, message: 'فایل گواهی (.crt/.pem) و کلید خصوصی (.key) الزامی است.' });
      }

      await saveCustomCertificate(certFile.buffer, keyFile.buffer);
      const applied = await applyCustomCertificate();
      await refreshOriginPublicUrlCache();

      res.json({
        success: true,
        message: 'گواهی SSL نصب شد. Nginx و سرویس بروزرسانی شدند.',
        data: { ...getSslStatus(), apply: applied },
      });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ success: false, message: error.message });
      next(error);
    }
  }
}

module.exports = AdminController;
module.exports.ensureCurrentWeek = ensureCurrentWeek;
module.exports.ensureFutureWeeks = ensureFutureWeeks;
