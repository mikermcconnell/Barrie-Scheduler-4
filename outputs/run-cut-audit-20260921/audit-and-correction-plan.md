# Run-cut audit and correction plan

September 21, 2026. Prepared for planner review from the supplied local workbooks, the original operating-rule photographs, and the current local Scheduler implementation.

## Decision

Correct the operator-duty representation and calculations before generating another cut. The first draft contains known excessive duties, while the current model also lacks information needed to reproduce the supplied operating examples. Changing the prompt alone will not resolve those structural gaps.

This is an audit and implementation plan, not a replacement run cut, a contractual sign-off, or approval of the example paddles. The initial audit was read-only. The user subsequently authorized the first local correction slice; its status is recorded at the end. Original workbooks, published schedules and stored scenarios remain unchanged. Local code was reviewed at HEAD `19d4f6a45e8f3dd2d0a375eb1dc2087a88c86b67` with unrelated working-tree changes present. Production was not inspected.

## Sources and coverage

| Source | Use and limits |
|---|---|
| `D:\First Draft - Run Cut.xlsx` | Read all nine sheets. August 27 pilot, scenario `dry-run-full-current-master-2026-08-27`, fingerprint `fnv1a32:c466d066`. Not the September board-period source. |
| `D:\Attached_Files_September_Board_Period\Paddles - September 20 2026.xlsx` | Inventoried 174 fixed-route duty headers: 72 weekday, 68 Saturday, 34 Sunday. Reconstructed selected duty timelines and reconciled header time plus BP to the roster. Weekday numbers omit 67; numbering alone is not proof of missing service. The extra `Sheet1` is not included in those counts. |
| `Roster - September 20 2026 (Documantation Purpose Only).xlsx`, same folder | Inspected `Current`; matched 462 fixed-route assignment rows covering all 174 paddle duty identities. Other rows include RPT, FXRPT, MISC and TOD work. This is not a complete workforce or service-coverage certification. |
| `Roster Summary - September 20 2026 - Not Complete.xlsx`, same folder | Internal sheet/title still say June 28, 2026. Do not use as authoritative September coverage until its period is confirmed. |
| Fourteen unique `D:\20260827_*.jpg` rule pages | Visually read all fourteen; source clauses cited below. Four key SOP files' SHA-256 values match `rules.ts` exactly: 094729, 094734, 094741 and 094748. Did not assume all source interpretations are settled merely because hashes match. |
| September fixed-route and TOD PDF paddles | Inventoried only; PDF/workbook agreement was not checked. TOD duty reconstruction remains outside this fixed-route audit. |
| Local `utils/run-cutting/`, feature contract and skill | Code evidence for current representation and checks. Existing domain tests pass, but do not establish agreement with real paddles. |

All workbook references below are local to the named source. The weekday paddle sheet is named `Mon - Fri ` with a trailing space. No employee names or badge data are reproduced.

## First-draft failure inventory

The Summary sheet explicitly records 105 contract blockers and `Approval ready: No` (`A12:H17`). Findings reconcile to:

| Finding code | Count |
|---|---:|
| straight-driving-exceeded | 29 |
| maximum-work-exceeded | 27 |
| maximum-spread-exceeded | 27 |
| maximum-driving-exceeded | 20 |
| long-spread-share-exceeded | 2 |
| Total | 105 |

The first four categories affect 29 distinct daily runs: 14 weekday, 13 Saturday and 2 Sunday. The last two findings apply to weekday and Saturday run distributions. These counts describe failures against the draft's recorded profile, not an independent interpretation of legislation.

- Every one of the 166 draft runs has one piece and `Split: No` (`Daily Runs!A2:M167`). Multiple pieces are supported by the schema, but this draft did not use them.
- W-001 is 04:14–20:24, platform 12:22, paid 14:41, spread 16:10 (`Daily Runs!A2:M2`).
- W-003 has 16:52 spread (`Daily Runs!A4:M4`). The largest reported spread is W-006, 04:34–00:58 next day, 20:24.
- There are 29 `codex-advisory:no-valid-whole-trip-relief-cut` findings, corresponding to the 29 affected duties. This records the earlier author's conclusion under its representation; it does not prove real-world infeasibility or exhaustive search.
- The draft nevertheless includes 82 weekly rosters. A weekly total inside its limits does not make an excessive daily duty acceptable.

