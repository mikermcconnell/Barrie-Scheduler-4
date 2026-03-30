import type { MasterRouteTable } from '../parsers/masterScheduleParser';

export interface TemplateInitialStopLike {
    code: string;
    name: string;
    enabled: boolean;
}

export interface TemplateInitialDataLike {
    name?: string;
    location?: string;
    stopCode?: string;
    icon?: 'train' | 'clock';
    stops?: TemplateInitialStopLike[];
    autoPopulateStops?: boolean;
}

export interface LoadedStopLike {
    code: string;
    name: string;
}

function trimCode(code: string | undefined): string {
    return (code || '').trim();
}

function buildAvailableStopMap(availableStops: LoadedStopLike[]): Map<string, string> {
    const stopMap = new Map<string, string>();
    availableStops.forEach(stop => {
        const code = trimCode(stop.code);
        if (code && !stopMap.has(code)) {
            stopMap.set(code, stop.name);
        }
    });
    return stopMap;
}

function isGoTemplate(data: TemplateInitialDataLike): boolean {
    const name = (data.name || '').toLowerCase();
    const location = (data.location || '').toLowerCase();
    return data.icon === 'train' && (
        name.includes('go')
        || location.includes('go')
        || name.includes('allandale')
        || location.includes('allandale')
    );
}

function matchGoStopsFromSchedules(
    data: TemplateInitialDataLike,
    schedules: Pick<MasterRouteTable, 'stopIds'>[]
): TemplateInitialStopLike[] {
    const name = (data.name || '').toLowerCase();
    const location = (data.location || '').toLowerCase();
    const wantsBarrieSouth = name.includes('barrie south') || location.includes('barrie south');
    const wantsAllandale = name.includes('allandale') || location.includes('allandale');

    const stopMap = new Map<string, string>();
    for (const table of schedules) {
        Object.entries(table.stopIds || {}).forEach(([stopName, code]) => {
            const trimmedCode = trimCode(code);
            if (!trimmedCode) return;

            const normalizedName = stopName.toLowerCase();
            const isBarrieSouthMatch = normalizedName.includes('barrie south')
                && (normalizedName.includes('terminal') || normalizedName.includes('go'));
            const isAllandaleMatch = normalizedName.includes('allandale')
                && (normalizedName.includes('terminal') || normalizedName.includes('go'));
            const stationMatch = wantsBarrieSouth
                ? isBarrieSouthMatch
                : wantsAllandale
                    ? isAllandaleMatch
                    : (isBarrieSouthMatch || isAllandaleMatch);

            if (stationMatch && !stopMap.has(trimmedCode)) {
                stopMap.set(trimmedCode, stopName);
            }
        });
    }

    return Array.from(stopMap.entries()).map(([code, stopName]) => ({
        code,
        name: stopName,
        enabled: true
    }));
}

export function alignTemplateInitialDataToLoadedStops<T extends TemplateInitialDataLike>(
    data: T,
    availableStops: LoadedStopLike[],
    schedules: Pick<MasterRouteTable, 'stopIds'>[] = []
): T {
    const availableStopMap = buildAvailableStopMap(availableStops);
    const normalizedStopCode = trimCode(data.stopCode);

    if (Array.isArray(data.stops) && data.stops.length > 0) {
        const matchedStops = data.stops
            .map(stop => {
                const code = trimCode(stop.code);
                const loadedName = availableStopMap.get(code);
                if (!loadedName) return null;

                return {
                    ...stop,
                    code,
                    name: loadedName,
                    enabled: stop.enabled
                };
            })
            .filter((stop): stop is TemplateInitialStopLike => !!stop);

        if (matchedStops.length > 0) {
            return {
                ...data,
                stops: matchedStops,
                stopCode: availableStopMap.has(normalizedStopCode) ? normalizedStopCode : matchedStops[0].code,
                autoPopulateStops: true
            };
        }

        return {
            ...data,
            stops: [],
            stopCode: availableStopMap.has(normalizedStopCode) ? normalizedStopCode : '',
            autoPopulateStops: false
        };
    }

    if (!isGoTemplate(data)) {
        return availableStopMap.has(normalizedStopCode)
            ? { ...data, stopCode: normalizedStopCode }
            : data;
    }

    const matchedStops = matchGoStopsFromSchedules(data, schedules);
    if (matchedStops.length === 0) {
        return availableStopMap.has(normalizedStopCode)
            ? { ...data, stopCode: normalizedStopCode }
            : data;
    }

    return {
        ...data,
        stops: matchedStops,
        stopCode: matchedStops[0].code,
        autoPopulateStops: true
    };
}
