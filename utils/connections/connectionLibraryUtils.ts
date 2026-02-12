import type { MasterRouteTable } from '../parsers/masterScheduleParser';
import type {
    ConnectionLibrary,
    ConnectionLibraryChangeLogEntry,
    ConnectionTarget
} from './connectionTypes';
import type { DayType } from '../parsers/masterScheduleParser';

const MAX_AUDIT_ENTRIES = 200;

export function appendLibraryChange(
    library: ConnectionLibrary,
    userId: string,
    action: string,
    details?: string
): ConnectionLibrary {
    const existing = library.changeLog || [];
    const nextVersion = (existing[0]?.version || 0) + 1;
    const entry: ConnectionLibraryChangeLogEntry = {
        id: `libchg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        version: nextVersion,
        timestamp: new Date().toISOString(),
        userId,
        action,
        details
    };

    return {
        ...library,
        changeLog: [entry, ...existing].slice(0, MAX_AUDIT_ENTRIES),
        updatedAt: new Date().toISOString(),
        updatedBy: userId
    };
}

export function getTargetStopCodes(target: ConnectionTarget): string[] {
    const codes: string[] = [];
    if (target.stopCode) codes.push(target.stopCode);
    (target.stopCodes || []).forEach(code => {
        if (code && !codes.includes(code)) codes.push(code);
    });
    return codes;
}

export function targetMatchesLoadedStops(
    target: ConnectionTarget,
    loadedStopCodes: string[]
): boolean {
    const loaded = new Set(loadedStopCodes);
    const targetCodes = getTargetStopCodes(target);
    return targetCodes.some(code => loaded.has(code));
}

export function targetHasActiveTimesForDay(
    target: ConnectionTarget,
    dayType: DayType
): boolean {
    if (!target.times || target.times.length === 0) return true;
    return target.times.some(time => time.enabled && time.daysActive.includes(dayType));
}

export function getTargetCoverageSummary(
    target: ConnectionTarget,
    schedules: MasterRouteTable[],
    dayType: DayType
): { matchingStopCodes: string[]; matchingRoutes: string[]; activeTimesCount: number } {
    const targetCodes = new Set(getTargetStopCodes(target));
    const matchingStopCodes = new Set<string>();
    const matchingRoutes = new Set<string>();

    schedules.forEach(table => {
        const routeHasMatch = Object.values(table.stopIds || {}).some(code => targetCodes.has(code));
        if (!routeHasMatch) return;
        matchingRoutes.add(table.routeName);
        Object.values(table.stopIds || {}).forEach(code => {
            if (targetCodes.has(code)) matchingStopCodes.add(code);
        });
    });

    const activeTimesCount = (target.times || []).filter(
        time => time.enabled && time.daysActive.includes(dayType)
    ).length;

    return {
        matchingStopCodes: Array.from(matchingStopCodes),
        matchingRoutes: Array.from(matchingRoutes),
        activeTimesCount
    };
}
