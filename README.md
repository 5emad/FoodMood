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

فقط یوزر و پسورد دیتابیس را می‌پرسد؛ بقیه (MongoDB، Nginx، کلیدهای رمزنگاری، سوپرادمین با رمز تصادفی) خودکار انجام می‌شود. رمزها **فقط یک‌بار در ترمینال** نمایش داده می‌شوند و باید تأیید کنید که در خزانه رمز **خارج از سرور** ذخیره کرده‌اید — هیچ فایل رمز روی سرور ساخته نمی‌شود.

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
