# Scout v8.47 — Live toggle + cron/send kick fix

- Live Work stays closed by default. Click the pill to open/close it.
- Start sending now creates a durable job and kicks the first small send chunk immediately.
- Cron continues the remaining job after the user leaves.
- Sent emails now use the final signature/logo body in the Gmail send call.
- Adds schedule/live activity schema repair SQL.
