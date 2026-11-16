# 03 — Core Progression and Scheduling Domain

## Purpose and scope
Pure, fully tested domain logic: modulo progression, 30-minute slots, timezone/DST `next_send_at` computation, staleness policy, and the settings-change rules used by the Edge Function. No I/O.

## Relevant requirements
Brief §4, §10. D-005, D-006, D-011, D-012, D-014, D-016, P-14.

## Technical design

### Progression (`src/core/progression/index.ts`)
```ts
messageIndexFor(startIndex: number, counter: number, n: number): number
```
- Definition (0-based): `index = (startIndex + counter) mod n`, result in `[0, n-1]`.
- Preconditions: `n` integer ≥ 1; `startIndex`, `counter` non-negative safe integers; `startIndex + counter ≤ Number.MAX_SAFE_INTEGER`. Violation → `RangeError` (programmer error; the sender treats it as a run error for that user, never as a skip of the whole run).
- `counter` is never reduced by modulo anywhere; `n` is read from the content at send time. Example: `n=41`, `start=0`, `counter=562` → `562 mod 41 = 29` → index 29. (Corrected during implementation: the original text said 7, an arithmetic error.)
- `randomStartIndex(rng: () => number): number` returns an integer in `[0, 2^31-1]` from an injected `rng` (`Math.random`-compatible, `[0,1)`).

### Slots (`src/core/scheduling/slots.ts`)
- `isValidSlot(t: string): boolean` — exactly `^([01][0-9]|2[0-3]):(00|30)$`.
- `SLOTS: readonly string[]` — the 48 values `00:00 … 23:30`.

### Timezone (`src/core/scheduling/timezone.ts`)
- `isValidTimezone(tz: string): boolean` — true iff `Intl.DateTimeFormat(undefined, { timeZone: tz })` constructs without throwing **and** `tz` is an IANA-style name (contains `/` or is `UTC`); rejects offsets like `+02:00` and abbreviations like `IST`.
- `offsetMinutesAt(tz, instant: Date): number` — UTC offset at an instant, from `Intl.DateTimeFormat` parts (`hourCycle: 'h23'`), minute precision. (Zones with 30/45-minute offsets work.)
- `localDateOf(tz, instant): {y, m, d}`.
- `localToInstant(tz, {y,m,d}, hh, mm): Date`:
  1. `guess = Date.UTC(y, m-1, d, hh, mm)`.
  2. Candidate offsets `o ∈ {offsetAt(guess − 24h), offsetAt(guess + 24h)}` (deduplicated). For each, `c = guess − o·60000`; keep `c` if the local wall time of `c` in `tz` equals `(y,m,d,hh,mm)`.
  3. **Two valid → ambiguous (fall back): return the earlier instant** (first occurrence). D-014.
  4. **One valid → return it.**
  5. **None valid → nonexistent (spring forward): return the transition instant**, i.e. the first instant whose local wall time is ≥ the requested time. Found by taking the offset-before candidate and the offset-after candidate and returning the later transition boundary via binary search on `[guess − 24h, guess + 24h]` over minute granularity for the first instant where `local ≥ requested`. D-014 ("next valid instant").

### Next send (`src/core/scheduling/next-send.ts`)
```ts
nextOccurrenceAfter(localTime: string, tz: string, after: Date): Date
```
- Local date `D` of `after` in `tz`. `candidate = localToInstant(tz, D, localTime)`. If `candidate > after` return it; else return `localToInstant(tz, D+1 calendar day, localTime)`. Strictly greater (an instant exactly equal to `after` is not "upcoming").
- Calendar-day arithmetic is done on `{y,m,d}` tuples, **not** by adding 24 h, so DST days (23 h / 25 h) are correct.
- Preconditions validated: slot and timezone; otherwise `RangeError`.

### Staleness (`src/core/scheduling/staleness.ts`)
```ts
evaluateDelay(scheduledFor: Date, attemptedAt: Date, maxLateSeconds = 7200): { delaySeconds: number; stale: boolean }
```
- `delaySeconds = max(0, floor((attemptedAt − scheduledFor)/1000))`.
- `stale = delaySeconds > maxLateSeconds` (exactly 7200 s is **not** stale). D-011.

### Settings change (`src/core/settings/apply-settings-change.ts`)
Used by the Edge Function (Task 4). Pure.
```ts
interface SettingsRequest { localTime?: string; timezone?: string; enabled?: boolean; pushSubscription?: StoredPushSubscription | null }
interface SettingsRow { /* Subscription minus id, updatedAt, claimedUntil */ }
applySettingsChange(current: SettingsRow | null, req: SettingsRequest, now: Date, rng: () => number):
  { ok: true; row: SettingsRow } | { ok: false; code: 'INVALID_SLOT'|'INVALID_TIMEZONE'|'MISSING_FIELDS'|'SUBSCRIPTION_REQUIRED'|'INVALID_SUBSCRIPTION'; message: string }
```
Rules:
1. **New row** (`current = null`): `localTime` and `timezone` required (`MISSING_FIELDS`). `startIndex = randomStartIndex(rng)`, `messageIndex = 0`, `enabled = req.enabled ?? false`.
2. Validate `localTime` (slot) and `timezone` when present. Invalid → error, **no partial change**.
3. `enabled = true` requires a non-null push subscription (in request, or already stored) else `SUBSCRIPTION_REQUIRED`. Push-subscription *shape* validation (https endpoint, allowlisted host, base64url keys, size ≤ 4 KiB) is `validatePushSubscription` in core with the allowlist passed in as data (P-08); failure → `INVALID_SUBSCRIPTION`.
4. **Disable** (`enabled=false`): `pushSubscription = null`, `nextSendAt = null`; `startIndex`, `messageIndex`, `localTime`, `timezone` unchanged (P-02, D-006).
5. **Enable, or change of `localTime`/`timezone` while enabled:** `nextSendAt = nextOccurrenceAfter(localTime, timezone, now)`. Old schedule is replaced.
6. **Subscription-only update while enabled** (renewal): keep `nextSendAt` unchanged.
7. Edit of time/timezone while disabled: stored, `nextSendAt` stays `null`.
8. Re-enable never touches `messageIndex` (resume from same counter).
9. P-14: no once-per-day guard.

