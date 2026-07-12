const express        = require('express');
const multer         = require('multer');
const path           = require('path');
const fs             = require('fs');
const FoodController = require('../controllers/FoodController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

const router    = express.Router();
const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'foods');
fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_SIZE_MB  = 5;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename:    (_req, file, cb) => {
    const ext      = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '');
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, safeName);
  },
});

const fileFilter = (_req, file, cb) => {
  if (ALLOWED_MIME.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('فرمت فایل مجاز نیست. فقط JPEG، PNG، WebP و GIF قابل قبول است.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
});

// Public read endpoints (menu display)
router.get('/',                  FoodController.getAll);
router.get('/category/:category',FoodController.getByCategory);
router.get('/:id',               FoodController.getById);

// Admin-only write endpoints
router.post(  '/', authMiddleware, roleMiddleware(['admin', 'superadmin']), upload.single('image'), FoodController.create);
router.put(   '/:id', authMiddleware, roleMiddleware(['admin', 'superadmin']), upload.single('image'), FoodController.update);
router.delete('/:id', authMiddleware, roleMiddleware(['admin', 'superadmin']), FoodController.delete);

module.exports = router;
