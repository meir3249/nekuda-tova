# Nekuda Tova (נקודה טובה)

One small moment of positive thought, once a day. A quiet notification, nothing to open, nothing to keep up with.

## What it does
A Progressive Web App on GitHub Pages. You pick a time (every 30 minutes, `:00` or `:30`) and turn notifications on. Once a day, around that time, one short message arrives as a Web Push notification. There is no account, no feed and no history.

## Principles
- No streaks, no scores, no guilt, no required interaction. Messages feel like a thought, not an instruction. See [DECISIONS.md](DECISIONS.md) D-001..D-004.
- **Calm space.** The screen is a quiet space: wide breathing room, a few soft cards, each label sharing one row with its control. Nothing appears on its own on load (apart from a one-time, dismissible install hint in iOS Safari). At most one gentle notice is visible at a time. No banners, inline status text, badges or helper text. Full wording: [specs/00-overview.md](specs/00-overview.md) section 3.
- Free to run, no analytics, no third-party scripts or fonts (the Rubik font is self-hosted).

## Architecture
```
 PWA (GitHub Pages) ──settings──▶ Supabase Edge Function ──▶ Postgres (RLS)
        ▲  service worker                                         ▲
        │  shows notification                                     │ claim / finalize
   Push service ◀── Web Push (VAPID) ◀── Sender (GitHub Actions, every 30 min)
                                              │
                                      data/messages.json
```
Pure TypeScript core (`src/core`) defines ports; adapters implement them for Supabase, web-push, the repo file and the system clock. `src/core` may not import infrastructure, enforced by an ESLint rule and a boundary test.

```
data/            messages.json (single source of content)
docs/            content-management, operations, privacy, limitations, verification
scripts/         validate-content, build-pwa, generate-vapid-keys, icons
specs/           task specs 00..08 and research notes
src/core/        pure logic and ports
src/adapters/    system, repo-file, supabase, web-push
src/sender/      Node entry point run by GitHub Actions
src/pwa/         the Vite app and service worker
supabase/        migrations, Edge Function, SQL tests
tests/           unit, adapter, boundary, PWA and function tests
.github/         ci.yml, send.yml, pages.yml
```
Contracts and conventions: [specs/00-overview.md](specs/00-overview.md).

## Prerequisites
- Node.js 24 (see `.nvmrc`)
- Git
- Optional: Docker Desktop and the Supabase CLI (installed by `npm ci`) for the local stack and SQL tests. Without Docker, apply the migrations by hand as described in [docs/operations.md](docs/operations.md).

## Run
```
npm ci
npm run dev:pwa       # PWA dev server (needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, see operations.md section 3.2)
npm run sender -- --dry-run     # Windows PowerShell 5.1 swallows "--": set $env:DRY_RUN = "1", then npm run sender
```
The sender reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the environment. A dry run sends and writes nothing and needs no VAPID keys. PowerShell and Unix examples are in [docs/operations.md](docs/operations.md) section 2.2.

## Test
```
npm test              # all tests
npm run test:boundary # architecture boundary checks only
npm run validate:content
npm run lint
npm run typecheck
npm run ci            # lint + typecheck + tests
npx supabase test db  # SQL and RLS tests (needs Docker and the local stack)
```

## Build and deploy
```
npm run build:pwa
```
The `pages.yml` workflow builds and deploys the PWA to GitHub Pages from the default branch. Setting up Supabase, GitHub secrets and Pages: [docs/operations.md](docs/operations.md).

## Content
Messages live in `data/messages.json` (currently Hebrew placeholders). Read [docs/content-management.md](docs/content-management.md) before editing. Validate with `npm run validate:content`.

## Privacy
[docs/privacy.md](docs/privacy.md)

## Limitations
Delivery and exact timing cannot be guaranteed. Read [docs/limitations.md](docs/limitations.md).

## Verification
Open items are tracked in [docs/remaining-work.md](docs/remaining-work.md).
[docs/verification/device-checklist.md](docs/verification/device-checklist.md), [docs/verification/accessibility-checklist.md](docs/verification/accessibility-checklist.md), [docs/verification/final-report-template.md](docs/verification/final-report-template.md).

## Cost
Everything is free: GitHub (public repo, Pages, Actions), Supabase free tier, Web Push. Free-tier numbers change; check the dates in [DEPENDENCIES.md](DEPENDENCIES.md) and [docs/operations.md](docs/operations.md) before relying on them.

## License
GNU Affero General Public License, version 3 or (at your option) any later version: [LICENSE](LICENSE). If you run a modified version as a network service, section 13 requires you to offer its source to the users of that service. Third-party dependency licenses are listed in [DEPENDENCIES.md](DEPENDENCIES.md).

The self-hosted Rubik font stays under its own SIL Open Font License ([OFL.txt](src/pwa/public/fonts/OFL.txt)).
