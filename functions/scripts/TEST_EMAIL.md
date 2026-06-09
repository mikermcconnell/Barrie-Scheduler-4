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

## Notes

- Use a mailbox you control.
- The normal report test uses the current latest day from Firebase Storage.
- The no-data test sends the short manager-facing fallback email.
- Email is delivered via the Firebase Trigger Email extension (Firestore `mail` collection).
- Scheduled production report runs daily at 07:00 AM Toronto time to `REPORT_RECIPIENTS`.
- If no new STREETS data is available, the scheduled report sends a short no-data message to `REPORT_RECIPIENTS`.
