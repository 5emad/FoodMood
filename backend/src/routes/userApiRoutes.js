const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const ldapProfileMiddleware = require('../middleware/ldapProfileMiddleware');
const { createWafParamsRestoreMiddleware } = require('../middleware/firewtwallPatches');
const { mountStatementAndPaymentRoutes } = require('./portalSharedRoutes');

const router = express.Router();
const restoreIds = createWafParamsRestoreMiddleware();
router.param('id', (req, res, next) => restoreIds(req, res, next));

router.use(authMiddleware, ldapProfileMiddleware);

mountStatementAndPaymentRoutes(router);

module.exports = router;
