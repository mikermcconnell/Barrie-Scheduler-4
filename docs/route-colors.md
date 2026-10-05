# Route Colors Reference

This document summarizes the static Barrie route color palette used by application screens that call `getRouteColor`.

The source of truth for this static mapping is `ROUTE_COLORS` in `utils/config/routeColors.ts`. Update that file first, then sync this document. GTFS-driven map features may instead use the imported feed's `route_color`; do not replace valid feed colors with this fallback palette.

## Color Mapping

| Route keys | Color Name | Hex Code |
|-------|------------|----------|
| 2, 2A, 2B | Dark Green | `#006838` |
| 7, 7A, 7B | Orange | `#F58220` |
| 8, 8A, 8B | Black | `#000000` |
| 10 | Plum | `#681757` |
| 11 | Lime | `#B2D235` |
| 12, 12A, 12B | Pink | `#F8A1BE` |
| 100 | Red | `#910005` |
| 101 | Blue | `#2464A2` |
| 400 | Cyan | `#00C4DC` |

## Usage

Import the `getRouteColor` utility function from `utils/config/routeColors.ts`.

Example from a component file under `components/`:

```tsx
import { getRouteColor } from '../utils/config/routeColors';

// Returns the hex color for a route
const color = getRouteColor('2A'); // '#006838'

// Use in styles
<div style={{ backgroundColor: getRouteColor(routeName) }}>
  Route {routeName}
</div>
```

## Notes

- Routes 2A and 2B share the same green color.
- Routes 8A and 8B share the same black color.
- Base route aliases such as `2`, `7`, `8`, and `12` also resolve in code.
- Unknown routes fall back to neutral gray `#6B7280`.
- Use `getRouteTextColor` or `getContrastingTextColor` when placing text over a route color; do not assume white text is readable on every palette value.