## Paddle reconstruction and pay reconciliation

The paddle's `Paid Time` header and its separate `B.P.` field must be read together. Across 462 matching fixed-route roster entries, 457 equal paddle header time plus BP directly. Five entries of weekday run 71 reconcile after adding their adjacent, separately listed one-hour RPT work. Thus all matched entries reconcile on that basis. This checks reported paid totals, not every driving minute or every contractual constraint.

| Example | Reconstructed evidence | Calculation / lesson |
|---|---|---|
| Weekday 1: meal plus route transfer | `Mon - Fri !A2:L5`, `B42:D47`; roster `Current!D826:L826`. Sign-on 13:04–13:09, shuttle 13:09–13:19, boarding/arrival 13:19, departure 13:23. Relief at B.A.T.T. 17:07. Meal 17:07–17:54. Transfer to Downtown 17:54–18:05. Board at 18:05, depart 18:10. Bus reaches garage 22:20, sign-off 22:25. | Spread 9:21 minus actual meal 0:47 = 8:34 paid. The 63 minutes from 17:07 to 18:10 comprise 47 meal + 11 travel + 5 boarding/wait, not 63 minutes of break. Source header row 4's end at 18:05 includes more than driving; use detailed events. |
| Weekday 2: no-meal duty | `Mon - Fri !A72:L78`; roster `Current!D276:L276`. Report 04:45, bus work starts after 15-minute preparation at 05:00, relieved at B.A.T.T. 11:47, cab returns to garage 11:57. | 7:12 elapsed + 0:30 BP = 7:42 roster paid. Paddle header alone is 7:12. Do not add a bus pull-in/post-trip to a passenger cab return without a rule basis. |
| Weekday 9: overnight meal duty | `Mon - Fri !A551:L554`, `B606:D606`; roster `Current!D48:L48`. Report 14:15, meal 18:57–19:52, finish 24:01. | 9:46 spread − 0:55 meal = 8:51 paid. Preserve 24:01 as the next day; do not wrap it to an earlier finish. |
| Saturday 1: bus pull-out, passenger return | `Saturday_1!A2:L8`; roster `Current!D389:L389`. Report 05:41, preparation through 05:56, relieved Downtown 12:47, cab returns garage 13:02. | 7:21 elapsed + 0:30 BP = 7:51 roster paid. Garage travel must distinguish driving a bus from riding in a cab. |
| Saturday 21: short meal and midnight | `Saturday_1!A1395:L1399`, `B1444:D1444`; roster `Current!D1141:L1141`. Report 14:52, bus pull-in 18:59, post-trip to 19:04, cab to break location 19:04–19:14, meal 19:14–19:51, subsequent service, finish 24:00. | 9:08 spread − 0:37 meal = 8:31 paid. The 37-minute meal is below the source's 42-minute route-change minimum. Keep this as a rule-review example, not an automatically accepted compliance fixture. Pre-meal travel/post-trip cannot inflate its qualifying break. |
| Sunday 1: no-meal duty with penalty | `Sunday_1!A2:L4`; roster `Current!D922:L922`. Report 14:33, five-minute sign-on, ten-minute cab journey to B.A.T.T., arrival 14:48, departure 14:53, garage 22:23, sign-off 22:28. | 7:55 elapsed + 0:30 BP = 8:25 roster paid. The current unconditional circle-check assumption cannot reproduce this start. |
| Sunday 4: longer meal | `Sunday_1!A212:L215`, `B259:D259`. Report 13:01, meal 16:57–18:07, finish 22:02. | 9:01 spread − 1:10 meal = 7:51 reported paid. Suitable weekend meal-duration reconstruction case; exact trip coverage still requires pinned source data. |
| Weekday 71: composite daily duty | `Mon - Fri !A4694:L4698`; roster `Current!D29:L30`. Paddle spans 17:19–24:58 with RPT work first. Roster lists RPT 17:19–18:19 separately, then run 71 18:19–24:58 with BP. | Paddle 7:39 + 0:30 = 8:09. Roster 1:00 RPT + 7:09 run = 8:09. This is a grouping difference, not a one-hour pay error. Both rows belong in daily work/spread/rest checks. |

