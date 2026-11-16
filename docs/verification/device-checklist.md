# Device checklist: push and permission flows (spec 07)

Legend: **Auto** = covered by tests in `tests/pwa/`; **Checked** = verified locally in this session; **Not run** = needs the deployed Pages URL and a real device. Fill in date, tester and result when run.

## Automated and local evidence (2026-11-16)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | iOS Safari tab: sheet once, dismissible, no row | Auto | `push-flows.test.ts` › iOS Safari tab (flag honoured, Not now / Esc, focus in and back, no saves, sessions or reads). Layout checked in headless Chrome at 320, 390 and 520 px: the sheet sits below the controls card and does not cover it |
| 5 | No permission request without a tap | Auto | Request count 0 after load in every state; 1 synchronously inside the tap handler |
| 6 | Denied: nothing on load, one calm toast on tap, no re-prompt, time still saves | Auto | |
| 7 | Disable sends `enabled=false` and removes the local subscription; re-enable subscribes afresh | Auto (client side) | Server side (null subscription, counter kept) covered by Task 04 handler tests |
| 9 | Timezone change on reopen is saved | Auto | Silent save with the new zone |
| 10 | Tap performs no app action in the handler | Auto | Source scan and built `sw.js` scan |
| 11 | Malformed payload → title-only notification | Auto | `sw-handlers.test.ts` |
| 13 | At most one notice; no inline text in any state | Auto | Toast suppressed while the sheet is open; controls card holds only two rows and the off hint |

## Device matrix (Not run)

| Device | Steps | Expected | Observed | Date / tester | Result |
|---|---|---|---|---|---|
| iOS Safari tab (16.4+) | Open the Pages URL | Sheet rises once; reopen: no sheet; tap switch: sheet; no Supabase row | | | Not run |
| iOS installed | Add to Home Screen, open, tap switch | Permission prompt; granting subscribes; `--test-push` arrives; no sheet | | | Not run |
| iOS installed | Tap a notification | Record whether iOS opens the app (D-017 caveat) | | | Not run |
| Android Chrome tab | Tap switch | Prompt; notification from `--test-push` arrives | | | Not run |
| Desktop Chrome | Same as Android | | | | Not run |
| Desktop Firefox | Same as Android | | | | Not run |
| Any | Disable, then sender dry run; re-enable, dry run | Row has null subscription and `next_send_at`; same message index after re-enable | | | Not run |
| Any | Change time while enabled | `next_send_at` moves; old slot no longer fires | | | Not run |
| Any | Revoke permission in OS settings, return to app | Switch off and quiet, no message; row disabled | | | Not run |
| Any | Wait for the first scheduled push | Arrives within 2 h of the slot; delay in `delivery_log` | | | Not run |
| Each device | Calm check | Sheet and toast above the safe area, never over the controls card, one at a time | | | Not run |

Endpoint allowlist: reconcile with the real endpoint hosts observed on these devices (`src/core/settings/push-endpoint-allowlist.ts`).
