# Transit On Demand Zones

## Purpose

TOD zones are an operational classification layer in Ridership's existing Transit On Demand Activity Map. They answer which published service zone or zones underlie a stop and let planners filter the existing pickup/drop-off activity. They do not create route attribution, hourly detail, demand totals for stops with no recorded activity, or additive KPIs across overlapping zones.

## Source and Zone A pilot

The initial Zone A draft is derived from `Transit-ON-Demand_Zone-A.pdf`, effective September 21, 2025. The PDF is a schematic service map rather than verified geographic polygon data. Its four disconnected service pockets and 25 labelled TOD stop IDs were checked against the City of Barrie Transit Stops ArcGIS layer. Codex generated conservative corridor polygons around those stop groups as a first draft; the geometry is explicitly not an official boundary and must be reviewed and adjusted by a planner before publication.

The editor loads current active stops from the City layer at `https://gispublic.barrie.ca/arcgis/rest/services/Open_Data/FacilitiesStreets/MapServer/6`. A published version also snapshots stop coordinates and assigned zone codes so historical classifications remain reproducible if the live layer later changes.

The client and GeoJSON interchange use standard `[longitude, latitude]` positions. Firestore stores each position as a `{ lon, lat }` map so polygon rings remain valid Firestore values; the service converts at the persistence boundary.

## Assignment rules

- A stop belongs to every active zone whose polygon contains it. A point on a polygon boundary counts as inside.
- Disconnected polygons may share one zone code. Connection stops may intentionally have multiple codes.
- An `include` override adds listed codes, `exclude` removes listed codes, and `replace` substitutes the full membership. Overrides require a reason.
- Activity selected across multiple effective versions is classified day by day. The map displays the latest applicable outline and discloses that more than one version was used.
- `Unassigned` is a visible, filterable outcome. Missing geometry must not be silently assigned to the nearest zone.

## Planner workflow

Team owners and admins open **Edit zones** from the TOD activity card. They can draw, select, reshape, and delete multiple polygons; switch between light and satellite imagery; inspect current City stops and assignment counts; maintain stop overrides; and import or export Polygon/MultiPolygon GeoJSON. Imported features require `zoneCode` (or `zone`/`code`) and may include `pocketName`.

**Save draft** shares the working geometry without changing operational classification. **Publish** requires current City stops, an effective date, source, and review note, then creates an immutable version. Corrections are new superseding publications rather than edits to history.

## Managed codes and safeguards

The seed includes permanent codes A, B, C, D, E, F, and H plus temporary code T. Storage supports managed active codes rather than hard-coding only those letters. Client validation permits at most 80 polygons, 250 vertices per polygon, and 5,000 vertices overall; Firestore rules also bound definitions, polygons, overrides, and stop snapshots. Team members can read published layers. Only owners/admins can read or change the mutable draft and publish, and publications are immutable.
