import type { RouteScenario } from './routePlannerTypes';

export interface RouteTimetableStopRow {
    stopId: string;
    stopName: string;
    role: RouteScenario['stops'][number]['role'];
    times: string[];
}

export interface RouteTimetablePreview {
    departures: string[];
    rows: RouteTimetableStopRow[];
}

function parseClockToMinutes(value: string): number | null {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return (hours * 60) + minutes;
}

function formatMinutesToClock(totalMinutes: number): string {
    const normalized = ((totalMinutes % 1440) + 1440) % 1440;
    const hours = Math.floor(normalized / 60);
    const minutes = normalized % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

function normalizeOffsetMinutes(stopTime: string, firstDeparture: string): number | null {
    const stopMinutes = parseClockToMinutes(stopTime);
    const departureMinutes = parseClockToMinutes(firstDeparture);
    if (stopMinutes === null || departureMinutes === null) return null;
    if (stopMinutes < departureMinutes) return stopMinutes + 1440 - departureMinutes;
    return stopMinutes - departureMinutes;
}

export function buildRouteTimetablePreview(
    scenario: RouteScenario,
    departureLimit = 5
): RouteTimetablePreview {
    const departures = scenario.departures.slice(0, departureLimit);
    if (departures.length === 0 || scenario.stops.length === 0) {
        return {
            departures,
            rows: [],
        };
    }

    const rows = scenario.stops.map((stop) => {
        const offsetMinutes = normalizeOffsetMinutes(stop.timeLabel, scenario.firstDeparture);
        const times = departures.map((departure) => {
            const departureMinutes = parseClockToMinutes(departure);
            if (offsetMinutes === null || departureMinutes === null) return '--';
            return formatMinutesToClock(departureMinutes + offsetMinutes);
        });

        return {
            stopId: stop.id,
            stopName: stop.name,
            role: stop.role,
            times,
        };
    });

    return {
        departures,
        rows,
    };
}

export function buildRouteTimetableMarkdown(
    scenario: RouteScenario,
    departureLimit = 5
): string {
    const preview = buildRouteTimetablePreview(scenario, departureLimit);
    if (preview.departures.length === 0 || preview.rows.length === 0) {
        return 'No timetable preview available yet.';
    }

    const header = ['Stop', 'Role', ...preview.departures].join(' | ');
    const divider = ['---', '---', ...preview.departures.map(() => '---')].join(' | ');
    const rows = preview.rows.map((row) =>
        [row.stopName, row.role, ...row.times].join(' | ')
    );

    return [
        `| ${header} |`,
        `| ${divider} |`,
        ...rows.map((row) => `| ${row} |`),
    ].join('\n');
}
