# Task 06 verification: PWA shell and settings screen

Date: 2026-11-16. Build: local `npm run build:pwa` with `PWA_BASE=/nekuda-tova/` and a placeholder Supabase URL, served by `vite preview` on `http://127.0.0.1:4173/nekuda-tova/` (localhost counts as a secure context). Browser: headless Chrome on Windows, mobile viewport 390×844, driven over the DevTools protocol.

Legend: **Auto** = covered by a test in `tests/pwa/`; **Checked** = verified by hand or by script in this session; **Open** = still to do on real devices or the deployed URL.

## Acceptance criteria (spec 06)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Installable (manifest, service worker, HTTPS, icons); Android install; iOS "Add to Home Screen" | Checked locally, **Open** on devices | Chrome `Page.getInstallabilityErrors` returned none; manifest parsed with no errors; service worker `activated` with scope `/nekuda-tova/`. Manifest fields and icon sizes asserted in `build.test.ts`. Not yet checked on the Pages URL, Android Chrome or iOS Safari |
| 2 | Interactive immediately; no loader; offline the screen renders and controls are editable | Checked + Auto | Offline reload in Chrome rendered the cached shell with 48 options and the user's last value (`07:30`). `settings-screen.test.ts`: renders from cache before any network reply; HTML contains no loader/progress/dialog |
| 3 | Exactly 48 options, only `:00` and `:30` | Auto + Checked | `strings-and-time.test.ts`; 48 options in Chrome |
| 4 | Time change saves and shows "Saved"; failure keeps a pending patch and retries on reconnect | Auto, **Open** against a real backend | `settings-screen.test.ts` and `state.test.ts` with a fake API. In Chrome with an unreachable backend: the friendly failure line appeared and `ntk.pending.v1` held the change. Real round trip (row visible via `GET settings`) needs the Supabase project |
| 5 | No notification-click navigation in `sw.js` | Auto | `build.test.ts` scans the built worker for `openWindow`, `focus(`, `navigate(` |
| 6 | No requests to third-party origins | Auto + Checked | CSP in the built HTML allows `'self'` plus the Supabase origin only (`build.test.ts`); HTML references only same-origin paths. Chrome network log: only `http://127.0.0.1:4173` and the configured Supabase origin |
| 7 | Accessibility checklist verified manually | Partly, see below | |
| 8 | Pages workflow publishes from the default branch | **Open** | `pages.yml` passes `actionlint`; not run (no remote yet) |

## Accessibility checklist

Full WCAG conformance needs testing with assistive technologies and an expert review; this covers the spec's list only.

| Item | Status | Notes |
|---|---|---|
| Every control has a bound visible label | Auto | `label[for=time]`, `label[for=notify]` |
| Switch semantics | Auto | Native checkbox with `role="switch"`; `aria-checked` kept in sync; state text linked by `aria-describedby` |
| One polite live region for status | Auto | `role="status"`, `aria-live="polite"`, rendered as a floating bottom toast outside `<main>`; bottom padding reserved so content is never permanently hidden |
| Visible focus | Checked (CSS) | 3 px warm outline via `:focus-visible`; focus colour contrast ≥ 3:1 on every background token (`contrast.test.ts`). **Open:** keyboard walk-through on a device |
| Contrast ≥ 4.5:1 text, ≥ 3:1 UI | Auto | `contrast.test.ts` over the CSS tokens, including the lightest painted gradient point and the toast |
| Touch targets ≥ 44 px | Checked (CSS) | Select 3.25rem high; switch hit area enlarged to ≥ 2.75rem; summary and privacy link padded. **Open:** measure on a phone |
| 200% text zoom | **Open** | Layout uses rem and wraps; not yet checked at 200% on a device |
| `prefers-reduced-motion` | Checked (CSS) | All transitions and the breathing animation removed under `reduce`; the toast appears without moving |
| Colour scheme | Checked | Single dark "cosmic ocean" palette (no light variant, by decision); screenshots reviewed at 390×844 and 1280×800 |
| `lang` / `dir` | Auto + Checked | `lang="he" dir="rtl"`; logical CSS properties; RTL layout reviewed in screenshots (switch knob at the inline start when off, chevrons, toast dot at the inline start) |
| "How it works" is visibly expandable | Checked | Rounded card with a chevron that turns when open; when open, a hairline separates the header and the text sits on a softer tint |
| Font | Auto + Checked | Rubik self-hosted (`build.test.ts`: under the base path, precached, OFL shipped, no Google URLs). In Chrome both subsets loaded from the app origin and `document.fonts.check('500 18px Rubik')` was true |
| Time labels 24-hour | Auto + Checked | Labels equal the `HH:MM` values; the styled picker (Chromium customizable select) opened in headless Chrome showing `13:30 … 16:30` with `15:00` highlighted |
| Screen reader (TalkBack, VoiceOver) | **Open** | |

## Error and edge cases

| Case | Status |
|---|---|
| Supabase unreachable / paused | Auto + Checked (friendly line, pending kept) |
| Session creation fails (rate limit) | Auto: the API returns `NETWORK`, which the queue treats as transient |
| `localStorage` unavailable | Auto (`pickStore` falls back to memory; a throwing store never breaks the screen) |
| Service worker registration fails | By construction: registration errors are swallowed; the screen does not depend on it |
| Corrupted cache | Auto |
| Timezone differs from cached | Auto: the device timezone is re-read on every open. Following the change on the server is Task 07 |
| Dark mode, narrow screen | Checked at 390 px and 320 px wide (label and picker stay on one row) |
| iOS tab vs installed app storage | Documented (Task 07 handles creation only after install on iOS) |
