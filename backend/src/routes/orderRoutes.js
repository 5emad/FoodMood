const express = require('express');
const OrderController = require('../controllers/OrderController');
const authMiddleware = require('../middleware/authMiddleware');
const ldapProfileMiddleware = require('../middleware/ldapProfileMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

const router = express.Router();

router.post('/', authMiddleware, ldapProfileMiddleware, OrderController.create);
router.get('/admin/all', authMiddleware, roleMiddleware(['admin', 'superadmin']), OrderController.getAll);
router.post('/admin/confirm-week', authMiddleware, roleMiddleware(['admin', 'superadmin']), OrderController.confirmWeek);
router.post('/admin/:id/cancel', authMiddleware, roleMiddleware(['admin', 'superadmin']), OrderController.adminCancel);
router.get('/', authMiddleware, ldapProfileMiddleware, OrderController.getUserOrders);
router.get('/:id', authMiddleware, ldapProfileMiddleware, OrderController.getById);
router.post('/:id/cancel', authMiddleware, ldapProfileMiddleware, OrderController.cancel);
router.put('/:id/status', authMiddleware, roleMiddleware(['admin', 'superadmin']), OrderController.updateStatus);
router.delete('/:id', authMiddleware, roleMiddleware(['admin', 'superadmin']), OrderController.delete);

module.exports = router;
