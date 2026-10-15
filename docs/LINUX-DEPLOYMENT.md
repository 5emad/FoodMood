# استقرار لینوکس — مسیرهای استاندارد و چک‌لیست پذیرش

راهنمای رسمی مسیرهای نصب FoodMood روی Ubuntu/Debian، مطابق **FHS** (Filesystem Hierarchy Standard) و قراردادهای **systemd** / **Debian**.

---

## جدول مسیرها (پس از نصب)

| نقش | مسیر | استاندارد | مالک / دسترسی |
|-----|------|-----------|----------------|
| **برنامه** | `/opt/food` | FHS `/opt` — نرم‌افزار اختیاری شخص ثالث | `foodapp:foodapp` `755` |
| **تنظیمات اجرا** | `/opt/food/.env` | Secrets در درخت برنامه (محدود به کاربر سرویس) | `foodapp:foodapp` **`600`** |
| **اطلاعات نصب (بدون رمز)** | `/opt/food/INSTALL_INFO.txt` | مرجع محلی اپراتور | `root:root` `644` |
| **مستندات روی سرور** | `/opt/food/docs/` | همراه بسته نصب | `foodapp:foodapp` |
| **گواهی LDAP CA** | `/opt/food/certs/ldap-ca.pem` | زیردرخت برنامه (رایج برای cert اختصاصی اپ) | `foodapp:foodapp` **`640`** |
| **لاگ اپلیکیشن** | `/var/log/foodmood/` | FHS `/var/log` | `foodapp:foodapp` **`750`** |
| **لاگ متنی اصلی** | `/var/log/foodmood/system.log` | خروجی `SystemLogService` | `foodapp` |
| **واحد systemd** | `/etc/systemd/system/foodmood.service` | [systemd unit file conventions](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html) | `root:root` |
| **کاربر سرویس** | `foodapp` | اصل least-privilege | shell: `/bin/bash`, home: `/opt/food` |
| **داده MongoDB** | `/var/lib/mongodb` | FHS `/var/lib` — داده سرویس سیستمی | `mongodb` |
| **Nginx (در صورت نصب)** | `/etc/nginx/sites-available/food` | قرارداد Debian `sites-available` | `root` |

> **چرا `/opt/food` و نه `/usr/local`؟**  
> FHS هر دو را برای نرم‌افزار اضافی می‌پذیرد. `/opt/<vendor>/<app>` برای بسته‌های مستقل سازمانی رایج‌تر است و با اسکریپت نصب و `update.sh` هماهنگ است.

---

## متغیرهای الزامی در `.env` (پروداکشن)

این کلیدها در نصب خودکار تولید می‌شوند؛ پس از به‌روزرسانی از نسخه‌های قدیمی‌تر، `update.sh` کلیدهای جدید را در صورت نبود اضافه می‌کند.

| متغیر | کاربرد |
|-------|--------|
| `SESSION_SECRET` | کوکی نشست |
| `JWT_SECRET` | توکن API |
| `BACKUP_SECRET` | رمزنگاری پشتیبان |
| `PASSWORD_PEPPER` | pepper رمز عبور محلی |
| `ANNOUNCEMENT_ENCRYPTION_KEY` | AES-256-GCM متن اطلاعیه در DB |
| `LDAP_ENCRYPTION_KEY` | scrypt + AES + HMAC برای رمز Bind LDAP در DB |
| `LOG_DIR` | باید `/var/log/foodmood` باشد |
| `MONGODB_URI` | اتصال MongoDB محلی |

---

## بررسی خودکار پس از نصب

```bash
sudo bash /opt/food/deploy/verify-install.sh
```

اسکریپت موارد زیر را بررسی می‌کند:

- وجود مسیرها و مجوزهای فایل
- فعال بودن `foodmood` و `mongod`
- پاسخ `GET /api/system/health` با وضعیت سالم
- کلیدهای `.env` (بدون placeholder)
- نسخه Node.js ≥ 20

خروجی **`ACCEPT`** یعنی سرور از نظر نصب آماده ورود به فاز LDAP / تست کاربری است.

---

## چک‌لیست پذیرش دستی (قبل از اعلام Go-Live)

### نصب پایه

- [ ] `sudo bash deploy/install-ubuntu.sh` بدون خطا تمام شد
- [ ] `sudo bash /opt/food/deploy/verify-install.sh` → **ACCEPT**
- [ ] رمزهای ترمینال نصب در خزانه رمز سازمانی **خارج از سرور** ذخیره شد
- [ ] `/opt/food/INSTALL_INFO.txt` بررسی شد (بدون رمز — فقط مسیرها)

### امنیت

- [ ] `.env` دسترسی `600` و مالک `foodapp`
- [ ] UFW فعال و فقط پورت‌های لازم باز است (SSH، 80/443 یا 3000)
- [ ] `fail2ban` و به‌روزرسانی خودکار امنیتی (در صورت انتخاب هاردنینگ) فعال است
- [ ] HTTPS با گواهی معتبر (در صورت دامنه عمومی)

