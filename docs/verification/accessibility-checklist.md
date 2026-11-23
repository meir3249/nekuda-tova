# Accessibility checklist

Builds on the checklist in [task-06-pwa-checklist.md](task-06-pwa-checklist.md) (labels, switch semantics, live region, focus, contrast, touch targets, zoom, reduced motion, `lang`/`dir`, font, time labels, screen readers) and adds the items from Task 07 and Task 08.

This is not a full WCAG audit. Statuses: **Auto** (a test covers it), **Checked** (verified by hand in a session), **Not run** (needs a real device or assistive technology). Nothing is passed by default.

| Item | Status | Evidence / how to check |
|---|---|---|
| Install sheet: focus moves into the sheet when it opens | Auto | `tests/pwa/push/push-flows.test.ts` (focus in) |
| Install sheet: focus returns to the control that opened it on close, and Esc and "Not now" close it | Auto | `tests/pwa/push/push-flows.test.ts` |
| Install sheet appears once only and never over the controls card | Auto + Checked | Flag honoured in tests; layout checked at 320, 390 and 520 px |
| Toast is announced politely, once per message | Not run | Verify with TalkBack and VoiceOver that one message is spoken once and focus does not move |
| At most one notice visible; toast suppressed while the sheet is open | Auto | `push-flows.test.ts` |
| Switch state is conveyed without colour alone | Not run | Check the knob position and the on/off words with colour filters or greyscale; the off hint is text |
| Keyboard only: tab order is time, switch, "How it works", privacy link | Not run | Walk through on desktop Chrome and Firefox; focus ring visible on each |
| Touch targets at least 44 px on a phone | Not run | Measure on Android and iOS |
| 200% text zoom keeps the label and control on one row or wraps without loss | Not run | Android font scale and browser zoom |
| Reduced motion removes animation | Checked | CSS under `prefers-reduced-motion: reduce` |
| Screen reader reads the Hebrew UI in the right order | Not run | TalkBack, VoiceOver |