The scan found no explicitly labelled meal interval of 90 minutes or more in the three fixed-route paddle sheets. A true garage-split example is therefore still needed for acceptance testing. Shorter meal-break duties must not be assumed to be the same contractual class as no-meal duties just because both contain the word `straight` in their labels.

## Confirmed implementation gaps

Paths and line numbers refer to the inspected local checkout.

| Priority | Gap and evidence | Required correction |
|---|---|---|
| P0 | Interior relief information is absent from `PlanningTrip`; `masterAdapter.ts:161-198` exports endpoints only and `validation.ts:198-217` requires piece boundaries at them. | Export immutable stop-event identities with arrival/departure provenance. Reference operator work between valid relief events, including interior events, without changing any master trip or vehicle block. Verify September trip/event correspondence before claiming a particular historical relief is available in a pinned source. |
| P0 | Starts use trip departure: `metrics.ts:65-75` backs report time from `first.startTime`, while source SOP 094729 section 5 specifies arrival-based relief on both sides. | Distinguish incoming operator report/boarding at arrival from the vehicle's later departure. Account for occupied waiting explicitly. |
| P0 | `metrics.ts:101-145` creates travel for garage splits only. Other inter-piece gaps become paid gaps or unpaid breaks wholesale. | Derive an explicit sequence of relief, travel, waiting and qualifying meal activities. Consume transfer time before checking actual break duration. |
| P0 | `metrics.ts:65-78,149-156` unconditionally applies circle-check and garage bus movement assumptions. Platform is only the sum of trip `travelTime`. | Distinguish bus driving from passenger cab travel, apply preparation/post-trip by actual movement, and include bus deadhead in driving/platform totals. SOP 094729 section 7 explicitly includes deadhead and standby in platform; 094734 lists shuttle as non-platform. |
| P0 | Vehicle interlining and operator route changes share `validation.ts:255-267`. Default permissions in `rules.ts:183-217` cover only 8A↔8B. | Separate immutable vehicle-chain rules from operator block/route-transfer permissions. Record specific confirmed operator transitions; do not infer permission for every route pair from one paddle. |
| P0 | `fullBreakPoint` exists but is unused by metrics/validation. Downtown is false in `rules.ts:71-76`; resets depend on gross gaps (`metrics.ts:142-145`). | Validate actual meal location and duration separately from relief eligibility. Do not treat unattended recovery as a meal or leave a bus unstaffed. |
| P0 | `validation.ts:276-283` enforces split driving per submitted piece, not continuous work across adjacent pieces. | Enforce limits across all activity segments until a valid reset. Splitting one uninterrupted six-hour stretch into two three-hour objects must not bypass a limit. |
| P1 | Cab capacity in `validation.ts:396-411` constructs garage journeys at piece boundaries independently of actual activities. | Count explicit required movements and state pooling/vehicle positioning assumptions. The paddle's shared cab rows show multiple operators in one trip, so operator count is not automatically cab count. |
| P1 | Weekly rest in `metrics.ts:195-201` omits the end-of-week wrap. | For recurring rosters check Sunday/last worked day to next week's first duty; for dated rosters require adjoining-week context or disclose the untested boundary. |
| P1 | `validation.ts:344-351` interprets three days off as three consecutive days. | Apply three total days off with at least two consecutive for four-day rosters, matching SOP 094748 section 23. |
| P1 | `WeeklyRosterAssignment` permits one run ID per day and source trips cannot represent RPT/standby activities. | Build composite daily duties before weekly assignment, with required auxiliary work separately sourced and classified. Aggregate RPT plus service for daily limits; do not claim complete workforce coverage when auxiliary/TOD work is absent. |

A related calculation concern is that displayed platform activities span start→arrival while summed driving/pay use `travelTime`. Intermediate recovery can make these different. Reconciliation must explicitly distinguish revenue driving, bus deadhead, occupied non-driving work, passenger travel, qualifying breaks and pay-only penalties.

