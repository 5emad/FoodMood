# سامانه تغذیه سازمانی

سیستم رزرو و سفارش غذا برای سازمان‌ها.

**راهنمای کامل:** [RAHNAMA.md](./RAHNAMA.md)

**استقرار LDAP روی لینوکس (گواهی CA + Active Directory):** [docs/LDAP-PRODUCTION.md](./docs/LDAP-PRODUCTION.md)

## شروع سریع

```bash
cp .env.example .env
npm install
npm start
```

پیش‌فرض: `http://localhost:3000`

## استقرار با Docker (پرفورمنس + آپ‌تایم)

```bash
cp .env.docker.example .env.docker
docker compose --env-file .env.docker up -d --build
# مقیاس: docker compose --env-file .env.docker up -d --scale app=2
```

مهاجرت از نصب قبلی بدون از دست رفتن داده:

```bash
sudo bash /opt/food/deploy/migrate-to-docker.sh
```

جزئیات: [deploy/DOCKER.md](./deploy/DOCKER.md)

## نصب پروداکشن لینوکس

نصب با **یک فایل** و **بدون هیچ سوالی** انجام می‌شود — Node.js، MongoDB، Nginx، فایروال و هاردنینگ همه خودکار:

**نصب یک‌خطی از GitHub روی سرور خام:**

```bash
curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/install.sh | sudo bash
```

هیچ سوالی پرسیده نمی‌شود. یوزر/پسورد دیتابیس و سوپرادمین خودکار ساخته می‌شوند و **فقط یک‌بار در پایان نصب** در ترمینال نمایش داده می‌شوند — آن‌ها را در خزانه رمز سازمانی ذخیره کنید.

**نصب از سورس محلی:**

```bash
sudo bash deploy/install.sh
```

**با یوزر/پسورد دلخواه دیتابیس:**

```bash
curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/install.sh | sudo MONGO_USER=foodadmin MONGO_PASS='YourPass123!' bash
```

**ساخت بسته قابل‌حمل (tar.gz) برای سرورهای بدون دسترسی به اینترنت:**

```bash
bash deploy/make-package.sh
# خروجی: dist/food-install-<تاریخ>.tar.gz
```

راهنمای کامل، گزینه‌های Nginx/HTTPS و نصب دستی در [RAHNAMA.md](./RAHNAMA.md#نصب-سریع-روی-لینوکس).

## نسخه‌بندی و به‌روزرسانی

آپدیت پیش‌فرض کل سامانه را روی **Docker** می‌برد (فرانت، بک، Mongo، WAF) و داده را حفظ می‌کند:

```bash
curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/update.sh | sudo bash
```

فقط حالت قدیمی بدون Docker: `sudo bash /opt/food/deploy/update.sh --bare-metal`

نسخه‌ها با [Semantic Versioning](https://semver.org/) و تگ‌های گیت (`v1.1.0`) منتشر می‌شوند.

| هدف | دستور |
|-----|--------|
| **آخرین نسخه** (شاخه `main`) | `sudo bash /opt/food/deploy/update.sh` |
| **نسخه مشخص** | `sudo bash /opt/food/deploy/update.sh --tag v1.2.0` |
| **بررسی نسخه فعلی** | `sudo bash /opt/food/deploy/update.sh --status` |
| **لیست نسخه‌ها** | `sudo bash /opt/food/deploy/update.sh --list` |

از GitHub (بدون اسکریپت محلی):

```bash
curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/update.sh | sudo bash -s -- --tag v1.2.0
```

**نگهدارنده مخزن** — انتشار نسخه جدید:

```bash
bash deploy/release.sh 1.2.0 "feat(admin): new report export"
git push origin main && git push origin v1.2.0
```

تاریخچه تغییرات: [CHANGELOG.md](./CHANGELOG.md) · انتشارها: [GitHub Releases](https://github.com/5emad/FoodMood/releases)
