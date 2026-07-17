# syntax=docker/dockerfile:1.7

# ── deps: نصب وابستگی‌ها (بدون postinstall تا سورس کپی شود) ───────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm ci --omit=dev --ignore-scripts \
 && npm ci --prefix frontend --ignore-scripts

# ── build: SPA + JS کلاینت + vendor ───────────────────────────────────────────
FROM deps AS build
WORKDIR /app
COPY . .
ENV NODE_ENV=production
RUN npm run build:client \
 && npm run vendor:sync \
 && npm run build --prefix frontend \
 && npm prune --omit=dev

# ── app: ران‌تایم Node (cluster-ready) ────────────────────────────────────────
FROM node:22-bookworm-slim AS app
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates tini curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 foodmood \
    && useradd --uid 10001 --gid foodmood --shell /usr/sbin/nologin --create-home foodmood

ENV NODE_ENV=production \
    PORT=3000 \
    TZ=Asia/Tehran \
    LOG_DIR=/app/backend/logs \
    NODE_OPTIONS=--max-old-space-size=1024 \
    CLUSTER_WORKERS=auto

COPY --from=build --chown=foodmood:foodmood /app/package.json /app/package-lock.json ./
COPY --from=build --chown=foodmood:foodmood /app/node_modules ./node_modules
COPY --from=build --chown=foodmood:foodmood /app/backend ./backend
COPY docker/app/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /app/backend/logs /app/backend/public/uploads/foods /app/backend/public/uploads/portal-slides \
 && chown -R foodmood:foodmood /app/backend/logs /app/backend/public/uploads

USER foodmood
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD curl -fsS http://127.0.0.1:3000/api/system/health || exit 1

ENTRYPOINT ["tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "backend/server.js"]

# ── nginx: استاتیک سریع + پروکسی API ──────────────────────────────────────────
FROM nginx:1.27-alpine AS nginx
RUN apk add --no-cache curl
COPY docker/nginx/nginx.conf /etc/nginx/nginx.conf
COPY docker/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/backend/public /var/www/food/public
RUN mkdir -p /var/www/food/public/uploads \
 && chown -R nginx:nginx /var/www/food
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=5 \
  CMD curl -fsS http://127.0.0.1/healthz || exit 1
