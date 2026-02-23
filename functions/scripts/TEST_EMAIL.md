# Test Daily Report Email

Quick reference for sending test performance report emails.

## Test Endpoint

```
https://testdailyreport-ieeja7khcq-uc.a.run.app?to=EMAIL
```

## Default Test Recipient

```
michaelryanmcconnell@gmail.com
```

## Send a Test

```bash
curl "https://testdailyreport-ieeja7khcq-uc.a.run.app?to=michaelryanmcconnell@gmail.com"
```

## Notes

- Subject is prefixed with `[TEST]` to distinguish from scheduled reports
- Uses the most recent day's data from Firebase Storage
- Email is delivered via the Firebase Trigger Email extension (Firestore `mail` collection)
- Scheduled production report runs daily at 07:00 AM Toronto time to `REPORT_RECIPIENTS` secret
