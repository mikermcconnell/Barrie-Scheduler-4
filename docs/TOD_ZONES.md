# Transit On Demand Zones

## Purpose

TOD zones are an operational classification layer in Ridership's existing Transit On Demand Activity Map. They answer which published service zone or zones underlie a stop and let planners filter the existing pickup/drop-off activity. They do not create route attribution, hourly detail, demand totals for stops with no recorded activity, or additive KPIs across overlapping zones.

## Source and Zone A pilot

The initial Zone A draft is derived from `Transit-ON-Demand_Zone-A.pdf`, effective September 21, 2025. The PDF is a schematic service map rather than verified geographic polygon data. Its four disconnected service pockets and 25 labelled TOD stop IDs were checked against the City of Barrie Transit Stops ArcGIS layer. Codex generated conservative corridor polygons around those stop groups as a first draft; the geometry is explicitly not an official boundary and must be reviewed and adjusted by a planner before publication.

Zone A also explicitly records the 17 connection stops shown on the source map: **58, 59, 60, 61, 76, 215, 216, 416, 440, 441, 447, 449, 453, 454, 628, 634, and 913**. These stops belong to Zone A for booking and filtering, but remain distinguishable from ordinary TOD stops in the editor, published stop snapshot, and activity-map symbol. Stop 207, for example, is an ordinary TOD stop rather than a connection stop.

The Zone B draft is derived from `Transit-ON-Demand-Zone-B.pdf`, also effective September 21, 2025. It contains four conservative editable pockets around the 10 ordinary TOD stops **160, 404, 682, 683, 685, 686, 687, 689, 690, and 948**. Its 13 explicit connection stops are **10, 67, 68, 129, 135, 136, 255, 333, 583, 586, 612, 938, and 959**. As with Zone A, the PDF is schematic and the generated geometry requires planner review before publication.

The Zone C draft is derived from `Transit-ON-Demand_Zone-C.pdf`, updated June 8, 2025. Its Hurst-area polygon contains 20 labelled ordinary TOD stops. Its 20 connection stops are **20, 117, 120, 704, 705, 715, 716, 717, 718, 722, 725, 741, 752, 764, 775, 777, 784, 968, 969, and 9009**.

The Zone D draft is derived from `Transit-ON-Demand-Zone-D-Map.pdf`, updated July 29, 2026. Its four west pockets and one east pocket contain 47 labelled ordinary TOD stops. Keeping the PDF's disconnected pockets separate avoids the self-crossing stop-to-stop web produced by the earlier two-polygon approximation. Its 18 connection stops are **20, 116, 704, 705, 715, 716, 717, 718, 722, 725, 741, 751, 752, 777, 784, 968, 969, and 9009**. Stops 764 and 775 illustrate the per-zone distinction: each is an ordinary Zone D stop and a Zone C connection stop. Six active fixed-route stops inside the schematic west boundaries (82, 83, 99, 100, 429, and 811) receive explicit Zone D exclusions because they are not labelled as TOD stops on the source map.

The Zone E draft is derived from `Transit-ON-Demand_Zone-E.pdf`, effective June 8, 2025. Its two pockets contain ordinary stops **770, 771, 772, 773, 785, 786, 787, and 788**. Its connection stops are **119, 596, 597, and 725**.

The current Zone F draft is derived from `Transit-ON-Demand-Zone-F_Construction.pdf`, effective July 2, 2026 for the Huronia/Lockhart construction impacts. Its four pockets contain ordinary stops **153, 952, 958, 960, 961, 962, 964, 975, 976, 980, 981, 988, 989, 990, 991, 992, 993, 994, 995, 996, and 997**. Its connection stops are **512, 513, 725, 741, 752, 764, 775, and 777**. Stops **977, 978, 979, and 986** are explicitly excluded from F because the source map marks them out of service during construction.

The Zone H draft is derived from `Transit-ON-Demand-Zone-H.pdf`, effective June 29, 2026. Its five pockets contain ordinary stops **33, 43, 44, 51, 52, 53, 66, 78, 79, 606, 613, 614, 615, 616, and 640**. Its connection stops are **312, 487, 488, 494, 495, 538, 539, and 847**. Stop 33 is labelled on the PDF but is absent from the current active City GIS stop layer, so live validation confirms the other 14 H ordinary stops and retains 33 as source-reference metadata for planner review.

