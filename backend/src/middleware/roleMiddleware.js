const roleMiddleware = (requiredRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'احراز هویت الزامی است' });
    }

    if (!requiredRoles.includes(req.user.role)) {
      if (req.accepts(['html', 'json']) === 'html' && !req.originalUrl.startsWith('/api/')) {
        return res.status(403).render('index', { user: req.user, error: 'دسترسی غیرمجاز' });
      }
      return res.status(403).json({ message: 'دسترسی غیرمجاز' });
    }

    next();
  };
};

module.exports = roleMiddleware;
