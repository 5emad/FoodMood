const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const ldapProfileMiddleware = require('../middleware/ldapProfileMiddleware');
const ensureDbMiddleware = require('../middleware/ensureDbMiddleware');
const { getUserCapabilities } = require('../helpers/PermissionHelper');

router.use(authMiddleware, ldapProfileMiddleware);

// داشبورد کاربر
router.get('/', (_req, res) => {
  res.redirect('/user/dashboard');
});

router.get('/dashboard', ensureDbMiddleware, async (req, res, next) => {
  try {
    const capabilities = await getUserCapabilities();
    res.render('user/dashboard', {
      user: req.user,
      capabilities,
      portalSettings: {
        showFinancialStatementToUsers: capabilities.showStatement,
        organizationSharePercent: capabilities.organizationSharePercent,
        personalSharePercent: capabilities.personalSharePercent,
        showPricesToUsers: capabilities.showPrices,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
