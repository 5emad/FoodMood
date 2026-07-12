const User = require('../models/User');
const AppSetting = require('../models/AppSetting');
const { comparePassword } = require('../helpers/SecurityHelper');
const { generateToken } = require('../helpers/TokenHelper');
const crypto = require('crypto');
const {
  assertActiveSession,
  commitAuthenticatedSession,
  invalidateSession,
} = require('../helpers/SessionSecurityHelper');

class ViewController {
  static async renderLogin(req, res, next) {
    if (req.session?.token) {
      const sessionCheck = assertActiveSession(req);
      if (!sessionCheck.ok) {
        await invalidateSession(req, res, sessionCheck.reason);
        const settings = await AppSetting.findOne({ key: 'default' }).lean().catch(() => null);
        return res.render('auth/login', {
          organizationName: settings?.organizationName || 'سامانه تغذیه',
          expired: sessionCheck.reason !== 'idle',
          idle: sessionCheck.reason === 'idle',
        });
      }
      return res.redirect(['admin', 'superadmin'].includes(req.session.userRole) ? '/admin/dashboard' : '/user/dashboard');
    }

    try {
      const settings = await AppSetting.findOne({ key: 'default' }).lean();
      return res.render('auth/login', {
        organizationName: settings?.organizationName || 'سامانه تغذیه',
        expired: req.query.expired === '1',
        idle: req.query.idle === '1',
      });
    } catch (error) {
      return next(error);
    }
  }

  static async login(req, res, next) {
    try {
      const identifier = String(req.body.username || req.body.email || '').trim();
      const password = typeof req.body.password === 'string' ? req.body.password : '';
      const user = await User.findOne({
        $or: [
          { username: identifier },
          { email: identifier.toLowerCase() },
          { phone: identifier },
        ],
      });

      const loginView = (status, error) => res.status(status).render('auth/login', {
        error,
        organizationName: 'سامانه تغذیه',
        expired: false,
        idle: false,
      });

      if (user?.isLocked) {
        const min = Math.ceil((user.lockUntil - Date.now()) / 60000);
        return loginView(423, `حساب کاربری قفل شده است. ${min} دقیقه دیگر تلاش کنید.`);
      }

      if (!user || !(await comparePassword(password, user.password))) {
        if (user) {
          const attempts = (user.loginAttempts || 0) + 1;
          const update = { loginAttempts: attempts };
          if (attempts >= 5) update.lockUntil = new Date(Date.now() + 30 * 60 * 1000);
          await User.findByIdAndUpdate(user._id, update);
        }
        return loginView(401, 'اطلاعات ورود صحیح نیست');
      }

      if (user && !['admin', 'superadmin'].includes(user.role)) {
        return loginView(401, 'ورود کاربران فقط از طریق Active Directory انجام می‌شود');
      }
      if (user.status !== 'active') return loginView(403, 'حساب کاربری شما غیرفعال است');
      if (user.role === 'superadmin') return loginView(403, 'ورود سوپر ادمین فقط از مسیر امن دو مرحله‌ای انجام می‌شود.');

      const sessionId = crypto.randomUUID();
      await User.findByIdAndUpdate(user._id, {
        loginAttempts: 0,
        lockUntil: null,
        activeSessionId: sessionId,
      });

      const token = generateToken(user._id, user.email, user.role, user.username, sessionId);
      await commitAuthenticatedSession(req, {
        token,
        sessionId,
        userId: String(user._id),
        authSource: 'local',
        userRole: user.role,
        username: user.username,
        fullName: user.fullName,
      });

      return res.redirect('/admin/dashboard');
    } catch (error) {
      return next(error);
    }
  }

  static async logout(req, res) {
    const userId = req.session?.authSource === 'local' ? req.session?.userId : null;
    if (userId) await User.findByIdAndUpdate(userId, { activeSessionId: null }).catch(() => {});
    await invalidateSession(req, res, 'logout');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.redirect('/login');
  }
}

module.exports = ViewController;
