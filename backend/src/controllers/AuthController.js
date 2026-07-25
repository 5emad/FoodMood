const crypto = require('crypto');
const User = require('../models/User');
const { hashPassword, comparePassword, compareSensitiveToken } = require('../helpers/SecurityHelper');
const { generateToken, generateLdapToken } = require('../helpers/TokenHelper');
const LdapHelper = require('../helpers/LdapHelper');
const { getSettingsLean } = require('../services/SettingsService');
const {
  needsProfileSetup,
  saveFullName: saveLdapFullName,
  resolveDisplayName,
  resolveLdapRole,
  isProfileActive,
  isValidPersianFullName,
  findProfile,
  markConvertedToLocal,
} = require('../helpers/LdapProfileHelper');
const { writeSecurityLog } = require('../services/SecurityLogService');
const {
  commitAuthenticatedSession,
  getSessionPolicy,
  touchSessionActivity,
  invalidateSession,
} = require('../helpers/SessionSecurityHelper');
const { setAuthCookies } = require('../helpers/AuthCookieHelper');
const { issueSession, revokeUserSessions } = require('../services/SessionTokenService');

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MS   = 30 * 60 * 1000; // 30 min
const PASSWORD_MIN_LEN   = 8;
const SUPER_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const LOCAL_AUTH_ROLES = ['user', 'admin', 'superadmin'];

function validatePasswordChangePayload({ newPassword, confirmPassword }) {
  if (!newPassword || newPassword.length < PASSWORD_MIN_LEN) {
    return `رمز جدید باید حداقل ${PASSWORD_MIN_LEN} کاراکتر باشد`;
  }
  if (newPassword !== confirmPassword) {
    return 'رمز جدید با تکرار آن همخوانی ندارد';
  }
  if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    return 'رمز عبور باید شامل حداقل یک حرف و یک عدد باشد';
  }
  return null;
}

function normalizePhone(value) {
  if (value === undefined || value === null) return undefined;
  const phone = String(value).trim();
  return phone || null;
}

function buildSessionData(user, token, sessionId) {
  const base = {
    token,
    sessionId,
    userRole: user.role,
    username: user.username,
    fullName: user.fullName,
  };
  if (user.authSource === 'ldap') {
    return {
      ...base,
      authSource: 'ldap',
      userId: null,
      email: user.email || null,
      department: user.department || null,
    };
  }
  return {
    ...base,
    authSource: 'local',
    userId: String(user._id || user.id),
  };
}

async function handleFailedLogin(user) {
  if (!user) return;
  const attempts = (user.loginAttempts || 0) + 1;
  const update = { loginAttempts: attempts };
  if (attempts >= MAX_LOGIN_ATTEMPTS) {
    update.lockUntil = new Date(Date.now() + LOCK_DURATION_MS);
  }
  await User.findByIdAndUpdate(user._id, update);
}

async function handleSuccessfulLogin(user, sessionId, req) {
  return issueSession({
    userId: user._id,
    authSource: 'local',
    sessionId,
    req,
  });
}

class AuthController {
  static async register(_req, res) {
    return res.status(403).json({
      success: false,
      message: 'ثبت نام عمومی غیرفعال است. ورود کاربران فقط از طریق Active Directory انجام می‌شود.',
    });
  }

  /**
   * مرحله ۱ ورود: همیشه فیلد رمز را نشان می‌دهد (ضد افشای وجود کاربر).
   * اعتبارسنجی واقعی فقط در login انجام می‌شود.
   */
  static async resolveUsername(req, res, next) {
    try {
      const identifier = String(req.body.username || req.body.email || '').trim();
      if (!identifier) {
        return res.status(400).json({ success: false, message: 'نام کاربری را وارد کنید' });
      }
      if (typeof req.body.username !== 'string' && typeof req.body.email !== 'string') {
        return res.status(400).json({ success: false, message: 'ورودی نامعتبر' });
      }

      let username = identifier;
      try {
        const user = await User.findOne({
          $or: [
            { username: identifier },
            { email: identifier.toLowerCase() },
            { phone: identifier },
          ],
        }).select('username');
        if (user?.username) {
          username = user.username;
        } else {
          const profile = await findProfile(identifier.toLowerCase());
          if (profile?.ldapUsername) username = profile.ldapUsername;
        }
      } catch {
        // نادیده — نرمال‌سازی اختیاری است؛ همیشه به مرحله رمز می‌رویم
      }

      return res.json({
        success: true,
        exists: true,
        username,
        showPassword: true,
      });
    } catch (error) {
      next(error);
    }
  }

