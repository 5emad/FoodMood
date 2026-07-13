const crypto = require('crypto');
const User = require('../models/User');
const Week = require('../models/Week');
const Food = require('../models/Food');
const Order = require('../models/Order');
const Department = require('../models/Department');
const DailyMenu = require('../models/DailyMenu');
const MenuItem = require('../models/MenuItem');
const AppSetting = require('../models/AppSetting');
const SecurityLog = require('../models/SecurityLog');
const { hashPassword, escapeRegex, hashSensitiveToken, validatePasswordPolicy } = require('../helpers/SecurityHelper');
const { testConnection: testLdapConn, validateConfig: validateLdapConfig, ldapConfig } = require('../helpers/LdapHelper');
const { mergeLdapSettings, ldapFieldsFromBody } = require('../helpers/LdapSettingsHelper');
const { startOfDay, formatJalaliDate } = require('../helpers/DateHelper');
const { finalizeExpiredOrders } = require('../helpers/OrderStatusHelper');
const { htmlToPdfBuffer } = require('../helpers/PdfHelper');
const { paginationFromQuery, paginationMeta } = require('../helpers/PaginationHelper');
const { defaultSettings, publicSettings, getOrCreateSettings, getSettingsLean } = require('../services/SettingsService');
const { writeSecurityLog } = require('../services/SecurityLogService');
const { ensureDailyMenus, ensureCurrentWeek, ensureFutureWeeks } = require('../services/WeekService');
const { resolveReportRange, buildReport, getAvailableReportMonths } = require('../services/ReportService');
const { createBackupBuffer, readBackupBuffer, restoreBackup } = require('../services/BackupService');
const { renderReportHtml } = require('../views/ReportPdfView');
const { refreshPublicUrlCache, normalizePublicUrl } = require('../helpers/AppUrlHelper');
const { refreshOriginPublicUrlCache } = require('../middleware/originGuard');

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

async function countActiveAdmins(excludeId = null) {
  const filter = { role: { $in: ['admin', 'superadmin'] }, status: 'active' };
  if (excludeId) filter._id = { $ne: excludeId };
  return User.countDocuments(filter);
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
      if (req.body.showPricesToUsers !== undefined) update.showPricesToUsers = Boolean(req.body.showPricesToUsers);
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
      Object.assign(update, ldapFieldsFromBody(req.body));

      if (update.ldapEnabled) {
        const savedSettings = await getSettingsLean();
        const candidate = { ...savedSettings, ...update };
        const validation = validateLdapConfig(ldapConfig(candidate));
        if (!validation.valid) {
          return res.status(400).json({ success: false, message: validation.message });
        }
      }

      await AppSetting.updateOne(
        { key: 'default' },
        { $setOnInsert: defaultSettings },
        { upsert: true }
      );

      const settings = await AppSetting.findOneAndUpdate(
        { key: 'default' },
        { $set: update },
        { new: true }
      );
      if (update.publicUrl !== undefined) {
        refreshPublicUrlCache(settings.publicUrl);
        await refreshOriginPublicUrlCache();
      }
      res.json({ success: true, message: 'تنظیمات بروزرسانی شد', data: publicSettings(settings) });
    } catch (error) {
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
      if (role) filter.role = role;
      if (department === 'none') filter.departmentId = null;
      else if (department) filter.departmentId = department;

      const pageInfo = paginationFromQuery(req.query, { limit: 20, maxLimit: 200 });
      const [users, total] = await Promise.all([
        User.find(filter)
          .select('-password')
          .populate('departmentId')
          .sort({ createdAt: -1 })
          .skip(pageInfo.skip)
          .limit(pageInfo.limit),
        User.countDocuments(filter),
      ]);

      res.json({
        success: true,
        data: users,
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
      const lockedUsers = await User.find({ lockUntil: { $gt: new Date() } })
        .select('username fullName email role status loginAttempts lockUntil')
        .sort({ lockUntil: -1 })
        .lean();

      const recentLogs = await SecurityLog.find({})
        .sort({ createdAt: -1 })
        .limit(120)
        .lean();

      const failedSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const failedAgg = await SecurityLog.aggregate([
        { $match: { type: { $in: ['login_failed', 'super_token_failed'] }, createdAt: { $gte: failedSince } } },
        { $group: { _id: '$username', count: { $sum: 1 }, lastAt: { $max: '$createdAt' }, ip: { $last: '$ip' } } },
        { $sort: { count: -1, lastAt: -1 } },
        { $limit: 20 },
      ]);

      res.json({
        success: true,
        data: {
          lockedUsers,
          recentLogs,
          failedSummary: failedAgg.filter(item => item._id),
          unreadCount: recentLogs.filter(log => ['account_locked', 'super_token_failed', 'login_failed'].includes(log.type)).length,
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
      const departments = await Department.aggregate([
        { $lookup: { from: 'users', localField: '_id', foreignField: 'departmentId', as: 'users' } },
        { $project: { name: 1, createdAt: 1, userCount: { $size: '$users' } } },
        { $sort: { name: 1 } },
      ]);
      res.json({ success: true, data: departments });
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
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getReportMonths(req, res, next) {
    try {
      const months = await getAvailableReportMonths();
      res.json({ success: true, data: months });
    } catch (error) {
      next(error);
    }
  }

  static async getReports(req, res, next) {
    try {
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
      if (error.status) return res.status(error.status).json({ message: error.message });
      next(error);
    }
  }

  static async getReportPdf(req, res, next) {
    try {
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
      if (error.status) return res.status(error.status).json({ message: error.message });
      next(error);
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
}

module.exports = AdminController;
module.exports.ensureCurrentWeek = ensureCurrentWeek;
module.exports.ensureFutureWeeks = ensureFutureWeeks;
