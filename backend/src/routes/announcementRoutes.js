const express = require('express');
const AnnouncementController = require('../controllers/AnnouncementController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/active', authMiddleware, AnnouncementController.getActive);

module.exports = router;
