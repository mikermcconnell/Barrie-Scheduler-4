# Peer Agency Watch

A weekly section in the Monday daily performance email: news from peer transit agencies that matters to Barrie Transit, researched and written by Claude Opus 5.5 through the Anthropic API.

Status: the first edition (Monday 2026-11-23) was researched by hand in a Claude Code session and loaded with `seed-peer-digest.mjs`, with no API call. The first API edition is the Sunday 2026-11-29 run.

## How it works

| When | What | Code |
|---|---|---|
| Sunday 18:00 Toronto | `buildPeerDigest` researches Monday–Sunday news and saves the digest. It makes no API call if that week already has a ready digest (for example one loaded by hand), or if the monthly budget can't cover a run. | `functions/src/peerDigestJob.ts` |
| Stage A | One Claude call per agency, 3 at a time, benchmark peers first. Anthropic's web search and web fetch tools (server-side, `web_search_20260209`, `web_fetch_20260209`; at most 5 searches and 4 fetches of up to 15,000 tokens each). Medium effort. Each returns notes with source links, or `NO NEWS`, plus dated changes coming in the next 60 days even when announced earlier. | `functions/src/peerDigestResearch.ts` |
| Stage B | One editor call. High effort, structured JSON output (`PEER_DIGEST_SCHEMA`). Gets all the notes, Barrie context, the team's editor notes and the last 4 weeks' titles. | same |
| Checks | Every source URL must be one the researcher saw in a tool result or citation; items left with none are dropped. News must be dated in the week. At most 12 items and 8 upcoming events. | `functions/src/peerDigest.ts` (`sanitizeDigestContent`) |
| Draft mode | The draft is emailed to `PEER_DIGEST_DRAFT_TO` on Sunday evening. | `peerDigestJob.ts` |
| Live mode | The first daily report sent on or after that Monday carries the section (the last section, after Trip of the Day), then marks the digest `includedInReportAt`. A missing or failed digest leaves the section out; the ops email always sends. Live mode emails `PEER_DIGEST_DRAFT_TO` only when a build fails or the budget stops it. | `dailyReport.ts`, `peerDigestStore.ts`, `peerDigestHtml.ts` |

Both Claude calls use the server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). An agency that fails, is declined or is skipped for budget is recorded; the digest still builds from the others.

The agency list and the default Barrie context are in `functions/src/peerDigestSources.ts`. The Barrie context is sent to the Anthropic API, so it holds public facts only. No rider, STREETS or operator data is sent. Branding is the City of Barrie blue `#1F4E79` with its tints, in Arial.

## Spending limit

The team's Anthropic API allowance is US$100 a month.

- **Monthly ceiling:** `monthlyBudgetUsd` (default 100) covers every run in a calendar month, full and partial. Spend is tallied in `teams/{teamId}/peerDigestConfig/spend-{YYYY-MM}`, which only increases, so re-running a week still counts.
- **Per-run ceiling:** `maxRunUsd` (default 20), cut to what is left of the month. Four or five Sunday runs fit; tuning runs share what remains.
- **No start below the minimum:** a full run needs at least US$12 left in the month and a partial run US$5. Otherwise the run is saved as failed with the reason and no API call is made.
- **Inside a run:** an agency is not started if the run's spend so far, plus a margin for the calls in flight (at least US$1.50 each, or 1.25 × the run's own average) and US$1.50 for the editor, would pass the run's budget. Paused searches are not resumed once the run nears its budget.
- **These are estimates** from list prices (Opus 5.5 at $4 / $20 per million input/output tokens, cache reads $0.20, web search $10 per 1,000). **Set a monthly spend limit of US$100 in the Anthropic Console as well**; that is the hard stop.

## Data

| Path | Contents |
|---|---|
| `teams/{teamId}/peerDigests/{weekOf}` | One digest per Monday (`PeerDigestDoc`): content, per-agency run results, dropped-item count, token and search usage, estimated cost, `includedInReportAt`, `source` (`api` or `manual`). |
| `teams/{teamId}/peerDigests/{weekOf}_partial` | Tuning runs on a few agencies. Never sent to management. |
| `teams/{teamId}/peerDigestConfig/settings` | `mode` (`draft` default, or `live`), `editorNotes`, `barrieContext`, `monthlyBudgetUsd`, `maxRunUsd`. |
| `teams/{teamId}/peerDigestConfig/spend-{YYYY-MM}` | `estimatedCostUsd` and `runs` for the month. |

Server-only (Admin SDK). Client rules grant no access.

## Setup

Run these on a computer signed in to Firebase (`firebase login`) and Google Cloud.

1. In the [Anthropic Console](https://console.anthropic.com): create an API key, and set the workspace's monthly spend limit to US$100.
2. Get the code and install:
   ```bash
   git fetch origin && git checkout feat/peer-agency-digest
   cd functions && npm install
   ```
3. Secrets (each command prompts for the value; never paste the key into chat or a file):
   ```bash
   firebase functions:secrets:set ANTHROPIC_API_KEY
   firebase functions:secrets:set PEER_DIGEST_DRAFT_TO   # comma-separated emails for drafts and failure notices
   ```
   `REPORT_TEST_API_KEY` already exists for `testDailyReport`.
4. Load a hand-made digest, if there is one, **before** deploying, so the Sunday build skips that week:
   ```bash
   gcloud auth application-default login
   node scripts/seed-peer-digest.mjs --project barrie-scheduler-7844a --file scripts/peer-digest-samples/2026-11-23.json --live --apply
   ```
   Leave out `--apply` for a dry run. `--live` switches the section on for management.
5. Deploy:
   ```bash
   firebase deploy --only functions:buildPeerDigest,functions:testPeerDigest,functions:sendDailyReport,functions:testDailyReport
   ```
6. Preview the whole Monday email with the section, sent only to you:
   ```bash
   curl -H "x-api-key: YOUR_REPORT_TEST_API_KEY" "https://testdailyreport-ieeja7khcq-uc.a.run.app?to=YOUR_EMAIL&peerDigest=1"
   ```

## Tuning

`testPeerDigest` takes the same API key as `testDailyReport` (header `x-api-key`). Use the URL Firebase prints on deploy.

| Call | Does |
|---|---|
| `?action=run&agencies=guelph,kingston` | Partial run, saved as `{week}_partial`, draft emailed to `PEER_DIGEST_DRAFT_TO`. Counts against the budget. |
| `?action=run` | Full run (10–15 min). Skips the API when the week already has a ready digest; add `&force=1` to rebuild. Add `&to=email` or `&send=0`. |
| `?action=preview` | Draft HTML of the latest saved digest (`&week=` or `&id=` for another) |
| `?action=json` | The saved document, including per-agency results and usage |
| `?action=send&to=email` | Email a saved draft |
| `?action=settings` | Settings plus this month's estimated spend |
| `?action=mode&value=live` | Management receives the section. `value=draft` stops it. |

To tune without a deploy, set `editorNotes` in `teams/{teamId}/peerDigestConfig/settings` (for example "Leave out Metrolinx construction notices" or "Always include fare changes"). To change the agencies, edit `peerDigestSources.ts` and deploy.

## Hand-made editions

`functions/scripts/seed-peer-digest.mjs` loads a `PeerDigestDoc` JSON file (see `functions/scripts/peer-digest-samples/`) with `source: 'manual'`. It checks that `weekOf` is a Monday, the status is ready, and every item has a title, summary and source. A week with a ready digest is skipped by the Sunday build, so a hand-made edition costs nothing.