### سرویس

- [ ] `sudo systemctl status foodmood` → `active (running)`
- [ ] `sudo systemctl status mongod` → `active (running)`
- [ ] `curl -s http://127.0.0.1:3000/api/system/health` → `"healthy":true`
- [ ] صفحه `/login` از مرورگر باز می‌شود

### عملکرد

- [ ] ورود سوپرادمین / ادمین تست
- [ ] ایجاد یک غذا و یک رزرو آزمایشی
- [ ] پشتیبان‌گیری از پنل ادمین (در صورت استفاده)
- [ ] `sudo tail -f /var/log/foodmood/system.log` خطای بحرانی نشان نمی‌دهد

### LDAP (در صورت نیاز)

- [ ] CA در `/opt/food/certs/ldap-ca.pem` با مالکیت `foodapp`
- [ ] `LDAP_ENCRYPTION_KEY` در `.env` تنظیم است (برای ذخیره رمز Bind از پنل)
- [ ] راهنما: [LDAP-PRODUCTION.md](./LDAP-PRODUCTION.md)
- [ ] تست اتصال از تب LDAP پنل ادمین موفق است

### اطلاعیه (v1.2+)

- [ ] `ANNOUNCEMENT_ENCRYPTION_KEY` در `.env` وجود دارد
- [ ] ایجاد اطلاعیه آزمایشی از پنل ادمین و نمایش در پرتال کاربر

---

## به‌روزرسانی

```bash
sudo bash /opt/food/deploy/update.sh
sudo bash /opt/food/deploy/verify-install.sh
```

هر به‌روزرسانی پیش از هر تغییری این کارها را انجام می‌دهد:

1. نسخه جدید را در یک پوشه موقت نصب و build می‌کند. اگر این مرحله شکست بخورد، سایت فعلی دست‌نخورده می‌ماند.
2. از کل دیتابیس (`mongodump`)، رسیدهای پرداخت، تصاویر آپلودشده، گواهی‌ها، `.env` و کد فعلی نسخه پشتیبان می‌گیرد و در `/var/backups/foodmood/update-<تاریخ>-v<نسخه قبلی>/` ذخیره می‌کند. اگر پشتیبان‌گیری ممکن نباشد (مثلاً فضای دیسک کم است)، به‌روزرسانی انجام نمی‌شود.
3. هنگام جایگزینی فایل‌ها، `.env`، `backend/storage` (رسیدها)، `uploads`، `certs/ssl`، لاگ‌ها و `backups` را دست نمی‌زند.
4. اگر نسخه جدید بالا نیاید، خودکار به کد قبلی برمی‌گردد. دیتابیس در این حالت دست نمی‌خورد.
5. تعداد رکوردهای کاربران، سفارش‌ها، پرداخت‌ها، مهمان‌ها، غذاها و کدهای تخفیف را قبل و بعد از به‌روزرسانی مقایسه می‌کند و اگر چیزی کم شده باشد هشدار می‌دهد.

۵ پشتیبان آخر نگه داشته می‌شود (با `--keep N` قابل تغییر است). کپی کد فقط در ۲ پشتیبان آخر می‌ماند.

```bash
sudo bash /opt/food/deploy/update.sh --list-backups            # فهرست پشتیبان‌ها
sudo bash /opt/food/deploy/update.sh --rollback                # بازگشت به کد نسخه قبل (دیتابیس دست نمی‌خورد)
sudo bash /opt/food/deploy/update.sh --restore-db [DIR] --yes  # بازگردانی دیتابیس و رسیدها از پشتیبان
```

`--restore-db` پیش از بازگردانی از دیتابیس فعلی هم یک پشتیبان می‌گیرد (`pre-restore-*`) تا خود بازگردانی هم قابل برگشت باشد.

---

## عیب‌یابی سریع

| علامت | اقدام |
|-------|--------|
| سرویس down | `sudo journalctl -u foodmood -n 50 --no-pager` |
| DB قطع | `sudo systemctl status mongod` |
| LDAP SSL | `sudo -u foodapp test -r /opt/food/certs/ldap-ca.pem` |
| مجوز لاگ | `sudo chown foodapp:foodapp /var/log/foodmood && chmod 750 /var/log/foodmood` |

---

## ACCEPT نصب (نسخه 1.2.0)

| بخش | وضعیت |
|-----|--------|
| مسیر FHS `/opt/food` + لاگ `/var/log/foodmood` | ✓ |
| systemd `foodmood` با hardening | ✓ |
| کلیدهای رمزنگاری در installer | ✓ |
| اسکریپت `verify-install.sh` | ✓ |
| مستند LDAP + مسیر certs | ✓ |
| `update.sh` مهاجرت کلیدهای env | ✓ |

**نتیجه:** بسته v1.2.0 برای نصب اولیه روی Ubuntu/Debian 22.04+ **پذیرفته شده** است — پس از اجرای `verify-install.sh` روی سرور هدف، Go-Live مجاز است.
