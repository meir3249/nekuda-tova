# 07 — Push Subscription and Environment-Aware Permission Flows

## Purpose and scope
Everything that turns the settings screen into real notifications: environment detection, the iOS install overlay, the permission request on user tap, subscription creation and storage, the service worker `push` handler, disable/re-enable, subscription renewal, and timezone follow.

## Relevant requirements
Hand-off Req 4, 6, 7; Brief §3. D-004, D-013, D-014, D-016, D-017, P-02, P-08, P-15; risks R-04, R-06.

## Technical design

### Environment inputs (PWA adapter, `src/pwa/env/read-environment.ts`)
Reads real globals and builds core `EnvInputs`: `navigator.userAgent`, `navigator.platform`, `navigator.maxTouchPoints`, `standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true`, `'serviceWorker' in navigator`, `'PushManager' in window`, `'Notification' in window`, `Notification.permission`. Re-read on every app open and on `visibilitychange`. Pure decision in core `detectEnvironment` (Task 3). Feature detection takes priority; UA/platform is only a hint (iPadOS desktop UA handled by `maxTouchPoints`).

### State matrix (what the UI does)
| Env state | Permission | UI behavior |
|---|---|---|
| `ios_needs_install` | any | Show the **install overlay** (below) once per open until dismissed; the switch is disabled with the line "Notifications work from the Home Screen app." No session or row is created in a Safari tab. |
| `unsupported` | any | Calm line: "This browser can't show notifications. Another browser or a newer system version may." Switch disabled. Time stays editable but is **not saved** (no row without a way to notify). |
| `push_ready` | `default` | Switch off. Tapping the switch (user gesture) → request permission → on `granted` subscribe and save `enabled=true`; on `denied` see below; on dismissal leave switch off. |
| `push_ready` | `granted` | Switch reflects server state. Tapping on subscribes (if needed) and saves. |
| `push_ready` | `denied` | Switch off and disabled; line: "Notifications are blocked for this app. They're what it's for, so you may want to allow them in your device or browser settings." No repeated prompts, no nagging. Settings stay usable. |

Permission is **never** requested on page load, only in the tap handler (D-013). The request call happens synchronously inside the handler so iOS accepts the gesture.

### iOS install overlay (`src/pwa/ui/install-overlay.ts`)
- A non-modal-looking but accessible dialog (`role="dialog"`, labelled, focus managed, `Esc` and a visible "Not now" button dismiss it). It never covers the settings screen permanently and never blocks reading it.
- Content (strings): short explanation that on iPhone/iPad notifications work from the Home Screen app, then steps: tap **Share**, choose **Add to Home Screen**, open the new icon, enable notifications. Mentions iOS 16.4 or later. A small inline diagram (SVG, local) of the Share icon.
- Dismissal is remembered for the session only (not persisted as a "don't show again" streak-like mechanic); it reappears on next open, kept gentle: no badges, no counters.
- Also shown when the user taps the (disabled) switch in the `ios_needs_install` state.
- Note on storage: installed iOS PWAs have storage separate from Safari tabs, so nothing is saved before installation (R-04).

### Subscribe flow (`src/pwa/push/subscribe.ts`)
1. Tap handler: `Notification.requestPermission()` (if `default`).
2. `registration = await navigator.serviceWorker.ready`.
3. `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC_KEY (base64url→Uint8Array) })`.
4. Serialize via `subscription.toJSON()` to `{endpoint, keys:{p256dh,auth}}`.
5. `saveSettings({ enabled: true, pushSubscription, localTime, timezone })` (Task 4). Server validates (allowlist) and computes `nextSendAt`.
6. On failure at any step: switch returns to off, gentle message, nothing half-saved. If step 5 fails after step 3, call `subscription.unsubscribe()` to avoid orphans.

### Disable / re-enable
- **Off:** `saveSettings({ enabled:false })` (server nulls subscription and `next_send_at`, keeps counter; P-02), then `subscription.unsubscribe()` locally. If offline, store a pending patch (Task 6 queue) and show the switch off immediately.
- **On again:** full subscribe flow with a fresh subscription; counter resumes server-side (D-006).

### Renewal and revocation handling on every open
- Server says `enabled` but `Notification.permission` is `denied` or no subscription exists and permission is `granted`: if granted, silently re-subscribe and update the server; if denied, show the denied line and send `enabled=false` so the server stops (no pushes into the void).
- If the local subscription endpoint differs from what was sent last (stored hash in `localStorage`), update it.
- Service worker `pushsubscriptionchange` handler: best-effort re-subscribe and post a message to the page to save; if it cannot, the next open repairs it. Documented as not guaranteed.

### Timezone follow
On each open: if `Intl` timezone differs from the saved one and the user is enabled, `saveSettings({ timezone })` silently; the same `local_time` then applies in the new zone (server recomputes `next_send_at`). If the app is not opened after travelling, notifications keep the old zone's schedule (documented limitation).

