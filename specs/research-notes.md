# Research Notes

Labels: **CONFIRMED** (seen in an official or primary source during this session) · **REPORTED** (secondary source; must be re-verified against official docs in the named task) · **ASSUMPTION** · **RECOMMENDATION**.

I have not been able to run code or open every official page in full. Items marked REPORTED were seen only as search snippets from secondary sources.

## GitHub Actions

| Fact | Label | Source / verify in |
|---|---|---|
| `schedule` events can be delayed under high load and queued jobs may be dropped. | REPORTED (quoting GitHub docs) | [Events that trigger workflows – schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule). Verify in Task 5. |
| One third-party measurement: 64% of 15-minute slots produced a run over 7 days, median delay 7.4 min. | REPORTED (single unofficial blog, [Hyperping](https://hyperping.com/blog/how-to-monitor-github-actions-scheduled-workflows)) | Indicative only. Motivates the 2 h window and the `sender_runs` heartbeat. |
| Scheduled workflows in public repos are disabled after 60 days without repository activity; no failure notification. | REPORTED by several sources incl. GitHub community threads | Verify in Task 5. |
| Re-enabling a workflow through the API (`PUT /repos/{owner}/{repo}/actions/workflows/{id}/enable`) resets that timer. | ASSUMPTION (used by community keep-alive actions) | Verify in Task 5; fallback is documented manual re-enable. |
| Standard GitHub-hosted runner minutes are free for public repositories. | ASSUMPTION (well known; not re-fetched) | [About billing for GitHub Actions](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions). Verify in Task 1/5. |
| Cron minimum interval is 5 minutes; heavy load around the top of the hour. | ASSUMPTION | Verify in Task 5. Basis for P-07. |

## GitHub Pages

| Fact | Label | Source |
|---|---|---|
| Free for public repositories; size/bandwidth soft limits apply. | ASSUMPTION | [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits). Verify in Task 6. |
| Project sites are served under `/<repo>/`; service-worker scope and Vite `base` must match. | RECOMMENDATION | Task 6. |

## Supabase (free tier)

| Fact | Label | Source |
|---|---|---|
| Free projects are paused after 1 week of inactivity; limit of 2 active projects. | CONFIRMED (official pricing page snippet) | [Pricing](https://supabase.com/pricing), [Project pausing](https://supabase.com/docs/guides/platform/free-project-pausing) |
| A paused project can be restored from the dashboard within a 1-year window. | CONFIRMED (official docs snippet) | [Project pausing](https://supabase.com/docs/guides/platform/free-project-pausing) |
| "Inactivity" means little API/database activity; the 30-minute claim query counts as DB activity. | ASSUMPTION | Verify in Task 4/5. |
| Free tier numeric limits (DB size, MAU, egress, Edge Function invocations, anonymous sign-in rate limits). | ASSUMPTION (I recall 500 MB DB, 50k MAU, 500k function invocations; not verified) | [Pricing](https://supabase.com/pricing). **Task 4 must record current figures in `DEPENDENCIES.md` before building.** |
| Anonymous sign-ins, RLS, Edge Functions exist on the free plan. | ASSUMPTION | [Anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Edge Functions](https://supabase.com/docs/guides/functions). Verify in Task 4. |

## Web Push

| Fact | Label | Source |
|---|---|---|
| iOS/iPadOS 16.4+ supports Web Push for **Home Screen web apps**, via Push API, Notifications API, and service workers. | CONFIRMED | [WebKit blog](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) |
| On iOS, permission must be requested from a user gesture inside the installed web app; a Safari tab (or other iOS browser) cannot request it. | CONFIRMED by WebKit + multiple vendor docs | WebKit blog above; [OneSignal iOS web push](https://documentation.onesignal.com/docs/en/web-push-for-ios) |
| Android Chrome and desktop browsers support Web Push without installation. | ASSUMPTION (widely known) | [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API). Verify on device in Task 7. |
| `PushManager` is absent in an iOS Safari tab (so capability detection alone identifies "needs install"). | ASSUMPTION | Verify on device in Task 7. UA/platform hint is a secondary signal (iPadOS reports a desktop UA, so also check `maxTouchPoints`). |
| Push protocol: TTL, Urgency, Topic headers; TTL 0 means deliver only if the device is online. | CONFIRMED (RFC; library issue snippet) | [RFC 8030](https://www.rfc-editor.org/rfc/rfc8030), [RFC 8292 VAPID](https://www.rfc-editor.org/rfc/rfc8292) |
| Push services require every push to result in a visible notification (userVisibleOnly); Apple may revoke subscriptions for silent pushes. | ASSUMPTION (WebKit documents this; not re-quoted) | WebKit blog. Basis for R-06. |
| `notificationclick`: without a handler, a click only dismisses the notification in most browsers; iOS may open the PWA on tap regardless. | ASSUMPTION | [MDN notificationclick](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/notificationclick_event). **Verify on device in Task 7; record result.** |
| Installed iOS PWA has its own storage, separate from Safari tab storage. | ASSUMPTION (well known) | Verify in Task 7. Drives "no account before install". |

## Libraries and licenses (verify each in Task 1 and record in `DEPENDENCIES.md`)

| Package | Use | Expected license | Label |
|---|---|---|---|
| `web-push` | Sender: VAPID signing, payload encryption | **MPL-2.0** (the brief says MIT; I believe MPL-2.0, verify) | REPORTED/ASSUMPTION. [repo](https://github.com/web-push-libs/web-push). Maintenance status must be checked. |
| `@supabase/supabase-js` | PWA + sender adapter | MIT | ASSUMPTION |
| `typescript` | Language | Apache-2.0 | ASSUMPTION |
| `vite` | PWA build | MIT | ASSUMPTION |
| `vitest` | Tests | MIT | ASSUMPTION |
| `eslint`, `typescript-eslint` | Lint, boundary rule | MIT | ASSUMPTION |
| `esbuild` | Optional core bundling for Edge Function | MIT | ASSUMPTION |
| Supabase CLI | Migrations, function deploy, local stack | MIT | ASSUMPTION |

No timezone library is proposed: DST logic uses built-in `Intl` (full ICU, bundled in current Node and browsers). Fallback if `Intl` proves inadequate: `luxon` (MIT), requires approval.

Every package is pinned to an exact version at implementation time. No package outside this table is added without approval.

## Costs disclosed

| Item | Cost |
|---|---|
| GitHub (public repo, Pages, Actions) | Free |
| Supabase free project | Free; pausing and limits above |
| Web Push services (FCM, Mozilla, Apple) | Free; no account needed for VAPID |
| Apple Developer / Google Play fees | **Not applicable** (no app stores) |
| Testing on iOS | Needs a physical iPhone/iPad on iOS 16.4+ (hardware; no software cost). If none is available, iOS verification is documented as not performed. |
| Domain name | None; uses `github.io` |
