# v8.20 Dashboard Analytics

This version turns the dashboard/home view into a period-filtered analytics page.

## Added

- Dashboard filters: Today, Yesterday, Last 7 days, Last 30 days, Last 3 months, All time.
- Period comparisons against the matching previous period.
- Imported/added businesses comparison.
- Auto Scout found-email comparison.
- Auto Scout completed-job comparison.
- Sent messages comparison.
- Real reply comparison.
- No-inbox/bounce comparison.
- Response rate and emails per reply for the selected period.
- Template performance filtered by selected period.
- Sender performance filtered by selected period.
- Cleaner separation between current pipeline totals and time-based analytics.

## Notes

Some current pipeline cards are not date-filtered because they represent live status buckets, such as Pending No Email and Ready To Message. Period cards are date-filtered using created_at, sent_at, received_at, finished_at, or created_at depending on the table.
