export const DETOUR_TIME_ZONE = 'America/Toronto' as const;

export type DetourNoticeType = 'route-detour' | 'stop-closure';
export type DetourNoticeStatus = 'draft' | 'posted' | 'archived';
export type DetourLifecycleState = 'draft' | 'upcoming' | 'active' | 'expired' | 'archived';
export type DetourDay = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export interface DetourCoordinate {
    latitude: number;
    longitude: number;
}

export interface DetourLineGeometry {
    coordinates: DetourCoordinate[];
    source: 'gtfs' | 'road-snapped' | 'manual';
    manualRoutingAcknowledged: boolean;
}

/** Stable position on the snapshotted route, including loop-safe segment placement. */
export interface DetourRouteAnchorSnapshot {
    segmentIndex: number;
    fraction: number;
    coordinate: DetourCoordinate;
}

export interface DetourMapLabel {
    id: string;
    text: string;
    position: DetourCoordinate;
}

export type DetourStreetLabelPath = 'closure' | 'detour';

/** Public, path-aware street wording kept separate from free-form map callouts. */
export interface DetourStreetLabel {
    id: string;
    path: DetourStreetLabelPath;
    streetName: string;
    position: DetourCoordinate;
    source: 'mapbox' | 'planner';
    confirmed: boolean;
    visible: boolean;
}

export interface DetourGtfsStopSnapshot {
    stopId: string;
    stopCode?: string;
    name: string;
    position: DetourCoordinate;
    sequence: number;
}

/** Immutable copy of the GTFS facts used to author an overlay. */
export interface DetourGtfsRouteSnapshot {
    feedId?: string;
    importedAt: string;
    routeId: string;
    routeShortName: string;
    routeLongName?: string;
    routeColor: string;
    tripId?: string;
    serviceId?: string;
    directionId?: 0 | 1;
    directionLabel: string;
    isLoop: boolean;
    headsign?: string;
    originalGeometry: DetourCoordinate[];
    stops: DetourGtfsStopSnapshot[];
}

export type DetourStopImpactStatus = 'open' | 'closed' | 'temporary';

export interface DetourStopImpact {
    id: string;
    sourceStop?: DetourGtfsStopSnapshot;
    status: DetourStopImpactStatus;
    suggestedStatus?: DetourStopImpactStatus;
    reviewed: boolean;
    temporaryStopName?: string;
    temporaryStopCode?: string;
    temporaryStopPosition?: DetourCoordinate;
    replacementStopId?: string;
    riderInstructions?: string;
}

export interface DetourRouteOverlay {
    id: string;
    routeSnapshot: DetourGtfsRouteSnapshot;
    closureStart: DetourRouteAnchorSnapshot | null;
    closureEnd: DetourRouteAnchorSnapshot | null;
    /** Sparse planner-created interior control points for the public closed-section line. */
    closureWaypoints: DetourCoordinate[];
    closureGeometry: DetourLineGeometry;
    /** Planner-authored control points; distinct from dense road-snapped geometry vertices. */
    detourWaypoints: DetourCoordinate[];
    detourGeometry: DetourLineGeometry;
    /** Optional planner placement for the public route-number label, snapped to the detour line. */
    routeLabelPosition?: DetourCoordinate;
    /** Confirmed labels publish as NO SERVICE ON or DETOUR VIA wording. */
    streetLabels?: DetourStreetLabel[];
    labels: DetourMapLabel[];
    stopImpacts: DetourStopImpact[];
    busSuitabilityConfirmed: boolean;
    labelCollisionAcknowledged?: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface DetourStopClosureDetails {
    closedStop: DetourGtfsStopSnapshot | null;
    replacementStop: DetourGtfsStopSnapshot | null;
    walkingGeometry?: DetourLineGeometry;
    walkingDistanceMetres?: number;
    instructions: string;
}

export type DetourEnd =
    | { mode: 'fixed'; date: string; time: string }
    | { mode: 'until-further-notice' }
    | { mode: 'until-construction-complete' };

export type DetourRecurrence =
    | { mode: 'continuous' }
    | { mode: 'weekly'; days: DetourDay[]; startTime: string; endTime: string };

export interface DetourEffectiveSchedule {
    timeZone: typeof DETOUR_TIME_ZONE;
    startDate: string;
    startTime: string;
    end: DetourEnd;
    recurrence: DetourRecurrence;
}

export interface DetourMapFrame {
    center: DetourCoordinate;
    zoom: number;
    bearing: number;
    pitch: number;
}

export interface DetourPublication {
    id: string;
    noticeId: string;
    revision: number;
    exportedAt: Date;
    exportedBy: string;
    postedAt: Date;
    postedBy: string;
    myRideUrl: string;
    filenames: {
        pdf: string;
        png: string;
    };
}

export interface DetourNotice {
    id: string;
    teamId: string;
    type: DetourNoticeType;
    status: DetourNoticeStatus;
    title: string;
    reason: string;
    publicSummary: string;
    publicDetails: string;
    affectedRouteTags: string[];
    schedule: DetourEffectiveSchedule;
    mapFrame: DetourMapFrame;
    stopClosure?: DetourStopClosureDetails;
    revision: number;
    createdAt: Date;
    createdBy: string;
    updatedAt: Date;
    updatedBy: string;
    overlays: DetourRouteOverlay[];
    publications: DetourPublication[];
}

export interface DetourDerivedState {
    lifecycle: DetourLifecycleState;
    updateNeeded: boolean;
    latestPostedRevision: number | null;
}

export interface DetourValidationIssue {
    code: string;
    message: string;
    path?: string;
}

export interface DetourValidationResult {
    errors: DetourValidationIssue[];
    warnings: DetourValidationIssue[];
    canExport: boolean;
}

export interface DetourNoticeSummary extends Omit<DetourNotice, 'overlays' | 'publications'> {
    overlayCount: number;
    latestPostedRevision: number | null;
}
