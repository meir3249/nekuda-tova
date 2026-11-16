# 02 — Content Schema, Validator, Content Docs

## Purpose and scope
Finalize the `data/messages.json` schema, implement the pure validator used by the sender, CI, and a local script, and document content management. Ships a small sample `messages.json`.

## Relevant requirements
Brief §5 (content structure, safety), §11 (content docs). D-003, D-008, P-10, Req 8 of the hand-off.

## Technical design

### Schema (version 1)
```json
{
  "version": 1,
  "retiredIds": ["msg_0007"],
  "messages": [
    { "id": "msg_0001", "content": "…", "tags": ["gratitude"] }
  ]
}
```
| Field | Rule |
|---|---|
| file | UTF-8, ≤ 1 MiB, valid JSON, top level object |
| `version` | required integer; supported set `{1}`; anything else → error `UNSUPPORTED_VERSION` |
| `messages` | required array, **non-empty** |
| `messages[].id` | required string matching `^msg_[0-9]{4,}$`; unique within file |
| `messages[].content` | required string; after `trim()` non-empty; length ≤ **280** (P-10); no control characters except `\n`; |
| `messages[].tags` | optional array, ≤ 10 items, each `^[a-z0-9_-]{1,32}$`, no duplicates within the message. Metadata only. |
| `retiredIds` | optional array of ids (same pattern), unique; **must not intersect** `messages[].id` |
| unknown fields | ignored, reported as **warnings** (forward compatibility) |
| exact duplicate content | error `DUPLICATE_CONTENT` after normalization (trim, collapse whitespace, Unicode NFKC, case-folded) |

Semantic duplicates cannot be detected by machine; documented as a human review duty.

### Validator
`validateContent(rawText: string): ValidationResult` in `src/core/content/validate.ts`. Pure; no I/O.
```ts
type ValidationIssue = { code: string; path: string; message: string }
type ValidationResult =
  | { ok: true; content: MessageCollection; warnings: ValidationIssue[] }
  | { ok: false; errors: ValidationIssue[]; warnings: ValidationIssue[] }
interface Message { id: string; content: string; tags: string[] }
interface MessageCollection { version: 1; messages: readonly Message[]; retiredIds: readonly string[] }
```
All errors are collected (not just the first), capped at 50 with a `TOO_MANY_ERRORS` marker. Error codes: `INVALID_JSON`, `FILE_TOO_LARGE`, `NOT_AN_OBJECT`, `MISSING_VERSION`, `UNSUPPORTED_VERSION`, `MISSING_MESSAGES`, `EMPTY_MESSAGES`, `INVALID_ID`, `DUPLICATE_ID`, `INVALID_CONTENT`, `CONTENT_TOO_LONG`, `DUPLICATE_CONTENT`, `INVALID_TAGS`, `INVALID_RETIRED_IDS`, `RETIRED_ID_REUSED`.

### Registry diff check (CI only, not the sender)
`scripts/check-content-diff.ts <base.json> <head.json>` (uses the core validator on both):
- **Error:** an id present in base but missing in head and not in head's `retiredIds` (IDs must never be reused or silently dropped).
- **Warning (printed in the CI summary, does not fail):** messages removed; order changed; messages inserted before the end. Prints the impact in plain words: "N existing users' positions will shift by …; some may see repeats or skip messages." If base is missing (first commit) the check is skipped.

### Local script
`npm run validate:content [-- path]` prints errors/warnings and exits non-zero on error.

### Content docs (`docs/content-management.md`)
Must cover, in this order: purpose of the file; the JSON structure with a full example; how to add (append at the end, new never-used id), edit (keep id; wording change affects only future sends), and remove (move id to `retiredIds`); how ordering affects users (index-based progression, `(start + counter) mod N`); why ids must stay stable and are never reused; duplicate prevention (exact checked by CI; semantic by reviewer, with a short checklist); consequences of reordering/deleting/inserting (repeats or skips, accepted by design D-008); tags (metadata only, no effect); message-writing principles from D-003 (no brand in body, no preaching, no required response, room for interpretation, humor allowed); the publishing flow (PR → CI → merge to default branch → live at next sender run, because the sender reads the checkout).

### Sample content
`data/messages.json` with 12 neutral, non-branded placeholder messages (clearly marked for replacement by the user's real content), ids `msg_0001..msg_0012`. Placeholders follow D-003. Language per Q-01 default (English).

## Files and components
`src/core/content/{schema.ts,validate.ts,normalize.ts,index.ts}`, `scripts/validate-content.ts`, `scripts/check-content-diff.ts`, `data/messages.json`, `docs/content-management.md`, `.github/workflows/ci.yml` (adds the real content step; diff step on pull requests using the base branch file), `tests/core/content/*.test.ts`, `tests/fixtures/content/*.json`.

## Interfaces and contracts
`validateContent` and types above exported from `src/core/index.ts`. `ContentSource` port (00 §4) is created here with `RepoFileContentSource` in `src/adapters/repo-file/` (reads a path; used by scripts and the sender later) and `tests/fakes/fake-content-source.ts`.

## Dependencies
Task 01. No new packages.

## Acceptance criteria
1. Valid sample file → `ok: true` with 12 messages, no errors.
2. Each error code has a fixture that produces exactly that code (and `path` pointing at the offending element, e.g. `messages[3].id`).
3. Empty `messages` array → `EMPTY_MESSAGES`. `version: 2` → `UNSUPPORTED_VERSION`. Truncated JSON → `INVALID_JSON`.
4. A retired id reappearing in `messages` → `RETIRED_ID_REUSED`.
5. Normalized duplicate content (different case/whitespace) → `DUPLICATE_CONTENT`.
6. CI fails on an invalid `data/messages.json` and on a PR that removes an id without retiring it; CI passes on the sample.
7. Diff check emits warnings for reorder/removal/insertion and does not fail on them.
8. `docs/content-management.md` contains every topic listed above.
9. Core boundary test still passes (validator imports only core).

## Unit tests
One test per error code; multi-error collection; cap at 50; Unicode edge cases (emoji, Hebrew/RTL text, combining characters, NFKC equivalents); 280-character boundary (280 ok, 281 error, counting by Unicode code points); BOM at file start (accepted and stripped); unknown-field warnings; `tags` absent vs empty array.

## Integration tests
- `RepoFileContentSource` reads a fixture file and the validator accepts it.
- Script exit codes (0 valid, 1 invalid, 2 usage error).
- Diff check against fixture pairs (add, edit, remove-with-retire, remove-without-retire, reorder).

## Error cases
File missing → script exit 2 with clear message; unreadable file; invalid UTF-8 (reported as `INVALID_JSON`); file over 1 MiB.

## Edge cases
Ids `msg_9999` → `msg_10000` (≥ 4 digits allowed); whitespace-only content; content with only newlines; tag case (`Gratitude` rejected, not auto-lowercased); duplicate ids differing only in case treated as distinct but flagged as a warning `ID_CASE_COLLISION`.

## Definition of Done
Acceptance criteria met; docs reviewed against D-003/D-008; CI green; `DECISIONS.md` updated (schema recorded, P-10 status).
