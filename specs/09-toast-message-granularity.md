# 09 — Toast Message Granularity

## Purpose and scope

Replace the current coarse toast strings with per-state messages that accurately reflect the
actual outcome or failure mode. The goal is actionable feedback and easier diagnosis across
devices, without changing any part of the notification architecture, the save queue, the
permission flow, or the visual toast component itself.

This spec covers only `src/pwa/strings.ts` and `src/pwa/ui/settings-screen.ts`.
No other files are changed except the tests that verify string content and screen behaviour.

## Existing constraints (must continue to hold)

Spec 06 §Visual design and the test in `tests/pwa/strings-and-time.test.ts` enforce three rules
on every key in `TOAST_KEYS`:

- **Length** ≤ 60 characters (one short, calm sentence).
- **No alarm words** — the regex `/שגיאה|נכשל|חסום|חסומ|אזהרה|דחוף|error|fail|block|warn/i`
  must not match any toast string.
- **No exclamation marks**.

All new strings must pass these same checks. The strings are Hebrew (Q-01).

## What the code can actually distinguish

The analysis below maps every code path that calls `notify()` to a distinguishable situation,
and decides whether the current single message is specific enough.

### Paths that currently share `strings.saved`

| Situation | Code path | Proposed change |
|---|---|---|
| Time or timezone change saved | `onOutcome({ kind: 'saved' })` while `!disabling` | Keep `strings.saved` ("נשמר") |
| Notifications enabled successfully | Direct `notify(strings.saved, …)` inside `enable()` | New `strings.notificationsEnabled` |
| Notifications disabled, save confirmed | `onOutcome({ kind: 'saved' })` while `disabling` | New `strings.notificationsDisabled` |

### Paths that currently share `strings.enableFailed`

`enable()` can reach `notify(strings.enableFailed)` via three separate sub-paths. Each is
reliably distinguishable at the call site.

| Situation | Trigger | Proposed change |
|---|---|---|
| Invalid or missing VAPID key (build config problem) | `subscribePush` returns `{ ok: false, reason: 'NO_VAPID_KEY' }` | New `strings.configError` |
| Push service or service worker unreachable | `subscribePush` returns `{ ok: false, reason: 'SUBSCRIBE_FAILED' }` | New `strings.subscriptionFailed` |
| Serialized subscription is missing keys | `subscribePush` returns `{ ok: false, reason: 'BAD_SUBSCRIPTION' }` | New `strings.subscriptionFailed` (same root-cause family: browser/push-service anomaly) |
| Push platform or API not wired (null) | `!deps.push \|\| !deps.api` guard fires | New `strings.configError` (same root cause: missing config) |
| Save rejected after successful subscribe | Server returns a non-retryable non-capacity code | Keep `strings.enableFailed` |

### Paths that remain unchanged

| String key | Situation |
|---|---|
| `saveFailed` | Queue retryable failure (network, server error) |
| `saveRejected` | Queue non-retryable save rejection |
| `capacityReached` | `CAPACITY_REACHED` from server |
| `enableOffline` | `isOnline()` false when enabling, or save returned `NETWORK` after subscribe |
| `permissionDenied` | `requestPermission()` returned `denied`, or denied switch tapped |
| `unsupported` | `env.state === 'unsupported'` |

### Why "blocked at OS level / blocked by browser" are not added

Both states return `"denied"` from the same `Notification.permission` / `requestPermission()`
API. There is no browser-standard way to distinguish a system-level block from a browser-level
block; UA sniffing would be speculative and unreliable. The existing `permissionDenied` string
already points the user to device settings, which is the correct action on all platforms.

### Why "missing service worker / PushManager / Notification API" are not added

These conditions gate the `push_ready` environment state in `detectEnvironment`. When any of
them is absent the screen is in `unsupported` state and `enable()` is never reached. The
`unsupported` toast fires when the user taps the quiet switch. Adding separate SW/PushManager/
Notification-API strings would require code paths that the architecture deliberately prevents.

## New string keys

```
notificationsEnabled   // enable() succeeded and the server confirmed
notificationsDisabled  // disable save confirmed by the server (via onOutcome)
subscriptionFailed     // subscribePush returned SUBSCRIBE_FAILED or BAD_SUBSCRIPTION
configError            // subscribePush returned NO_VAPID_KEY, or push/api is null
```

All four are added to `TOAST_KEYS` so the existing length/alarm/exclamation test covers them
automatically. The four existing keys they refine (`saved` for enable, `enableFailed` for the
sub-paths above) remain in the string map and in `TOAST_KEYS`; their call sites that do *not*
change continue to use them.

## Implementation plan

### 1 — `src/pwa/strings.ts`

Add four strings inside the `strings` object and add all four keys to `TOAST_KEYS`.

```
notificationsEnabled: 'ההתראות הופעלו.'
notificationsDisabled: 'ההתראות כובו.'
subscriptionFailed: 'לא הצלחנו לרשום את המכשיר להתראות. אפשר לנסות שוב.'
configError: 'התצורה חסרה. אפשר לנסות שוב מאוחר יותר.'
```

Length check (must be ≤ 60 chars each):
- `'ההתראות הופעלו.'` → 16 chars ✓
- `'ההתראות כובו.'` → 14 chars ✓
- `'לא הצלחנו לרשום את המכשיר להתראות. אפשר לנסות שוב.'` → 52 chars ✓
- `'התצורה חסרה. אפשר לנסות שוב מאוחר יותר.'` → 42 chars ✓

Alarm-word check: none of the new strings contain any of the banned patterns ✓