### Environment detection (`src/core/environment/detect.ts`) — consumed by Task 7, specified here because it is pure
```ts
interface EnvInputs { userAgent: string; platform: string; maxTouchPoints: number; standalone: boolean; hasServiceWorker: boolean; hasPushManager: boolean; hasNotification: boolean; permission: 'default'|'granted'|'denied'|'unavailable' }
type EnvState = 'push_ready' | 'ios_needs_install' | 'unsupported' ; 
detectEnvironment(i: EnvInputs): { state: EnvState; isIOSLike: boolean; permission: EnvInputs['permission'] }
```
- `isIOSLike`: UA matches `/iPhone|iPad|iPod/` **or** (`platform === 'MacIntel'` and `maxTouchPoints > 1`) (iPadOS desktop UA).
- Feature detection first: `hasServiceWorker && hasPushManager && hasNotification` → `push_ready`.
- Else, if `isIOSLike && !standalone` → `ios_needs_install`.
- Else → `unsupported` (includes iOS standalone on versions before 16.4, old browsers, in-app browsers).

## Files and components
`src/core/progression/`, `src/core/scheduling/{slots,timezone,next-send,staleness}.ts`, `src/core/settings/{apply-settings-change,validate-push-subscription}.ts`, `src/core/environment/detect.ts`, `src/core/index.ts` exports; `tests/core/**`.

## Dependencies
Task 01. Task 02 types only for `Message` count `n` (not imported by progression).

## Acceptance criteria
1. `messageIndexFor(0, 562, 41) === 29`; `(start=40, counter=562, n=41)` → `(602) mod 41 = 28`; counters up to `2^40` remain correct; `n=1` always 0.
2. Pause/resume: a scenario test applies disable → N calendar days elapse → enable, and asserts `messageIndex` unchanged and the next message equals the one that would have been next before pausing.
3. All DST tests in the matrix below pass.
4. Staleness boundaries: 7199 s, 7200 s → send; 7201 s → stale.
5. Every `applySettingsChange` rule has a passing test, and no partial writes on error.
6. Core boundary test passes; no runtime dependency added.
7. Tests use `FakeClock` and an injected `rng`; no real clock, no randomness.

### DST/timezone test matrix (expected values to be computed with the runtime's ICU data and cross-checked against tzdata; dates below are the 2026–2027 transitions and must be re-verified at implementation)
| Zone | Case | Expectation |
|---|---|---|
| `Asia/Jerusalem` | `09:00` across 2027-03-26 (spring forward) | Local 09:00 each day; UTC instant shifts by 1 h |
| `Asia/Jerusalem` | `02:30` on 2027-03-26 (nonexistent) | Transition instant (local 03:00) |
| `Asia/Jerusalem` | `01:30` on 2026-10-25 (ambiguous) | First occurrence (earlier UTC instant) |
| `America/New_York` | `02:30` on 2027-03-14 | Transition instant |
| `America/New_York` | `01:30` on 2027-11-07 | First occurrence |
| `Asia/Kolkata` | `09:30` | Offset +05:30 handled |
| `Asia/Kathmandu` | `09:00` | Offset +05:45 handled |
| `Australia/Lord_Howe` | any slot near its 30-minute DST shift | Correct instant, documented |
| `UTC` | trivial | Identity |
| any | `after` exactly equals a slot instant | Returns next day, not same instant |
| any | `after` 1 ms before slot | Returns same-day slot |
| any | 23 h and 25 h days | Next day's slot is still local `HH:MM` |
| `Pacific/Kiritimati` (+14), `Pacific/Pago_Pago` (−11) | extremes | Local date boundary correct |

## Unit tests
As above, plus invalid inputs (`"9:00"`, `"09:15"`, `"24:00"`, `"Asia/Nowhere"`, `"+02:00"`, `"IST"`), `randomStartIndex` bounds with rng `0` and `0.999999`, `detectEnvironment` truth table (iPhone Safari tab, iPhone standalone, iPad desktop-UA tab, Android Chrome, desktop Firefox, unsupported WebView, iOS standalone without PushManager).

## Integration tests
Scenario test with `InMemoryUserRepository` (created here in `tests/fakes/`): simulate 600 daily cycles for N=41 with a pause in the middle and a mid-way content size change (N 41→38), asserting every computed index is in range and counter is monotonic.

## Error cases
Invalid slot/timezone → typed error; `n ≤ 0` → `RangeError`; counter overflow → `RangeError`.

## Edge cases
Content shrinks below `(start+counter) mod n` previous value: still valid by definition (index may repeat/skip, accepted by D-008). `startIndex` near `2^31` plus large counters stay within safe integers. `after` before 1970 or far future rejected (`RangeError` outside 2000–2200).

## Definition of Done
Acceptance criteria met; matrix expectations verified against ICU output and recorded in the test file with comments; CI green; `DECISIONS.md` updated with the indexing convention (0-based), the gap/overlap rule, and P-14 status.