Temporary Zone T is derived from `Transit-ON-Demand-Temporary-Zone.pdf`, effective July 2, 2026 through Fall 2026. Its Fenchurch pocket contains ordinary stops **973 and 974**, temporarily reassigned from F, and connection stop **725**. T remains a managed temporary zone so it can be superseded by a later effective-dated publication when construction ends.

Zone definitions use the source-map colors: A blue (`#117db6`), B orange (`#f58645`), C red (`#dd1f33`), D lime green (`#8dc73f`), E brown (`#9c3220`), F gold (`#cb9f2c`), H purple (`#7e489c`), and T gray (`#606161`). Polygon fills/outlines, editor connection markers, activity-map connection markers, and connection legends use the corresponding definition color. On the activity map a connection stop uses one source-colored outer halo behind the ridership dot, keeping the selected ridership metric visible; collision-aware zone-code labels appear only at close zoom. Shared connection stops retain every connection-zone code.

The editor loads current active stops from the City layer at `https://gispublic.barrie.ca/arcgis/rest/services/Open_Data/FacilitiesStreets/MapServer/6`. A published version also snapshots stop coordinates, assigned zone codes, and connection-stop status so historical classifications remain reproducible if the live layer later changes.

The client and GeoJSON interchange use standard `[longitude, latitude]` positions. Firestore stores each position as a `{ lon, lat }` map so polygon rings remain valid Firestore values; the service converts at the persistence boundary.

## Assignment rules

- A stop belongs to every active zone whose polygon contains it. A point on a polygon boundary counts as inside.
- Disconnected polygons may share one zone code. Connection stops may intentionally have multiple codes.
- Connection stops are explicit zone records, not polygon expansions or generic stop overrides. A connection stop inherits its listed zone membership and retains both an `isConnectionStop` flag and its specific `connectionZoneCodes` in the published snapshot.
- An `include` override adds listed codes, `exclude` removes listed codes, and `replace` substitutes the full membership. Overrides require a reason.
- Activity selected across multiple effective versions is classified day by day. The map displays the latest applicable outline and discloses that more than one version was used.
- `Unassigned` is a visible, filterable outcome. Missing geometry must not be silently assigned to the nearest zone.

## Planner workflow

Team owners and admins open **Edit zones** from the TOD activity card. They can draw, select, reshape, and delete multiple polygons; switch between light and satellite imagery; inspect current City stops and assignment counts; maintain stop overrides; and import or export Polygon/MultiPolygon GeoJSON. Imported features require `zoneCode` (or `zone`/`code`) and may include `pocketName`.

**Save draft** shares the working geometry without changing operational classification. **Publish** requires current City stops, an effective date, source, and review note, then creates an immutable version. Corrections are new superseding publications rather than edits to history.

## Zone performance view

The existing TOD activity card has **Map** and **Zone performance** views that share the selected Ridership period and Activity/Pickups/Drop-offs metric. Zone performance classifies every daily location with the immutable version effective on that service date, then shows each zone's selected metric, pickups, drop-offs, active-stop count, coverage share, connection-stop share, top five stops, and daily or weekly trend. Unassigned activity remains visible as a review queue. The F / Temporary T construction watch compares their current selected-period coverage and does not claim causality or supply a pre-construction baseline.

Zone rows are intentionally non-additive. A shared stop contributes its full activity to every applicable zone, matching the map filters, so coverage shares may overlap and the rows may sum above the system total. Connection share is specific to the selected zone: a stop that is ordinary in Zone D but a connection for Zone C counts as connection activity only for C. Activity remains pickups plus drop-offs and therefore represents stop touches, not completed trips or unique riders.

## Managed codes and safeguards

The schema-v4 seed includes permanent codes A, B, C, D, E, F, and H plus temporary code T. Loading a schema-v1 mutable draft performs a one-time migration that adds Zones B-F, H, and T; schema v2 adds C-F, H, and T; schema v3 adds E, F, H, and T. Migration adds only the newly introduced source polygons, merges new per-zone connection memberships into existing stop records, adds the reviewed source exclusions, and preserves existing polygon edits. The earlier default effective date advances to July 2, 2026 for the construction configuration, while a planner-entered custom date remains unchanged. Once saved as v4, subsequent planner edits remain authoritative. Storage supports managed active codes rather than hard-coding only those letters. Client validation permits at most 80 polygons, 250 vertices per polygon, 5,000 vertices overall, 1,500 connection stops, and 1,000 overrides; Firestore rules also bound definitions, polygons, connection stops, overrides, and stop snapshots. Team members can read published layers. Only owners/admins can read or change the mutable draft and publish, and publications are immutable.
