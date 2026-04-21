---
name: ui-styling
description: Use when creating or modifying UI components. Enforces the enterprise-clean design system with gray-based palette and Tailwind CSS.
---

## UI/Styling Guidelines

### Design System: Enterprise-Clean

Gray-based palette with minimal color usage. Professional, scannable data tables with strategic white space.

### Color Palette

| Purpose | Color | Tailwind |
|---------|-------|----------|
| Brand Blue | `#1890ff` | `bg-brand-blue` |
| North Direction | Blue (light) | `bg-blue-50`, `border-blue-200` |
| South Direction | Indigo (light) | `bg-indigo-50`, `border-indigo-200` |
| Metrics/Neutral | Gray | `bg-gray-50`, `bg-gray-100` |
| Text Primary | Gray 900 | `text-gray-900` |
| Text Secondary | Gray 500-600 | `text-gray-500`, `text-gray-600` |
| Success | Emerald | `bg-emerald-50`, `text-emerald-600` |
| Warning | Amber | `bg-amber-50`, `text-amber-600` |
| Error | Red | `bg-red-50`, `text-red-600` |

### Technology

- **Framework**: Tailwind CSS via CDN (loaded in `index.html`)
- **Icons**: Lucide React (`lucide-react`)
- **Charts**: Recharts

### Component Patterns

```tsx
// Button
<button className="px-4 py-2 bg-[#58CC02] text-white rounded-lg hover:bg-green-600 transition-colors">
  Save
</button>

// Card
<div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
  {/* content */}
</div>

// Badge
<span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">
  North
</span>
```

### Band Colors

| Band | Color | Meaning |
|------|-------|---------|
| A | Red (`bg-red-*`) | Slowest |
| B | Orange (`bg-orange-*`) | Slow |
| C | Yellow (`bg-yellow-*`) | Medium |
| D | Lime (`bg-lime-*`) | Fast |
| E | Green (`bg-green-*`) | Fastest |

### Icons Usage

```tsx
import { Plus, Save, Trash2 } from 'lucide-react';

<Plus className="w-4 h-4" />
```
