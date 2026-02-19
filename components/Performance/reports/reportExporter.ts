import ExcelJS from 'exceljs';
import type { DailySummary } from '../../../utils/performanceDataTypes';

// ─── Shared Helpers ──────────────────────────────────────────────

function downloadBuffer(buffer: ExcelJS.Buffer, fileName: string): void {
    const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
}

function styleHeader(row: ExcelJS.Row): void {
    row.eachCell(cell => {
        cell.font = { bold: true, size: 11 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FF94A3B8' } } };
    });
}

function autoWidth(sheet: ExcelJS.Worksheet): void {
    sheet.columns.forEach(col => {
        let maxLen = 10;
        col.eachCell?.({ includeEmpty: false }, cell => {
            const len = String(cell.value ?? '').length;
            if (len > maxLen) maxLen = len;
        });
        col.width = Math.min(maxLen + 2, 40);
    });
}

// ─── Weekly Summary Export ───────────────────────────────────────

export async function exportWeeklySummary(
    filteredDays: DailySummary[],
    startDate: string,
    endDate: string,
): Promise<void> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Barrie Transit Scheduler';

    // Sheet 1: Summary KPIs
    const summary = wb.addWorksheet('Summary');
    summary.addRow(['System Performance Summary']);
    summary.getRow(1).font = { bold: true, size: 14 };
    summary.addRow([`Period: ${startDate} to ${endDate} (${filteredDays.length} days)`]);
    summary.addRow([]);

    const n = filteredDays.length;
    if (n > 0) {
        const otp = Math.round(filteredDays.reduce((s, d) => s + d.system.otp.onTimePercent, 0) / n * 10) / 10;
        const early = Math.round(filteredDays.reduce((s, d) => s + d.system.otp.earlyPercent, 0) / n * 10) / 10;
        const late = Math.round(filteredDays.reduce((s, d) => s + d.system.otp.latePercent, 0) / n * 10) / 10;
        const ridership = filteredDays.reduce((s, d) => s + d.system.totalRidership, 0);
        const trips = filteredDays.reduce((s, d) => s + d.system.tripCount, 0);
        const vehicles = Math.round(filteredDays.reduce((s, d) => s + d.system.vehicleCount, 0) / n);
        const peakLoad = Math.max(...filteredDays.map(d => d.system.peakLoad));

        const kpiHeader = summary.addRow(['Metric', 'Value']);
        styleHeader(kpiHeader);
        summary.addRow(['On-Time Performance', `${otp}%`]);
        summary.addRow(['Early %', `${early}%`]);
        summary.addRow(['Late %', `${late}%`]);
        summary.addRow(['Total Ridership', ridership]);
        summary.addRow(['Total Trips', trips]);
        summary.addRow(['Avg Vehicles', vehicles]);
        summary.addRow(['Peak Load', peakLoad]);
    }
    autoWidth(summary);

    // Sheet 2: Route Scorecard
    const routeSheet = wb.addWorksheet('Route Scorecard');
    const routeHeader = routeSheet.addRow([
        'Route', 'Name', 'OTP%', 'Early%', 'Late%', 'Ridership', 'Alightings', 'Trips', 'BPH',
    ]);
    styleHeader(routeHeader);

    const routeMap = new Map<string, {
        otp: number[]; early: number[]; late: number[];
        ridership: number; alightings: number; serviceHours: number;
        tripCount: number; routeId: string; routeName: string;
    }>();
    for (const day of filteredDays) {
        for (const r of day.byRoute) {
            const ex = routeMap.get(r.routeId) || {
                otp: [], early: [], late: [],
                ridership: 0, alightings: 0, serviceHours: 0,
                tripCount: 0, routeId: r.routeId, routeName: r.routeName,
            };
            ex.otp.push(r.otp.onTimePercent);
            ex.early.push(r.otp.earlyPercent);
            ex.late.push(r.otp.latePercent);
            ex.ridership += r.ridership;
            ex.alightings += r.alightings;
            ex.serviceHours += r.serviceHours;
            ex.tripCount += r.tripCount;
            routeMap.set(r.routeId, ex);
        }
    }
    const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10 : 0;
    const routes = Array.from(routeMap.values())
        .map(r => ({
            routeId: r.routeId, routeName: r.routeName,
            otp: avg(r.otp), early: avg(r.early), late: avg(r.late),
            ridership: r.ridership, alightings: r.alightings, tripCount: r.tripCount,
            bph: r.serviceHours > 0 ? Math.round(r.ridership / r.serviceHours * 10) / 10 : 0,
        }))
        .sort((a, b) => b.bph - a.bph);

    for (const r of routes) {
        routeSheet.addRow([r.routeId, r.routeName, r.otp, r.early, r.late, r.ridership, r.alightings, r.tripCount, r.bph]);
    }
    autoWidth(routeSheet);

    // Sheet 3: Daily Trend
    const trendSheet = wb.addWorksheet('Daily Trend');
    const trendHeader = trendSheet.addRow(['Date', 'Day Type', 'OTP%', 'Ridership', 'Trips', 'Vehicles']);
    styleHeader(trendHeader);
    for (const d of [...filteredDays].sort((a, b) => a.date.localeCompare(b.date))) {
        trendSheet.addRow([
            d.date, d.dayType, d.system.otp.onTimePercent,
            d.system.totalRidership, d.system.tripCount, d.system.vehicleCount,
        ]);
    }
    autoWidth(trendSheet);

    // Sheet 4: Hourly
    const hourlySheet = wb.addWorksheet('Hourly');
    const hourlyHeader = hourlySheet.addRow(['Hour', 'Avg Boardings', 'Avg OTP%']);
    styleHeader(hourlyHeader);
    const hours = Array.from({ length: 24 }, (_, i) => ({ hour: i, boardings: 0, otp: 0, otpCount: 0 }));
    for (const day of filteredDays) {
        for (const h of day.byHour) {
            const idx = h.hour % 24;
            if (idx >= 0 && idx < 24) {
                hours[idx].boardings += h.boardings;
                if (h.otp.total > 0) {
                    hours[idx].otp += h.otp.onTimePercent;
                    hours[idx].otpCount++;
                }
            }
        }
    }
    for (const h of hours.filter(h => h.boardings > 0)) {
        hourlySheet.addRow([
            `${h.hour.toString().padStart(2, '0')}:00`,
            Math.round(h.boardings / n),
            h.otpCount > 0 ? Math.round(h.otp / h.otpCount * 10) / 10 : 'N/A',
        ]);
    }
    autoWidth(hourlySheet);

    const buffer = await wb.xlsx.writeBuffer();
    downloadBuffer(buffer, `performance_summary_${startDate}_${endDate}.xlsx`);
}

