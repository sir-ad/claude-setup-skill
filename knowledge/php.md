# PHP, Laravel and Symfony

Checked: 2026-10. The project's pinned versions always win over this file.

## Current versions
| Tool | Latest stable | Support notes |
|---|---|---|
| PHP 8.5 | 8.5.11 | GA 2025-11-20. Active support to 2027-12-31, security to 2029-12-31. |
| PHP 8.4 | 8.4.26 | Active support to 2026-12-31, security to 2028-12-31. |
| PHP 8.3 | 8.3.35 | Security fixes only, to 2027-12-31. |
| PHP 8.2 | 8.2.34 | Security fixes to 2026-12-31. 8.1 reached EOL 2025-12-31. |
| Laravel | 13.35.0 | 13 needs PHP 8.3 or newer (8.3 to 8.5). Security fixes to 2028-03-17. 12 supports PHP 8.2 to 8.5, security to 2027-02-24. 11 security ended 2026-03-12. |
| Symfony | 7.4.20 (LTS) | 7.4 needs PHP 8.2+. 8.1 (8.1.8) needs PHP 8.4.1+. 8.0 reached EOL 2026-07-31. 6.4 LTS to 2027-11-30. |
| PHPUnit | 13.4.1 | |
| Pest | 5.3.1 | 5.x needs PHP ^8.4 and PHPUnit ^13.4.1. 4.x needs PHP ^8.3 and PHPUnit 12.5. |
| PHPStan | 2.3.1 | |
| Larastan | 3.13.0 | Needs PHP ^8.2 and PHPStan ^2.3. |
| Laravel Pint | 1.32.1 | |

PHP 8.6 is in development and unreleased.

## Version notes
- **PHP >= 8.4**: property hooks and asymmetric visibility (`public private(set) string $name`) are available. Use them instead of boilerplate getters and setters in new code. `new Foo()->bar()` works without wrapping parentheses. [source](https://raw.githubusercontent.com/php/php-src/PHP-8.4/UPGRADING)
- **PHP >= 8.4**: implicitly nullable parameter types are deprecated. Write `?Foo $x = null`, not `Foo $x = null`. [source](https://raw.githubusercontent.com/php/php-src/PHP-8.4/UPGRADING)
- **PHP >= 8.4**: mark deprecated functions and methods with the `#[\Deprecated]` attribute instead of a docblock-only note. [source](https://raw.githubusercontent.com/php/php-src/PHP-8.4/UPGRADING)
- **PHP >= 8.5**: the pipe operator `|>` is available. `#[\NoDiscard]` and the `(void)` cast mark return values that must be used. [source](https://raw.githubusercontent.com/php/php-src/PHP-8.5/UPGRADING)
- **PHP >= 8.5**: use `(bool)`, `(int)`, `(float)` and `(string)` casts. The `(boolean)`, `(integer)`, `(double)` and `(binary)` casts are deprecated. [source](https://raw.githubusercontent.com/php/php-src/PHP-8.5/UPGRADING)
- **PHP >= 8.5**: the backtick shell operator is deprecated; use `shell_exec()`. Incrementing a non-numeric string with `++` is deprecated; use `str_increment()`. [source](https://raw.githubusercontent.com/php/php-src/PHP-8.5/UPGRADING)
- **PHP 8.1 or older**: 8.1 reached EOL on 2025-12-31. Do not use 8.2+ syntax unless `composer.json` `require.php` allows it. [source](https://endoflife.date/php)
- **Laravel >= 13**: requires PHP 8.3 or newer. New app skeletons ship `laravel/pint` and PHPUnit 12. [source](https://raw.githubusercontent.com/laravel/laravel/13.x/composer.json)
- **Laravel >= 13**: expanded PHP attributes are available (`#[Middleware]`, `#[Authorize]`, `#[Tries]`, `#[Backoff]`). The origin-aware CSRF middleware is `PreventRequestForgery`. Match the project's existing style before switching. [source](https://raw.githubusercontent.com/laravel/docs/13.x/releases.md)
- **Laravel >= 12**: the starter kits are React, Svelte, Vue and Livewire. Breeze and Jetstream no longer receive updates, so do not add them to new projects. [source](https://raw.githubusercontent.com/laravel/docs/12.x/releases.md)
- **Symfony >= 8.0**: requires PHP 8.4 or newer. 8.0 is 7.4 with all deprecated code removed, so fix every 7.4 deprecation notice before moving up. [source](https://raw.githubusercontent.com/symfony/symfony/8.1/UPGRADE-8.0.md)
- **Symfony 7.4 (LTS)**: supported on PHP 8.2 or newer, with security fixes to 2029-11-30. [source](https://raw.githubusercontent.com/symfony/symfony/7.4/composer.json)
- **Pest >= 5**: needs PHP 8.4+ and PHPUnit 13.4.1+. On PHP 8.3 stay on Pest 4 (PHPUnit 12.5). [source](https://raw.githubusercontent.com/pestphp/pest/5.x/composer.json)
- **Larastan >= 3**: supports Laravel 11, 12 and 13 and needs PHP 8.2+ and PHPStan 2.3+. [source](https://raw.githubusercontent.com/larastan/larastan/3.x/composer.json)

## Default toolchain
- Setup: `composer install`.
- Test: `vendor/bin/pest` if Pest is installed, otherwise `vendor/bin/phpunit`. Laravel projects also have `php artisan test`.
- Format: `vendor/bin/pint` for Laravel projects, or the project's PHP-CS-Fixer config.
- Static analysis: `vendor/bin/phpstan analyse` when a `phpstan.neon` exists.
- Check `composer.json` scripts first; many projects wrap these as `composer test` and `composer lint`.
