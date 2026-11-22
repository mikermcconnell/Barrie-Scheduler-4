# Peer Agency Watch

A weekly section in the Monday daily performance email: news from peer transit agencies that matters to Barrie Transit, researched and written by Claude Opus 5.5 through the Anthropic API.

Status: built, **draft mode**. Drafts go only to `PEER_DIGEST_DRAFT_TO` until the transit projects lead approves the switch to live.

## How it works

| When | What | Code |
|---|---|---|
| Sunday 18:00 Toronto | `buildPeerDigest` researches Monday–Sunday news and saves the digest | `functions/src/peerDigestJob.ts` |
| Stage A | One Claude call per agency, 5 at a time. Anthropic's web search and web fetch tools (server-side, `web_search_20260209`, `web_fetch_20260209`). Medium effort. Each returns notes with source links, or `NO NEWS`. | `functions/src/peerDigestResearch.ts` |
| Stage B | One editor call. High effort, structured JSON output (`PEER_DIGEST_SCHEMA`). Gets all the notes, Barrie context, the team's editor notes and the last 4 weeks' titles. | same |
| Checks | Every source URL must be one the researcher saw in a tool result or citation; items left with none are dropped. News must be dated in the week. At most 12 items and 8 upcoming events. | `functions/src/peerDigest.ts` (`sanitizeDigestContent`) |
| Draft mode | The draft is emailed to `PEER_DIGEST_DRAFT_TO` on Sunday evening. | `peerDigestJob.ts` |
| Live mode | The first daily report sent on or after that Monday carries the section (the last section, after Trip of the Day), then marks the digest `includedInReportAt`. A missing or failed digest leaves the section out; the ops email always sends. Live mode emails `PEER_DIGEST_DRAFT_TO` only when a build fails. | `dailyReport.ts`, `peerDigestStore.ts`, `peerDigestHtml.ts` |

Both Claude calls use the server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). An agency that fails or is declined is recorded and skipped; the digest still builds from the others.

The agency list and the default Barrie context are in `functions/src/peerDigestSources.ts`. The Barrie context is sent to the Anthropic API, so it holds public facts only. No rider, STREETS or operator data is sent.

## Data

| Path | Contents |
|---|---|
| `teams/{teamId}/peerDigests/{weekOf}` | One digest per Monday (`PeerDigestDoc`): content, per-agency run results, dropped-item count, token and search usage, estimated cost, `includedInReportAt`. |
| `teams/{teamId}/peerDigests/{weekOf}_partial` | Tuning runs on a few agencies. Never sent to management. |
| `teams/{teamId}/peerDigestConfig/settings` | `mode` (`draft` default, or `live`), `editorNotes` (extra instructions for the editor), `barrieContext` (replaces the default). |

Server-only (Admin SDK). Client rules grant no access.

## Setup (once)

1. Secrets:
   ```bash
   firebase functions:secrets:set ANTHROPIC_API_KEY      # from console.anthropic.com
   firebase functions:secrets:set PEER_DIGEST_DRAFT_TO   # comma-separated, e.g. the transit projects lead
   ```
   `REPORT_TEST_API_KEY` already exists for `testDailyReport`.
2. `cd functions && npm install`, then `firebase deploy --only functions:buildPeerDigest,functions:testPeerDigest,functions:sendDailyReport,functions:testDailyReport`.

## Tuning

`testPeerDigest` takes the same API key as `testDailyReport` (see `requestAuth.ts`).

| Call | Does |
|---|---|
| `?action=run&agencies=guelph,kingston` | Cheap partial run (about $0.50–1), saved as `{week}_partial`, draft emailed to `PEER_DIGEST_DRAFT_TO` |
| `?action=run` | Full run (about $4–8, 10–15 min). Add `&to=email` or `&send=0`. |
| `?action=preview` | Draft HTML of the latest saved digest (`&week=` or `&id=` for another) |
| `?action=json` | The saved document, including per-agency results and usage |
| `?action=send&to=email` | Email a saved draft |
| `?action=settings` | Show the settings |
| `?action=mode&value=live` | **Start sending to management.** `value=draft` stops it. |

`testDailyReport?...&preview=1&peerDigest=1` shows the whole Monday email with the newest digest in it.

To tune without a deploy, set `editorNotes` in `teams/{teamId}/peerDigestConfig/settings` (for example "Leave out Metrolinx construction notices" or "Always include fare changes"). To change the agencies, edit `peerDigestSources.ts` and deploy.

## Going live

The transit projects lead approves the switch after reviewing drafts. Then call `?action=mode&value=live`. The next Monday report carries the section.

## Cost

Roughly US$4–8 a week (18 agencies): Opus 5.5 at $4 / $20 per million input/output tokens, web search at $10 per 1,000 searches. Each digest stores its own estimate in `usage.estimatedCostUsd`; the draft shows it.
