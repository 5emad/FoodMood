# Changelog

All notable changes to FoodMood are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.9.16] - 2026-07-26

### Fixed
- Console CSP errors: firewtwall was overwriting Helmet CSP with `default-src 'self'` only — blocked React inline styles and `data:` SVG images; WAF security-headers now deferred to Helmet
- Helmet CSP: explicit `style-src` / `style-src-attr` / `img-src data: blob:` for SPA
- Security: WAF no longer trusts arbitrary `sid` cookies (path-only app-surface trust)
- Security: superadmin health-gate requires valid JWT, not forged role cookie alone; timing-safe role HMAC verify
- Security: password field hidden by default on login
- WAF panel toggle: DB setting wins over env (toggle in Super→Security works again)
- Admin bootstrap: do not retry FORBIDDEN_ROLE as session race
- Root redirect: navigate once via useEffect (avoid render-time replace loops)
- WAF stays off the hot path for `/api` and `/admin` so it does not slow the panel

## [1.9.15] - 2026-07-26

### Fixed
- WAF no longer blocks admin panel navigation: trust entire app surface (`/api`, `/admin`, `/user`, static, session cookies) before firewtwall runs
- Soften entropy/heuristic/mutation/rhythm; tarpit off by default; higher rate ceilings
- Default WAF off (`WAF_ENABLED=false` on update + `appsettings.wafEnabled` default false) until superadmin enables it intentionally

## [1.9.14] - 2026-07-26

### Fixed
- Reports tab load: months list no longer scans/populates entire Orders collection; cached 90s
- Report queries use lean + status filter + dailyMenuId indexes; skip blocking finalize; omit raw orders from JSON
- Supplier report uses slim `prep` mode (no users/LDAP scaffolding)
- Frontend loads months only when opening monthly tab so weekly reports appear immediately

### Added
- Order indexes: `orderDate`, `menuItemId`, `status+orderDate`, `dailyMenuId+status`

## [1.9.13] - 2026-07-26

### Fixed
- Admin settings/data APIs under `/api/admin/*` were still scanned by WAF → «درخواست مجاز نیست» and saves did nothing; entire `/api/` is now trusted (app auth/CSRF/rate-limit remain)
- Clearer FORBIDDEN_ROLE message includes current role vs required role

### Added
- `deploy/emergency-unlock.sh` — turn WAF off, reset superadmin, print DB counts

## [1.9.12] - 2026-07-26

### Fixed
- «درخواست مجاز نیست» on login/admin: WAF now trusts `/api/auth/*` and `/api/app/*`; softer rate/burst defaults
- Root URL (`/`) always redirects to `/login` (SPA static no longer captures index)
- Logout works via server GET `/logout` (clears session cookies) instead of fragile SPA POST

## [1.9.11] - 2026-07-26

### Added
- App version persisted in MongoDB (`appsettings.appVersion`) on every boot and shown on login/admin from DB
- `deploy/import-json.sh` to restore mongoexport JSON folders; `restore-data.sh --from-json`
- Update summary prints DB version and user/order counts for empty-DB diagnosis

### Fixed
- Version badge now shows full semver (e.g. ۱.۹.۱۱) instead of only major «۱»
- SPA still injects version into HTML when DB is empty/unavailable

## [1.9.10] - 2026-07-25

### Fixed
- Admin panel no longer force-logouts on bootstrap race after login; shows clear error and retry path instead

## [1.9.9] - 2026-07-25

### Fixed
- Logout always succeeds (CSRF exempt, never throws); admin panel waits for bootstrap before mounting tabs to stop spam «دسترسی غیرمجاز»

## [1.9.8] - 2026-07-25

### Fixed
- “دسترسی غیرمجاز” after promote: authorize with DB role, case-insensitive roles, auto-issue missing superadmin 2FA token, redirect non-admin away from `/admin`

## [1.9.7] - 2026-07-25

### Added
- One-shot update auto-recovery: copy `food_reservation`→`food_ordering`, restore newest backup if empty, create/promote superadmin automatically and print credentials

## [1.9.6] - 2026-07-25

### Fixed
- Docker-exit dump/restore used wrong DB name `food_reservation` instead of `food_ordering` (data appeared “lost”)
- `reset-credentials` now promotes existing `admin` → `superadmin` (no more stuck plain admin)

### Added
- `deploy/restore-data.sh` to scan backups and restore into `food_ordering`

## [1.9.5] - 2026-07-25

### Fixed
- Blank white login page: serve Vite `/assets` before WAF (JS/CSS were blocked so the username form never mounted)

## [1.9.4] - 2026-07-25

### Fixed
- Diagnose superadmin query: require `./backend/src/models/User` (was broken MODULE_NOT_FOUND)
- Site HTTPS probe no longer reports `000000` when curl `-f` fails

