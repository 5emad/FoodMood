# Changelog

All notable changes to FoodMood are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
