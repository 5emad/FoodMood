const express = require('express');
const MenuController = require('../controllers/MenuController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/active', authMiddleware, MenuController.getWeeklyMenu);
router.get('/weeks/:weekId', authMiddleware, MenuController.getWeeklyMenu);

module.exports = router;