## Rule decisions identified during the original audit

These are evidence conflicts or missing definitions, not permission to relax a rule. Existing planner overrides, including Park Place, remain labelled and preserved.

| Decision | Evidence | Proposed treatment pending confirmation |
|---|---|---|
| Meaning of straight and 7.5-hour cap | Checklist 091739 section 2 states a straight driving maximum; SOP 094734 says 7.5 hours without a physical break. Paddle labels also call meal-break duties `AM/PM straight`. Current code equates non-split (<90-minute gap) with straight. | Model no-meal, meal-break and garage-split duties separately. Ask whether 7.5 applies to no-meal duties, and confirm the driving limits on each side of a meal. Do not derive legal class from the source label. |
| Split threshold and usable break | SOP 094729 section 4 says gaps ≥90; 094741 section 15 says splits ≥91, minimum split break 90, return to garage. | Resolve 90 versus 91 and whether 90 is gross gap or actual garage break after travel. Current code subtracts travel but enforces no 90-minute usable-break minimum. |
| Breaks 30–41 and 76–89 minutes | 091744 sections 6–7 call 42–75 contractual with no exception; SOP 094741 permits minimum 30. Current normalized profile accepts same-route 30-minute resets and 76–89 exceptions. Saturday 21 shows 37 minutes before changing routes. | Record the authoritative rule by duty/transition type and identify any explicit exceptions. Preserve Saturday 21 as a discrepancy until resolved. |
| Driving versus passenger travel | SOP 094729 includes deadhead and standby in platform; 094734 places shuttle in non-platform. Current code excludes all garage movements from platform. | Bus deadhead counts as driving/platform; passenger cab travel remains separately counted. Confirm treatment of operator-driven company vehicles and other auxiliary work. |
| Conditional preparation and travel standards | Paddles show five-minute sign-on before cab travel and 15-minute preparation before bus pull-out. B.A.T.T. cab examples take 10 minutes, while the source deadhead table says 12. | Use separate movement modes and confirmed travel values. Do not replace the source's 12-minute bus standard globally with observed 10-minute cab time. |
| Weekly platform maximum | Checklist 091744 section 9 allows overtime to maintain coverage; SOP 094734/094746 says maximum 40 platform hours and separately specifies overtime after 40. | Keep the current hard limit until the planner resolves whether any authorized exception exists and how it is documented. |

### September 21 planner confirmation

The planner subsequently confirmed the first two decisions above: the 7.5-hour
cap applies to driving without a qualifying physical meal break, and the
90-minute split threshold uses the whole arrival-to-arrival gap including
travel. These confirmations supersede the pending treatment in those two rows.
There is no separate 90-minute usable garage-meal requirement. Travel and
preparation still do not count toward a qualifying meal reset.

Default rule-profile revision 2 records this provenance. Local validation now
checks the longest uninterrupted driving stretch for the no-meal cap, so a
non-split duty with a qualifying meal can exceed 7.5 total driving hours while
retaining all other daily limits. A later meal cannot excuse an earlier
overlong uninterrupted stretch. Split duties retain their five-hour continuous
driving limit. Existing non-split share and weekly roster preference categories
are unchanged; this confirmation does not redefine those categories.

Regression cases cover 89/90-minute gross gaps, usable break after travel and
checks, qualifying versus too-short meals, and an excessive pre-meal stretch.
The remaining rule conflicts and source/representation requirements remain
open. No original workbook, exported bundle, or persisted scenario was changed.

## Correction sequence and acceptance gates

### 1. Establish a versioned rule and source baseline

Resolve the decisions above in a compact rule register with clause, severity, calculation basis, source and any explicit override. Acquire the September pinned Master export and required RPT/auxiliary obligations. Confirm that the roster summary's June label is stale before relying on it.

Owners/files: `rules.ts`, `types.ts`, `docs/OPERATIONS_PLANNING.md`; confirmed wire changes also update `docs/SCHEMA.md`. The audit itself does not change those contracts.

