# Scout v10.35.1 Scale Guard R4 deployment fix

R4 contains the same application code and R3 database compatibility repair.

The only package correction is removal of trailing whitespace from
`V10_35_VALIDATION_REPORT.md`, which previously caused
`git diff --cached --check` to stop the deployment before commit and push.

No additional SQL is required if the R3 SQL completed successfully.
