# Ruby and Rails

Checked: 2026-10. The project's pinned versions always win over this file.

## Current versions
| Tool | Latest stable | Support notes |
|---|---|---|
| Ruby | 4.0.7 (2026-09-14) | 4.0 EOL 2029-03-31. 3.4 EOL 2028-03-31, 3.3 EOL 2027-03-31. 3.2 reached EOL 2026-03-31. There is no Ruby 3.5; that line became 4.0. |
| Rails | 8.1.4 | 8.1 bug fixes end 2026-10-10, security to 2027-10-10. 8.0 EOL 2026-11-07. 7.2 reached EOL 2026-08-09. |
| rubocop | 1.91.0 | |
| standard | 1.57.0 | |
| rubocop-rails-omakase | 1.1.0 | Rails default style. |
| rspec | 3.13.2 | |
| minitest | 6.0.6 | |
| kamal | 2.12.0 | |
| solid_queue | 1.7.0 | |
| brakeman | 8.1.0 | |

## Version notes
- **Ruby >= 4.0**: `Set` is a core class. Do not write `require "set"`, and do not use `SortedSet` (removed). [source](https://raw.githubusercontent.com/ruby/ruby/v4.0.0/NEWS.md)
- **Ruby >= 4.0**: `ostruct` is a bundled gem, not a default gem. Add `gem "ostruct"` to the Gemfile if the code uses `OpenStruct`. Of CGI, only `cgi/escape` stays in the default gems, so do not `require "cgi"` for other features without adding the dependency. [source](https://raw.githubusercontent.com/ruby/ruby/v4.0.0/NEWS.md)
- **Ruby >= 4.0**: a line that starts with `&&`, `||`, `and` or `or` continues the previous line. Do not begin a new statement with one of those tokens. [source](https://raw.githubusercontent.com/ruby/ruby/v4.0.0/NEWS.md)
- **Ruby >= 4.0**: `Ractor.yield` and `Ractor#take` are removed. Use `Ractor::Port`. [source](https://raw.githubusercontent.com/ruby/ruby/v4.0.0/NEWS.md)
- **Ruby >= 4.0**: YJIT is still the production JIT. ZJIT is experimental, so do not enable it in deployment config. [source](https://raw.githubusercontent.com/ruby/ruby/v4.0.0/NEWS.md)
- **Rails >= 8.0**: needs Ruby 3.2.0 or newer. Rails 8.2 (on `main`, alpha) will need Ruby 3.3.5 or newer. [source](https://raw.githubusercontent.com/rails/rails/main/guides/source/upgrading_ruby_on_rails.md)
- **Rails >= 8.0**: new apps use Solid Queue for jobs, Solid Cache for caching and Solid Cable for Action Cable, all database-backed. Do not add Redis, Sidekiq or Memcached unless the project already uses them. [source](https://raw.githubusercontent.com/rails/rails/main/guides/source/8_0_release_notes.md)
- **Rails >= 8.0**: new apps use Propshaft, not Sprockets, for assets. Deployment defaults are Kamal 2 (with Kamal Proxy) and Thruster in the Dockerfile. [source](https://raw.githubusercontent.com/rails/rails/main/guides/source/8_0_release_notes.md)
- **Rails >= 8.0**: for sign-in, `bin/rails generate authentication` creates a session-based authentication setup. Use it before reaching for a gem if the project has no auth yet. [source](https://raw.githubusercontent.com/rails/rails/main/guides/source/8_0_release_notes.md)
- **Rails >= 8.1**: Active Job has continuations (`ActiveJob::Continuable` with `step`) for long jobs that must resume after a restart. `bin/ci` runs the CI steps locally. [source](https://raw.githubusercontent.com/rails/rails/main/guides/source/8_1_release_notes.md)
- **Rails 8.1 new apps**: the generated Gemfile includes `rubocop-rails-omakase`, `brakeman` and `bundler-audit`, and `.rubocop.yml` inherits `rubocop-rails-omakase`. Use that style; do not add Standard or a second rubocop config. [source](https://raw.githubusercontent.com/rails/rails/8-1-stable/railties/lib/rails/generators/rails/app/templates/rubocop.yml.tt)
- **Rails 8.1 new apps**: system tests use `capybara` with `selenium-webdriver`. The generator adds no RSpec entry, so follow the test framework already in the project. [source](https://raw.githubusercontent.com/rails/rails/8-1-stable/railties/lib/rails/generators/rails/app/templates/Gemfile.tt)
- **Rails 7.2 or older**: Rails 7.2 reached EOL on 2026-08-09. Do not use 8.x defaults (Solid Queue, Propshaft, the authentication generator) in a 7.x app without an explicit upgrade. [source](https://endoflife.date/ruby-on-rails)

## Default toolchain
- Setup: `bundle install`.
- Test: `bin/rails test` (Minitest), or `bundle exec rspec` if the project has a `spec/` directory.
- Lint: `bundle exec rubocop`.
- Security checks, if in the Gemfile: `bundle exec brakeman`.
- Rails 8.1 and newer: `bin/ci` runs the project's CI steps locally.
