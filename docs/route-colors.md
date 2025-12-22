# Route Colors Reference

This document defines the official color scheme for each bus route in the application.

## Color Mapping

| Route | Color Name | Hex Code | CSS Class |
|-------|------------|----------|-----------|
| 2A | Dark Green | `#22C55E` | `route-2a` |
| 2B | Dark Green | `#22C55E` | `route-2b` |
| 7A | Orange | `#F97316` | `route-7a` |
| 7B | Orange | `#F97316` | `route-7b` |
| 8A | Black | `#1F2937` | `route-8a` |
| 8B | Black | `#1F2937` | `route-8b` |
| 10 | Magenta/Pink | `#EC4899` | `route-10` |
| 11 | Lime/Yellow-Green | `#84CC16` | `route-11` |
| 12A | Pink | `#F472B6` | `route-12a` |
| 12B | Pink | `#F472B6` | `route-12b` |
| 100 | Red | `#EF4444` | `route-100` |
| 101 | Navy Blue | `#1E40AF` | `route-101` |
| 400 | Teal/Cyan | `#14B8A6` | `route-400` |

## Usage

Import the `getRouteColor` utility function:

```tsx
import { getRouteColor } from '../utils/routeColors';

// Returns the hex color for a route
const color = getRouteColor('2A'); // '#22C55E'

// Use in styles
<div style={{ backgroundColor: getRouteColor(routeName) }}>
  Route {routeName}
</div>
```

## Notes
- Routes 2A and 2B share the same green color.
- Routes 8A and 8B share the same black color.
- The colors are designed to be visually distinct for accessibility.