// ─── Route Performance Export ────────────────────────────────────

export async function exportRoutePerformance(
    filteredDays: DailySummary[],
    routeId: string,
    startDate: string,
    endDate: string,
): Promise<void> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Barrie Transit Scheduler';

    const routeDays = filteredDays
        .map(d => ({ day: d, route: d.byRoute.find(r => r.routeId === routeId) }))
        .filter((d): d is { day: DailySummary; route: NonNullable<typeof d.route> } => d.route != null);

    const routeName = routeDays[0]?.route.routeName ?? routeId;

    // Sheet 1: Route Summary
    const summary = wb.addWorksheet('Route Summary');
    summary.addRow([`Route ${routeId} — ${routeName}`]);
    summary.getRow(1).font = { bold: true, size: 14 };
    summary.addRow([`Period: ${startDate} to ${endDate} (${routeDays.length} days)`]);
    summary.addRow([]);

    if (routeDays.length > 0) {
        const n = routeDays.length;
        const kpiHeader = summary.addRow(['Metric', 'Value']);
        styleHeader(kpiHeader);
        const avgField = (fn: (r: typeof routeDays[0]['route']) => number) =>
            Math.round(routeDays.reduce((s, d) => s + fn(d.route), 0) / n * 10) / 10;
        const sumField = (fn: (r: typeof routeDays[0]['route']) => number) =>
            routeDays.reduce((s, d) => s + fn(d.route), 0);

        summary.addRow(['OTP%', avgField(r => r.otp.onTimePercent)]);
        summary.addRow(['Early%', avgField(r => r.otp.earlyPercent)]);
        summary.addRow(['Late%', avgField(r => r.otp.latePercent)]);
        summary.addRow(['Total Ridership', sumField(r => r.ridership)]);
        summary.addRow(['Total Alightings', sumField(r => r.alightings)]);
        summary.addRow(['Total Trips', sumField(r => r.tripCount)]);
        summary.addRow(['Service Hours', Math.round(sumField(r => r.serviceHours) * 10) / 10]);
        summary.addRow(['Avg Load', avgField(r => r.avgLoad)]);
        summary.addRow(['Max Load', Math.max(...routeDays.map(d => d.route.maxLoad))]);
    }
    autoWidth(summary);

    // Sheet 2: Stop Performance
    const stopSheet = wb.addWorksheet('Stop Performance');
    const stopHeader = stopSheet.addRow(['Stop', 'Timepoint', 'Boardings', 'Alightings', 'Avg Load', 'Max Load']);
    styleHeader(stopHeader);

    for (const day of filteredDays) {
        for (const lp of day.loadProfiles) {
            if (lp.routeId !== routeId) continue;
            for (const stop of lp.stops) {
                stopSheet.addRow([
                    stop.stopName, stop.isTimepoint ? 'Yes' : 'No',
                    Math.round(stop.avgBoardings * lp.tripCount),
                    Math.round(stop.avgAlightings * lp.tripCount),
                    stop.avgLoad, stop.maxLoad,
                ]);
            }
        }
    }
    autoWidth(stopSheet);

    // Sheet 3: Trip Detail
    const tripSheet = wb.addWorksheet('Trip Detail');
    const tripHeader = tripSheet.addRow(['Trip', 'Block', 'Direction', 'Departure', 'OTP%', 'Boardings', 'Max Load']);
    styleHeader(tripHeader);

    for (const day of filteredDays) {
        for (const t of day.byTrip) {
            if (t.routeId !== routeId) continue;
            tripSheet.addRow([
                t.tripName, t.block, t.direction, t.terminalDepartureTime,
                t.otp.onTimePercent, t.boardings, t.maxLoad,
            ]);
        }
    }
    autoWidth(tripSheet);

    // Sheet 4: Daily Trend
    const trendSheet = wb.addWorksheet('Daily Trend');
    const trendHeader = trendSheet.addRow(['Date', 'Day Type', 'OTP%', 'Ridership', 'Trips', 'Service Hours']);
    styleHeader(trendHeader);
    for (const d of routeDays.sort((a, b) => a.day.date.localeCompare(b.day.date))) {
        trendSheet.addRow([
            d.day.date, d.day.dayType, d.route.otp.onTimePercent,
            d.route.ridership, d.route.tripCount, Math.round(d.route.serviceHours * 10) / 10,
        ]);
    }
    autoWidth(trendSheet);

    const buffer = await wb.xlsx.writeBuffer();
    downloadBuffer(buffer, `route_${routeId}_performance_${startDate}_${endDate}.xlsx`);
}