Gate: every enforced threshold has a clear unit, duty class and source; unresolved inputs produce a disclosed inability to evaluate, not a successful check.

### 2. Add relief-event and composite-duty representation

Prefer a versioned v2 planning bundle/proposal. Each event retains master version, source trip ID, stop occurrence/sequence, arrival/departure and provenance. Operator segments reference event boundaries; vehicle trips remain whole and immutable. Coverage checks partition each source service interval exactly once, including ownership of waiting/recovery at reliefs. Prevent both overlap and omission at internal boundaries.

Keep v1 readable as historical draft evidence. Do not silently reinterpret or rewrite old proposals as v2. Include source freshness and stop-event information in fingerprints. If source arrival cannot be resolved, mark that cut unavailable.

Owners/files: `types.ts`, `masterAdapter.ts`, `json.ts`, `validation.ts`, `edits.ts`, `utils/services/operationsPlanningService.ts`, corresponding tests and schema documentation.

Gate: reproduce a source-backed interior B.A.T.T. relief and incoming arrival-based boarding without changing master trip times, segment rounding, pairing, occupied-end semantics or block order.

### 3. Make duty activities the calculation source

Derive explicit bus driving/deadhead, passenger travel, preparation, boarding/waiting, standby/RPT, meals and sign-off. Derive pay-only penalties separately from elapsed activity time. Reuse those movements for cab feasibility. Validate actual break duration/location and continuous driving/work independently of how many piece objects are submitted.

Owners/files: `metrics.ts`, `validation.ts`, `rules.ts`, `types.ts` and `tests/runCuttingDomain.test.ts` or focused successor suites.

Gate: reconcile the eight examples above to the minute, with unresolved-rule examples producing the expected finding rather than being accepted. Add synthetic negative cases for illegal transfer, missing arrival, split-piece bypass, too-short usable split break, unapproved meal location, auxiliary-work omission, and week-wrap rest. A true garage-split source example remains required for empirical fidelity.

### 4. Generate and select feasible daily duties

Enumerate eligible relief-to-relief work, combine it only through feasible transfers and breaks, reject hard-limit failures before candidate selection, then select complete non-overlapping service coverage. Use deterministic validation of every result. Optimization may improve quality/cost only inside the feasible set.

Keep a reproducible proposal-authoring script alongside the skill rather than relying on an undocumented conversational search. The existing code audited here validates external proposals; the supplied draft is insufficient evidence to reconstruct its original generation algorithm.

If no full cover is found, return an explicit infeasibility/uncovered-work report. Do not fill the gap with a 16–20-hour operator run. Distinguish “search did not find a solution” from a demonstrated constraint contradiction. A partial diagnostic must remain incomplete and unapprovable, with omitted service visible.

Owners/files: `.codex/skills/operations-planning/SKILL.md`, its proposal contract and authoring helpers, plus domain validation as needed. Update skill and app schema together.

Gate: 100% included service and required auxiliary coverage exactly once, zero daily integrity/contract failures, and feasible operator movements. Fixed-route-only scope must be stated if TOD/other obligations are excluded.

### 5. Build and verify weekly rosters

Use only accepted daily duties, including composite duties such as RPT + run 71. Check actual worked/paid/platform limits separately, rest across recurring weeks, total and consecutive days off, and full weekly coverage. Do not use weekly averages to conceal daily failures.

Gate: zero weekly hard failures and all included day instances covered once. Headcount/cost comparisons are valid only on aligned source periods and equal included work; August's 82 crews cannot be compared directly with September's full establishment.

### 6. Produce planner review output and verify import

Show arrival relief, actual meal, travel mode/time, report/sign-off, driving, paid work, penalties and spread in the review export. Retain blocked-draft visibility while making illegal duties and their reasons unmistakable. Test import, source matching, recalculation and protected approval in Scheduler, then inspect the exported duties against the source events.

Owners/files: `excel.ts`, `components/workspaces/RunCuttingWorkspace.tsx`, service/schema readers, tests and feature/architecture documentation.

Gate: source-matched application assessment agrees with independent examples; no integrity or contractual blockers; planner approval remains an explicit action.

## Verification and limits

