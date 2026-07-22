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

- exact start and end dates, with optional times; new notices default to date-only
- until further notice
- until construction is complete
- optional weekly recurrence with selected days and daily start/end times

Date state is derived as upcoming, active, or expired. Workflow state remains draft, posted, or archived.
When a time is blank, the start date begins at 12:00 a.m. and a fixed end date runs through 11:59 p.m.; public copy remains date-only.

## Authoring Rules

- This is a preset map editor, not an Illustrator clone.
- Mapbox may suggest a route, but it never approves a detour for bus use.
- Unsnapped/manual segments remain visible warnings until acknowledged.
- In Select mode, clicking the replacement path or closed section inserts an ordered interior anchor at the nearest point on that line. Orange diamonds edit the road-snapped detour; red diamonds edit only the published closed-section geometry.
- Blue authoring-only diamonds are shared diversion and rejoin junctions. The visible active route, closed section, and replacement path use the exact same junction coordinates; dragging a blue diamond moves all three together and re-snaps the detour while preserving its interior orange controls. Existing saved notices are normalized to this invariant when loaded, disconnected junctions block export, and junction handles never appear in public preview or export.
- The route number remains a separate label. The route number defaults near the first third of the replacement path and has a violet authoring-only handle that lets the planner reposition it anywhere along that line; the saved position is re-snapped to the current detour geometry.
- Confirmed street labels replace generic path wording with **NO SERVICE ON · {street}** for the bypassed section and **DETOUR VIA · {street}** for the replacement path. This wording describes transit service without claiming that a municipal road itself is closed. Mapbox road names are suggestions only and require planner confirmation; existing detours without suggestions request them when opened, without replacing the approved geometry. Closed-section street names are planner-entered. A planner may add multiple street names to either path; each new label starts at the path midpoint and can be positioned with a **Position along path** slider or its draggable authoring handle. Line clicks remain reserved exclusively for adding geometry anchors. Pending labels remain visible with reduced emphasis in authoring view, are hidden from public view, and stay available for confirmation or dismissal even after a path change invalidates them. Labels can be hidden, removed, edited, and dragged along their associated path, and their angles are derived from the line rather than persisted.
- Closed-section edits never change the GTFS closure anchors or suggested stop impacts. They preserve the detailed line and distribute a moved anchor across its neighbouring geometry instead of creating a one-point spike. Edited geometry blocks export until reviewed against the actual road closure, and planners can reset the closed line to its GTFS geometry.
- Selecting a stop opens its right-sidebar editor, where planners can change its status between active, closed, and temporary. Planner-created temporary stops also expose public-name and optional stop-code fields plus a remove action; imported GTFS stops may be reclassified but are not deleted from the route snapshot.
- Public view and exports hide all editable anchors and line hit areas. While Public view is active, the sidebar explains that editing is hidden and provides a **Return to editing** action. Closing the notice preview also restores Select mode and the authoring handles.
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

The map is captured from the app. PDF page text and chrome stay vector-based for print clarity. The supplied Barrie Transit logo is shared by the on-screen preview, PNG capture, and PDF export. Keep the explicit asset seam for future approved brand replacements and the City of Barrie footer artwork.

Publication previews and exports preserve the planner's current map viewport; capture must not automatically zoom out to the entire route. The explicit **Fit map** tool remains available when full-notice framing is desired. Closed routing is a red dashed line with no solid-route underlay. Replacement routing retains the route colour with a restrained orange outer casing, consistently spaced direction arrows, and a small white route-number capsule with dark text and border offset above the path. Confirmed street-specific service labels replace the generic **DETOUR** and **DETOUR CLOSED** badges; the generic badges remain only as authoring fallbacks until street labels are confirmed. Route, detour, and closure labels follow the angle of the line segment beneath them while remaining upright. Temporary stops use a larger green circle with its label fixed directly above; closed stops use a larger red circle and nearby explicit **STOP {code} CLOSED** wording. Public view hides authoring handles and map controls without changing planner data; secondary basemap and ordinary stop labels may be de-emphasized or collision-managed, while critical detour, closure, temporary-stop, and planner-authored labels remain visible.

The notice header uses an oversized warning icon while preserving its established outline weight. Footer contact details pair phone, email, and website text with matching white vector icons.

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
