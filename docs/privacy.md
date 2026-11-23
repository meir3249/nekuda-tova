# Privacy

Short and plain. There is no account and no name.

## What is stored
- An anonymous id (created by your browser's anonymous sign-in).
- The time you chose (`local_time`) and your time zone name (`timezone`), for example `Asia/Jerusalem`.
- Whether notifications are on (`enabled`).
- A position counter (`message_index`) and a random starting point (`start_index`), so you receive the next message and not the same one.
- The next send time (`next_send_at`) and a short work lease (`claimed_until`).
- Your device's push address (`push_subscription`). It is a pseudonymous identifier.
- A technical delivery log (`delivery_log`): when a send was due, when it was attempted, how late, the result, and the id of the message. **Never the message text.**
- A heartbeat per sender run (`sender_runs`) with counts only.

## Why
To send one notification a day at your time, and to notice when sending is late or failing.

## Where
In a Supabase project (database) and in GitHub (code, scheduled runs, and the public page). Push messages travel through your browser vendor's push service.

## How long
- Turning notifications off removes your push address at once.
- Rows that are off and untouched for 365 days are deleted.
- Delivery log and run rows are deleted after 90 days.

## What is not collected
No name, no email, no analytics, no location beyond the time zone name, and no third-party trackers, scripts, or fonts.

## Removing your data
Turn notifications off to remove the push address. Clearing site data detaches this device from its row, and retention deletes the row later.

*This note is not legal advice. Review it before a public launch.*
