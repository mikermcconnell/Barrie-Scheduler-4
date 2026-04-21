import type { MasterRouteTable } from '../parsers/masterScheduleParser';
import { extractDirectionFromName } from '../config/routeDirectionConfig';
import type { Route8Branch, Route8SandboxContent } from './types';

const tableHasData = (table: MasterRouteTable | undefined): table is MasterRouteTable =>
    Boolean(table && ((table.trips?.length ?? 0) > 0 || (table.stops?.length ?? 0) > 0));

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function resolveTableDirection(table: MasterRouteTable): 'North' | 'South' | null {
    const explicit = extractDirectionFromName(table.routeName);
    if (explicit) return explicit;
    const firstTripDirection = table.trips.find((trip) => trip.direction === 'North' || trip.direction === 'South')?.direction;
    return firstTripDirection ?? null;
}

export function getRoute8BranchSchedules(
    content: Route8SandboxContent,
    branch: Route8Branch,
    source: 'working' | 'source' = 'working'
): MasterRouteTable[] {
    const copy = source === 'working' ? content.workingCopies[branch] : content.sourceCopies[branch];
    const tables: MasterRouteTable[] = [];
    if (tableHasData(copy.northTable)) tables.push(clone(copy.northTable));
    if (tableHasData(copy.southTable)) tables.push(clone(copy.southTable));
    return tables;
}

export function updateRoute8BranchSchedules(
    content: Route8SandboxContent,
    branch: Route8Branch,
    schedules: MasterRouteTable[]
): Route8SandboxContent {
    const existing = content.workingCopies[branch];
    let nextNorth = clone(existing.northTable);
    let nextSouth = clone(existing.southTable);

    schedules.forEach((table, index) => {
        const direction = resolveTableDirection(table);
        if (direction === 'North') {
            nextNorth = clone(table);
            return;
        }
        if (direction === 'South') {
            nextSouth = clone(table);
            return;
        }

        if (index === 0) {
            nextNorth = clone(table);
        } else {
            nextSouth = clone(table);
        }
    });

    return {
        ...content,
        workingCopies: {
            ...content.workingCopies,
            [branch]: {
                ...existing,
                northTable: nextNorth,
                southTable: nextSouth,
            },
        },
    };
}

export function resetRoute8BranchToSource(
    content: Route8SandboxContent,
    branch: Route8Branch
): Route8SandboxContent {
    return {
        ...content,
        workingCopies: {
            ...content.workingCopies,
            [branch]: clone(content.sourceCopies[branch]),
        },
    };
}
