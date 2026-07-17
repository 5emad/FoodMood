const fs = require('fs');
const path = require('path');
const multer = require('multer');

/** MIME → پسوند امن (پسوند کلاینت نادیده گرفته می‌شود) */
const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const ALLOWED_MIME = new Set(Object.keys(MIME_TO_EXT));

function matchesImageMagic(buf, mime) {
  if (!buf || buf.length < 12) return false;
  if (mime === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (mime === 'image/png') {
    return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  }
  if (mime === 'image/gif') {
    return buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38;
  }
  if (mime === 'image/webp') {
    return buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
      && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
  }
  return false;
}

function createImageDiskUpload({ destDir, maxSizeMb = 5, filenamePrefix = 'img' }) {
  fs.mkdirSync(destDir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, destDir),
    filename: (_req, file, cb) => {
      const ext = MIME_TO_EXT[file.mimetype];
      if (!ext) return cb(new Error('فرمت فایل مجاز نیست'));
      const name = `${filenamePrefix}-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
      cb(null, name);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: maxSizeMb * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED_MIME.has(file.mimetype)) {
        return cb(new Error('فرمت فایل مجاز نیست. فقط JPEG، PNG، WebP و GIF قابل قبول است.'), false);
      }
      // پسوند اصلی را فقط برای هشدار چک می‌کنیم؛ ذخیره همیشه از MIME است
      const origExt = path.extname(file.originalname || '').toLowerCase();
      const dangerous = ['.html', '.htm', '.svg', '.js', '.mjs', '.php', '.exe', '.shtml', '.xhtml'];
      if (dangerous.includes(origExt)) {
        return cb(new Error('پسوند فایل خطرناک است و پذیرفته نمی‌شود.'), false);
      }
      cb(null, true);
    },
  });

  return upload;
}

/** بعد از multer: امضای باینری را با MIME ادعا‌شده تطبیق بده */
function assertUploadedImageMagic(req, res, next) {
  if (!req.file?.path) return next();
  try {
    const fd = fs.openSync(req.file.path, 'r');
    const buf = Buffer.alloc(12);
    fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);
    if (!matchesImageMagic(buf, req.file.mimetype)) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({
        success: false,
        message: 'محتوای فایل با فرمت تصویر مطابقت ندارد',
      });
    }
    return next();
  } catch {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ success: false, message: 'خواندن فایل آپلود ناموفق بود' });
  }
}

module.exports = {
  MIME_TO_EXT,
  ALLOWED_MIME,
  matchesImageMagic,
  createImageDiskUpload,
  assertUploadedImageMagic,
};
