import {
    DETOUR_TIME_ZONE,
    type DetourEffectiveSchedule,
    type DetourMapFrame,
    type DetourNotice,
    type DetourNoticeType,
    type DetourGtfsRouteSnapshot,
    type DetourRouteOverlay,
} from './detourTypes';

export interface CreateDetourNoticeOptions {
    id?: string;
    teamId: string;
    userId: string;
    type?: DetourNoticeType;
    now?: Date;
}

const localDate = (date: Date): string => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: DETOUR_TIME_ZONE,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find(part => part.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
};

export const createDefaultDetourSchedule = (now = new Date()): DetourEffectiveSchedule => {
    return {
        timeZone: DETOUR_TIME_ZONE,
        startDate: localDate(now),
        startTime: '',
        end: { mode: 'until-further-notice' },
        recurrence: { mode: 'continuous' },
    };
};

export const DEFAULT_DETOUR_MAP_FRAME: DetourMapFrame = {
    center: { latitude: 44.3894, longitude: -79.6903 },
    zoom: 12,
    bearing: 0,
    pitch: 0,
};

export const createDetourNotice = (options: CreateDetourNoticeOptions): DetourNotice => {
    const now = options.now ?? new Date();
    return {
        id: options.id ?? '',
        teamId: options.teamId,
        type: options.type ?? 'route-detour',
        status: 'draft',
        title: '',
        reason: '',
        publicSummary: '',
        publicDetails: '',
        affectedRouteTags: [],
        schedule: createDefaultDetourSchedule(now),
        mapFrame: { ...DEFAULT_DETOUR_MAP_FRAME, center: { ...DEFAULT_DETOUR_MAP_FRAME.center } },
        ...(options.type === 'stop-closure' ? {
            stopClosure: { closedStop: null, replacementStop: null, instructions: '' },
        } : {}),
        revision: 0,
        createdAt: now,
        createdBy: options.userId,
        updatedAt: now,
        updatedBy: options.userId,
        overlays: [],
        publications: [],
    };
};

export const createDetourRouteOverlay = (
    id: string,
    routeSnapshot: DetourGtfsRouteSnapshot,
    now = new Date(),
): DetourRouteOverlay => ({
    id,
    routeSnapshot,
    closureStart: null,
    closureEnd: null,
    closureWaypoints: [],
    closureGeometry: { coordinates: [], source: 'gtfs', manualRoutingAcknowledged: false },
    detourWaypoints: [],
    detourGeometry: { coordinates: [], source: 'road-snapped', manualRoutingAcknowledged: false },
    streetLabels: [],
    labels: [],
    stopImpacts: [],
    busSuitabilityConfirmed: false,
    createdAt: now,
    updatedAt: now,
});
