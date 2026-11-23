# Final report (template)

Copy this file to `final-report.md`, fill it in, and state **not verified** for anything you did not run. Do not leave rows blank.

- Date:
- Commit:
- Tester:

## 1. Requirements completed
| Requirement | Brief section | Evidence (test, commit, doc) | Status |
|---|---|---|---|
| D-001..D-004 product principles | | | |
| D-005, D-006 progression, pause and resume | | | |
| D-007, D-011 no retroactive sends, 2 h window | | | |
| D-008 content in `data/messages.json` | | | |
| D-009 everything free | | | |
| D-010 PWA, Web Push, Supabase, GitHub Actions | | | |
| D-012 30-minute slots | | | |
| D-013 permission flows by environment | | | |
| D-014 timezone and DST | | | |
| D-015 pure core and boundaries | | | |
| D-016 counter advances on push acceptance | | | |
| D-017 notification tap does nothing | | | |

## 2. Test results
| Command | Outcome | Notes |
|---|---|---|
| `npm run ci` | | |
| `npm run test:boundary` | | |
| `npm run validate:content` | | |
| SQL and RLS tests (`supabase test db`) | | |
| `npm run sender -- --dry-run` | | |

## 3. Soak test (7 days, real project)
- Test subscriptions:
- Delay distribution from `delivery_log` (min, median, max):
- Dropped or late runs from `sender_runs`:
- Keep-alive result:
- Supabase pause behavior observed:

## 4. Known limitations
Link to [../limitations.md](../limitations.md) and list anything new.

## 5. Outstanding issues

## 6. Deviations from the specs

## 7. Calm-space review
For each state (first paint, switch off with hint, saved toast, error toast, permission denied, iOS install sheet) attach a screenshot and confirm: at most one notice, no inline status text, nothing on load apart from the install hint.

UI strings reviewed against the principle (one short sentence, no alarming words, no guilt): yes / no, reviewer, date.

## 8. Code review
- Unapproved dependencies: none / list
- Message text in logs or tables: none / list

## 9. Recommended next steps
