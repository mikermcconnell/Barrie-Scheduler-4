import { useEffect, useMemo, useState } from 'react';
import type { DayType } from '../../../utils/parsers/masterScheduleParser';
import type { ConnectionLibrary, ConnectionTime } from '../../../utils/connections/connectionTypes';
import {
    buildDayLibrary,
    deriveRouteTargetTimes,
    findStopNameInTable,
    toDayRouteIdentity,
} from '../../../utils/connections/guidedConnectionSetup';
import { getMasterSchedule } from '../../../utils/services/masterScheduleService';
import type { RouteIdentity } from '../../../utils/masterScheduleTypes';

/**
 * The team library with route-to-route targets re-read for one day type
 * (e.g. Route 8A's Saturday master), so a target built on Weekday still has
 * the right times on Saturday.
 */
export const useDayConnectionLibrary = (
    library: ConnectionLibrary | null,
    teamId: string | undefined,
    dayType: DayType
): ConnectionLibrary | null => {
    const [dayTimes, setDayTimes] = useState<Record<string, ConnectionTime[] | undefined>>({});
    const routeTargetKey = useMemo(() => (
        (library?.targets ?? [])
            .filter(target => target.type === 'route' && target.routeIdentity)
            .map(target => `${target.id}|${target.routeIdentity}|${target.direction ?? ''}|${target.stopCode}`)
            .join(',')
    ), [library]);

    useEffect(() => {
        if (!library || !teamId) return;
        const routeTargets = library.targets.filter(target => target.type === 'route' && target.routeIdentity);
        if (routeTargets.length === 0) {
            setDayTimes({});
            return;
        }
        let cancelled = false;
        const masters = new Map<string, ReturnType<typeof getMasterSchedule>>();
        Promise.all(routeTargets.map(async target => {
            const id = toDayRouteIdentity(target.routeIdentity!, dayType);
            if (!masters.has(id)) masters.set(id, getMasterSchedule(teamId, id as RouteIdentity).catch((): null => null));
            const master = await masters.get(id)!;
            const table = master ? (target.direction === 'South' ? master.content.southTable : master.content.northTable) : null;
            const stopName = table ? findStopNameInTable(table, target) : null;
            // No master for the day: an empty list, so Weekday times are not used on Saturday.
            return [target.id, table && stopName ? deriveRouteTargetTimes(table, stopName, dayType) : []] as const;
        })).then(entries => {
            if (!cancelled) setDayTimes(Object.fromEntries(entries));
        });
        return () => { cancelled = true; };
        // routeTargetKey stands in for the route targets of the library.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [routeTargetKey, teamId, dayType]);

    return useMemo(() => (library ? buildDayLibrary(library, dayType, dayTimes) : null), [library, dayType, dayTimes]);
};
