# DEPENDENCIES.md

Every dependency, with its exact version, license (read from the installed `package.json`, not from memory), purpose, and any free-tier limit. Nothing here costs money (D-009). Anything not listed needs approval before it is added.

Last updated: 2026-11-16 (Task 04).

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

### Version choices worth knowing
- **TypeScript 6.0.3, not the latest 7.0.2.** `typescript-eslint@8.73.0` declares a peer range of `typescript >=4.8.4 <6.1.0`, so 7.x would break linting. Revisit when `typescript-eslint` supports 7.
- **Node 24** is the current Active LTS. Node 24 can run `.ts` scripts directly (type stripping), so relative imports in this repo carry explicit `.ts` extensions and there is no extra TypeScript runner dependency.

## Transitive licenses (license scan of `node_modules`, depth 3)

97 MIT, 14 Apache-2.0, 6 ISC, 6 BSD-2-Clause, 2 BSD-3-Clause, 2 BlueOak-1.0.0, **2 MPL-2.0**. The two MPL-2.0 packages are `lightningcss` and its Windows binary, pulled in by Vitest's bundled Vite. They are development-only, unmodified, and never shipped. MPL-2.0 is a free/open-source license. No paid or proprietary license found.

## Pending (added by later tasks; not installed yet)

| Package / service | Task | Check required before adding |
|---|---|---|
| `web-push` | 05 | **R-08:** the brief says MIT; believed MPL-2.0. Read the real license from the package, check maintenance status, and record both here. Stop and ask if unmaintained or not free. |
| `@supabase/supabase-js` | 04 | Done: see runtime dependencies |
| Supabase CLI | 04 | Done: see dev dependencies |
| `vite` (direct) | 06 | License; exact pin (a transitive copy already exists via Vitest) |
| `happy-dom` or `jsdom` | 06 | License; exact pin |
| `esbuild` | 04 (only if the Edge Function cannot import `src/core` directly) | License; exact pin |
| Supabase free tier | 04 | Done: see "Supabase free tier (checked 2026-11-16)" below |
| GitHub Pages / Actions limits | 05, 06 | Record current limits |

## GitHub Actions used

| Action | Pinned to | Notes |
|---|---|---|
| `actions/checkout` | `3d3c42e5aac5ba805825da76410c181273ba90b1` (v7.0.1) | First-party |
| `actions/setup-node` | `949feb2413d6458794dcd2491c4babbbce0c15c1` (v7.1.0) | First-party |

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
