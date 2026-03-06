# Route Colors Reference

This document summarizes the route color palette used in the application.

The source of truth is `utils/config/routeColors.ts`. Update that file first, then sync this document.

## Color Mapping

| Route | Color Name | Hex Code | CSS Class |
|-------|------------|----------|-----------|
| 2A | Dark Green | `#006838` | `route-2a` |
| 2B | Dark Green | `#006838` | `route-2b` |
| 7A | Orange | `#F58220` | `route-7a` |
| 7B | Orange | `#F58220` | `route-7b` |
| 8A | Black | `#000000` | `route-8a` |
| 8B | Black | `#000000` | `route-8b` |
| 10 | Plum | `#681757` | `route-10` |
| 11 | Lime | `#B2D235` | `route-11` |
| 12A | Pink | `#F8A1BE` | `route-12a` |
| 12B | Pink | `#F8A1BE` | `route-12b` |
| 100 | Red | `#910005` | `route-100` |
| 101 | Blue | `#2464A2` | `route-101` |
| 400 | Cyan | `#00C4DC` | `route-400` |

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
- The colors are designed to be visually distinct for accessibility.
