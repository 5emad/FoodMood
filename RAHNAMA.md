# راهنمای سامانه تغذیه سازمانی

راهنمای واحد و کامل کار با سامانه — از نصب روی لینوکس تا مدیریت روزانه، پشتیبان‌گیری، LDAP و امنیت.

---

## فهرست

1. [معرفی](#معرفی)
2. [نصب سریع روی لینوکس](#نصب-سریع-روی-لینوکس)
3. [به‌روزرسانی روی سرور نصب‌شده](#به‌روزرسانی-روی-سرور-نصب‌شده)
4. [اجرای خودکار با systemd](#اجرای-خودکار-با-systemd)
5. [تنظیمات محیط (.env)](#تنظیمات-محیط-env)
6. [کار آفلاین / بدون اینترنت](#کار-آفلاین--بدون-اینترنت)
7. [ورود و نقش‌های کاربری](#ورود-و-نقشهای-کاربری)
8. [پنل مدیریت](#پنل-مدیریت)
9. [پشتیبان‌گیری و بازیابی](#پشتیبانگیری-و-بازیابی)
10. [تنظیم LDAP / Active Directory](#تنظیم-ldap--active-directory) — [راهنمای کامل گواهی و پروداکشن](./docs/LDAP-PRODUCTION.md)
11. [مسیرهای استاندارد لینوکس و پذیرش نصب](./docs/LINUX-DEPLOYMENT.md)
12. [امنیت](#امنیت)
13. [عیب‌یابی](#عیبیابی)

---

## معرفی

سامانه تغذیه برای مدیریت منوی هفتگی، رزرو غذا توسط کارکنان، گزارش‌گیری و مدیریت کاربران طراحی شده است.

**اجزای اصلی:**
- Node.js + Express (بک‌اند)
- MongoDB (پایگاه داده — ترجیحاً روی همان سرور)
- رابط وب فارسی (RTL) با فونت و آیکون‌های محلی (بدون CDN)

**آدرس‌های مهم پس از نصب:**
| مسیر | توضیح |
|------|--------|
| `/login` | ورود کاربران |
| `/user/dashboard` | پرتال کاربر |
| `/admin/dashboard` | پنل مدیریت |
| `/api/...` | API داخلی |

---

## نصب سریع روی لینوکس

### روش خودکار (توصیه‌شده) — یک اسکریپت، همه‌چیز آماده

پروژه را روی سرور Ubuntu/Debian کپی کنید، سپس:

```bash
cd food
chmod +x deploy/install-ubuntu.sh
sudo bash deploy/install-ubuntu.sh
```

اسکریپت به‌صورت تعاملی:

| مرحله | کار |
|--------|-----|
| دیتابیس | نام کاربری و رمز MongoDB را می‌پرسد (با **هشدار قرمز** برای نگه‌داری امن) |
| Nginx | نصب پروکسی معکوس (اختیاری) |
| دامنه + HTTPS | در صورت انتخاب: نام دامنه + Let's Encrypt یا گواهی اختصاصی |
| سامانه | Node.js 20، MongoDB 7، Chromium (PDF)، npm install، systemd |
| سوپرادمین | ساخت حساب اولیه (اختیاری) |

**خروجی مهم پس از نصب:**

```
/opt/food/INSTALL_INFO.txt              ← بدون رمز — فقط آدرس‌ها و مسیرها
/opt/food/.env                          ← تنظیمات اجرا (رمزها — کپی دستی توصیه نمی‌شود)
/opt/food/docs/LINUX-DEPLOYMENT.md      ← مسیرهای FHS + چک‌لیست Go-Live
```

**بررسی نهایی پس از نصب:**

```bash
sudo bash /opt/food/deploy/verify-install.sh
```

خروجی `ACCEPT` یعنی مسیرها، سرویس‌ها و API سالم‌اند.

> **حتماً** رمزهای نمایش‌داده‌شده در ترمینال نصب را در خزانه رمز سازمانی **خارج از سرور** نگه دارید. هیچ فایل رمز روی سرور ساخته نمی‌شود.

**سه حالت دسترسی:**

| انتخاب شما | آدرس نهایی |
|------------|------------|
| بدون Nginx | `http://IP:3000` |
| Nginx + IP | `http://IP` |
| Nginx + دامنه + HTTPS | `https://دامنه` |

---

## به‌روزرسانی روی سرور نصب‌شده

پس از هر انتشار در GitHub، سرورهایی که قبلاً نصب شده‌اند می‌توانند بدون از دست دادن `.env` و دیتابیس به‌روز شوند.

### آخرین نسخه (همیشه جدیدترین `main`)

```bash
sudo bash /opt/food/deploy/update.sh
```

### نسخه پایدار مشخص (توصیه پروداکشن)

```bash
# لیست نسخه‌های منتشرشده
sudo bash /opt/food/deploy/update.sh --list

# نصب نسخه مشخص
sudo bash /opt/food/deploy/update.sh --tag v1.1.0
```

### بررسی وضعیت

```bash
sudo bash /opt/food/deploy/update.sh --status
```

اسکریپت `update.sh` این کارها را انجام می‌دهد:
1. دریافت سورس از GitHub (شاخه یا تگ)
2. همگام‌سازی `/opt/food` (حفظ `.env`)
3. `npm install --omit=dev`
4. `systemctl restart food`

> **توصیه:** در پروداکشن به‌جای `main`، همیشه یک **تگ نسخه** (`v1.1.0`) را نصب/به‌روز کنید تا تغییرات ناخواسته نگیرید.

### نصب اولیه نسخه مشخص

```bash
curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/bootstrap.sh | sudo bash -s -- --tag v1.1.0 --quick
```

---

### روش دستی (در صورت نیاز)

#### پیش‌نیازها

```bash
# Ubuntu / Debian
sudo apt update
sudo apt install -y curl git mongodb-org nodejs npm

# Node.js 18+ (اگر نسخه قدیمی است)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

> **توصیه آفلاین:** MongoDB و Node را یک‌بار روی سرور با اینترنت نصب کنید. بعد از آن سامانه بدون اینترنت هم کار می‌کند.

#### مراحل نصب

```bash
# ۱. کاربر اختصاصی
sudo useradd -r -m -d /opt/food -s /bin/bash foodapp

# ۲. کپی پروژه
sudo mkdir -p /opt/food
sudo cp -r . /opt/food/
sudo chown -R foodapp:foodapp /opt/food

# ۳. نصب وابستگی‌ها
cd /opt/food
sudo -u foodapp npm install --omit=dev

# ۴. تنظیم محیط
sudo -u foodapp cp .env.example .env
sudo -u foodapp nano .env   # مقادیر را پر کنید

# ۵. MongoDB محلی
sudo systemctl enable mongod
sudo systemctl start mongod

# ۶. تست اجرا
sudo -u foodapp npm start
# مرورگر: http://SERVER_IP:3000
```

### مقادیر حداقلی `.env` برای شروع

```env
NODE_ENV=production
PORT=3000
APP_URL=http://YOUR_SERVER_IP:3000
MONGODB_URI=mongodb://127.0.0.1:27017/food_ordering

SESSION_SECRET=یک-رشته-تصادفی-طولانی
JWT_SECRET=رشته-متفاوت-تصادفی
BACKUP_SECRET=رشته-سوم-متفاوت-برای-پشتیبان
PASSWORD_PEPPER=رشته-چهارم-برای-رمز-عبور
```

برای تولید رشته تصادفی:
```bash
openssl rand -base64 48
```

---

## اجرای خودکار با systemd

نصب خودکار از `deploy/foodmood.service` استفاده می‌کند. در نصب دستی:

```bash
sudo cp /opt/food/deploy/foodmood.service /etc/systemd/system/foodmood.service
sudo systemctl daemon-reload
sudo systemctl enable foodmood
sudo systemctl start foodmood
sudo systemctl status foodmood
```

**بعد از ری‌استارت سرور** سامانه و MongoDB خودکار بالا می‌آیند.

```bash
# مشاهده لاگ
sudo journalctl -u foodmood -f
sudo tail -f /var/log/foodmood/system.log

# ری‌استارت
sudo systemctl restart foodmood
```

> واحد قدیمی `food` دیگر استفاده نمی‌شود. نصب‌کننده خودکار به `foodmood` مهاجرت می‌کند.

---

## تنظیمات محیط (.env)

| متغیر | الزامی | توضیح |
|--------|--------|--------|
| `MONGODB_URI` | بله | آدرس MongoDB (ترجیحاً `127.0.0.1`) |
| `SESSION_SECRET` | بله (پروداکشن) | کلید نشست |
| `JWT_SECRET` | بله (پروداکشن) | کلید JWT |
| `BACKUP_SECRET` | بله (پروداکشن) | کلید رمزنگاری فایل `.fzbackup` |
| `PASSWORD_PEPPER` | توصیه‌شده | تقویت هش رمز عبور |
| `LDAP_URL` | خیر | آدرس سرور AD (fallback) |
| `LDAP_BIND_PASSWORD` | برای AD | رمز Bind — **فقط در `.env`** |
| `LDAP_CA_CERT_PATH` | توصیه‌شده | مسیر گواهی CA روی سرور |
| `LDAP_ALLOWED_HOSTS` | توصیه‌شده | محدودیت hostname سرور LDAP |
| `ANNOUNCEMENT_ENCRYPTION_KEY` | توصیه‌شده | رمزنگاری متن اطلاعیه‌ها در DB |

---

## کار آفلاین / بدون اینترنت

سامانه برای محیط بدون اینترنت طراحی شده:

| مورد | وضعیت |
|------|--------|
| فونت Vazirmatn | محلی در `/vendor/vazirmatn/` |
| آیکون‌ها (Font Awesome) | محلی در `/vendor/fontawesome/` |
| SweetAlert2 | محلی در `/vendor/sweetalert2/` |
| MongoDB | روی همان سرور (`127.0.0.1`) |
| LDAP | شبکه داخلی سازمان (نیاز به AD داخلی، نه اینترنت) |
| PDF گزارش | Chrome/Edge نصب‌شده روی سرور |

**چیزهایی که اینترنت می‌خواهند (اختیاری):**
- نصب اولیه `npm install` (یک‌بار)
- اتصال به MongoDB Atlas (اگر استفاده کنید — توصیه نمی‌شود برای آفلاین)

**بعد از قطع اینترنت** اگر MongoDB و سرویس `foodmood` فعال باشند، کاربران می‌توانند وارد شوند، رزرو کنند و گزارش بگیرند.

---

## ورود و نقش‌های کاربری

| نقش | دسترسی |
|-----|--------|
| `user` | رزرو غذا، مشاهده سفارش‌های خود |
| `admin` | پنل مدیریت (هفته، منو، سفارش، گزارش، پشتیبان) |
| `superadmin` | همه دسترسی‌ها + تنظیمات سامانه + امنیت |

**سوپرادمین:** ورود دو مرحله‌ای با توکن امنیتی.

**LDAP:** اگر فعال باشد، کاربران AD با همان نام کاربری وارد می‌شوند.

---

## پنل مدیریت

آدرس: `/admin/dashboard`

### گزارش‌ها
- گزارش هفتگی (پیش‌فرض: هفته فعال) و ماهیانه
- جدول افراد بدون سفارش
- دانلود PDF

### هفته‌ها
- ساختار درختی: سال → ماه → هفته
- فعال‌سازی هفته، مدیریت منوی روزانه

### سفارش‌ها
- جستجو با کد سفارش
- تایید یکجای سفارش‌های هفته

### غذاها / کاربران / واحدها
- CRUD کامل از پنل

### پشتیبان‌گیری
- دانلود `.fzbackup`
- بازیابی از فایل (جایگزینی کامل داده)

### تنظیمات سامانه (سوپرادمین)
- نام سازمان، تم رنگی، LDAP

---

## پشتیبان‌گیری و بازیابی

### دریافت پشتیبان
1. پنل → **پشتیبان‌گیری** → «دانلود فایل پشتیبان»
2. فایل `.fzbackup` ذخیره شود (خارج از سرور هم کپی بگیرید)

### بازیابی
1. **قبل از بازیابی** یک پشتیبان جدید بگیرید
2. فایل `.fzbackup` را انتخاب کنید
3. «بازیابی داده‌ها» → تأیید
4. صفحه رفرش می‌شود

### امنیت فایل پشتیبان

| لایه | شرح |
|------|------|
| فرمت اختصاصی | Magic `FZBAK1` — فقط این سامانه می‌شناسد |
| رمزنگاری | AES-256-GCM با `BACKUP_SECRET` |
| یکپارچگی | HMAC-SHA256 روی داده‌ها |
| ضد دستکاری | GCM Auth Tag + AAD |
| محدودیت نرخ | حداکثر ۳ بازیابی در ساعت |

> **مهم:** `BACKUP_SECRET` را در جای امن نگه دارید. بدون آن فایل پشتیبان قابل بازگردانی نیست.

---

## تنظیم LDAP / Active Directory

**راهنمای کامل پروداکشن (گواهی CA، `.env`، عیب‌یابی):** [docs/LDAP-PRODUCTION.md](./docs/LDAP-PRODUCTION.md)

از **تنظیمات سامانه** (سوپرادمین):

| فیلد | مثال |
|------|------|
| فعال‌سازی LDAP | بله |
| آدرس | `ldaps://dc.company.local:636` |
| نوع اتصال | `ldaps` یا `starttls` |
| Base DN | `DC=company,DC=local` |
| Bind DN | `CN=svc-food,OU=Services,DC=company,DC=local` |
| فیلتر کاربر | `(sAMAccountName={{username}})` |
| گواهی CA | مسیر فایل `.pem` روی سرور |

**متغیرهای `.env` مکمل:**
```env
LDAP_URL=ldaps://dc.company.local:636
LDAP_SECURITY=ldaps
LDAP_BASE_DN=DC=company,DC=local
LDAP_BIND_DN=CN=svc-food,DC=company,DC=local
LDAP_BIND_PASSWORD=...
LDAP_CA_CERT_PATH=/opt/food/certs/ldap-ca.pem
LDAP_ALLOWED_HOSTS=dc.company.local
```

> **رمز Bind** فقط در `.env` نگه‌داری می‌شود. پس از تغییر `.env` حتماً `sudo systemctl restart foodmood` بزنید.

**تست اتصال:** دکمه «تست LDAP» در تنظیمات.

**نکات امنیتی LDAP:**
- ترجیحاً `ldaps` یا `starttls` (نه LDAP ساده)
- `LDAP_ALLOW_INSECURE=true` فقط در محیط تست
- گواهی CA را در مسیر امن روی سرور قرار دهید (نه داخل git)

---

## امنیت

- رمز عبور: bcrypt + pepper
- CSRF روی درخواست‌های تغییردهنده
- Rate limit ورود و API
- Helmet (هدرهای امنیتی)
- لاگ امنیتی (سوپرادمین)
- پشتیبان رمزنگاری‌شده

**توصیه پروداکشن:**
- HTTPS با Nginx جلوی سامانه
- فایروال: فقط پورت 443 باز
- MongoDB فقط از `127.0.0.1`
- پشتیبان دوره‌ای `.fzbackup` روی ذخیره جدا

---

## عیب‌یابی

| مشکل | راه‌حل |
|------|--------|
| سامانه بالا نمی‌آید | `sudo journalctl -u foodmood -n 50` |
| MongoDB وصل نمی‌شود | `sudo systemctl status mongod` |
| صفحه بدون استایل | `npm run vendor:sync` |
| LDAP خطا | [docs/LDAP-PRODUCTION.md](./docs/LDAP-PRODUCTION.md) — تست پنل، گواهی CA، پورت ۶۳۶ |
| پشتیبان باز نمی‌شود | `BACKUP_SECRET` همان سرور صادرکننده باشد |
| PDF ساخته نمی‌شود | Chrome یا Edge روی سرور نصب باشد |

### اسکریپت‌های کمکی

```bash
node scripts/super-admin.js      # ساخت سوپرادمین
node scripts/fix-admin.js        # بازیابی دسترسی ادمین
node scripts/set-capacity.js     # تنظیم ظرفیت منو
npm run vendor:sync              # همگام‌سازی فایل‌های UI
```

---

*نسخه راهنما: 1.0 — سامانه تغذیه سازمانی*
