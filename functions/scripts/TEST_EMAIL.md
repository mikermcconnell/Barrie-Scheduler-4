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

## Stale-data alert test

After deploy, use the new endpoint:

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
- The stale alert test sends the IT/Admin-style stale-data warning email.
- Email is delivered via the Firebase Trigger Email extension (Firestore `mail` collection).
- Scheduled production report runs daily at 07:00 AM Toronto time to `REPORT_RECIPIENTS`.
- Scheduled stale-data alerts go only to `REPORT_ALERT_RECIPIENTS` and use a different subject line that does **not** include `Barrie Transit Performance`.
