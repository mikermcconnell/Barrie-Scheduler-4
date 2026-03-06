# Student Transit Pass PDF Export Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the Student Transit Pass PDF export from a 2/10 debug printout to a 10/10 professional document with dual journey timelines.

**Architecture:** Rewrite `handleExportPdf()` in StudentPassModule.tsx using jsPDF direct drawing. Reuse the existing timeline segment builders from StudentPassTimeline.tsx. Add export-time CSS overrides for better map label/marker readability. No new dependencies.

**Tech Stack:** jsPDF (existing), html2canvas (existing), React/TypeScript, Mapbox GL

---

## Approved Layout

```
+----------------------------------------------+
| SCHOOL NAME                          DATE    | 22mm blue banner
| Student Transit Pass                         |
+----------------------------------------------+
|                                              |
|          MAP (captured from Mapbox)          | ~120mm tall
|          hero element                        |
|                                              |
+----------------------------------------------+
| MORNING JOURNEY                      36 min  |
| [Walk][====Rt 10====][Xfer][===Rt 7B===]    | timeline bar
| 7:19  7:26          7:51  7:57               | time labels
+----------------------------------------------+
| AFTERNOON JOURNEY                    28 min  |
| [===Rt 7A===][Xfer][====Rt 10====][Walk]    | timeline bar
| 15:19       15:28  15:42          15:48      | time labels
+----------------------------------------------+
| Barrie Transit              Exported Mar 6   | footer
+----------------------------------------------+
```

---

## Phase 1: PDF Layout Redesign

### Task 1: Export timeline segment builders from StudentPassTimeline

**Files:**
- Modify: `components/Analytics/StudentPassTimeline.tsx:25-151`

The segment builders (`buildMorningSegments`, `buildAfternoonSegments`), the `TimelineSegment` interface, and the `resolveColor` helper are currently module-private. Export them so the PDF export can reuse them.

**Step 1: Add export keyword to TimelineSegment interface**

At `StudentPassTimeline.tsx:25`, change:
```typescript
interface TimelineSegment {
```
to:
```typescript
export interface TimelineSegment {
```

**Step 2: Add export keyword to buildMorningSegments**

At `StudentPassTimeline.tsx:37`, change:
```typescript
function buildMorningSegments(
```
to:
```typescript
export function buildMorningSegments(
```

**Step 3: Add export keyword to buildAfternoonSegments**

At `StudentPassTimeline.tsx:90`, change:
```typescript
function buildAfternoonSegments(
```
to:
```typescript
export function buildAfternoonSegments(
```

**Step 4: Add export keyword to resolveColor**

At `StudentPassTimeline.tsx:148`, change:
```typescript
function resolveColor(raw: string | undefined): string {
```
to:
```typescript
export function resolveColor(raw: string | undefined): string {
```

**Step 5: Verify build**

Run: `npm run build`
Expected: PASS — exports don't change behavior

---

### Task 2: Add PDF helper functions to StudentPassModule

**Files:**
- Modify: `components/Analytics/StudentPassModule.tsx`

Add three helper functions above the component: `hexToRgb`, `drawTimelineBar`, and update imports.

**Step 1: Add imports for timeline builders**

At the top of `StudentPassModule.tsx`, after the existing StudentPassTimeline import (line 22), add the named imports:

```typescript
import StudentPassTimeline, {
    buildMorningSegments,
    buildAfternoonSegments,
    resolveColor,
} from './StudentPassTimeline';
import type { TimelineSegment } from './StudentPassTimeline';
```

Replace the existing `import StudentPassTimeline from './StudentPassTimeline';` line.

**Step 2: Add hexToRgb helper**

Add after the `formatDisplayDate` function (~line 40):

```typescript
function hexToRgb(hex: string): [number, number, number] {
    const h = hex.replace('#', '');
    return [
        parseInt(h.substring(0, 2), 16),
        parseInt(h.substring(2, 4), 16),
        parseInt(h.substring(4, 6), 16),
    ];
}
```

**Step 3: Add drawTimelineBar function**

Add after `hexToRgb`. This is the core PDF drawing function — draws a proportional colored bar for a journey's segments.

