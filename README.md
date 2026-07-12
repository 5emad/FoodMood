# سامانه تغذیه سازمانی

سیستم رزرو و سفارش غذا برای سازمان‌ها.

**راهنمای کامل:** [RAHNAMA.md](./RAHNAMA.md)

## شروع سریع

```bash
cp .env.example .env
npm install
npm start
```

پیش‌فرض: `http://localhost:3000`

## نصب پروداکشن لینوکس

سه روش نصب وجود دارد — همه Node.js و MongoDB را خودشان نصب و پیکربندی می‌کنند:

**۱) نصب یک‌خطی از GitHub روی سرور خام (پیشنهادی):**

```bash
curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/bootstrap.sh | sudo bash -s -- --quick
```

فقط یوزر و پسورد دیتابیس را می‌پرسد؛ سپس **دامنه و گواهی SSL** (اختیاری)، **فایروال UFW** (SSH + پورت‌های وب)، و **هاردنینگ پایه** خودکار انجام می‌شود. رمزها فقط یک‌بار در ترمینال نمایش داده می‌شوند.

**۲) نصب سریع از سورس محلی:**

```bash
sudo bash deploy/install-ubuntu.sh --quick
```

**۳) نصب تعاملی کامل (دامنه، HTTPS، انتخاب نام سوپرادمین):**

```bash
sudo bash deploy/install-ubuntu.sh
```

**ساخت بسته قابل‌حمل (tar.gz) برای سرورهای بدون دسترسی به اینترنت:**

```bash
bash deploy/make-package.sh
# خروجی: dist/food-install-<تاریخ>.tar.gz
```

راهنمای کامل، گزینه‌های Nginx/HTTPS و نصب دستی در [RAHNAMA.md](./RAHNAMA.md#نصب-سریع-روی-لینوکس).

## نسخه‌بندی و به‌روزرسانی

نسخه‌ها با [Semantic Versioning](https://semver.org/) و تگ‌های گیت (`v1.1.0`) منتشر می‌شوند.

| هدف | دستور |
|-----|--------|
| **آخرین نسخه** (شاخه `main`) | `sudo bash /opt/food/deploy/update.sh` |
| **نسخه مشخص** | `sudo bash /opt/food/deploy/update.sh --tag v1.1.0` |
| **بررسی نسخه فعلی** | `sudo bash /opt/food/deploy/update.sh --status` |
| **لیست نسخه‌ها** | `sudo bash /opt/food/deploy/update.sh --list` |

از GitHub (بدون اسکریپت محلی):

```bash
curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/update.sh | sudo bash -s -- --tag v1.1.0
```

**نگهدارنده مخزن** — انتشار نسخه جدید:

```bash
bash deploy/release.sh 1.2.0 "feat(admin): new report export"
git push origin main && git push origin v1.2.0
```

تاریخچه تغییرات: [CHANGELOG.md](./CHANGELOG.md) · انتشارها: [GitHub Releases](https://github.com/5emad/FoodMood/releases)
