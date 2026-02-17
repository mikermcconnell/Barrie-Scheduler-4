# Auto-Ingest: Daily STREETS Performance Data

Automatically imports your daily STREETS CSV email attachment into the Performance Dashboard.

**Flow:** Outlook Email → Power Automate → Cloud Function → Firebase (same place manual imports go)

---

## Overview

| Piece | What it does | Who does it |
|-------|-------------|-------------|
| Cloud Function | Receives CSV, parses it, saves to Firebase | Already built (code in `functions/`) |
| Power Automate | Watches your inbox, grabs CSV, sends to function | You set up (step-by-step below) |
| Deploy | Push the function to Google Cloud | One-time terminal command |

---

## Step 1: Find Your Team ID

You need your team's Firestore ID for the function URL.

1. Open the Scheduler app and log in
2. Open your browser's DevTools (F12) → Console tab
3. Type this and press Enter:
   ```
   document.cookie
   ```
   Or easier — look at any Firestore call in the Network tab. The team ID appears in URLs like:
   `teams/YOUR_TEAM_ID/performanceData/...`

4. Copy that ID — you'll use it in Step 4.

**Your team ID is: `PHICwXGlvDen0RGt7fCG`** (already hardcoded as the default in the Cloud Function, so you don't need to pass it as a query parameter unless you have multiple teams).

---

## Step 2: Deploy the Cloud Function

Open a terminal in the project folder and run these commands one at a time:

### 2a. Log in to Firebase
```bash
npx firebase login
```
This opens a browser window. Sign in with your Google account that owns the Firebase project.

### 2b. Set the API key secret
This creates a password that Power Automate will use to call your function. **Pick any random string** (like a password). You'll use this same string in Step 4.

```bash
npx firebase functions:secrets:set INGEST_API_KEY
```
It will prompt you to type a value. Enter something like: `streets-auto-2026-barrie` (or any string you want — just remember it).

### 2c. Deploy
```bash
cd functions && npm run build && cd .. && npx firebase deploy --only functions
```

Wait for it to finish. It will print a URL like:
```
https://us-central1-barrie-scheduler-7844a.cloudfunctions.net/ingestPerformanceData
```

**Copy this URL** — you need it for Step 4.

### 2d. Verify Firebase is on Blaze plan
Cloud Functions require the Blaze (pay-as-you-go) plan. If deployment fails with a billing error:
1. Go to https://console.firebase.google.com
2. Select your project → Upgrade to Blaze
3. Add a payment method (you won't be charged — this usage is well within the free tier)
4. Re-run the deploy command

---

## Step 3: Test the Function (Optional but Recommended)

Before setting up Power Automate, test with a CSV file you already have:

```bash
curl -X POST "YOUR_FUNCTION_URL?teamId=YOUR_TEAM_ID" \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: text/csv" \
  --data-binary @path/to/your/streets-export.csv
```

Replace:
- `YOUR_FUNCTION_URL` with the URL from Step 2c
- `YOUR_TEAM_ID` with your team ID from Step 1
- `YOUR_API_KEY` with the secret from Step 2b
- `path/to/your/streets-export.csv` with an actual CSV file

You should get back:
```json
{
  "success": true,
  "daysIngested": 1,
  "dates": ["2026-02-12"],
  "totalDaysStored": 15,
  "recordsParsed": 36421,
  "warnings": []
}
```

Then check the app — your Performance Dashboard should show the data.

---

## Step 4: Set Up Power Automate

### 4a. Create a new flow

1. Go to https://make.powerautomate.com
2. Click **+ Create** → **Automated cloud flow**
3. Name it: `STREETS Daily Import`
4. Choose trigger: **When a new email arrives (V3)** (Office 365 Outlook)
5. Click **Create**

### 4b. Configure the email trigger

Click the trigger and set:
- **Folder**: Inbox
- **From**: *(the email address that sends the daily STREETS export)*
- **Subject Filter**: *(any keyword from the subject line, e.g. "STREETS" or "Daily Export")*
- **Has Attachment**: Yes
- **Include Attachments**: Yes

### 4c. Add "Get Attachment" action

1. Click **+ New step**
2. Search for **Get Attachment (V2)** (Office 365 Outlook)
3. Set:
   - **Message Id**: Select `Message Id` from the trigger's dynamic content
   - **Attachment Id**: Select `Attachment Id` from the trigger's dynamic content

> If Power Automate shows an "Apply to each" loop (because emails can have multiple attachments), that's fine — it will process each attachment.

### 4d. Add condition to filter for CSV only (optional but recommended)

1. Inside the "Apply to each", click **+ New step** → **Condition**
2. Set: `Name` (from Get Attachment) **ends with** `.csv`
3. In the **If yes** branch, continue with the next step

### 4e. Add HTTP action to call the Cloud Function

1. In the **If yes** branch, click **+ New step**
2. Search for **HTTP** (the built-in HTTP action, NOT the premium connector)
3. Configure:
   - **Method**: POST
   - **URI**: `YOUR_FUNCTION_URL?teamId=YOUR_TEAM_ID`
     - Replace with your actual function URL and team ID
   - **Headers**:
     | Key | Value |
     |-----|-------|
     | x-api-key | *(your API key from Step 2b)* |
     | Content-Type | text/csv |
   - **Body**: Select **Content Bytes** from the "Get Attachment" dynamic content

4. Click **Save**

### 4f. Test the flow

1. Click **Test** in the top right
2. Choose **Manually**
3. Send yourself a test email with a STREETS CSV attached (or forward one of the daily emails)
4. Watch the flow run — it should show green checkmarks on each step
5. Check the Performance Dashboard in the app — the data should appear

---

## Step 5: Verify It's Working

The next morning after the daily email arrives:
1. Open Power Automate → **My flows** → `STREETS Daily Import`
2. Check the **Run history** — it should show a successful run
3. Open the Scheduler app → Performance Dashboard — yesterday's data should be there

---

## How It Works (Technical Summary)

1. **Email arrives** in your Outlook with a CSV attachment
2. **Power Automate** detects it, extracts the CSV attachment
3. **HTTP POST** sends the raw CSV to the Cloud Function
4. **Cloud Function** parses the CSV using the same STREETS parser your app uses
5. **Aggregation** computes OTP, ridership, load profiles (same as manual import)
6. **Merge** — loads existing data, adds the new day (or replaces if same date), saves back
7. **Firebase Storage** stores the full JSON, **Firestore** stores the metadata
8. **Performance Dashboard** shows the updated data next time you open it

Data accumulates over time — each day appends to your history.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Power Automate flow fails with 401 | API key doesn't match. Re-check `x-api-key` header matches what you set in Step 2b |
| Flow fails with 400 "No valid records" | The CSV format may have changed. Try a manual import in the app to verify the CSV |
| Flow fails with 500 | Check Cloud Function logs: Firebase Console → Functions → Logs |
| Data doesn't appear in dashboard | Check the team ID is correct. Open DevTools → Network to verify |
| Duplicate days | Not a problem — the function replaces existing dates automatically |
| Firebase billing error | Upgrade to Blaze plan (Step 2d). Free tier covers this usage |

### Viewing Cloud Function Logs
1. Go to https://console.firebase.google.com
2. Select your project
3. Left sidebar → **Functions** → **Logs**
4. Look for `ingestPerformanceData` entries

---

## Cost

- **Cloud Functions**: ~30 invocations/month = $0 (free tier: 2M/month)
- **Firebase Storage**: ~1-5 MB/day = $0 (free tier: 5 GB)
- **Firestore**: ~1 write/day = $0 (free tier: 20K writes/day)
- **Power Automate**: Included with Microsoft 365