### Service worker `push` handler (`src/pwa/sw.ts`)
- Parse `event.data.json()` into `PushPayload v1` (Task 5). Always call `event.waitUntil(self.registration.showNotification(title, { body, tag, icon, badge }))`. No `requireInteraction`, no actions, no vibration pattern, `silent` left unset so the OS controls sound.
- **Malformed/empty payload (R-06):** still show a notification with only the title (no body) so the push is never silent (iOS may revoke subscriptions for silent pushes). Never invent message text.
- Title is the product name; the **body never contains the product name** (D-003; asserted by a lint test over the sample content in the sender, and by a unit test here).
- `notificationclick`: `event.notification.close()` only. No `openWindow`, `focus`, or `navigate` (D-017). **Documented caveat to verify on device:** iOS may bring the PWA to the foreground on tap regardless of the handler; record the observed behavior in `docs/verification/`.
- `tag` replaces an earlier notification with the same tag (duplicate protection, P-05).

## Files and components
`src/pwa/env/read-environment.ts`, `src/pwa/ui/install-overlay.ts`, `src/pwa/push/{subscribe,unsubscribe,renewal,vapid.ts}`, `src/pwa/sw.ts` (push + pushsubscriptionchange + click-close), `src/pwa/strings.ts` additions, `tests/pwa/push/*`, `docs/verification/device-checklist.md` (updated).

## Interfaces and contracts
`detectEnvironment` (Task 3); `settings-api` (Task 4); `PushPayload v1` (Task 5); allowlist data shared with the server (single source file `src/core/settings/push-endpoint-allowlist.ts`).

## Dependencies
Tasks 03–06. No new packages. Requires a deployed Pages URL and a real device for acceptance. iOS acceptance needs an iPhone/iPad on iOS 16.4+ (no software cost); if none is available, iOS acceptance is marked **not verified** and reported (never claimed).

## Acceptance criteria
1. iOS Safari tab: overlay appears, is dismissible, the settings screen stays readable, the switch is disabled with the explanation, no Supabase row is created.
2. iOS installed (standalone): tapping the switch shows the permission prompt; granting subscribes; a `--test-push` from Task 5 arrives; the overlay is not shown.
3. Android Chrome (browser tab, not installed): tapping the switch prompts directly and works; notification arrives.
4. Desktop Chrome/Firefox: same as Android.
5. Permission is never requested without a tap (test: no `requestPermission` call on load; verified manually).
6. Denied: polite explanation, no repeated prompts, settings usable; switch disabled.
7. Disable removes the subscription server-side (row has null `push_subscription`, null `next_send_at`, counter intact); re-enable resumes the same counter (verified with the sender dry run showing the same message index).
8. Changing the time while enabled updates `next_send_at` per core rules; the old schedule no longer fires.
9. Changing device timezone and reopening updates the stored timezone.
10. Tapping the notification performs no application action in the handler (scan test) and observed OS behavior is documented per platform.
11. Malformed payload still shows a (title-only) notification; no silent pushes.
12. End-to-end: first real scheduled push (not `--test-push`) arrives within the 2 h window after the chosen slot; the delay is visible in `delivery_log`.

## Unit tests
`detectEnvironment` table via `read-environment` with fake globals; subscribe/unsubscribe with a fake `PushManager` and fake `Notification`; ordering (permission request inside the handler); rollback on save failure; renewal logic cases (granted+no sub, denied+enabled, endpoint changed); service worker handler tests with a fake `ServiceWorkerGlobalScope` for payload parsing, malformed payload, tag set, no body branding.

## Integration tests
Manual device matrix recorded in `docs/verification/device-checklist.md` (Android Chrome, desktop Chrome, desktop Firefox, iOS standalone, iOS Safari tab). Automated headless Chromium test for permission-denied and unsupported states only if it can be done with free tools and no new paid services; otherwise manual.

## Error cases
`subscribe` throws (blocked, push service unreachable, VAPID key invalid); server `INVALID_SUBSCRIPTION` (unknown push host, so we learn about unlisted hosts); `CAPACITY_REACHED` shows a gentle "Not available right now" line; offline during enable (switch reverts with an explanation, nothing queued for enable since permission and subscription must be confirmed first); service worker not yet active on first launch (wait for `ready`).

## Edge cases
In-app browsers (Instagram/Facebook WebViews) → `unsupported`; Firefox desktop private mode; Safari desktop; iPadOS desktop UA; user revokes permission in OS settings while enabled; user uninstalls the PWA (server learns via 404/410 on next send and disables the row); two devices (each device has its own anonymous identity and schedule, accepted and documented); OS-level "Focus"/"Do not disturb" (delivery silent but not observable); push services dropping messages (documented guarantee not provided).

## Definition of Done
Acceptance criteria met on the devices actually available, with unverified platforms explicitly listed; endpoint allowlist reconciled with real endpoints observed; `DECISIONS.md` updated (D-013/D-017 evidence recorded, P-02 behavior confirmed).