```typescript
function drawTimelineBar(
    doc: jsPDF,
    segments: TimelineSegment[],
    x: number,
    y: number,
    width: number,
    barHeight: number,
): number {
    const totalMinutes = segments.reduce((sum, s) => sum + s.durationMinutes, 0);
    if (totalMinutes === 0 || segments.length === 0) return y;

    const gap = 1;
    const totalGaps = (segments.length - 1) * gap;
    const availableWidth = width - totalGaps;
    const MIN_WIDTH = 12;

    // Calculate widths with minimum enforcement
    const rawWidths = segments.map(
        (s) => Math.max((s.durationMinutes / totalMinutes) * availableWidth, MIN_WIDTH)
    );
    const rawTotal = rawWidths.reduce((a, b) => a + b, 0);
    const scale = availableWidth / rawTotal;
    const widths = rawWidths.map((w) => w * scale);

    const radius = 2;
    let curX = x;

    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const segW = widths[i];

        if (seg.type === 'walk') {
            doc.setFillColor(100, 116, 139);
            doc.roundedRect(curX, y, segW, barHeight, radius, radius, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(7);
            doc.setFont('helvetica', 'bold');
            doc.text('Walk', curX + segW / 2, y + barHeight / 2 - 1, { align: 'center' });
            doc.setFontSize(6);
            doc.setFont('helvetica', 'normal');
            doc.text(`${seg.durationMinutes}m`, curX + segW / 2, y + barHeight / 2 + 3, { align: 'center' });
        } else if (seg.type === 'ride') {
            const color = resolveColor(seg.routeColor);
            const [r, g, b] = hexToRgb(color);
            doc.setFillColor(r, g, b);
            doc.roundedRect(curX, y, segW, barHeight, radius, radius, 'F');
            const textColor = getContrastingTextColor(color);
            if (textColor === 'white') {
                doc.setTextColor(255, 255, 255);
            } else {
                doc.setTextColor(0, 0, 0);
            }
            doc.setFontSize(7);
            doc.setFont('helvetica', 'bold');
            doc.text(`Rt ${seg.routeShortName}`, curX + segW / 2, y + barHeight / 2 - 1, { align: 'center' });
            doc.setFontSize(6);
            doc.setFont('helvetica', 'normal');
            doc.text(`${seg.durationMinutes}m`, curX + segW / 2, y + barHeight / 2 + 3, { align: 'center' });
        } else {
            // Transfer — amber dashed outline
            doc.setFillColor(254, 243, 199);
            doc.roundedRect(curX, y, segW, barHeight, radius, radius, 'F');
            doc.setDrawColor(245, 158, 11);
            doc.setLineWidth(0.5);
            doc.setLineDashPattern([1, 1], 0);
            doc.roundedRect(curX, y, segW, barHeight, radius, radius, 'S');
            doc.setLineDashPattern([], 0);
            doc.setFontSize(7);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(146, 64, 14);
            doc.text(`${seg.durationMinutes}m`, curX + segW / 2, y + barHeight / 2 + 1, { align: 'center' });
        }

        curX += segW + gap;
    }

    // Time labels below the bar
    curX = x;
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const segW = widths[i];
        if (seg.type === 'ride' && seg.startMinutes != null) {
            doc.setFontSize(6);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(100, 116, 139);
            doc.text(minutesToDisplayTime(seg.startMinutes), curX + 1, y + barHeight + 4);
        }
        curX += segW + gap;
    }

    return y + barHeight + 6;
}
```

**Step 4: Verify build**

Run: `npm run build`
Expected: PASS

---

### Task 3: Rewrite handleExportPdf with new layout

**Files:**
- Modify: `components/Analytics/StudentPassModule.tsx:433-565` (replace entire function)
- Delete: `buildMorningSteps` and `buildAfternoonSteps` functions (~lines 60-149) — no longer needed

**Step 1: Delete dead step-builder functions**

Remove `buildMorningSteps` (lines 60-102) and `buildAfternoonSteps` (lines 104-149) from StudentPassModule.tsx. These were only used by the old PDF export.

**Step 2: Replace handleExportPdf function**

Replace the entire `handleExportPdf` useCallback (starting at the line with `const handleExportPdf = useCallback(async () => {`) with:

