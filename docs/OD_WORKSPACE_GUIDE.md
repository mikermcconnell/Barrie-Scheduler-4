# Ontario Northland OD Workspace — User Guide

End-user guide for the Origin-Destination analysis workspace.

---

## 1. Getting Started

The OD workspace analyzes pre-aggregated origin-destination ridership data. To begin:

1. Navigate to **Analytics → Ontario Northland**
2. Click **Import Data** and upload an Excel cross-tab file
   - Row headers = origin stations, column headers = destination stations
   - Cell values = journey counts between each pair
3. The parser auto-detects stations, pairs, and totals
4. After import, the workspace opens to the **Overview** tab

---

## 2. Overview Tab

The landing tab shows:

- **Metric Cards** — Total journeys, station count, top origin, top destination
- **Flow Map** — Interactive Leaflet map with OD flow arcs (see Section 3)
- **Import Details** — File name, date range, import date, pair count
- **Quick Navigation** — Jump links to Top Pairs, Rankings, and Heatmap tabs

---

## 3. Flow Map Controls

The control bar above the map provides:

| Control | Description |
|---------|-------------|
| **Pairs** dropdown | Show Top 10, 25, 50, 100, or All OD pairs |
| **Threshold** slider | Minimum trip count for a pair to appear |
| **Direction** toggle | Filter to All / Outbound / Inbound (active when a station is selected) |
| **Search stops** | Type to search, click to isolate a station |
| **Map / Table** toggle | Switch between map view and tabular pair list |

### Reading the Map

- **Green markers** = origin-only stations
- **Red markers** = destination-only stations
- **Orange markers** = mixed (both origin and destination)
- **Arc color** = rank (red = #1, through green, then grey for lower ranks)
- **Arc thickness** = rank (thicker = higher rank)
- **Rank badges** = numbered circles on top-ranked arcs

---

## 4. Station Filtering

Two ways to isolate a station:

1. **Click a marker** on the map
2. **Search** using the search box and click a result

When a station is selected:

- Only pairs involving that station are shown
- A **"Filtered stop"** badge appears with a **Clear** button
- The **Direction toggle** becomes active:
  - **Outbound** — pairs where the selected station is the origin
  - **Inbound** — pairs where the selected station is the destination
  - **All** — both directions (default)
- A **Stop OD summary** table appears below the map showing all pairs for that station

Click the station marker again or press **Clear stop filter** to deselect.

---

## 5. Top Pairs Tab

Shows the busiest OD pairs:

- **Bar chart** — Visual ranking of top pairs by journey count
- **Searchable table** — Full list with origin, destination, trips, and percentage of total

---

## 6. Station Rankings Tab

Side-by-side analysis of station activity:

- **Busiest Origins** — Top 20 stations by departing journeys (bar chart)
- **Busiest Destinations** — Top 20 stations by arriving journeys (bar chart)
- **Total Volume Rankings** — Combined table with origin trips, destination trips, total volume, and % share

---

## 7. Heatmap Grid Tab

Matrix view of all station-to-station flows:

| Control | Description |
|---------|-------------|
| **Stations** slider | Number of stations to display (10–50) |
| **Sort** buttons | Sort by Total Volume, Origin Volume, Dest Volume, or Alphabetical |
| **Filter stations** | Text search to narrow the grid |
| **Show Numbers / Color Only** | Toggle between numeric values and color-only compact mode |

- Color scale: white (0) → light violet → dark violet (max journeys)
- Hover a cell to see the exact origin → destination and journey count
- Row/column headers highlight on hover for easy cross-referencing

---

## 8. Coordinate Management

Stations need geographic coordinates for the flow map. If stations are missing coordinates:

- An **amber warning** appears on the map: "X stations still missing coordinates"
- Click **Fix coordinates** to open the coordinate management modal
- Enter lat/lon manually or re-run geocoding
- Stations with coordinates outside Canada are automatically excluded with a red warning

---

## 9. Exporting

Two export options in the workspace header:

### Export Excel

Downloads a multi-sheet `.xlsx` workbook:

| Sheet | Contents |
|-------|----------|
| **OD Matrix** | Full cross-tab grid (origin rows × destination columns) |
| **Top Pairs** | Ranked list with origin, destination, journeys, % total |
| **Station Summary** | Each station's origin trips, destination trips, total volume, % total |

### Export PDF

Downloads a `.pdf` report containing:

1. **Title page** — Report name, file metadata, station count, total journeys, export date
2. **Flow map** — Screenshot of the current map view (if on Overview tab)
3. **Station rankings** — Screenshot (if Rankings tab has been visited)
4. **Heatmap grid** — Screenshot (if Heatmap tab has been visited)
5. **Top pairs table** — Data table of top 50 pairs with violet header styling

> **Tip:** Visit the Rankings and Heatmap tabs before exporting PDF to include their screenshots.

---

## 10. Tips & Tricks

- **Compare inbound vs outbound**: Select a station, toggle between Inbound/Outbound to see asymmetric demand patterns
- **Find low-volume pairs**: Set Pairs to "All" and increase the Threshold slider to filter noise
- **Quick station lookup**: Use the search box rather than zooming the map
- **Fullscreen map**: Click the Fullscreen button on the map card for detailed exploration
- **Compact heatmap**: Use Color Only mode for large station counts to see patterns at a glance
- **Export filtered views**: The PDF captures the current map state, so apply filters before exporting to highlight specific patterns
