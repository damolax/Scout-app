# Scout v10.34 validation report

Baseline: Scout v10.33 access recovery package.

## Changed runtime files

1. `app/(app)/message/MessageClient.tsx`
2. `app/api/message/start-job/route.ts`
3. `app/api/message/run-schedules/route.ts`
4. `components/AppOpenRunner.tsx`
5. `lib/email-signature.ts`
6. `package.json`

## Validation completed

- TypeScript: passed with `tsc --noEmit`.
- Next.js production build: passed.
- Static route generation: all 42 pages/routes completed.
- Signature MIME test: passed for unsigned and already-signed inputs; text and HTML each contained exactly one signature.
- Sender-path audit: scheduled sender now passes the unsigned template body to `buildMimeMessage`.
- Delay persistence audit: Send Now and saved schedules store `delay_ms`.
- Default delay audit: Message page defaults to 3 seconds.
- Parallel-lane audit: the worker creates one sequential lane per selected sender and runs lanes with `Promise.all`.
- Per-lane chunk size: 20 messages maximum per sender per worker invocation, keeping a 3-second lane below the Message page's 90-second request timeout under normal API latency.
- Deployment script syntax: checked with `bash -n`.

## Operational limitation

This build improves continuation while Scout is open. A browser-independent 24/7 worker still depends on the existing scheduled worker/hosting setup. Gmail may independently throttle or reject traffic; when that occurs, Scout pauses the affected sender rather than accelerating through the provider limit.