### 2 — `src/pwa/ui/settings-screen.ts`

**Track the disable state**

Add a `boolean` variable `disabling` (initially `false`). Set it to `true` just before calling
`change()` inside `disable()`, clear it to `false` in `onOutcome`.

**`onOutcome`**

```ts
const onOutcome = (o: SaveOutcome): void => {
  if (o.kind === 'saved') {
    server = o.settings
    if (disabling) {
      disabling = false
      notify(strings.notificationsDisabled, SAVED_VISIBLE_MS)
    } else {
      notify(strings.saved, SAVED_VISIBLE_MS)
    }
  } else if (o.kind === 'failed') notify(strings.saveFailed)
  else notify(o.code === 'CAPACITY_REACHED' ? strings.capacityReached : strings.saveRejected)
}
```

The `disabling` flag is set to `true` only inside `disable()` immediately before `change()`.
Every other call site for `onOutcome` (time change, timezone change) leaves `disabling` as
`false`, so they continue to show `strings.saved`. The flag is cleared in `onOutcome` itself
so a subsequent time-change save after a disable cannot accidentally show the disabled string.
If the save fails and retries, `disabling` remains `true` until the eventual `'saved'` outcome.

**`disable()`**

```ts
function disable(): void {
  disabling = true
  change({ enabled: false }, { enabled: false })
  writeEndpointHash(store, null)
  if (deps.push) void unsubscribeLocal(deps.push)
}
```

**`enable()` — replace the sub-path `notify()` calls**

Replace the three `notify(strings.enableFailed)` usages that correspond to distinguishable
failure modes:

| Old call | Condition | New call |
|---|---|---|
| `notify(strings.enableFailed)` | `!deps.push \|\| !deps.api` guard | `notify(strings.configError)` |
| `notify(deps.isOnline() ? strings.enableFailed : strings.enableOffline)` | `!sub.ok`, `reason === 'NO_VAPID_KEY'` | `notify(strings.configError)` |
| `notify(deps.isOnline() ? strings.enableFailed : strings.enableOffline)` | `!sub.ok`, `reason === 'SUBSCRIBE_FAILED' \| 'BAD_SUBSCRIPTION'` | `notify(strings.subscriptionFailed)` |
| `notify(strings.saved, SAVED_VISIBLE_MS)` at enable success | success path | `notify(strings.notificationsEnabled, SAVED_VISIBLE_MS)` |

Currently the code does not branch on `sub.stored`'s failure reason; it checks `!sub.ok` and
then checks `deps.isOnline()`. The refactor reads `sub.reason` to pick the right string, then
falls back to `enableOffline` only if offline and `SUBSCRIBE_FAILED` (the subscribe call itself
could not reach the push service, which may be a network problem).

Concretely:

```ts
if (!sub.ok) {
  if (sub.reason === 'NO_VAPID_KEY') return notify(strings.configError)
  // SUBSCRIBE_FAILED may be a network issue; BAD_SUBSCRIPTION is a browser anomaly.
  return notify(!deps.isOnline() ? strings.enableOffline : strings.subscriptionFailed)
}
```

The existing path `notify(strings.enableFailed)` for a failed API save (after a successful
subscribe) is unchanged; that failure is already specific enough ("Couldn't turn on
notifications just now").

## Files changed

| File | Change |
|---|---|
| `src/pwa/strings.ts` | Add 4 string keys; add them to `TOAST_KEYS` |
| `src/pwa/ui/settings-screen.ts` | Add `disabling` flag; update `onOutcome`, `disable()`, and `enable()` |

## Tests to add / update

### `tests/pwa/push/push-flows.test.ts`

- **`notificationsEnabled`**: the existing "turning it on (permission already granted)" test
  currently asserts `strings.saved`; update to assert `strings.notificationsEnabled`.
- **`notificationsDisabled`**: add a test in "turning notifications off" that asserts the
  status shows `strings.notificationsDisabled` after the save queue delivers a `saved` outcome.
- **`subscriptionFailed`**: add a test for `push.subscribeFails = true` asserting
  `strings.subscriptionFailed` (currently asserts `strings.enableFailed`).
- **`configError`**: add tests for `vapidPublicKey: ''` (currently asserts `strings.enableFailed`)
  and `push: null` (no-push-platform path) asserting `strings.configError`.
- The existing test "a missing or invalid VAPID key never reaches subscribe" already checks the
  subscribe-not-called invariant; it needs its string assertion updated.

### `tests/pwa/settings-screen.test.ts`

- The "turning it on (permission already granted)" inner test asserts `strings.saved`; update
  to `strings.notificationsEnabled`.

### `tests/pwa/strings-and-time.test.ts`

No changes needed. The existing calm-space test already iterates `TOAST_KEYS` and the new keys
will be covered automatically once they are added to that array.

## Acceptance criteria

1. All existing tests pass with no behaviour changes outside the string assertions listed above.
2. The four new string keys appear in `TOAST_KEYS` and pass the length/alarm/exclamation test.
3. Enabling notifications shows `notificationsEnabled` in the toast, not `saved`.
4. Disabling notifications and waiting for the save to confirm shows `notificationsDisabled`.
5. A subscribe failure (push service unreachable) shows `subscriptionFailed`.
6. A missing VAPID key shows `configError`.
7. Time/timezone saves continue to show `saved`.
8. All other existing toast messages (capacity, offline, permission denied, etc.) are unchanged.

## Definition of Done

All acceptance criteria met; CI green; no new packages; no changes outside the two source files
and their test files.