```typescript
const handleExportPdf = useCallback(async () => {
    if (!result?.found) return;
    setIsExporting(true);
    try {
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const margin = 14;
        const contentW = pageW - margin * 2;

        // ── Title Banner ─────────────────────────────────────
        doc.setFillColor(0, 78, 126);
        doc.rect(0, 0, pageW, 22, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text(selectedSchool.name, margin, 11);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(214, 237, 250);
        doc.text('Student Transit Pass', margin, 18);
        doc.text(formatDisplayDate(serviceDate), pageW - margin, 11, { align: 'right' });

        let y = 28;

        // ── Map Capture ──────────────────────────────────────
        const mapEl = document.querySelector('.student-pass-map') as HTMLElement | null;
        const mapH = 120;
        if (mapEl) {
            try {
                await prepareMapForExport(mapEl);
                const canvas = await captureStudentPassMapCanvas(mapEl);
                const imgData = canvas.toDataURL('image/png');
                doc.setDrawColor(200, 220, 235);
                doc.setLineWidth(0.3);
                doc.rect(margin, y, contentW, mapH, 'S');
                doc.addImage(imgData, 'PNG', margin, y, contentW, mapH);
                y += mapH + 6;
            } catch {
                y += 4;
            }
        }

        // ── Morning Timeline ─────────────────────────────────
        const morningSegs = buildMorningSegments(result);
        const morningTotal = morningSegs.reduce((sum, s) => sum + s.durationMinutes, 0);

        if (morningSegs.length > 0) {
            doc.setFontSize(8);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(0, 78, 126);
            doc.text('MORNING JOURNEY', margin, y);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(100, 116, 139);
            doc.text(`${morningTotal} min`, pageW - margin, y, { align: 'right' });
            y += 4;

            y = drawTimelineBar(doc, morningSegs, margin, y, contentW, 12);
            y += 4;
        }

        // ── Afternoon Timeline ───────────────────────────────
        const afternoonSegs = buildAfternoonSegments(result);
        const afternoonTotal = afternoonSegs.reduce((sum, s) => sum + s.durationMinutes, 0);

        if (afternoonSegs.length > 0) {
            doc.setFontSize(8);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(0, 78, 126);
            doc.text('AFTERNOON JOURNEY', margin, y);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(100, 116, 139);
            doc.text(`${afternoonTotal} min`, pageW - margin, y, { align: 'right' });
            y += 4;

            y = drawTimelineBar(doc, afternoonSegs, margin, y, contentW, 12);
        }

        // ── Footer ───────────────────────────────────────────
        const footerY = pageH - 10;
        doc.setDrawColor(0, 78, 126);
        doc.setLineWidth(0.3);
        doc.line(margin, footerY - 4, pageW - margin, footerY - 4);
        doc.setFontSize(7);
        doc.setTextColor(94, 127, 150);
        doc.text('Barrie Transit', margin, footerY);
        const today = new Date().toLocaleDateString('en-CA');
        doc.text(
            `${formatDisplayDate(serviceDate)} | Exported ${today}`,
            pageW - margin,
            footerY,
            { align: 'right' },
        );

        // ── Save ─────────────────────────────────────────────
        const safeName = selectedSchool.name.replace(/[^a-zA-Z0-9]/g, '-');
        doc.save(`${safeName}-Student-Transit-Pass.pdf`);
    } finally {
        setIsExporting(false);
    }
}, [result, selectedSchool, serviceDate]);
```

Note: dependency array simplified — removed `effectiveBellStart`, `effectiveBellEnd`, `selectedZoneStop` since we no longer render step lists or stats that use them.

**Step 3: Verify build**

Run: `npm run build`
Expected: PASS

**Step 4: Commit Phase 1**

```bash
git add components/Analytics/StudentPassTimeline.tsx components/Analytics/StudentPassModule.tsx
git commit -m "feat(student-pass): redesign PDF export with dual journey timelines

Replace verbose step lists and stats box with visual timeline bars.
Each journey (morning + afternoon) gets a proportional colored bar
showing walk/ride/transfer segments with route colors and time labels.

Layout: banner → map (120mm hero) → morning timeline → afternoon timeline → footer"
```

---

## Phase 2: Map Export Readability

### Task 4: Add export-time CSS overrides for larger markers and labels

**Files:**
- Modify: `components/Analytics/studentPass.css`

The `.student-pass-export-map` class already hides UI controls. Add overrides that scale up HTML overlay elements (Mapbox markers and labels) for print readability.

**Step 1: Add marker/label scaling rules**

Append to `studentPass.css` after the existing `.student-pass-export-map` block (after line 59):

```css
/* ── Export-time readability: scale up HTML overlays for print ────────── */
.student-pass-export-map .mapboxgl-marker {
    transform-origin: center center;
}

/* Larger map labels for print */
.student-pass-export-map [class*="MapLabel"] > div,
.student-pass-export-map .mapboxgl-marker > div > div[style*="border"] {
    transform: scale(1.4);
    transform-origin: center bottom;
}
```

Note: This scales the HTML label/marker elements. The Mapbox GL canvas (route lines, tile layer) is unaffected since it's WebGL.

**Step 2: Verify build**

Run: `npm run build`
Expected: PASS

---

### Task 5: Improve map canvas background for print contrast

**Files:**
- Modify: `components/Analytics/StudentPassModule.tsx` — `captureStudentPassMapCanvas` function (~line 197)

**Step 1: Change background fill to white**

In the `captureStudentPassMapCanvas` function, change the canvas background fill from dark blue-tinted to clean white for better print contrast:

At the line `ctx.fillStyle = '#dfeef8';` (inside captureStudentPassMapCanvas), change to:
```typescript
ctx.fillStyle = '#ffffff';
```

**Step 2: Verify build**

Run: `npm run build`
Expected: PASS

**Step 3: Commit Phase 2**

```bash
git add components/Analytics/studentPass.css components/Analytics/StudentPassModule.tsx
git commit -m "feat(student-pass): improve map export readability

Scale up markers and labels 1.4x during export capture.
Change map export background to white for better print contrast."
```

---

## Summary

| Phase | What Changes | Files |
|-------|-------------|-------|
| 1 | Export timeline builders, add drawTimelineBar, rewrite handleExportPdf, remove dead step builders | StudentPassTimeline.tsx, StudentPassModule.tsx |
| 2 | CSS marker/label scaling, white map background | studentPass.css, StudentPassModule.tsx |

**Total files modified:** 3
**New files:** 0
**Dependencies added:** 0
