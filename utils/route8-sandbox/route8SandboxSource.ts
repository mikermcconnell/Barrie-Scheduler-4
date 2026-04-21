import { buildRouteIdentity, type DayType, type MasterScheduleContent, type MasterScheduleEntry } from '../masterScheduleTypes';
import { getMasterSchedule } from '../services/masterScheduleService';
import type { Route8Branch, Route8SandboxContent, Route8SandboxSourceSnapshot } from './types';

type Route8MasterPair = Record<Route8Branch, { entry: MasterScheduleEntry; content: MasterScheduleContent }>;

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function buildSnapshot(entry: MasterScheduleEntry): Route8SandboxSourceSnapshot {
    return {
        routeNumber: entry.routeNumber as Route8Branch,
        routeIdentity: entry.id as Route8SandboxSourceSnapshot['routeIdentity'],
        version: entry.currentVersion,
        updatedAt: entry.updatedAt.toISOString(),
        publishedAt: entry.publishedAt?.toISOString(),
        effectiveDate: entry.effectiveDate,
        notes: entry.notes,
    };
}

export function buildRoute8SandboxProjectName(dayType: DayType, now: Date = new Date()): string {
    const formattedDate = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    }).format(now);

    return `Route 8 Sandbox - ${dayType} - ${formattedDate}`;
}

export function buildRoute8SandboxContentFromMasters(
    masters: Route8MasterPair,
    dayType: DayType
): Route8SandboxContent {
    const sourceCopies = {
        '8A': clone(masters['8A'].content),
        '8B': clone(masters['8B'].content),
    } satisfies Route8SandboxContent['sourceCopies'];

    return {
        dayType,
        sourceSnapshots: {
            '8A': buildSnapshot(masters['8A'].entry),
            '8B': buildSnapshot(masters['8B'].entry),
        },
        sourceCopies,
        workingCopies: {
            '8A': clone(sourceCopies['8A']),
            '8B': clone(sourceCopies['8B']),
        },
        notes: '',
    };
}

export async function loadRoute8SandboxSource(teamId: string, dayType: DayType): Promise<Route8SandboxContent> {
    const routePairs = await Promise.all((['8A', '8B'] as Route8Branch[]).map(async (routeNumber) => {
        const identity = buildRouteIdentity(routeNumber, dayType);
        const loaded = await getMasterSchedule(teamId, identity);
        if (!loaded) {
            throw new Error(`Could not find published ${routeNumber} ${dayType} schedule.`);
        }

        return [routeNumber, loaded] as const;
    }));

    const masters = Object.fromEntries(routePairs) as Route8MasterPair;
    return buildRoute8SandboxContentFromMasters(masters, dayType);
}
