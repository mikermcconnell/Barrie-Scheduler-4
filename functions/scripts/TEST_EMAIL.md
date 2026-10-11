# Test Daily Report Emails

Quick reference for sending test performance emails.

## Normal management report test

```
https://testdailyreport-ieeja7khcq-uc.a.run.app?to=YOUR_EMAIL
```

### Example

```bash
curl "https://testdailyreport-ieeja7khcq-uc.a.run.app?to=your.name@example.com"
```

## No-data report test

Use this endpoint to preview the email sent when the scheduled report has no new STREETS data:

```
https://teststalereportalert-ieeja7khcq-uc.a.run.app?to=YOUR_EMAIL
```

### Example

```bash
curl "https://teststalereportalert-ieeja7khcq-uc.a.run.app?to=your.name@example.com"
```

## Monthly ridership report test

After deployment, use the `testMonthlyRidershipReport` URL reported by Firebase. The endpoint accepts an explicit recipient and optional report month:

```bash
curl -H "x-api-key: YOUR_REPORT_TEST_API_KEY" "FUNCTION_URL?to=your.name@example.com&month=2026-08"
```

Add `&debug=1` to return the calculated model and chart byte size without queueing an email.

## Notes

- Use a mailbox you control.
- The normal report test uses the current latest day from Firebase Storage.
- The no-data test sends the short manager-facing fallback email.
- The monthly test uses the compact Ridership Trends and On Demand projections, prefixes the subject with `[TEST]`, and never writes the production monthly audit.
- Email is delivered via the Firebase Trigger Email extension (Firestore `mail` collection).
- Scheduled production report runs daily at 07:00 AM Toronto time to `REPORT_RECIPIENTS`.
- If no new STREETS data is available, the scheduled report sends a short no-data message to `REPORT_RECIPIENTS`.
- Scheduled monthly ridership runs at 10:00 AM Toronto time on the first calendar day and reports the previous month to `REPORT_RECIPIENTS`.
