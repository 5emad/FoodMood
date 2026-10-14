const roleMiddleware = (requiredRoles) => {
  const allowed = (requiredRoles || []).map((r) => String(r).toLowerCase().trim());
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'احراز هویت الزامی است' });
    }

    let role = String(req.user.role || '').toLowerCase().trim();
    // Common aliases / legacy values
    if (role === 'super_admin' || role === 'super-admin') role = 'superadmin';
    if (role === 'administrator') role = 'admin';

    if (!allowed.includes(role)) {
      const msg = 'شما به این بخش دسترسی ندارید';
      if (req.accepts(['html', 'json']) === 'html' && !req.originalUrl.startsWith('/api/')) {
        return res.status(403).render('errors/status', { statusCode: 403, user: req.user });
      }
      return res.status(403).json({
        success: false,
        message: msg,
        code: 'FORBIDDEN_ROLE',
      });
    }

    req.user.role = role;
    next();
  };
};

module.exports = roleMiddleware;
