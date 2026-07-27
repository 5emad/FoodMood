const express = require('express');
const SurveyController = require('../controllers/SurveyController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/active', authMiddleware, SurveyController.userActive);
router.post('/respond', authMiddleware, SurveyController.userRespond);

module.exports = router;
