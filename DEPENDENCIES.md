# DEPENDENCIES.md

Every dependency, with its exact version, license (read from the installed `package.json`, not from memory), purpose, and any free-tier limit. Nothing here costs money (D-009). Anything not listed needs approval before it is added.

Last updated: 2026-11-16 (Task 06).

## Runtime and tooling

| Item | Version | License | Purpose | Cost / limits |
|---|---|---|---|---|
| Node.js | 24.x (Active LTS at 2026-11-16; `.nvmrc` = `24`; developer machine runs 24.12.0) | MIT | Runtime for tests, scripts, sender | Free |
| npm | 11.7.0 (bundled) | Artistic-2.0 | Package manager | Free |
| GitHub-hosted runners (`ubuntu-latest`) | n/a | n/a | CI | Free for public repos (**ASSUMPTION**, re-verify at [billing docs](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions) once the repo is public) |

## Direct dev dependencies (exact pins)

| Package | Version | License | Purpose |
|---|---|---|---|
| `typescript` | 6.0.3 | Apache-2.0 | Language, type checking, `preProcessFile` for the boundary test |
| `vitest` | 5.1.0 | MIT | Test runner |
| `vite` | 8.3.8 | MIT | PWA build and dev server (P-12). Same version Vitest already used, so it is deduplicated. Uses `lightningcss` (MPL-2.0, build tool only, see below) for CSS. |
| `happy-dom` | 21.0.4 | MIT | DOM for the PWA screen tests. Its dependencies: `whatwg-mimetype`, `ws`, `@types/ws`, `@types/whatwg-mimetype` (MIT), `entities` (BSD-2-Clause) |
| `eslint` | 10.15.0 | MIT | Linting, core import restrictions |
| `@eslint/js` | 10.0.1 | MIT | ESLint recommended rules |
| `typescript-eslint` | 8.73.0 | MIT | TypeScript lint rules |
| `globals` | 17.14.0 | MIT | Global names per environment |
| `@types/node` | 24.19.2 | MIT | Node typings (tests and scripts only; not visible to `src/core` lint rules) |
| `supabase` (CLI) | 3.2.0 | MIT | Migrations, local stack, `db push`, function deploy. Local stack needs Docker (optional). Downloads a platform binary on install. |

## Direct runtime dependencies (exact pins)

| Package | Version | License | Purpose |
|---|---|---|---|
| `@supabase/supabase-js` | 2.119.0 | MIT | Supabase client for the adapters, the Edge Function and the PWA settings API. Its dependencies (`auth-js`, `functions-js`, `postgrest-js`, `realtime-js`, `storage-js`, `phoenix`) were checked and are all MIT. |
| `web-push` | 4.0.0 | **MPL-2.0** (read from the installed `package.json` and `LICENSE`) | Web Push encryption and VAPID signing for the sender (`src/adapters/web-push`) and `scripts/generate-vapid-keys.ts`. Never shipped to the PWA (boundary rule). |

### Version choices worth knowing
- **TypeScript 6.0.3, not the latest 7.0.2.** `typescript-eslint@8.73.0` declares a peer range of `typescript >=4.8.4 <6.1.0`, so 7.x would break linting. Revisit when `typescript-eslint` supports 7.
- **Node 24** is the current Active LTS. Node 24 can run `.ts` scripts directly (type stripping), so relative imports in this repo carry explicit `.ts` extensions and there is no extra TypeScript runner dependency.

## Transitive licenses (license scan of `node_modules`, depth 3)

97 MIT, 14 Apache-2.0, 6 ISC, 6 BSD-2-Clause, 2 BSD-3-Clause, 2 BlueOak-1.0.0, **2 MPL-2.0**. The two MPL-2.0 packages are `lightningcss` and its Windows binary, pulled in by Vitest's bundled Vite. They are development-only, unmodified, and never shipped. MPL-2.0 is a free/open-source license. No paid or proprietary license found.

## Pending (added by later tasks; not installed yet)

