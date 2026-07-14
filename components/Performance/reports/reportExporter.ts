import ExcelJS from 'exceljs';
import type { DailySummary } from '../../../utils/performanceDataTypes';
import {
    buildDwellIncidentReviewModel,
    buildFilteredDwellIncidentReviewModel,
    type DwellIncidentReviewRow,
} from '../../../utils/performanceDwellReview';

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
        const otpTotals = filteredDays.reduce(
            (acc, d) => ({
                total: acc.total + d.system.otp.total,
                onTime: acc.onTime + d.system.otp.onTime,
                early: acc.early + d.system.otp.early,
                late: acc.late + d.system.otp.late,
            }),
            { total: 0, onTime: 0, early: 0, late: 0 }
        );
        const otp = otpTotals.total > 0 ? Math.round(otpTotals.onTime / otpTotals.total * 1000) / 10 : 0;
        const early = otpTotals.total > 0 ? Math.round(otpTotals.early / otpTotals.total * 1000) / 10 : 0;
        const late = otpTotals.total > 0 ? Math.round(otpTotals.late / otpTotals.total * 1000) / 10 : 0;
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
        otpTotal: number; otpOnTime: number; otpEarly: number; otpLate: number;
        ridership: number; alightings: number; serviceHours: number;
        tripCount: number; routeId: string; routeName: string;
    }>();
    for (const day of filteredDays) {
        for (const r of day.byRoute) {
            const ex = routeMap.get(r.routeId) || {
                otpTotal: 0, otpOnTime: 0, otpEarly: 0, otpLate: 0,
                ridership: 0, alightings: 0, serviceHours: 0,
                tripCount: 0, routeId: r.routeId, routeName: r.routeName,
            };
            ex.otpTotal += r.otp.total;
            ex.otpOnTime += r.otp.onTime;
            ex.otpEarly += r.otp.early;
            ex.otpLate += r.otp.late;
            ex.ridership += r.ridership;
            ex.alightings += r.alightings;
            ex.serviceHours += r.serviceHours;
            ex.tripCount += r.tripCount;
            routeMap.set(r.routeId, ex);
        }
    }
    const routes = Array.from(routeMap.values())
        .map(r => ({
            routeId: r.routeId, routeName: r.routeName,
            otp: r.otpTotal > 0 ? Math.round(r.otpOnTime / r.otpTotal * 1000) / 10 : 0,
            early: r.otpTotal > 0 ? Math.round(r.otpEarly / r.otpTotal * 1000) / 10 : 0,
            late: r.otpTotal > 0 ? Math.round(r.otpLate / r.otpTotal * 1000) / 10 : 0,
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

        const mergedOtp = routeDays.reduce(
            (acc, d) => ({
                total: acc.total + d.route.otp.total,
                onTime: acc.onTime + d.route.otp.onTime,
                early: acc.early + d.route.otp.early,
                late: acc.late + d.route.otp.late,
            }),
            { total: 0, onTime: 0, early: 0, late: 0 }
        );
        summary.addRow(['OTP%', mergedOtp.total > 0 ? Math.round(mergedOtp.onTime / mergedOtp.total * 1000) / 10 : 0]);
        summary.addRow(['Early%', mergedOtp.total > 0 ? Math.round(mergedOtp.early / mergedOtp.total * 1000) / 10 : 0]);
        summary.addRow(['Late%', mergedOtp.total > 0 ? Math.round(mergedOtp.late / mergedOtp.total * 1000) / 10 : 0]);
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
    const stopHeader = stopSheet.addRow(['Date', 'Direction', 'Stop', 'Timepoint', 'Boardings', 'Alightings', 'Avg Load', 'Max Load']);
    styleHeader(stopHeader);

    for (const { day } of routeDays) {
        for (const lp of day.loadProfiles) {
            if (lp.routeId !== routeId) continue;
            for (const stop of lp.stops) {
                stopSheet.addRow([
                    day.date, lp.direction, stop.stopName, stop.isTimepoint ? 'Yes' : 'No',
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

// ─── Dwell Incident Review Excel Export ─────────────────────────

export async function exportOperatorDwell(
    filteredDays: DailySummary[],
    startDate: string,
    endDate: string,
    reviewRows?: DwellIncidentReviewRow[],
    filtersActive = false,
): Promise<void> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Barrie Transit Scheduler';
    const fullModel = buildDwellIncidentReviewModel(filteredDays);
    const model = filtersActive && reviewRows
        ? buildFilteredDwellIncidentReviewModel(filteredDays, reviewRows)
        : fullModel;
    const incidentRows = reviewRows ?? model.rows;

    // Sheet 1: prioritized reportable incident queue
    const detailSheet = wb.addWorksheet('Incident Queue');
    const detailHeader = detailSheet.addRow([
        'Date', 'Departure', 'Route', 'Stop', 'Trip', 'Block', 'Operator',
        'Severity', 'Effective Dwell (min)', 'Departure Late (min)',
        'Boardings', 'Alightings', 'Wheelchair Activity', 'Departure Load',
        'Later Trips Touched', 'OTP-Late Departures', 'Downstream Evidence',
    ]);
    styleHeader(detailHeader);
    for (const row of incidentRows) {
        const inc = row.incident;
        const cascade = row.cascade?.incidentRecordMatched === false ? null : row.cascade;
        detailSheet.addRow([
            inc.date, inc.observedDepartureTime, inc.routeId, inc.stopName, inc.tripName,
            inc.block, inc.operatorId, inc.severity,
            Math.round(inc.trackedDwellSeconds / 60 * 10) / 10,
            inc.departureDeviationSeconds === undefined ? null : Math.round(inc.departureDeviationSeconds / 60 * 10) / 10,
            inc.boardings ?? null,
            inc.alightings ?? null,
            inc.wheelchairUsageCount ?? null,
            inc.departureLoadReliable ? (inc.departureLoad ?? 0) : null,
            cascade?.affectedTripCount ?? null,
            cascade?.blastRadius ?? null,
            row.impactStatus,
        ]);
    }
    autoWidth(detailSheet);

    // Sheet 2: recurring patterns
    const patternSheet = wb.addWorksheet('Recurring Patterns');
    styleHeader(patternSheet.addRow([
        'Route', 'Stop', 'Trip', 'Distinct Days', 'Incidents', 'High',
        'Average Dwell (min)', 'OTP-Late Departures', 'Operators', 'Latest Date',
    ]));
    for (const pattern of model.patterns) {
        patternSheet.addRow([
            pattern.routeId, pattern.stopName, pattern.tripName, pattern.distinctDays,
            pattern.incidentCount, pattern.highCount, (pattern.avgDwellSeconds / 60).toFixed(1),
            pattern.otpLateDepartures, pattern.operatorCount, pattern.latestDate,
        ]);
    }
    autoWidth(patternSheet);

    // Sheet 3: neutral operator context
    const operatorSheet = wb.addWorksheet('Operator Context');
    styleHeader(operatorSheet.addRow([
        'Operator ID', 'Eligible Timepoint Visits', 'Reportable Incidents', 'High',
        'Incidents per 1K Eligible Visits', 'Reportable Dwell (min)',
    ]));
    for (const operator of model.operatorContext) {
        operatorSheet.addRow([
            operator.operatorId,
            operator.eligibleTimepointVisits,
            operator.incidentCount,
            operator.highCount,
            operator.incidentsPer1kEligibleVisits === null ? null : +operator.incidentsPer1kEligibleVisits.toFixed(2),
            +(operator.reportableDwellSeconds / 60).toFixed(1),
        ]);
    }
    autoWidth(operatorSheet);

    // Sheet 4: definitions and scope
    const definitionsSheet = wb.addWorksheet('Definitions');
    styleHeader(definitionsSheet.addRow(['Item', 'Definition']));
    const definitions: Array<[string, string]> = [
        ['Report period', `${startDate} to ${endDate}`],
        ['Reportable incident', 'Departure more than 3 minutes late with effective dwell above 2 minutes.'],
        ['High severity', 'Effective dwell above 5 minutes.'],
        ['Exposure rate', 'Reportable incidents per 1,000 eligible timepoint visits.'],
        ['Active incident filters', filtersActive
            ? 'Applied to the incident queue, recurring patterns, operator context, and daily counts. Exposure rates are blank because arbitrary incident filters do not have a matching eligible-visit denominator.'
            : 'None. Supporting sections cover the full selected dashboard period.'],
        ['Dwell-associated delay', 'Observed delay remaining after subtracting lateness already present on arrival. This is an association, not proof of sole causation.'],
        ['Missing evidence', 'Blank downstream values mean the stored day did not contain a complete matching incident story.'],
    ];
    for (const definition of definitions) definitionsSheet.addRow(definition);
    autoWidth(definitionsSheet);

    const trendSheet = wb.addWorksheet('Daily Trend');
    styleHeader(trendSheet.addRow([
        'Date', 'Reportable Incidents', 'High', 'Eligible Timepoint Visits', 'Incidents per 1K Visits',
    ]));
    for (const point of model.dailyTrend) {
        trendSheet.addRow([
            point.date,
            point.incidents,
            point.high,
            point.eligibleTimepointVisits,
            point.incidentsPer1kEligibleVisits === null ? null : +point.incidentsPer1kEligibleVisits.toFixed(2),
        ]);
    }
    autoWidth(trendSheet);

    const buffer = await wb.xlsx.writeBuffer();
    downloadBuffer(buffer, `dwell_incident_review_${startDate}_${endDate}.xlsx`);
}

// ─── Dwell Incident Review PDF Export ───────────────────────────

export async function exportOperatorDwellPDF(
    filteredDays: DailySummary[],
    startDate: string,
    endDate: string,
    reviewRows?: DwellIncidentReviewRow[],
    filtersActive = false,
): Promise<void> {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
    ]);

    const fullModel = buildDwellIncidentReviewModel(filteredDays);
    const model = filtersActive && reviewRows
        ? buildFilteredDwellIncidentReviewModel(filteredDays, reviewRows)
        : fullModel;
    const incidentRows = reviewRows ?? model.rows;
    const doc = new jsPDF({ orientation: 'landscape' });

    doc.setFontSize(16);
    doc.text('Dwell Incident Review', 14, 18);
    doc.setFontSize(10);
    const exportedOtpLateDepartures = incidentRows.reduce((sum, row) => (
        sum + (row.cascade?.incidentRecordMatched === false ? 0 : (row.cascade?.blastRadius ?? 0))
    ), 0);
    doc.text(`${startDate} — ${endDate}  |  ${filteredDays.length} days  |  ${incidentRows.length} reportable incidents  |  ${exportedOtpLateDepartures} OTP-late departures`, 14, 26);
    doc.setFontSize(8);
    doc.text('Investigation signals only. Results do not prove operator fault or sole causation.', 14, 31);

    autoTable(doc, {
        startY: 36,
        head: [['Date', 'Time', 'Route', 'Stop', 'Operator', 'Severity', 'Dwell', 'Trips Touched', 'OTP-Late', 'Evidence']],
        body: incidentRows.map(row => [
            row.incident.date,
            row.incident.observedDepartureTime,
            row.incident.routeId,
            row.incident.stopName.length > 28 ? `${row.incident.stopName.slice(0, 28)}…` : row.incident.stopName,
            row.incident.operatorId,
            row.incident.severity,
            (row.incident.trackedDwellSeconds / 60).toFixed(1),
            row.cascade?.incidentRecordMatched === false ? '—' : (row.cascade?.affectedTripCount ?? '—'),
            row.cascade?.incidentRecordMatched === false ? '—' : (row.cascade?.blastRadius ?? '—'),
            row.impactStatus,
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [8, 145, 178] },
    });

    doc.addPage();
    doc.setFontSize(13);
    doc.text('Recurring patterns', 14, 16);
    autoTable(doc, {
        startY: 22,
        head: [['Route', 'Stop', 'Trip', 'Days', 'Incidents', 'High', 'Avg Dwell', 'OTP-Late', 'Operators']],
        body: model.patterns.map(pattern => [
            pattern.routeId,
            pattern.stopName,
            pattern.tripName,
            pattern.distinctDays,
            pattern.incidentCount,
            pattern.highCount,
            (pattern.avgDwellSeconds / 60).toFixed(1),
            pattern.otpLateDepartures,
            pattern.operatorCount,
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [8, 145, 178] },
    });

    doc.save(`dwell_incident_review_${startDate}_${endDate}.pdf`);
}
