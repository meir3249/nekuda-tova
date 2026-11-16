# 06 — PWA Shell and Settings UI

## Purpose and scope
The installable PWA: manifest, service worker (push display only), the single settings screen, instant render, "saved" confirmation, and the GitHub Pages deploy. Push permission and subscription logic arrive in Task 7; here the toggle and time are saved to Supabase and the screen works without push.

## Relevant requirements
Brief §3; hand-off Req 5, 6. D-003, D-004, D-012, D-017, P-12, P-13, P-15.

## Technical design

### Build
Vite with root `src/pwa`, output `dist/`, `base = '/<REPO_NAME>/'` (Q-02, from env `PWA_BASE`). Vanilla TypeScript, no UI framework, no CSS framework. Service worker built as a separate entry (`sw.ts` → `sw.js` at the base path root so its scope covers the app). Public env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`.

### Manifest (`manifest.webmanifest`)
`name` "Nekuda Tova", `short_name` same, `display: standalone`, `start_url` and `scope` = base, `background_color`/`theme_color` from the night-blue palette (Visual design), icons 192, 512 and maskable 512 (Q-04: generated simple placeholder unless the user provides one), `lang` per Q-01.

### Screen layout (single page; no routing)
Order top to bottom:
1. Title (product name) and one calm line of subtitle from `strings`, centred under a small decorative glowing "point" (`aria-hidden`).
2. **Time**: native `<select>` with 48 half-hour options (from core `SLOTS`), label "Notification time" (`שעת ההתראה`). Label and picker sit on **one row**: the label at the inline-start edge, the picker at its natural width at the inline-end edge, open space between them. No helper text, hint or caption anywhere in the card. Only when there is genuinely no room (e.g. 200% text zoom) the row wraps, label above picker. Labels are **always 24-hour, zero-padded `HH:MM`** (e.g. `09:00`, `15:00`; never `3:00 PM`), whatever the browser locale (Israeli/European convention); the option **value** is the same `"HH:MM"`. Default `09:00` until chosen (P-13). A native select is kept (over `<input type="time">`, whose step/half-hour behavior is inconsistent on mobile, and over a custom listbox, which would lose native accessibility and mobile pickers) but styled as a custom component (see Visual design).
3. **Notifications switch**: `<input type="checkbox" role="switch">` on one row with its visible label (label at inline start; a short state word and the pill at inline end, the same rhythm as the time row). Initial state off (P-15). **Off hint:** while off, one soft rose line under the row ("כל עוד ההתראות כבויות, לא יגיעו אליך הודעות.", rose `--rose` on a 9% rose tint, rounded, a small glowing dot), part of the switch's `aria-describedby`; hidden while on. It is the only persistent text in the card, a deliberate exception to the calm-space rule because without notifications the app does nothing. Gentle, never alarming (no red, no icon of warning).
   Items 2 and 3 sit together in one rounded card: two quiet rows separated by a single hairline. Nothing else ever appears inside this card (no status lines, warnings or explanations), apart from the off hint above.
4. **Status toast** (`role="status"`, `aria-live="polite"`): the **single channel for every message** on the screen: save results, and Task 7's gentle notices (permission off, needs install, unsupported). At most one notice is visible at a time; a new one replaces the current one, never stacks. Notices appear only in response to something the user just did, never on load (the one exception is Task 7's one-time install sheet, which is not a toast). There is no other status line, banner or inline message.
5. **How it works**: a `<details>` element (collapsed by default, never opened automatically), styled as a rounded card with a chevron. When open, a hairline separates the header from the content, which sits on a softer, slightly lifted tint. A few short paragraphs (no step lists, no diagrams), including the note that the message arrives around the chosen time (sometimes a little after; more than 2 h late means that day is skipped, D-011), from `strings` (Q-05), and an optional link slot for a future video (not shown now). The last paragraph (what is stored) is quieter fine print.
6. **Privacy**: one quiet text link at the end of the How it works content (`docs/privacy.md` rendered or linked on GitHub). No footer bar and no other links.

Not present: feed, history, accounts, streaks, scores, analytics, refresh button, sound settings, modals for sync, blocking loaders, persistent banners, inline status or error lines, helper text under controls, stacked notices, badges or counters, footers, dimmed full-screen overlays, anything that appears by itself on load (except the one-time install sheet, Task 7).

### Visual design ("cosmic ocean")
A relaxation product (Calm-space principle, 00 §3): the screen itself is the space of peace and the content is only what lives in it. It must feel calm, soft and spacious, never messy, crowded, bustling, rigid or boxed in. Every new element must justify itself against this; when in doubt, leave it out or route it through the toast.
- **Palette and atmosphere:** a single deep night-blue/indigo palette. The background is a smooth vertical gradient (indigo at the top fading to near-black navy) with two very soft radial glows (indigo at the top, a faint sea-teal at the bottom). CSS only: no images, no blur filters, painted on one fixed layer. Accent: soft sea-glass aqua; focus: warm starlight. All colours are tokens in `styles.css`; contrast is tested over every background point including the lightest painted one.
- **Typography:** Rubik (SIL OFL 1.1; Hebrew + Latin subsets, variable weight 400–600) as the primary font, self-hosted under `public/fonts/` with `font-display: swap` and a preload of the Hebrew subset; the system UI font stack is the fallback.
- **Breathing room:** generous, fluid spacing (`clamp()`); large top margin, wide gaps between sections, roomy card padding; content column up to 36 rem, centred.
- **Softness:** rounded corners everywhere (cards ≈ 1.75 rem, controls ≈ 1.1 rem, pill switch and toast), soft shadows, hairline dividers instead of boxes, gentle eased transitions.
- **Time picker:** inline with its label, aligned to the inline-end edge at its natural width (never stretched full-width), so the row reads as a calm label-and-value pair. The `<select>` has no native chrome (`appearance: none`): large tabular numerals, rounded raised fill, soft edge, custom chevron, hover glow. Where supported (Chromium customizable select, `appearance: base-select`) the open list is a rounded floating panel with rounded options and the chosen time highlighted in the accent; elsewhere the OS picker is used (mobile wheel/sheet), which is the accessible native behavior.
- **Toast:** fixed at the bottom of the viewport (above the safe-area inset), centred on the X axis, 80% of the width (max 32 rem), rounded, raised indigo with a soft shadow and a small glowing accent dot. Appears with a short fade and rise; under `prefers-reduced-motion` it simply appears. "Saved" disappears after 2 s; other notices after 6 s (a pending save keeps retrying silently). The page reserves bottom padding so the toast never permanently hides content. One toast element only; a new message replaces the text in place. Toast copy is one short sentence (about 60 characters at most), no technical terms, no exclamation marks, no alarming words (error, failed, blocked, warning).
- **Colour scheme:** dark only (`color-scheme: dark`); the cosmic palette is the product's identity, so there is no light variant. `theme-color` and the manifest colours match the gradient; placeholder icons show the same glowing orb (highlight, warm rim and a soft fading halo) on the night-blue gradient.

### Behavior
- **Instant render:** HTML is static; JS reads cached settings from `localStorage` (`ntk.settings.v1`: time, timezone, enabled) and renders synchronously; first paint never waits for the network. If no cache, defaults apply.
- **Reconcile in background:** after render, if a Supabase session already exists, `getSettings()` and update the UI silently if it differs. No spinner. If no session exists, nothing is created yet (P-15).
- **Saving:** changing the time or the switch calls `saveSettings(patch)` (Task 4 API). Lazily `ensureSession()` on the first save. Changes are debounced 400 ms and coalesced; the control stays interactive. On success show "Saved" in the toast for 2 s (respects `prefers-reduced-motion`). On failure show "Couldn't save just now. We'll try again." for 6 s and keep a `pending` patch in `localStorage`, retried on `online` event and next app open. No technical detail shown.
- **Enabling in Task 6** (before Task 7): the switch stays off and quiet; tapping it shows one short toast (no explanation text next to it); the full flow is Task 7. During Task 6 acceptance, the switch saves `enabled=false` only; the enabling path is gated behind a feature flag removed in Task 7.
- **Timezone:** `Intl.DateTimeFormat().resolvedOptions().timeZone` read on every open and sent with settings (auto-follow rule completed in Task 7).
- **Service worker** (`sw.ts`): handles `push` and `install/activate` (`skipWaiting`, `clients.claim`). No fetch caching beyond a minimal app-shell precache for installability (static assets only; never caches Supabase calls). The `push` handler is specified fully in Task 7. There is **no** `notificationclick` handler beyond closing the notification (`event.notification.close()`) and no `clients.openWindow`/`focus` (D-017).
- **Accessibility:** labels bound to controls, visible focus, ≥ 4.5:1 contrast, touch targets ≥ 44 px, supports 200% text zoom, honors `prefers-reduced-motion` (no transitions, no breathing animation), a single dark colour scheme (see Visual design), `lang`/`dir` set (Hebrew RTL, Q-01); styles use logical properties (`margin-inline`, etc.) so the direction is a text change only. Full WCAG conformance requires manual testing with assistive technologies and expert review; this spec only commits to the checklist above.
- **Privacy:** no third-party requests, no analytics, no fonts loaded from a third party (Rubik is self-hosted). Only calls: GitHub Pages assets and Supabase.

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
3. The select offers exactly 48 options, only `:00` and `:30`, labelled in 24-hour `HH:MM`.
4. Changing the time saves to Supabase (row visible via `settings` GET) and shows "Saved"; failure keeps a pending patch and retries on reconnect.
5. No `notificationclick` navigation exists in `sw.js` (checked by a test that scans the built worker for `openWindow`, `focus(`, `navigate(`).
6. No requests to third-party origins (checked in a headless test or documented network review).
7. Accessibility checklist items verified manually and recorded.
8. Pages deploy workflow publishes the app from the default branch.
9. **Calm-space check:** on first paint the screen shows only the glowing point, title, subtitle, the controls card (label and picker on one row, label and switch on one row) and the collapsed How it works. No text beneath any control except the off hint while notifications are off; at most one notice ever visible; nothing appears on load. Checked at 320 px, 390 px and desktop widths and at 200% zoom, recorded in `docs/verification/`.

## Unit tests
Time select options and value mapping (always 24-hour `HH:MM` labels equal to the values, no AM/PM); cache read/write and corruption tolerance (invalid JSON in `localStorage` → defaults); save queue debounce/coalesce/retry; status toast messages and auto-dismiss; the toast is a single element; every toast string is short (≤ 60 characters) with no alarming words; the controls card contains exactly the two label/control rows and, while off, the off hint; palette contrast over every background token; strings completeness (no missing keys, no product name in anything designated as a message body).

## Integration tests
DOM test (`happy-dom`/`jsdom`): render with and without cache; save success/failure with a fake `settings-api`; manual: install and use offline.

## Error cases
Supabase unreachable/paused; session creation fails (rate limit) → the same calm toast as a save failure and a silent retry (no inline text); `localStorage` unavailable (private mode) → in-memory fallback; service worker registration fails → app still works.

## Edge cases
User travels (timezone differs from cached); user clears site data (new anonymous identity; old row eventually pruned, documented); iOS Safari tab vs installed app have separate storage (settings never created before install on iOS, see Task 7); very narrow screens; dark mode; browser language differing from UI language.

## Definition of Done
Acceptance criteria met; deployed URL recorded in README; manual accessibility checklist stored in `docs/verification/`; `DECISIONS.md` updated (P-12, P-13, P-15 status; Q-01/Q-02/Q-04/Q-05 resolved or still open).