  static async login(req, res, next) {
    try {
      const identifier = String(req.body.username || req.body.email || '').trim();
      const password   = typeof req.body.password === 'string' ? req.body.password : '';

      if (!identifier || !password) {
        return res.status(400).json({ message: 'نام کاربری و رمز عبور الزامی هستند' });
      }

      // Sanitise: reject objects masquerading as strings (NoSQL injection guard)
      if (typeof req.body.username !== 'string' && typeof req.body.email !== 'string') {
        return res.status(400).json({ message: 'ورودی نامعتبر' });
      }

      const user = await User.findOne({
        $or: [
          { username: identifier },
          { email: identifier.toLowerCase() },
          { phone: identifier },
        ],
      }).select('+password');

      // Account lock check — return the generic auth failure so probing a
      // username cannot confirm the account exists (anti-enumeration).
      if (user?.isLocked) {
        await writeSecurityLog(req, 'login_failed', user, 'Login attempt on locked account');
        return res.status(401).json({ message: 'اطلاعات وارد شده صحیح نیست' });
      }

      const settings = await getSettingsLean();

      // Any active local account with ldapUser=false uses app password and skips AD.
      const canUseLocalAuth = Boolean(
        user && !user.ldapUser && LOCAL_AUTH_ROLES.includes(user.role),
      );

      // ── Local auth first (admins + converted employees) ──────────────────────
      if (canUseLocalAuth) {
        if (!(await comparePassword(password, user.password))) {
          await handleFailedLogin(user);
          await writeSecurityLog(req, 'login_failed', user, 'Local password mismatch');
          if ((user.loginAttempts || 0) + 1 >= MAX_LOGIN_ATTEMPTS) {
            await writeSecurityLog(req, 'account_locked', user, 'Account locked after repeated failed logins');
          }
          return res.status(401).json({ message: 'اطلاعات وارد شده صحیح نیست' });
        }

        if (user.status !== 'active') {
          return res.status(401).json({ message: 'اطلاعات وارد شده صحیح نیست' });
        }

        const sessionId = crypto.randomUUID();

        if (user.role === 'superadmin') {
          req.session.pendingSuperLogin = {
            userId: String(user._id),
            sessionId,
            createdAt: Date.now(),
          };
          await writeSecurityLog(req, 'super_token_required', user, 'Superadmin second factor required');
          return res.json({
            success: false,
            tokenRequired: true,
            message: 'توکن امنیتی سوپر ادمین را وارد کنید',
          });
        }

        await handleSuccessfulLogin(user, sessionId, req);
        await writeSecurityLog(req, 'login_success', user, 'Local login success');

        const token = generateToken(user._id, user.email, user.role, user.username, sessionId);
        await commitAuthenticatedSession(req, buildSessionData(user, token, sessionId));
        setAuthCookies(res, { token, role: user.role });

        return res.json({
          success: true,
          message: 'ورود موفقیت‌آمیز بود',
          user: {
            id:                String(user._id),
            username:          user.username,
            fullName:          user.fullName,
            email:             user.email,
            phone:             user.phone,
            role:              user.role,
            authSource:        'local',
            isLocalAuth:       true,
            mustSetFullName:   user.mustSetFullName,
            mustChangePassword:user.mustChangePassword,
          },
        });
      }

      // ── LDAP path (بدون ذخیره در دیتابیس) ───────────────────────────────────
      if (!canUseLocalAuth && LdapHelper.isEnabled(settings || {})) {
        const ldapResult = await LdapHelper.authenticate(identifier, password, settings || {});
        if (ldapResult) {
          if (!(await isProfileActive(ldapResult.username))) {
            await writeSecurityLog(req, 'login_failed', null, 'Inactive LDAP profile login blocked', {
              username: ldapResult.username,
            });
            return res.status(401).json({ message: 'اطلاعات وارد شده صحیح نیست' });
          }
          const sessionId = await issueSession({
            username: ldapResult.username,
            authSource: 'ldap',
            req,
          });
          const mustSetFullName = await needsProfileSetup(ldapResult.username);
          const displayName = mustSetFullName
            ? ldapResult.username
            : await resolveDisplayName(ldapResult.username, ldapResult.displayName || ldapResult.username);
          const ldapRole = await resolveLdapRole(ldapResult.username);
          const ldapUser = {
            authSource: 'ldap',
            id: `ldap:${ldapResult.username}`,
            username: ldapResult.username,
            fullName: displayName,
            email: ldapResult.email || null,
            department: ldapResult.department || null,
            role: ldapRole,
          };

          await writeSecurityLog(req, 'login_success', null, 'LDAP login success', {
            username: ldapUser.username,
          });

          const token = generateLdapToken({
            username: ldapUser.username,
            email: ldapUser.email,
            fullName: ldapUser.fullName,
            department: ldapUser.department,
            sessionId,
            role: ldapUser.role,
          });
          await commitAuthenticatedSession(req, buildSessionData(ldapUser, token, sessionId));
          setAuthCookies(res, { token, role: ldapUser.role });

          return res.json({
            success: true,
            message: 'ورود موفقیت‌آمیز بود',
            user: {
              id: ldapUser.id,
              username: ldapUser.username,
              fullName: ldapUser.fullName,
              email: ldapUser.email,
              role: ldapUser.role,
              department: ldapUser.department,
              authSource: 'ldap',
              isLocalAuth: false,
              mustSetFullName,
            },
          });
        }
      }

      // ── Final auth failure handling ──────────────────────────────────────────
      // Uniform message for every failure path so responses cannot be used to
      // enumerate valid usernames, roles, or auth sources.
      if (!user) {
        await writeSecurityLog(req, 'login_failed', null, 'Unknown username login failure', { username: identifier });
      } else if (user.ldapUser) {
        await writeSecurityLog(req, 'login_failed', user, 'LDAP-flagged user local path skipped');
      } else {
        await handleFailedLogin(user);
        await writeSecurityLog(req, 'login_failed', user, 'Final login failure');
      }
      return res.status(401).json({ message: 'اطلاعات وارد شده صحیح نیست' });
    } catch (error) {
      next(error);
    }
  }

