# Changelog

All notable changes to FoodMood are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/5emad/FoodMood/compare/v1.1.0...main
[1.1.0]: https://github.com/5emad/FoodMood/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/5emad/FoodMood/releases/tag/v1.0.0