- Existing `npx.cmd vitest run tests/runCuttingDomain.test.ts`: 15/15 passed during the read-only code review. Coverage includes endpoint adaptation, excessive straight driving and one garage-split calculation; the identified real-paddle gaps remain largely untested.
- Two independent workbook-reading approaches were used: ZIP/XML extraction and bundled openpyxl read-only analysis. No workbook was saved or recalculated.
- All 174 fixed-route duty identities were reconciled to roster paid entries as described above. Representative timelines were inspected in detail; this is not a complete stop-by-stop service or legality audit of September.
- Source rule photographs were inspected directly. Conflicting wording remains explicit. No legal conclusion or external regulatory research is claimed.
- No live Master version, persisted scenario, browser import or production deployment was verified.

## Product review

Alignment: 9/10. Recommendation: proceed with corrections in the sequence above, with rule decisions resolved before accepting regenerated duties.

The plan serves planner review, preserves immutable Master schedules and protected approval, and limits work to the existing Operations Planning boundary. Timing/event changes are high-risk for arrival/recovery and overnight semantics; retain the locked formulas and add focused boundary tests. No new dispatch system, employee bidding system or automatic publishing is proposed. Scope auxiliary activities only as needed to avoid incomplete daily-duty totals.

The immediate implementation milestone is a verified duty calculator and relief model that can represent weekday run 1 and composite run 71, and reject known excessive draft duties. A new full run cut follows that milestone.

## First authorized correction slice

Local changes now address whole-trip arrival boarding, bus-versus-passenger
movement classification at source block boundaries, paid occupied time,
non-split transfer/break decomposition, full-break location enforcement,
continuous split-driving validation across piece objects, recurring-week rest,
and four-day off-day distribution. The skill now requires daily feasibility
before weekly rostering and explicit disclosure of uncovered work.

The weekday run 1 meal/transfer/boarding interval is covered by a synthetic
source-linked regression fixture matching its observed times. This does not
claim a September pinned-source import or full-paddle reproduction. Interior
relief events, composite run 71/RPT representation, route-permission separation,
cab movement allocation and the unresolved rule decisions remain subsequent
work.

The original pilot input/proposal JSON were subsequently located under
`output/operations-planning/`. Their scenario and source fingerprint match the
supplied draft exactly. Reassessment using the corrected local code still
returns `approvalReady: false`, now with 155 contractual findings:
23 maximum-driving, 28 maximum-work, 27 maximum-spread, 31 straight-driving,
36 weekly-combined maximum, 8 minimum-rest and 2 long-spread-share findings.
This is a revalidation of August inputs, not a September source refresh or a
newly generated cut. It illustrates that corrected accounting can expose more
failures even when no proposed assignment changes.

The review also caught internal block-boundary bus activity: 42 minutes between
two complete Park Place vehicle blocks leaves only 15 minutes after two
six-minute deadheads, five-minute post-trip and ten-minute circle check. That
case is now a regression test and cannot generate a qualifying reset.

Verification after the corrections:

- Focused run: 41/41 tests across the domain, duty-transition, weekly-rule,
  scenario-service and workspace suites passed.
- `npm.cmd run build`: passed.
- `npx.cmd tsc --noEmit`: passed after explicit test-fixture type annotations.
- `npm.cmd run docs:check`: passed for 93 active Markdown files.
- Scoped `git diff --check`: passed.
- Independent review found and then cleared the intermediate bus-edge issue.
- Repository-wide suite: 413 files passed, 9 skipped, 1 failed; 2,667 tests
  passed, 49 skipped and one five-second timeout in the unrelated
  `RoutePlanner2Workspace.localWorkspace` feasibility test. Its isolated rerun
  passed (1.28 seconds test time), without changing that test or module. This
  is a timeout that did not reproduce in isolation, not an all-green full run.
  Evidence: `full-test.log` and `isolated-timeout-recheck.log`.

The recovered proposal was also compared directly against the supplied draft:
all 166 piece trip lists and all seven-day assignments in its 82 rosters match.

No application deployment, live scenario mutation, new proposal generation or
operational sign-off has been performed.
