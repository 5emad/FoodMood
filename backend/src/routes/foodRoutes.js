const express        = require('express');
const path           = require('path');
const FoodController = require('../controllers/FoodController');
const FoodCategoryController = require('../controllers/FoodCategoryController');
const authMiddleware = require('../middleware/authMiddleware');
const optionalAuthMiddleware = require('../middleware/optionalAuthMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const {
  createImageDiskUpload,
  assertUploadedImageMagic,
} = require('../helpers/ImageUploadHelper');
const { createWafParamsRestoreMiddleware } = require('../middleware/firewtwallPatches');

const router = express.Router();
const uploadDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'foods');
const upload = createImageDiskUpload({ destDir: uploadDir, maxSizeMb: 5, filenamePrefix: 'food' });
const adminOnly = [authMiddleware, roleMiddleware(['admin', 'superadmin'])];
const restoreIds = createWafParamsRestoreMiddleware();

// Categories — قبل از /:id تا با مسیر غذا تداخل نکند
router.get('/categories', optionalAuthMiddleware, FoodCategoryController.list);
router.post('/categories', ...adminOnly, FoodCategoryController.create);
router.put('/categories/:id', ...adminOnly, restoreIds, FoodCategoryController.update);
router.delete('/categories/:id', ...adminOnly, restoreIds, FoodCategoryController.remove);

// Public/user read: optional session so prices can be stripped when hidden
router.get('/', optionalAuthMiddleware, FoodController.getAll);
router.get('/category/:category', optionalAuthMiddleware, FoodController.getByCategory);
router.get('/:id', optionalAuthMiddleware, restoreIds, FoodController.getById);

// Admin-only write endpoints
router.post(
  '/',
  authMiddleware,
  roleMiddleware(['admin', 'superadmin']),
  upload.single('image'),
  assertUploadedImageMagic,
  FoodController.create,
);
router.put(
  '/:id',
  authMiddleware,
  roleMiddleware(['admin', 'superadmin']),
  restoreIds,
  upload.single('image'),
  assertUploadedImageMagic,
  FoodController.update,
);
router.delete('/:id', authMiddleware, roleMiddleware(['admin', 'superadmin']), restoreIds, FoodController.delete);

module.exports = router;