  static async verifySuperToken(req, res, next) {
    try {
      const pending = req.session?.pendingSuperLogin;
      const raw = req.body.token ?? req.body.superToken;
      const token = typeof raw === 'string' ? raw.trim() : '';
      if (!pending || !pending.userId || Date.now() - Number(pending.createdAt || 0) > SUPER_CHALLENGE_TTL_MS) {
        if (req.session) delete req.session.pendingSuperLogin;
        return res.status(401).json({ success: false, message: 'نشست ورود سوپر ادمین منقضی شده است. دوباره وارد شوید.' });
      }
      if (!/^[A-Za-z0-9._~!@#$%^&*+=-]{12,160}$/.test(token)) {
        return res.status(400).json({ success: false, message: 'فرمت توکن امنیتی معتبر نیست' });
      }

      const user = await User.findById(pending.userId).select('+superTokenHash');
      if (!user || user.status !== 'active' || user.role !== 'superadmin' || !user.superTokenHash) {
        return res.status(403).json({ success: false, message: 'دسترسی سوپر ادمین معتبر نیست' });
      }

      if (user.isLocked) {
        if (req.session) delete req.session.pendingSuperLogin;
        const minutesLeft = Math.ceil((user.lockUntil - Date.now()) / 60000);
        return res.status(423).json({
          success: false,
          message: `حساب کاربری به دلیل تلاش‌های ناموفق قفل شده است. ${minutesLeft} دقیقه دیگر تلاش کنید.`,
        });
      }

      if (!compareSensitiveToken(token, user.superTokenHash)) {
        await handleFailedLogin(user);
        await writeSecurityLog(req, 'super_token_failed', user, 'Invalid superadmin token');
        if ((user.loginAttempts || 0) + 1 >= MAX_LOGIN_ATTEMPTS) {
          await writeSecurityLog(req, 'account_locked', user, 'Superadmin locked after repeated token failures');
          if (req.session) delete req.session.pendingSuperLogin;
        }
        return res.status(401).json({ success: false, message: 'توکن امنیتی اشتباه است' });
      }

      const sessionId = pending.sessionId || crypto.randomUUID();
      await handleSuccessfulLogin(user, sessionId, req);
      user.superTokenLastUsedAt = new Date();
      await user.save();

      const jwt = generateToken(user._id, user.email, user.role, user.username, sessionId);
      await commitAuthenticatedSession(req, buildSessionData(user, jwt, sessionId));
      setAuthCookies(res, { token: jwt, role: user.role });
      delete req.session.pendingSuperLogin;
      await writeSecurityLog(req, 'super_token_success', user, 'Superadmin token accepted');
      await writeSecurityLog(req, 'login_success', user, 'Superadmin login success');

      return res.json({
        success: true,
        message: 'ورود سوپر ادمین با موفقیت انجام شد',
        user: {
          id: String(user._id),
          username: user.username,
          fullName: user.fullName,
          email: user.email,
          role: user.role,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async setFullName(req, res, next) {
    try {
      const fullName = String(req.body.fullName || '').trim();
      const departmentId = String(req.body.departmentId || '').trim();
      if (!fullName) {
        return res.status(400).json({ message: 'نام کامل الزامی است' });
      }

      if (!isValidPersianFullName(fullName)) {
        return res.status(400).json({ message: 'لطفا نام و نام خانوادگی خود را به فارسی وارد کنید' });
      }

      if (!departmentId) {
        return res.status(400).json({ message: 'انتخاب واحد الزامی است' });
      }

      const Department = require('../models/Department');
      const department = await Department.findById(departmentId).select('name').lean();
      if (!department) {
        return res.status(400).json({ message: 'واحد انتخاب‌شده معتبر نیست' });
      }

      if (req.user?.authSource === 'ldap') {
        await saveLdapFullName(req.user.username, fullName, department._id);
        const sessionId = req.user.sessionId || req.session?.sessionId;
        const ldapRole = await resolveLdapRole(req.user.username);
        const ldapUser = {
          authSource: 'ldap',
          id: req.user.id,
          username: req.user.username,
          fullName,
          email: req.user.email || null,
          department: department.name,
          role: ldapRole,
        };
        const token = generateLdapToken({
          username: ldapUser.username,
          email: ldapUser.email,
          fullName,
          department: department.name,
          sessionId,
          role: ldapRole,
        });
        await commitAuthenticatedSession(req, buildSessionData(ldapUser, token, sessionId));
        setAuthCookies(res, { token, role: ldapRole });
        return res.json({ success: true, message: 'پروفایل با موفقیت تکمیل شد' });
      }

      const user = await User.findById(req.user.id);
      if (!user) return res.status(404).json({ message: 'کاربر یافت نشد' });

      user.fullName = fullName;
      user.departmentId = department._id;
      user.mustSetFullName = false;
      await user.save();

      if (req.session) {
        req.session.fullName = fullName;
        req.session.departmentId = String(department._id);
      }

      return res.json({ success: true, message: 'پروفایل با موفقیت تکمیل شد' });
    } catch (error) {
      if (Number(error.status) > 0 && Number(error.status) < 500) return res.status(error.status).json({ message: error.message });
      next(error);
    }
  }

  static async logout(req, res, next) {
    try {
      const username = req.session?.username || req.user?.username;
      await writeSecurityLog(req, 'logout_success', null, 'User logout', { username });

      await invalidateSession(req, res, 'logout');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      return res.json({ success: true, message: 'خروج موفقیت‌آمیز بود' });
    } catch (error) {
      next(error);
    }
  }

  static async ping(req, res) {
    touchSessionActivity(req);
    return res.json({
      success: true,
      policy: getSessionPolicy(),
      lastActivityAt: req.session?.lastActivityAt || null,
    });
  }

  static async getCurrentUser(req, res, next) {
    try {
      if (req.user?.authSource === 'ldap') {
        const mustSetFullName = await needsProfileSetup(req.user.username);
        const profile = await findProfile(req.user.username);
        const fullName = mustSetFullName
          ? req.user.fullName
          : await resolveDisplayName(req.user.username, req.user.fullName);
        const departmentName = profile?.departmentId?.name
          || profile?.department
          || req.user.department
          || null;
        return res.json({
          success: true,
          user: {
            id: req.user.id,
            username: req.user.username,
            fullName,
            email: profile?.email || req.user.email || null,
            phone: profile?.phone || null,
            department: departmentName ? { name: departmentName } : null,
            role: req.user.role,
            authSource: 'ldap',
            isLocalAuth: false,
            mustSetFullName,
          },
        });
      }

      const user = await User.findById(req.user.id).populate('departmentId').lean();
      if (!user) return res.status(404).json({ message: 'کاربر یافت نشد' });

      return res.json({
        success: true,
        user: {
          id:                String(user._id),
          username:          user.username,
          fullName:          user.fullName,
          email:             user.email,
          phone:             user.phone,
          department:        user.departmentId,
          role:              user.role,
          authSource:        'local',
          isLocalAuth:       true,
          mustChangePassword:user.mustChangePassword,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async updateProfile(req, res, next) {
    try {
      const fullNameRaw = req.body.fullName !== undefined
        ? String(req.body.fullName || '').trim()
        : undefined;
      const phone = normalizePhone(req.body.phone);

      if (fullNameRaw !== undefined) {
        if (!isValidPersianFullName(fullNameRaw)) {
          return res.status(400).json({
            success: false,
            message: 'لطفا نام و نام خانوادگی خود را به فارسی وارد کنید',
          });
        }
      }

      if (req.user?.authSource === 'ldap') {
        const profile = await findProfile(req.user.username);
        const update = {};
        if (fullNameRaw !== undefined) update.fullName = fullNameRaw;
        if (phone !== undefined) update.phone = phone;

        if (Object.keys(update).length === 0) {
          return res.status(400).json({ success: false, message: 'هیچ فیلدی برای به‌روزرسانی ارسال نشده است' });
        }

        const LdapProfile = require('../models/LdapProfile');
        const username = String(req.user.username || '').trim().toLowerCase();
        const saved = await LdapProfile.findOneAndUpdate(
          { ldapUsername: username },
          {
            $set: { ...update, updatedAt: new Date() },
            $setOnInsert: {
              ldapUsername: username,
              fullName: fullNameRaw || req.user.fullName || username,
              status: 'active',
            },
          },
          { upsert: true, new: true, lean: true },
        ).populate('departmentId', 'name');

        const sessionId = req.user.sessionId || req.session?.sessionId;
        const ldapRole = await resolveLdapRole(req.user.username);
        const displayName = saved?.fullName || fullNameRaw || req.user.fullName;
        const departmentName = saved?.departmentId?.name || saved?.department || req.user.department || null;
        const ldapUser = {
          authSource: 'ldap',
          id: req.user.id,
          username: req.user.username,
          fullName: displayName,
          email: saved?.email || req.user.email || null,
          department: departmentName,
          role: ldapRole,
        };
        const token = generateLdapToken({
          username: ldapUser.username,
          email: ldapUser.email,
          fullName: displayName,
          department: departmentName,
          sessionId,
          role: ldapRole,
        });
        await commitAuthenticatedSession(req, buildSessionData(ldapUser, token, sessionId));
        setAuthCookies(res, { token, role: ldapRole });

        return res.json({
          success: true,
          message: 'پروفایل به‌روزرسانی شد',
          user: {
            id: ldapUser.id,
            username: ldapUser.username,
            fullName: displayName,
            email: ldapUser.email,
            phone: saved?.phone || null,
            department: departmentName ? { name: departmentName } : null,
            role: ldapRole,
            authSource: 'ldap',
            isLocalAuth: false,
          },
        });
      }

      const user = await User.findById(req.user.id);
      if (!user) return res.status(404).json({ success: false, message: 'کاربر یافت نشد' });

      if (fullNameRaw !== undefined) user.fullName = fullNameRaw;
      if (phone !== undefined) user.phone = phone || undefined;
      await user.save();

      if (req.session) {
        if (fullNameRaw !== undefined) req.session.fullName = fullNameRaw;
      }

      const populated = await User.findById(user._id).populate('departmentId').lean();
      return res.json({
        success: true,
        message: 'پروفایل به‌روزرسانی شد',
        user: {
          id: String(populated._id),
          username: populated.username,
          fullName: populated.fullName,
          email: populated.email,
          phone: populated.phone,
          department: populated.departmentId,
          role: populated.role,
          authSource: 'local',
          isLocalAuth: true,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async changePassword(req, res, next) {
    try {
      const { oldPassword, currentPassword, newPassword, confirmPassword } = req.body;
      const current = String(oldPassword || currentPassword || '');

      const validationError = validatePasswordChangePayload({ newPassword, confirmPassword });
      if (validationError) {
        return res.status(400).json({ message: validationError });
      }

      // ── LDAP session: verify AD password, then convert to local User ─────────
      if (req.user?.authSource === 'ldap') {
        const username = String(req.user.username || '').trim();
        if (!username || !current) {
          return res.status(400).json({ message: 'رمز عبور فعلی الزامی است' });
        }

        const settings = await getSettingsLean();
        if (!LdapHelper.isEnabled(settings || {})) {
          return res.status(400).json({ message: 'تغییر رمز در حال حاضر در دسترس نیست' });
        }

        const ldapResult = await LdapHelper.authenticate(username, current, settings || {});
        if (!ldapResult) {
          return res.status(400).json({ message: 'رمز عبور فعلی اشتباه است' });
        }

        const profile = await findProfile(username);
        const hashed = await hashPassword(newPassword);
        const displayName = (profile?.fullName && isValidPersianFullName(profile.fullName))
          ? profile.fullName
          : (req.user.fullName || username);
        const email = profile?.email || req.user.email || undefined;
        const phone = profile?.phone || undefined;
        const departmentId = profile?.departmentId?._id || profile?.departmentId || undefined;
        const ldapRole = await resolveLdapRole(username);
        const role = ['admin', 'superadmin'].includes(ldapRole) ? ldapRole : 'user';

        let localUser = await User.findOne({ username }).select('+password');
        if (localUser) {
          localUser.password = hashed;
          localUser.ldapUser = false;
          localUser.status = 'active';
          localUser.mustChangePassword = false;
          localUser.fullName = displayName;
          if (email) localUser.email = email;
          if (phone !== undefined) localUser.phone = phone;
          if (departmentId) localUser.departmentId = departmentId;
          if (!['admin', 'superadmin'].includes(localUser.role)) {
            localUser.role = role;
          }
          localUser.activeSessionId = null;
          await localUser.save();
        } else {
          localUser = await User.create({
            username,
            email: email || undefined,
            fullName: displayName,
            password: hashed,
            phone: phone || undefined,
            departmentId: departmentId || null,
            role,
            status: 'active',
            ldapUser: false,
            mustChangePassword: false,
            mustSetFullName: false,
          });
        }

        await markConvertedToLocal(username);
        await revokeUserSessions({
          username,
          authSource: 'ldap',
          reason: 'converted_to_local',
          revokeAll: true,
        });
        await revokeUserSessions({
          userId: localUser._id,
          authSource: 'local',
          reason: 'converted_to_local',
          revokeAll: true,
        });

        await writeSecurityLog(req, 'password_change', localUser, 'LDAP user converted to local auth', {
          username,
        });

        await invalidateSession(req, res, 'password_change');
        return res.json({
          success: true,
          convertedToLocal: true,
          message: 'رمز عبور تغییر کرد. لطفاً دوباره وارد شوید.',
        });
      }

      // ── Local user password change ───────────────────────────────────────────
      const user = await User.findById(req.user.id).select('+password');
      if (!user) return res.status(404).json({ message: 'کاربر یافت نشد' });

      if (!(await comparePassword(current, user.password))) {
        return res.status(400).json({ message: 'رمز عبور فعلی اشتباه است' });
      }

      user.password           = await hashPassword(newPassword);
      user.mustChangePassword = false;
      await revokeUserSessions({ userId: user._id, authSource: 'local', reason: 'password_change', revokeAll: true });
      user.activeSessionId    = null;
      await user.save();

      await invalidateSession(req, res, 'password_change');
      return res.json({ success: true, message: 'رمز عبور تغییر کرد. لطفاً دوباره وارد شوید.' });
    } catch (error) {
      next(error);
    }
  }

}

module.exports = AuthController;
