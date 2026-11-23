# Limitations

What Nekuda Tova cannot promise. Written plainly so nothing here comes as a surprise.

## Delivery is not guaranteed
Push services, browsers and operating systems decide whether a notification reaches the screen. The sender can only observe that the push service **accepted** a message (D-016). Doze mode, battery savers, Focus modes, an offline device, or a revoked permission can each stop it from appearing.

## Exact time is not guaranteed
Messages arrive around the chosen slot, not at the exact minute. GitHub scheduled runs may start late or be skipped. The sender runs at minutes 3 and 33 of every hour. A message up to 2 hours late is still sent; later than that it is skipped for that day and the next day's slot is used (D-011). Slots are 30 minutes (D-012).

## iOS and iPadOS
Notifications need iOS or iPadOS 16.4 or later, the app added to the Home Screen, and a tap to grant permission. The installed app and the Safari tab keep separate storage, so a setting made in one is not seen by the other. When a notification is tapped, iOS may open the app; the app does nothing special in response (D-017).

## The schedule can silently stop
- GitHub may disable scheduled workflows after 60 days without repository activity. The workflow re-enables itself each run, which mitigates this but cannot be guaranteed (R-02).
- Supabase free projects pause after about a week of inactivity. The 30-minute database query mitigates this but cannot be guaranteed (R-03). A paused project can be restored from the dashboard within the restore window stated in the Supabase documentation.
- If a free tier changes its terms, the service may stop being free or stop working. See the migration notes in [operations.md](operations.md).

## Identity and devices
- Each browser or device is a separate anonymous identity. There is no sync between devices.
- Clearing site data loses the identity. The old row is removed by retention (see [privacy.md](privacy.md)).
- If you change time zone and do not open the app, the schedule stays in the old zone until you do.

## Content and progression
- Progression is index-based. Editing `data/messages.json` can repeat or skip a message for someone mid-sequence (D-008, accepted).
- A crash between a push being accepted and the state being saved can produce one repeat within the window. The notification `tag` and push `topic` make a repeat replace the earlier one on most devices.
- Changing the time after today's notification already fired can produce a second one the same day (P-14).

## Platform caveats
- A push endpoint is a pseudonymous identifier (R-10).
- The notification service worker always shows a notification, even for a malformed payload, to avoid iOS revoking the subscription (R-06).
- Anonymous sign-in is open to scripted abuse. The subscription cap and rate limits reduce this and do not remove it (R-07).

Not verified on real devices at the time of writing: see [verification/device-checklist.md](verification/device-checklist.md).
