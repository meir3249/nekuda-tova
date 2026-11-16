# 06 — PWA Shell and Settings UI

## Purpose and scope
The installable PWA: manifest, service worker (push display only), the single settings screen, instant render, "saved" confirmation, and the GitHub Pages deploy. Push permission and subscription logic arrive in Task 7; here the toggle and time are saved to Supabase and the screen works without push.

## Relevant requirements
Brief §3; hand-off Req 5, 6. D-003, D-004, D-012, D-017, P-12, P-13, P-15.

## Technical design

### Build
Vite with root `src/pwa`, output `dist/`, `base = '/<REPO_NAME>/'` (Q-02, from env `PWA_BASE`). Vanilla TypeScript, no UI framework, no CSS framework. Service worker built as a separate entry (`sw.ts` → `sw.js` at the base path root so its scope covers the app). Public env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`.

### Manifest (`manifest.webmanifest`)
`name` "Nekuda Tova", `short_name` same, `display: standalone`, `start_url` and `scope` = base, `background_color`/`theme_color` neutral, icons 192, 512 and maskable 512 (Q-04: generated simple placeholder unless the user provides one), `lang` per Q-01.

### Screen layout (single page; no routing)
Order top to bottom:
1. Title (product name) and one calm line of subtitle from `strings`.
2. **Time**: native `<select>` with 48 half-hour options (from core `SLOTS`), label "Time". Display uses `Intl.DateTimeFormat` for the user's locale (12/24 h) but the option **value** is always `"HH:MM"`. Default `09:00` until chosen (P-13). A native select is chosen over `<input type="time">` because step/half-hour behavior is inconsistent on mobile pickers.
3. **Notifications switch**: `<input type="checkbox" role="switch">` with a visible label and state text. Initial state off (P-15).
4. **Status area** (`aria-live="polite"`, one line): gentle messages from Task 7 (permission denied, needs install, unsupported) and the tiny "Saved" confirmation.
5. **How it works**: a `<details>` element (collapsed) with a short manifesto text from `strings` (Q-05) and an optional link slot for a future video (not shown now).
6. Footer: link to privacy note (`docs/privacy.md` rendered or linked on GitHub).

Not present: feed, history, accounts, streaks, scores, analytics, refresh button, sound settings, modals for sync, blocking loaders.

### Behavior
- **Instant render:** HTML is static; JS reads cached settings from `localStorage` (`ntk.settings.v1`: time, timezone, enabled) and renders synchronously; first paint never waits for the network. If no cache, defaults apply.
- **Reconcile in background:** after render, if a Supabase session already exists, `getSettings()` and update the UI silently if it differs. No spinner. If no session exists, nothing is created yet (P-15).
- **Saving:** changing the time or the switch calls `saveSettings(patch)` (Task 4 API). Lazily `ensureSession()` on the first save. Changes are debounced 400 ms and coalesced; the control stays interactive. On success show "Saved" for 2 s (`aria-live`, respects `prefers-reduced-motion`; a fade, no motion). On failure show "Couldn't save just now. We'll try again." and keep a `pending` patch in `localStorage`, retried on `online` event and next app open. No technical detail shown.
- **Enabling in Task 6** (before Task 7) is disabled with a short explanation only if push is unavailable; the full flow is Task 7. During Task 6 acceptance, the switch saves `enabled=false` only; the enabling path is gated behind a feature flag removed in Task 7.
- **Timezone:** `Intl.DateTimeFormat().resolvedOptions().timeZone` read on every open and sent with settings (auto-follow rule completed in Task 7).
- **Service worker** (`sw.ts`): handles `push` and `install/activate` (`skipWaiting`, `clients.claim`). No fetch caching beyond a minimal app-shell precache for installability (static assets only; never caches Supabase calls). The `push` handler is specified fully in Task 7. There is **no** `notificationclick` handler beyond closing the notification (`event.notification.close()`) and no `clients.openWindow`/`focus` (D-017).
- **Accessibility:** labels bound to controls, visible focus, ≥ 4.5:1 contrast, touch targets ≥ 44 px, supports 200% text zoom, honors `prefers-reduced-motion` and `prefers-color-scheme` (light/dark), `lang` attribute set; RTL deferred pending Q-01 but styles use logical properties (`margin-inline`, etc.) so RTL is a text change only. Full WCAG conformance requires manual testing with assistive technologies and expert review; this spec only commits to the checklist above.
- **Privacy:** no third-party requests, no analytics, no remote fonts. Only calls: GitHub Pages assets and Supabase.

### Deploy `.github/workflows/pages.yml`
On push to default branch: `npm ci`, `build:pwa` (with public env from repository **variables**, not secrets), upload artifact, `actions/deploy-pages`. Permissions `pages: write`, `id-token: write`. `docs/operations.md` explains enabling Pages (source: GitHub Actions). Costs: none (public repo).

## Files and components
`src/pwa/{index.html,main.ts,sw.ts,strings.ts,styles.css,manifest.webmanifest}`, `src/pwa/ui/{settings-screen.ts,time-select.ts,status.ts}`, `src/pwa/state/{local-cache.ts,save-queue.ts}`, `src/pwa/assets/icons/*`, `vite.config.ts`, `.github/workflows/pages.yml`, `tests/pwa/*`.

## Interfaces and contracts
Uses `settings-api` (Task 4) and core `SLOTS`, `isValidSlot`. Push payload shape per Task 5 (consumed in Task 7).

## Dependencies
Tasks 01, 03, 04. New packages: `vite` (dev). Optional `jsdom` or `happy-dom` (dev, license-verified) for DOM unit tests.

## Acceptance criteria
1. Lighthouse-style PWA installability checks pass (manifest, service worker, HTTPS, icons) on the deployed Pages URL; installs on Android Chrome and shows "Add to Home Screen" capability on iOS Safari.
2. The screen is interactive immediately; no loader is ever shown; with the network off, the screen renders and the control values are editable.
3. The select offers exactly 48 options, only `:00` and `:30`.
4. Changing the time saves to Supabase (row visible via `settings` GET) and shows "Saved"; failure keeps a pending patch and retries on reconnect.
5. No `notificationclick` navigation exists in `sw.js` (checked by a test that scans the built worker for `openWindow`, `focus(`, `navigate(`).
6. No requests to third-party origins (checked in a headless test or documented network review).
7. Accessibility checklist items verified manually and recorded.
8. Pages deploy workflow publishes the app from the default branch.

## Unit tests
Time select options and value mapping (12/24 h display, `"HH:MM"` values); cache read/write and corruption tolerance (invalid JSON in `localStorage` → defaults); save queue debounce/coalesce/retry; status messages; strings completeness (no missing keys, no product name in anything designated as a message body).

## Integration tests
DOM test (`happy-dom`/`jsdom`): render with and without cache; save success/failure with a fake `settings-api`; manual: install and use offline.

## Error cases
Supabase unreachable/paused; session creation fails (rate limit) → friendly retry text; `localStorage` unavailable (private mode) → in-memory fallback; service worker registration fails → app still works.

## Edge cases
User travels (timezone differs from cached); user clears site data (new anonymous identity; old row eventually pruned, documented); iOS Safari tab vs installed app have separate storage (settings never created before install on iOS, see Task 7); very narrow screens; dark mode; browser language differing from UI language.

## Definition of Done
Acceptance criteria met; deployed URL recorded in README; manual accessibility checklist stored in `docs/verification/`; `DECISIONS.md` updated (P-12, P-13, P-15 status; Q-01/Q-02/Q-04/Q-05 resolved or still open).
