# Managing `data/messages.json`

This file is the single source of truth for what readers receive. The daily sender reads it from the repository checkout on every run, so whatever is merged into the default branch is what goes out next.

> **The messages currently in the file are placeholders** written to exercise the system. Replace them with your real content before the sender goes live.

## 1. File structure

```json
{
  "version": 1,
  "retiredIds": ["msg_0007"],
  "messages": [
    { "id": "msg_0001", "content": "מתי בפעם האחרונה הסתכלת על השמיים סתם ככה?", "tags": ["wonder"] },
    { "id": "msg_0002", "content": "חיבוק אחד קטן יכול להספיק ליום שלם." }
  ]
}
```

| Field | Required | Rule |
|---|---|---|
| `version` | yes | Integer. Only `1` is supported today. |
| `messages` | yes | Non-empty array. **Order matters** (see section 4). |
| `messages[].id` | yes | `msg_` plus at least 4 digits, e.g. `msg_0042`. Unique. Never reused. |
| `messages[].content` | yes | The notification text. 1 to 280 characters, not blank, no tabs or control characters (line breaks are fine). Unicode, including Hebrew and emoji, is fine. |
| `messages[].tags` | no | Up to 10 tags, each lower-case `a-z`, `0-9`, `_`, `-`, 1 to 32 characters, no repeats in one message. **Metadata only: tags never change which message is sent or in what order.** |
| `retiredIds` | no | Ids that used to exist and were removed. They must never come back (section 3). |

Unknown extra fields are ignored with a warning. The file must be UTF-8 and under 1 MiB.

## 2. Adding, editing, removing

**Add.** Append a new object at the **end** of `messages` with a never-used id (take the next number). Appending is the least disruptive change.

**Edit.** Change `content` and keep the `id`. Readers who reach that position later see the new wording. Editing does not move anyone.

**Remove.** Delete the object **and** add its id to `retiredIds`. CI fails if you remove an id without retiring it.

## 3. Why ids must be stable and never reused

The id is the permanent name of a message. Logs, history, and future features may refer to it. If an old id came back with different text, anything that referred to the old message would silently point at the new one. So ids are immutable, and an id that has been removed is retired forever. The validator rejects a retired id that reappears in `messages`, and the pull-request check rejects un-retiring one.

## 4. Order and what it means for readers

Progression is **index-based**. Each reader has a start position chosen at random when they joined and a counter that goes up by one for each notification sent. The message sent is:

```
messages[(start + counter) mod N]      N = number of messages, 0-based
```

The file is read at send time, so `N` is always the current count. The sequence loops back to the beginning after the last message.

Consequences of changing the file:

| Change | Effect on readers |
|---|---|
| Append at the end | `N` grows. Readers who have already gone through the whole list at least once will land on different messages (some repeats, some skips). First-time readers are unaffected for now. |
| Insert in the middle | Everything after the insertion shifts by one position. Some readers see a message twice in a row, or miss one. |
| Remove | Everything after it shifts the other way. Some readers skip a message. |
| Reorder | Readers near the moved messages see repeats or skips. |
| Edit text | No movement. |

This is an accepted trade-off of the index-based design. The system does not try to prevent repeats across content updates. A pull request that changes order or count gets a plain-language impact warning in the CI summary; it does not fail.

Because the order is exactly what readers experience, arrange messages so neighbors feel different (mix serious and light, avoid three similar ones in a row).

## 5. Avoiding duplicates

- **Exact duplicates** (same text ignoring case, spacing, and character-width variants) are errors and CI fails.
- **Semantic duplicates** (same idea in different words) cannot be detected by a machine. Before adding, search the file for the idea. A reader will notice the same thought twice in a cycle. A quick review question: "Would someone feel they already got this one?"

## 6. Writing principles

These come from the product manifesto and apply to every message.

- Sound like a thought, not an instruction from an app.
- No preaching or moralizing. Do not pretend to know the reader's situation.
- Do not ask for a response or tell the reader to open the app.
- Leave room for interpretation. Do not explain the thought completely.
- Not always serious: humor, curiosity, and lightness are welcome.
- Do not use the product name ("נקודה טובה" or "Nekuda Tova") in the text. The name appears only in the notification title.
- Do not promote a religion, ideology, or lifestyle.
- Avoid repetitive templates.

### Hebrew notes
- Hebrew addresses people by gender. Prefer wording that reads the same for everyone: questions in the past tense (the unpointed spelling is the same for masculine and feminine, e.g. "הסתכלת"), impersonal forms ("אפשר ל…"), and plural or general statements.
- Check that the line still reads well in a notification: short lines work best, and the first words show first.

## 7. Validating locally

```
npm run validate:content                 # checks data/messages.json
npm run validate:content -- path/to.json # checks another file
```

Exit code 0 means valid, 1 means invalid (every problem is listed with its location, for example `messages[3].id`), 2 means the file could not be read or the command was used incorrectly.

To preview the impact of your change against the version on the main branch:

```
git show origin/main:data/messages.json > base.json
node scripts/check-content-diff.ts base.json data/messages.json
```

The sender runs the same validator before every send. If the file is invalid, **nothing is sent** and the run is marked failed, so a mistake cannot reach readers as a broken message.

## 8. Publishing a change

1. Edit `data/messages.json` on a branch.
2. Run `npm run validate:content`.
3. Open a pull request. CI validates the file and prints the impact on existing readers.
4. Merge into the default branch. The next sender run uses the new content.

## 9. Validation errors reference

| Code | Meaning |
|---|---|
| `INVALID_JSON` | Not valid JSON (missing comma or quote, truncated file, invalid UTF-8) |
| `FILE_TOO_LARGE` | Over 1 MiB |
| `NOT_AN_OBJECT` | Top level is not a JSON object |
| `MISSING_VERSION` / `UNSUPPORTED_VERSION` | `version` absent, or not a supported value |
| `MISSING_MESSAGES` / `EMPTY_MESSAGES` | `messages` absent, not an array, or empty |
| `INVALID_MESSAGE` | A message is not an object |
| `INVALID_ID` / `DUPLICATE_ID` | Bad id shape, or the id appears twice |
| `INVALID_CONTENT` / `CONTENT_TOO_LONG` | Missing, blank, contains control characters, or over 280 characters |
| `DUPLICATE_CONTENT` | Same text as an earlier message |
| `INVALID_TAGS` | Tags are not an array of valid, unique, lower-case tags (max 10) |
| `INVALID_RETIRED_IDS` / `RETIRED_ID_REUSED` | Bad `retiredIds`, or a retired id is back in `messages` |
| `ID_REMOVED_WITHOUT_RETIRE` / `RETIRED_ID_DROPPED` | (pull requests) an id was removed without retiring it, or un-retired |
| `TOO_MANY_ERRORS` | More than 50 problems; only the first 50 are shown |
