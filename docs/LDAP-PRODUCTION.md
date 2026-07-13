# راهنمای استقرار LDAP و گواهی TLS روی لینوکس

راهنمای گام‌به‌گام اتصال FoodMood به **Active Directory** در محیط پروداکشن — شامل گواهی CA، متغیرهای محیطی، پنل مدیریت و عیب‌یابی.

> **پیش‌نیاز:** نصب پایه سامانه با `deploy/install-ubuntu.sh` یا `bootstrap.sh` انجام شده باشد و سرویس `foodmood` فعال باشد.

---

## فهرست

1. [معماری و پیش‌نیازها](#معماری-و-پیش‌نیازها)
2. [حساب سرویس در Active Directory](#حساب-سرویس-در-active-directory)
3. [آماده‌سازی گواهی CA](#آماده‌سازی-گواهی-ca)
4. [تنظیم `.env` روی سرور](#تنظیم-env-روی-سرور)
5. [تنظیم پنل مدیریت (سوپرادمین)](#تنظیم-پنل-مدیریت-سوپرادمین)
6. [تست و اعتبارسنجی](#تست-و-اعتبارسنجی)
7. [نگهداری و به‌روزرسانی](#نگهداری-و-به‌روزرسانی)
8. [عیب‌یابی](#عیب‌یابی)
9. [چک‌لیست امنیتی](#چک‌لیست-امنیتی)

---

## معماری و پیش‌نیازها

| مورد | توضیح |
|------|--------|
| **احراز هویت** | کاربران عادی فقط از AD؛ ادمین/سوپرادمین محلی می‌توانند از حساب داخلی وارد شوند |
| **رمز Bind** | فقط در `.env` (`LDAP_BIND_PASSWORD`) — **در دیتابیس ذخیره نمی‌شود** |
| **تنظیمات LDAP** | URL، Base DN، فیلتر، گواهی CA در MongoDB (`AppSetting`) + fallback از `.env` |
| **TLS** | پیش‌فرض `ldaps` (پورت ۶۳۶) یا `starttls` (پورت ۳۸۹) |
| **سرویس systemd** | `foodmood` — مسیر نصب پیش‌فرض `/opt/food` |

### شبکه

از سرور اپلیکیشن باید به DC دسترسی داشته باشید:

```bash
# DNS
getent hosts dc.company.local

# پورت LDAPS
nc -zv dc.company.local 636

# یا StartTLS
nc -zv dc.company.local 389
```

> فایروال UFW روی سرور FoodMood معمولاً فقط SSH و HTTP/HTTPS را باز می‌کند. **اتصال به DC خروجی (outbound)** است و نیاز به باز کردن پورت LDAP از اینترنت ندارد.

---

## حساب سرویس در Active Directory

یک حساب سرویس (مثال: `svc-food`) با حداقل دسترسی:

- **Read** روی OU کاربران
- بدون نیاز به دسترسی نوشتن

مثال Bind DN:

```text
CN=svc-food,OU=Service Accounts,DC=company,DC=local
```

فیلتر پیش‌فرض ورود کاربر:

```text
(sAMAccountName={{username}})
```

---

## آماده‌سازی گواهی CA

اگر DC از گواهی داخلی سازمان استفاده می‌کند، فایل PEM ریشه یا CA میانی را روی سرور FoodMood قرار دهید.

### ۱. ساخت پوشه (اگر نصب‌کننده نساخته)

```bash
sudo mkdir -p /opt/food/certs
sudo chown foodapp:foodapp /opt/food/certs
sudo chmod 750 /opt/food/certs
```

### ۲. کپی گواهی

```bash
# مثال: انتقال از ماشین مدیریت
sudo cp enterprise-ca.pem /opt/food/certs/ldap-ca.pem
sudo chown foodapp:foodapp /opt/food/certs/ldap-ca.pem
sudo chmod 640 /opt/food/certs/ldap-ca.pem
```

### ۳. استخراج گواهی از DC (در صورت نیاز)

```bash
# روی سروری که به DC دسترسی دارد
openssl s_client -connect dc.company.local:636 -showcerts </dev/null 2>/dev/null \
  | awk '/BEGIN CERTIFICATE/,/END CERTIFICATE/{print}' > ldap-ca-chain.pem
```

فقط **CA مورد اعتماد سازمان** را نگه دارید (نه لزوماً کل زنجیره، مگر سرور آن را بخواهد).

### ۴. تست خواندن توسط کاربر سرویس

```bash
sudo -u foodapp test -r /opt/food/certs/ldap-ca.pem && echo OK
```

> پوشه `certs/` در `.gitignore` است — **هرگز گواهی را در Git قرار ندهید.**

---

## تنظیم `.env` روی سرور

فایل: `/opt/food/.env` (مالکیت `foodapp`، دسترسی `600`)

```bash
sudo nano /opt/food/.env
```

متغیرهای LDAP (به انتهای فایل اضافه کنید):

```env
# ── LDAP / Active Directory ──────────────────────────────────
LDAP_URL=ldaps://dc.company.local:636
LDAP_SECURITY=ldaps
LDAP_BASE_DN=DC=company,DC=local
LDAP_BIND_DN=CN=svc-food,OU=Service Accounts,DC=company,DC=local
LDAP_BIND_PASSWORD=رمز-حساب-سرویس
LDAP_CA_CERT_PATH=/opt/food/certs/ldap-ca.pem
LDAP_USER_FILTER=(sAMAccountName={{username}})
LDAP_ALLOWED_HOSTS=dc.company.local
# LDAP_ALLOW_INSECURE=false   # هرگز در پروداکشن true نکنید
```

| متغیر | الزامی | توضیح |
|--------|--------|--------|
| `LDAP_BIND_PASSWORD` | **بله** (برای AD معمولی) | رمز حساب Bind — فقط env |
| `LDAP_CA_CERT_PATH` | توصیه‌شده | مسیر PEM روی سرور لینوکس |
| `LDAP_ALLOWED_HOSTS` | توصیه‌شده | محدودیت hostname (جلوگیری از redirect) |
| `LDAP_URL` و بقیه | اختیاری اگر در پنل ست شود | fallback اگر DB خالی باشد |

**پس از هر تغییر `.env`:**

```bash
sudo systemctl restart foodmood
sudo systemctl status foodmood
```

---

## تنظیم پنل مدیریت (سوپرادمین)

1. ورود به `/admin/dashboard` با حساب **سوپرادمین محلی**
2. تب **تنظیمات سامانه** → بخش **LDAP / Active Directory**
3. مقادیر را پر کنید:

| فیلد | مثال |
|------|------|
| وضعیت LDAP | فعال |
| LDAP URL | `ldaps://dc.company.local:636` |
| نوع اتصال | `LDAPS` (پیشنهادی) |
| Base DN | `DC=company,DC=local` |
| Bind DN | `CN=svc-food,OU=Service Accounts,DC=company,DC=local` |
| فیلتر کاربر | `(sAMAccountName={{username}})` |
| مسیر گواهی CA | `/opt/food/certs/ldap-ca.pem` |

4. **تست LDAP** — اگر `LDAP_BIND_PASSWORD` در `.env` است، فیلد رمز تست را خالی بگذارید
5. **ذخیره تنظیمات**

> رمز Bind در فرم ذخیره نمی‌شود. پیام «رمز Bind از متغیر محیطی خوانده می‌شود» طبیعی است.

---

## تست و اعتبارسنجی

### چک‌لیست

- [ ] دکمه «تست LDAP» در پنل: موفق
- [ ] ورود کاربر AD در `/login`
- [ ] ورود ادمین محلی همچنان کار می‌کند
- [ ] واحد کاربر AD در پرتال نمایش داده می‌شود
- [ ] لاگ امنیتی: رویداد ورود LDAP (سوپرادمین → امنیت)

### دستورات مفید

```bash
sudo journalctl -u foodmood -n 80 --no-pager
sudo tail -n 50 /var/log/foodmood/system.log
```

---

## نگهداری و به‌روزرسانی

### چرخش رمز Bind

```bash
# 1. رمز جدید در AD
# 2. ویرایش .env
sudo nano /opt/food/.env
# 3. ری‌استارت
sudo systemctl restart foodmood
```

### به‌روزرسانی سامانه

```bash
sudo bash /opt/food/deploy/update.sh --tag v1.2.0
```

فایل `.env` (شامل LDAP) **حفظ می‌شود**.

### StartTLS به‌جای LDAPS

```env
LDAP_URL=ldap://dc.company.local:389
LDAP_SECURITY=starttls
```

آدرس باید با `ldap://` شروع شود (نه `ldaps://`).

---

## عیب‌یابی

| پیام / علامت | علت محتمل | راه‌حل |
|--------------|-----------|--------|
| `LDAP URL معتبر نیست` | URL نادرست یا نوع اتصال با پروتکل همخوان نیست | `ldaps://` برای LDAPS، `ldap://` برای StartTLS |
| `خطای SSL/TLS` / certificate | CA نادرست یا مسیر اشتباه | مسیر `/opt/food/certs/ldap-ca.pem`، مالکیت `foodapp` |
| `LDAP host در فهرست مجاز نیست` | `LDAP_ALLOWED_HOSTS` | hostname دقیق DC را اضافه کنید |
| `سرور LDAP پاسخ نمی‌دهد` | فایروال شبکه / DC خاموش | `nc -zv dc 636` از سرور اپ |
| `00002028` / integrity | AD اجبار signing | از LDAPS یا StartTLS استفاده کنید |
| `نام کاربری یا رمز Bind اشتباه` | رمز سرویس | `.env` + `systemctl restart foodmood` |
| ورود AD ناموفق، تست موفق | فیلتر یا Base DN | فیلتر و OU را با `ldapsearch` بررسی کنید |
| تنظیمات ذخیره نمی‌شود | LDAP غیرفعال با URL خالی | URL و Base DN را کامل کنید |

### تست دستی TLS

```bash
openssl s_client -connect dc.company.local:636 \
  -CAfile /opt/food/certs/ldap-ca.pem -servername dc.company.local </dev/null
```

خروجی باید `Verify return code: 0 (ok)` باشد.

---

## چک‌لیست امنیتی

- [ ] `LDAP_ALLOW_INSECURE` تنظیم نشده یا `false`
- [ ] `LDAP_ALLOWED_HOSTS` محدود به DCهای شناخته‌شده
- [ ] گواهی CA خارج از Git و با دسترسی `640`
- [ ] `.env` با chmod `600`
- [ ] HTTPS فعال (Nginx + گواهی وب)
- [ ] MongoDB فقط `127.0.0.1`
- [ ] رمز Bind فقط در خزانه رمز + `.env` سرور

---

## مراجع

- [RAHNAMA.md](../RAHNAMA.md) — راهنمای کلی سامانه
- [README.md](../README.md) — نصب سریع
- `.env.example` — نمونه متغیرها
- `deploy/foodmood.service` — واحد systemd
