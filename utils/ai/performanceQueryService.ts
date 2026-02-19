import type { DailySummary } from '../performanceDataTypes';

export type ContextTier = 'system' | 'route' | 'stops' | 'trips';

/**
 * Build a concise text context from performance data for AI queries.
 * Uses text serialization (not JSON) to save tokens.
 */
export function buildQueryContext(
    filteredDays: DailySummary[],
    tier: ContextTier,
    routeId?: string,
): string {
    if (filteredDays.length === 0) return 'No performance data available for the selected period.';

    const lines: string[] = [];
    const n = filteredDays.length;
    const dates = filteredDays.map(d => d.date).sort();

    lines.push(`=== SYSTEM OVERVIEW ===`);
    lines.push(`Period: ${dates[0]} to ${dates[dates.length - 1]} (${n} days)`);

    // System-level aggregates
    const avgOtp = Math.round(filteredDays.reduce((s, d) => s + d.system.otp.onTimePercent, 0) / n * 10) / 10;
    const avgEarly = Math.round(filteredDays.reduce((s, d) => s + d.system.otp.earlyPercent, 0) / n * 10) / 10;
    const avgLate = Math.round(filteredDays.reduce((s, d) => s + d.system.otp.latePercent, 0) / n * 10) / 10;
    const totalRidership = filteredDays.reduce((s, d) => s + d.system.totalRidership, 0);
    const totalTrips = filteredDays.reduce((s, d) => s + d.system.tripCount, 0);
    const avgVehicles = Math.round(filteredDays.reduce((s, d) => s + d.system.vehicleCount, 0) / n);
    const peakLoad = Math.max(...filteredDays.map(d => d.system.peakLoad));

    lines.push(`System OTP: ${avgOtp}% (Early ${avgEarly}%, Late ${avgLate}%)`);
    lines.push(`Total Ridership: ${totalRidership.toLocaleString()} boardings over ${n} days (${Math.round(totalRidership / n)} avg/day)`);
    lines.push(`Total Trips: ${totalTrips.toLocaleString()}, Avg Vehicles: ${avgVehicles}, Peak Load: ${peakLoad}`);

    // Route summaries (always included)
    lines.push('');
    lines.push('=== ROUTE SUMMARY ===');
    const routeMap = new Map<string, { otp: number[]; ridership: number; svcHours: number; trips: number; name: string }>();
    for (const day of filteredDays) {
        for (const r of day.byRoute) {
            const ex = routeMap.get(r.routeId) || { otp: [], ridership: 0, svcHours: 0, trips: 0, name: r.routeName };
            ex.otp.push(r.otp.onTimePercent);
            ex.ridership += r.ridership;
            ex.svcHours += r.serviceHours;
            ex.trips += r.tripCount;
            routeMap.set(r.routeId, ex);
        }
    }
    for (const [id, r] of routeMap) {
        const avg = Math.round(r.otp.reduce((a, b) => a + b, 0) / r.otp.length * 10) / 10;
        const bph = r.svcHours > 0 ? Math.round(r.ridership / r.svcHours * 10) / 10 : 0;
        lines.push(`Route ${id} ${r.name}: OTP ${avg}%, ${r.ridership.toLocaleString()} boardings, ${r.trips} trips, BPH ${bph}`);
    }

    // Daily trends
    lines.push('');
    lines.push('=== DAILY TRENDS ===');
    for (const d of [...filteredDays].sort((a, b) => a.date.localeCompare(b.date))) {
        lines.push(`${d.date} (${d.dayType}): OTP ${d.system.otp.onTimePercent}%, Ridership ${d.system.totalRidership}, Trips ${d.system.tripCount}`);
    }

    // Hourly distribution
    lines.push('');
    lines.push('=== HOURLY DISTRIBUTION (averaged) ===');
    const hours = Array.from({ length: 24 }, (_, i) => ({ hour: i, boardings: 0, count: 0 }));
    for (const day of filteredDays) {
        for (const h of day.byHour) {
            const idx = h.hour % 24;
            if (idx >= 0 && idx < 24) {
                hours[idx].boardings += h.boardings;
                hours[idx].count++;
            }
        }
    }
    for (const h of hours.filter(h => h.boardings > 0)) {
        lines.push(`${h.hour.toString().padStart(2, '0')}:00 — ${Math.round(h.boardings / n)} avg boardings`);
    }

    // Tier: route — add specific route detail
    if ((tier === 'route' || tier === 'stops' || tier === 'trips') && routeId) {
        lines.push('');
        lines.push(`=== ROUTE ${routeId} DETAIL ===`);
        for (const day of [...filteredDays].sort((a, b) => a.date.localeCompare(b.date))) {
            const r = day.byRoute.find(route => route.routeId === routeId);
            if (!r) continue;
            lines.push(`${day.date}: OTP ${r.otp.onTimePercent}%, Early ${r.otp.earlyPercent}%, Late ${r.otp.latePercent}%, Ridership ${r.ridership}, Trips ${r.tripCount}, AvgLoad ${r.avgLoad}, MaxLoad ${r.maxLoad}`);
        }
    }

    // Tier: stops
    if (tier === 'stops') {
        lines.push('');
        lines.push('=== STOP-LEVEL DATA ===');
        const stopMap = new Map<string, { name: string; otp: number[]; boardings: number; tp: boolean }>();
        for (const day of filteredDays) {
            for (const s of day.byStop) {
                if (routeId) {
                    // Filter to route stops via load profiles
                    const routeStopIds = new Set(
                        day.loadProfiles.filter(lp => lp.routeId === routeId).flatMap(lp => lp.stops.map(st => st.stopId))
                    );
                    if (routeStopIds.size > 0 && !routeStopIds.has(s.stopId)) continue;
                }
                const ex = stopMap.get(s.stopId) || { name: s.stopName, otp: [], boardings: 0, tp: s.isTimepoint };
                ex.otp.push(s.otp.onTimePercent);
                ex.boardings += s.boardings;
                stopMap.set(s.stopId, ex);
            }
        }
        for (const [, s] of stopMap) {
            const avg = Math.round(s.otp.reduce((a, b) => a + b, 0) / s.otp.length * 10) / 10;
            lines.push(`${s.name}${s.tp ? ' [TP]' : ''}: OTP ${avg}%, ${s.boardings} boardings`);
        }
    }

    // Tier: trips (limit to avoid token explosion)
    if (tier === 'trips') {
        lines.push('');
        lines.push('=== TRIP-LEVEL DATA ===');
        let tripCount = 0;
        const maxTrips = 200;
        for (const day of [...filteredDays].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5)) {
            for (const t of day.byTrip) {
                if (routeId && t.routeId !== routeId) continue;
                if (tripCount >= maxTrips) break;
                lines.push(`${day.date} ${t.tripName} Block:${t.block} Dir:${t.direction} Dep:${t.terminalDepartureTime} OTP:${t.otp.onTimePercent}% Boards:${t.boardings} MaxLoad:${t.maxLoad}`);
                tripCount++;
            }
            if (tripCount >= maxTrips) {
                lines.push(`... (limited to ${maxTrips} trips for context size)`);
                break;
            }
        }
    }

    return lines.join('\n');
}

/**
 * Send a performance question to the API.
 */
export async function askPerformanceQuestion(
    question: string,
    context: string,
): Promise<{ answer: string }> {
    const res = await fetch('/api/performance-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, context }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(err.message || `API error: ${res.status}`);
    }
    return res.json();
}
