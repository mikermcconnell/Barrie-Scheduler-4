# Detour Publisher

Durable product and implementation contract for the Scheduled Transit Detour Publisher.

## Purpose

Detour Publisher replaces the routine Illustrator workflow for standard fixed-route detour and stop-closure notices. It is a team-shared Scheduled Transit subworkspace. Planners remain responsible for confirming bus suitability, stop impacts, rider wording, and the final MyRide upload.

## Version 1 Workflow

1. Create a route-detour or stop-closure notice.
2. Enter the public title, reason, details, and effective schedule.
3. Import one or more current GTFS route/direction patterns.
4. Mark the bypassed section and draw a road-snapped replacement path.
5. Review suggested closed stops and add temporary or replacement stops.
6. Adjust preset labels and closure markers within the printable map frame.
7. Preview and export a landscape-letter PDF, 2200 x 1700 PNG, and MyRide-ready text package.
8. Upload manually to MyRide, then record the public URL with **Mark posted**.

Editing a posted notice is allowed. When the working revision is newer than the posted revision, the notice must show **Update needed** until the revised notice is exported and marked posted again.

## Notice Types

### Route detour

- supports one or more route/direction overlays
- snapshots the selected GTFS pattern so later feed changes do not rewrite an old notice
- keeps original, bypassed, and replacement geometry distinct
- suggests stops between diversion and rejoin anchors, but requires planner confirmation
- supports temporary stops, closure markers, direction arrows, and movable preset labels

### Stop closure

- starts from a selected GTFS stop
- supports an existing or temporary replacement stop
- may suggest a walking connection and distance
- requires planner-confirmed public instructions

## Effective Schedule

All dates and times use `America/Toronto`.

- exact start and end
- until further notice
- until construction is complete
- optional weekly recurrence with selected days and daily start/end times

Date state is derived as upcoming, active, or expired. Workflow state remains draft, posted, or archived.

## Authoring Rules

- This is a preset map editor, not an Illustrator clone.
- Mapbox may suggest a route, but it never approves a detour for bus use.
- Unsnapped/manual segments remain visible warnings until acknowledged.
- Stop-impact suggestions are never silently accepted.
- The app must not modify schedule drafts, master schedules, or GTFS.
- Existing fixed-route locked logic is out of scope.

## Export Contract

The fixed Barrie notice template contains:

- Barrie Transit header and warning treatment
- notice title and affected routes/directions
- printable map with north arrow and route direction arrows
- effective-date panel and rider details
- automatic active/out-of-service/closed/temporary legend
- contact footer and map attribution

The map is captured from the app. PDF page text and chrome stay vector-based for print clarity. Official brand assets should be supplied from the approved source template; the implementation must keep an explicit asset seam until those files are available.

Export is blocked when required public copy, effective dates, route paths, stop review, bus-suitability confirmation, or map capture is incomplete. Label collisions and missing alternatives may warn without silently changing planner work.

## Persistence and Access

Notices are team-scoped under `teams/{teamId}/detourNotices`. Route overlays and publication records use subcollections. Structured editable data is saved; generated PDF and PNG files remain browser downloads in version 1.

The workspace is protected by Scheduled Transit access and a dedicated feature flag during pilot rollout. Saves use optimistic revisions so a stale editor cannot silently overwrite newer team work.

## Not in Version 1

- direct TripSpark/MyRide publishing
- Transit On Demand zone notices
- shuttle schedules or other multi-page publications
- arbitrary freehand artwork, fonts, or page-layout controls
- mobile authoring
- public hosting or real-time service alerts

## Acceptance References

- Shanty Bay: single-route detour
- Livingstone: multi-route/direction detour
- Farmer's Market: weekly recurring detour
- Stop 265: replacement-stop notice

Version 1 is ready for broad use when these workflows can be recreated without Illustrator corrections and the exported files pass visual checks in browser PDF viewers, Acrobat, and Poppler.
