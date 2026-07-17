const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const ldapProfileMiddleware = require('../middleware/ldapProfileMiddleware');
const UserStatementController = require('../controllers/UserStatementController');

const router = express.Router();

router.use(authMiddleware, ldapProfileMiddleware);

router.get('/statement/config', UserStatementController.getConfig);
router.get('/statement/list', UserStatementController.getList);
router.get('/statement/weeks', UserStatementController.getWeeks);
router.get('/statement/months', UserStatementController.getMonths);
router.get('/statement', UserStatementController.getStatement);

module.exports = router;
