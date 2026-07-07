# Scout App v8.9 Auto Scout Flow

## Simple workflow

1. Upload contacts. Rows with emails become Ready; rows without emails remain Pending.
2. From Businesses, queue pending/no-email businesses to Auto Scout.
3. From Auto Scout, click Start Auto Scout. The page queues pending/no-email businesses and keeps processing backend batches until you stop it or the queue ends.
4. Found emails become status `found`.
5. Go to Ready Email Detection. Detect a fixed number, or leave the number blank to process all matching contacts up to the safety cap. Already-detected emails are skipped.
6. Valid business or personal email formats become Ready. Clearly bad/disposable emails become Invalid.
7. Send messages from Email Scout. Bounces/no-inbox are handled after sending and are not counted as real responses.

## Important limitation

This version does not use paid inbox verification. It cannot prove an inbox exists before sending. It uses a free preflight detector for format/domain/disposable checks, then bounce/reply tracking determines no-inbox after sending.

## Auto Scout speed

The frontend can queue thousands quickly and loop backend batches. Actual 5,000-business email finding speed depends on the backend, target websites/directories, rate limits, and serverless timeouts. The later dedicated backend worker is still the best path for unattended large runs.