| Package / service | Task | Check required before adding |
|---|---|---|
| `@supabase/supabase-js` | 04 | Done: see runtime dependencies |
| Supabase CLI | 04 | Done: see dev dependencies |
| `esbuild` | 04 (only if the Edge Function cannot import `src/core` directly) | License; exact pin |
| Supabase free tier | 04 | Done: see "Supabase free tier (checked 2026-11-16)" below |
| GitHub Actions limits | 05 | Done: see "GitHub Actions scheduling (checked 2026-11-16)" below |
| GitHub Pages limits | 06 | Done: see "GitHub Pages (checked 2026-11-16)" below |

## GitHub Actions used

| Action | Pinned to | Notes |
|---|---|---|
| `actions/checkout` | `3d3c42e5aac5ba805825da76410c181273ba90b1` (v7.0.1) | First-party |
| `actions/setup-node` | `949feb2413d6458794dcd2491c4babbbce0c15c1` (v7.1.0) | First-party |

| `actions/upload-pages-artifact` | `fc324d3547104276b827a68afc52ff2a11cc49c9` (v5.0.0) | First-party (`pages.yml`) |
| `actions/deploy-pages` | `368f82528645a54fb793d4d04e342629a3f51346` (v5.0.1) | First-party (`pages.yml`) |

checkout and setup-node are used by `ci.yml`, `send.yml` and `pages.yml`; the Pages SHAs were read with `git ls-remote` on 2026-11-16 (lightweight tags, so the SHA is the commit). `send.yml` also calls the GitHub REST API with `gh` (preinstalled on GitHub runners) for the keep-alive step; no extra action.

## Supabase free tier (checked 2026-11-16)

