# Test Daily Report Email

Quick reference for sending test performance report emails.

## Test Endpoint

```
https://testdailyreport-ieeja7khcq-uc.a.run.app?to=YOUR_EMAIL
```

## Example Recipient

```
your.name@example.com
```

## Send a Test

```bash
curl "https://testdailyreport-ieeja7khcq-uc.a.run.app?to=your.name@example.com"
```

## Notes

- Use a mailbox you control.
- Subject is prefixed with `[TEST]` to distinguish from scheduled reports
- Uses the most recent day's data from Firebase Storage
- Email is delivered via the Firebase Trigger Email extension (Firestore `mail` collection)
- Scheduled production report runs daily at 07:00 AM Toronto time to `REPORT_RECIPIENTS` secret
