# Route Concept Planner Product Contract

## Use case

A transit planner needs to answer: **Is this complete route concept operationally workable, and which alternative should be developed further?**

The planner can start blank or import a full GTFS route, edit alignments and stops, set service assumptions, compare alternatives, identify feasibility issues, mark a preferred alternative, and save the project for the team.

## Complete-route alternatives

Each alternative represents the full operating route:

- **Bidirectional:** separately editable outbound and inbound patterns.
- **Loop:** one complete loop pattern; do not double its runtime.
- **Out and back:** separately editable outbound and return patterns that meet at a turnaround. Each pattern contributes its runtime once.

GTFS import shows one complete-route option per route and service day rather than exposing technical pattern rows. It automatically chooses the strongest full pattern for each direction, preferring an explicitly labelled service day and then the candidate with the most scheduled trips. Duplicate service IDs with the same stops and alignment collapse into that one choice. Only genuinely different stop sequences or alignments appear under optional route-variant review. Barrie route-family handling may merge 2A/2B, 7A/7B, and 12A/12B while keeping 8A and 8B separate. Exclude short turns. A one-direction linear import is incomplete until a return is imported, drawn, or created as an editable reversed copy; incomplete alternatives cannot be review-ready.

The reversed-copy action creates neutral stop/alignment IDs and intentionally clears automatic and manual runtime evidence so outbound evidence is never silently applied to the return.

## Planner workflow

1. Load a saved project, import GTFS, or start blank.
2. Create, duplicate, rename, delete, and select alternatives.
3. Edit patterns, stops, stop roles, order, alignments, and bend points.
4. Enter service day, runtime period, span, frequency, dwell, terminal layovers, and optional buses being tested.
5. Review route runtime, cycle requirement, minimum buses, recovery, daily operating estimates, confidence, source mix, and actionable issues.
6. Compare alternatives, mark one preferred, and explicitly save for the team.

The map-first desktop workspace uses an alternatives rail, a map, and Route/Service/Review controls. The active pattern is editable and its sibling direction remains visible for context. Camper counts, bulk address manifests, and Camp terminology never appear.

## Runtime evidence

Runtime selection is segment-based and uses this priority:

1. confirmed planner override
2. scheduled GTFS evidence matching route, service day, and period
3. Mapbox road-time estimate
4. clearly labelled fallback estimate
5. missing/not ready

Switching runtime sources is non-destructive. Stop, order, or geometry edits invalidate only affected automatic evidence. A manual override survives a path edit but requires planner reconfirmation before it can support review-ready status. Runtime displays must disclose the evidence source and actual period used.

## Feasibility and daily estimates

- Complete runtime is the sum of individually rounded segment runtimes plus intermediate dwell.
- Cycle requirement is complete runtime plus terminal layovers.
- Minimum buses is `ceil(cycle requirement / frequency)`.
- Buses being tested is a separate optional input; it must never overwrite the minimum.
- Scheduled cycle window is tested buses, when entered, otherwise minimum buses, multiplied by frequency.
- Recovery is scheduled cycle window minus cycle requirement.

Show negative recovery as blocking, recovery under 10% as fragile, 10–25% as the acceptable planning range, over 25% as an efficiency warning, and concepts within three minutes of another bus threshold as at risk.

Store service span as service-day minutes so GTFS times after midnight remain ordered and display as next day. Assuming uniform frequency, show estimated departures, revenue hours, and vehicle hours. Label these as planning estimates; do not present them as a generated schedule or operating-cost estimate.

## Explicit deferrals

- Camp focus, camper/address imports, camper counts, and Camp exports
- PDF exports and operator route cards
- moving or copying stop ranges between alternatives
- observed STREETS/GPS evidence
- coverage, demographics, ridership, and operating-cost analysis
- schedule generation or handoff
- GTFS editing or publishing
- autosave, live collaboration, and formal approval