Sources: [pricing](https://supabase.com/pricing), [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits), [Edge Functions limits](https://supabase.com/docs/guides/functions/limits), [function secrets](https://supabase.com/docs/guides/functions/secrets). Everything this project needs is included in the Free plan, so nothing here blocks D-009.

| Item | Free plan | Our usage / note |
|---|---|---|
| Database size | 500 MB | Rows are tiny; the subscription cap (P-09, default 5000) and retention (P-03, 90-day logs) keep it far below the limit |
| Monthly active users | 50,000 | Anonymous users count as MAU; capped by P-09 |
| Anonymous sign-ins | Included | Rate limit 30 per hour per IP by default (burst equals the limit); configurable |
| Edge Function invocations | 500,000 per month | One call per settings change or load |
| Edge Function runtime | 150 s wall clock, 2 s CPU per request, 256 MB memory | Settings function is milliseconds |
| Edge Function size | 20 MB (CLI-bundled), 5 MB (server-bundled) | Small |
| Secrets | up to 100 per project | A handful |
| Egress | 5 GB | Tiny payloads |
| API requests | Unlimited | |
| Projects | 2 active | We use 1 |
| **Pausing** | **Paused after 1 week of inactivity** | Mitigated by regular sender activity and the keep-alive in Task 05; restore is manual from the dashboard |
| Log retention | 1 day (API and database), 24 h auth audit logs | Our own `delivery_log` is the durable record |

**Not checked / unverified:** the Supabase pricing page is a marketing page and plans can change; re-check before launch. Free-tier statements were read from official Supabase pages, not tested against a live project (none exists yet).

## `web-push` (R-08, checked 2026-11-16)

- **License: MPL-2.0**, not MIT as the brief said. MPL-2.0 is a free, open-source, file-level copyleft license. We use the package unmodified as a dependency, which carries no obligation for our own code. If we ever modified its files, those files would have to stay MPL-2.0 and be published.
- **Maintenance:** 4.0.0 was published on 2026-11-06 (ten days before this check); the 3.6.x line had releases through 2024. Repository: `github.com/web-push-libs/web-push`. It is the standard Node library for Web Push. Considered maintained.
- **Typings:** none shipped; `@types/web-push` is 3.6.4 (MIT) and lags 4.0.0, so it is not installed. A minimal declaration lives in `src/adapters/web-push/web-push.d.ts`.
- **Its runtime dependencies** (from `package-lock.json`): `jws` 4.0.1, `jwa` 2.0.1, `asn1.js` 5.4.1, `bn.js` 4.12.5, `http_ece` 1.2.1, `https-proxy-agent` 9.1.0, `agent-base` 9.0.0, `debug` 4.4.3, `ms` 2.1.3, `safe-buffer` 5.2.1, `safer-buffer` 2.1.2 (all MIT); `inherits` 2.0.4 and `minimalistic-assert` 1.0.1 (ISC); `ecdsa-sig-formatter` 1.0.11 (Apache-2.0); `buffer-equal-constant-time` 1.0.1 (BSD-3-Clause). `npm audit`: 0 vulnerabilities.

## GitHub Actions scheduling (checked 2026-11-16)

Source: [events that trigger workflows: schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) and [disabling and enabling a workflow](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/disabling-and-enabling-a-workflow).

| Item | Current rule | Our handling |
|---|---|---|
| Delay / drops | Scheduled runs can be delayed under load (worst at the start of each hour); under enough load queued jobs may be dropped | Cron at `:03` and `:33` (P-07); 2-hour lateness window (D-011); `sender_runs` heartbeat shows gaps |
| Branch | Runs only on the default branch, using its latest commit | Content is always the merged `data/messages.json` |
| Minimum interval | 5 minutes | We use 30 |
| Auto-disable | In a public repository, scheduled workflows are disabled after 60 days without repository activity | Keep-alive step (P-11, unverified) + fallback in `docs/operations.md` 2.4 |
| Minutes | Free for public repositories on standard runners (**ASSUMPTION**, see the runner row above) | About 1 minute per run, 48 runs a day |

## Shipped in the PWA bundle (Task 06)

Only `@supabase/supabase-js` (MIT) and its helpers, including `tslib` 2.8.1 (**0BSD**, a permissive license without an attribution requirement), plus our own code. The bundle is about 226 kB (60 kB gzipped), almost all supabase-js. Lockfile license totals after Task 06: 158 MIT, 16 Apache-2.0, 8 ISC, 7 BSD-2-Clause, 6 0BSD, 3 BSD-3-Clause, 2 BlueOak-1.0.0, 13 MPL-2.0. The 13 MPL-2.0 entries are `web-push` plus `lightningcss` and its 11 per-platform binaries (only one is installed). Nothing paid or proprietary.

**Font: Rubik** (Rubik Project Authors, **SIL Open Font License 1.1**, free, redistribution allowed with the license). Downloaded once from Google Fonts (v31, variable weight 400–600, Hebrew 9 kB + Latin 35 kB woff2) and self-hosted in `src/pwa/public/fonts/` with `OFL.txt` alongside. Served from the app's own origin, so users' browsers never contact Google (privacy rule and CSP in spec 06).

## GitHub Pages (checked 2026-11-16)

Source: [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).

| Item | Limit | Our usage |
|---|---|---|
| Published site size | 1 GB | About 240 kB |
| Bandwidth | 100 GB per month (soft) | Tiny static files, cached by the service worker |
| Deployment time | 10 minutes | Under a minute |
| Builds | 10 per hour (soft), not applied to custom Actions workflows | We use a custom workflow |
| Use policy | Not for commercial transactions or sensitive data such as passwords | A free, non-commercial settings page; no passwords |
## Project license (2026-11-23)

This project is **AGPL-3.0-or-later** (LICENSE, package.json). Compatibility with the dependencies: MIT, 0BSD and similar permissive licenses are compatible. web-push (MPL-2.0) is compatible because MPL-2.0 section 3.3 allows combining with GNU licenses as a secondary license, provided the MPL files carry no 'Incompatible With Secondary Licenses' notice (not re-verified file by file; re-check when upgrading). The Rubik font (OFL-1.1) is a separate bundled asset under its own license. The Edge Function and the PWA are served to users over a network, so AGPL section 13 applies if you modify and host them.
