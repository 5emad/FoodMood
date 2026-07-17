# استقرار با Docker

## آپدیت عادی = مهاجرت به Docker

از این نسخه، دستور آپدیت **به‌صورت پیش‌فرض** کل سامانه را داکرایز می‌کند:

```bash
curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/update.sh | sudo bash
```

| چه می‌شود | جزئیات |
|-----------|--------|
| فرانت + بک | ایمیج `app` (با **WAF**) |
| دیتابیس | کانتینر `mongo` — داده از نصب قبلی **restore** می‌شود |
| آپلودها | volume — از `/opt/food/backend/public/uploads` کپی می‌شود |
| HTTPS | Nginx میزبان روی 443 → `127.0.0.1:8080` (Docker) |
| پرفورمنس | `CLUSTER_WORKERS=auto` + `--scale app=2` |

داده از دست نمی‌رود؛ بکاپ زیر `/var/backups/foodmood-docker-migrate-*`.

فقط در اضطرار بدون Docker:

```bash
sudo bash /opt/food/deploy/update.sh --bare-metal
```

## نصب تازه (فقط Docker)

```bash
cp .env.docker.example .env.docker
# رازها را پر کنید — برای سرور عمومی HTTP_BIND=0.0.0.0 و HTTP_PORT=80
docker compose --env-file .env.docker up -d --build
```

## آپدیت وقتی از قبل Docker هستید

همان `update.sh` — فقط کد را sync می‌کند و `docker compose up -d --build` می‌زند؛ volumeها دست‌نخورده می‌مانند.

```bash
APP_SCALE=3 curl -fsSL .../deploy/update.sh | sudo bash
```

## مقیاس دستی

```bash
cd /opt/food
docker compose --env-file .env.docker up -d --scale app=2
```