## [1.9.3] - 2026-07-25

### Fixed
- Login / DB access after Docker exit: normalize `MONGODB_URI` host to `127.0.0.1`, recreate missing superadmin on reset, bypass WAF for SPA shells (`/login`, `/admin/*`), surface real API error messages on login

## [1.9.2] - 2026-07-25

### Changed
- `update.sh` console UI: English-only, numbered steps, banner / success card

## [1.9.1] - 2026-07-25

### Fixed
- WAF blocking all page loads after Docker→bare-metal: ensure loopback is always in `TRUSTED_PROXIES` / `WAF_TRUSTED_PROXIES` so nginx client IPs are not collapsed to `127.0.0.1`

## [1.9.0] - 2026-07-24

### Removed
- Docker / Compose deployment path (`Dockerfile`, `docker-compose.yml`, `docker/`, `deploy/lib-docker.sh`)
- Docker-related npm scripts and docs

### Changed
- `update.sh` is bare-metal only (systemd + host MongoDB + Nginx)
- Servers still on Docker are migrated off automatically on update (mongo dump → host mongod, compose down, nginx → `:3000`)

## [1.8.0] - 2026-07-17

### Added
- Docker as default update path (`update.sh`) with data-preserving migration from bare metal
- Built-in WAF (`firewtwall`) with safe client errors and ObjectId compatibility for Mongo IDs
- Admin React panels for foods/users/orders/reports and superadmin security/settings/backup

### Fixed
- Admin edit/delete actions failing when WAF scrubbed `weekId` / ObjectIds from requests
- SweetAlert confirm dialogs not receiving clicks in admin panel
- Stable admin sidebar layout (no remount jump between tabs)

### Changed
- `update.sh` defaults to Docker (`--bare-metal` for emergency only)
- SPA admin shell uses nested routes with shared `AdminLayout`

## [1.2.2] - 2026-07-13

### Added
- Reports section locked until all pending orders are confirmed (admin + superadmin)
- `GET /api/admin/reports/access` status endpoint
- `npm run stop` / `npm run restart` scripts for clean server reload on Windows/Linux

### Fixed
- Reports gate now enforced server-side on page load (not only client API)
- Superadmin no longer bypasses pending-order gate
- Confirm button approves all pending orders (`scope: all`)

## [1.2.1] - 2026-07-13

### Fixed
- PDF weekly/monthly download: missing `nextReportNumber` import caused 503 errors
- API errors no longer masked as generic outage message (except real DB failures)
- Health gate auto-recovers when MongoDB reconnects but stale unhealthy flag remains
- User portal reservation toast notifications (native toast instead of broken SweetAlert)
- PDF client validates response content-type before download

### Changed
- Clearer PDF/Chromium error messages in admin panel

## [1.2.0] - 2026-07-13

### Added
- Encrypted announcements: admin CRUD, department/all targeting, user bottom-sheet UI
- DB outage page, structured system logs, `foodmood` systemd unit
- Hashed session tokens with rotation on login/logout
- Persian Jalali datepicker for announcement expiry (admin)
- **LDAP production guide:** [docs/LDAP-PRODUCTION.md](./docs/LDAP-PRODUCTION.md) (certificates, `.env`, troubleshooting)
- `ANNOUNCEMENT_ENCRYPTION_KEY` in installer `.env` and LDAP placeholders in install script

### Changed
- Admin theme (burgundy), public URL setting, login/session fixes, table footers
- Installer creates `/opt/food/certs/`, documents `foodmood` systemd unit consistently
- LDAP admin save validation fixed (`ldapConfig` mapping)

### Fixed
- Login password field RTL layout; `/login?expired=1` redirect loop
- Self-admin deactivation guard; monthly report empty state

### Removed
- Local-only `START-MONGODB.bat` and `seed.js` from repository

## [1.1.0] - 2026-07-12

### Added
- Automated Linux installer with FoodMood banner, UFW firewall, and base hardening
- Off-server credential acknowledgement during install (no secrets file on disk)
- Domain and SSL certificate configuration (Let's Encrypt or custom paths)
- Security fixes: superadmin 2FA lockout, password policy on admin user APIs
- Deployment tooling: `bootstrap.sh`, `make-package.sh`, `update.sh`, `release.sh`

### Changed
- Install output uses `INSTALL_INFO.txt` instead of `CREDENTIALS.txt`

## [1.0.0] - 2026-07-12

### Added
- Initial FoodMood release: food ordering system with security hardening
- MongoDB session store, LDAP auth, backup encryption, admin panel

[Unreleased]: https://github.com/5emad/FoodMood/compare/v1.2.2...main
[1.2.2]: https://github.com/5emad/FoodMood/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/5emad/FoodMood/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/5emad/FoodMood/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/5emad/FoodMood/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/5emad/FoodMood/releases/tag/v1.0.0
