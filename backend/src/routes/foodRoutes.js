const express        = require('express');
const path           = require('path');
const FoodController = require('../controllers/FoodController');
const authMiddleware = require('../middleware/authMiddleware');
const optionalAuthMiddleware = require('../middleware/optionalAuthMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const {
  createImageDiskUpload,
  assertUploadedImageMagic,
} = require('../helpers/ImageUploadHelper');

const router = express.Router();
const uploadDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'foods');
const upload = createImageDiskUpload({ destDir: uploadDir, maxSizeMb: 5, filenamePrefix: 'food' });

// Public/user read: optional session so prices can be stripped when hidden
router.get('/', optionalAuthMiddleware, FoodController.getAll);
router.get('/category/:category', optionalAuthMiddleware, FoodController.getByCategory);
router.get('/:id', optionalAuthMiddleware, FoodController.getById);

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
  upload.single('image'),
  assertUploadedImageMagic,
  FoodController.update,
);
router.delete('/:id', authMiddleware, roleMiddleware(['admin', 'superadmin']), FoodController.delete);

module.exports = router;
