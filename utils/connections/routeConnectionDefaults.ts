import type {
    ConnectionTarget,
    ConnectionTime,
    ConnectionType,
    RouteConnection,
    StopInfo
} from './connectionTypes';
import { formatConnectionTime } from './connectionTypes';
import type { DayType } from '../parsers/masterScheduleParser';

const normalizeText = (value?: string): string =>
    value?.trim().toLowerCase().replace(/\s+/g, ' ') || '';

export function getDefaultConnectionTypeForTarget(
    target: Pick<ConnectionTarget, 'defaultEventType'>
): ConnectionType {
    return target.defaultEventType === 'arrival' ? 'feed_arriving' : 'meet_departing';
}

export function getBusConnectionAnchorForConnectionType(
    connectionType: ConnectionType
): 'arrival' | 'departure' {
    return connectionType === 'meet_departing' ? 'arrival' : 'departure';
}

export function getBusConnectionAnchorLabel(
    connectionType: ConnectionType
): 'Bus arrival' | 'Bus departure' {
    return getBusConnectionAnchorForConnectionType(connectionType) === 'arrival'
        ? 'Bus arrival'
        : 'Bus departure';
}

export function getConnectionIntentLabel(
    connectionType: ConnectionType,
    targetLabel = 'this service'
): string {
    return connectionType === 'meet_departing'
        ? `To ${targetLabel}`
        : `From ${targetLabel}`;
}

export function getConnectionRuleSummary(
    connectionType: ConnectionType,
    bufferMinutes: number,
    targetEventType: 'departure' | 'arrival' = 'arrival'
): string {
    if (connectionType === 'meet_departing') {
        return `${getBusConnectionAnchorLabel(connectionType)} ${bufferMinutes} min before departure`;
    }
    return `${getBusConnectionAnchorLabel(connectionType)} ${bufferMinutes} min after ${targetEventType === 'departure' ? 'departure' : 'arrival'}`;
}

export function suggestRouteConnectionStopCode(
    target: Pick<ConnectionTarget, 'stopCode' | 'stopName' | 'location'>,
    availableStops: StopInfo[]
): string {
    const directMatch = availableStops.find(stop => stop.code === target.stopCode);
    if (directMatch) return directMatch.code;

    const normalizedTargetStopName = normalizeText(target.stopName);
    if (normalizedTargetStopName) {
        const byStopName = availableStops.find(stop => normalizeText(stop.name) === normalizedTargetStopName);
        if (byStopName) return byStopName.code;
    }

    const normalizedLocation = normalizeText(target.location);
    if (normalizedLocation) {
        const containingMatches = availableStops.filter(stop => {
            const stopName = normalizeText(stop.name);
            return stopName.includes(normalizedLocation) || normalizedLocation.includes(stopName);
        });
        if (containingMatches.length === 1) return containingMatches[0].code;
    }

    return availableStops.length === 1 ? availableStops[0].code : '';
}

export function buildRouteConnectionFromTarget(
    target: Pick<ConnectionTarget, 'id' | 'stopCode' | 'stopName' | 'location' | 'defaultEventType'>,
    availableStops: StopInfo[],
    priority: number
): Omit<RouteConnection, 'id'> | null {
    const stopCode = suggestRouteConnectionStopCode(target, availableStops);
    if (!stopCode) return null;

    const stopInfo = availableStops.find(stop => stop.code === stopCode);
    return {
        targetId: target.id,
        connectionType: getDefaultConnectionTypeForTarget(target),
        bufferMinutes: 5,
        stopCode,
        stopName: stopInfo?.name,
        priority,
        enabled: true
    };
}

export interface RouteAttachmentPreview {
    canAttach: boolean;
    connectionType: ConnectionType;
    ruleSummary: string;
    stopCode: string;
    stopName?: string;
    activeEventCount: number;
    activeEventPreview: string[];
}

export function buildRouteAttachmentPreview(
    target: Pick<ConnectionTarget, 'stopCode' | 'stopName' | 'location' | 'defaultEventType' | 'times'>,
    availableStops: StopInfo[],
    dayType: DayType,
    bufferMinutes = 5
): RouteAttachmentPreview {
    const connectionType = getDefaultConnectionTypeForTarget(target);
    const stopCode = suggestRouteConnectionStopCode(target, availableStops);
    const stopName = availableStops.find(stop => stop.code === stopCode)?.name;
    const activeTimes = (target.times || []).filter(time => time.enabled && time.daysActive.includes(dayType));

    const formatPreviewTime = (time: ConnectionTime): string => {
        const eventType = time.eventType || target.defaultEventType || 'departure';
        const suffix = eventType === 'arrival' ? 'ARR' : 'DEP';
        return `${formatConnectionTime(time.time)} ${suffix}`;
    };

    return {
        canAttach: !!stopCode,
        connectionType,
        ruleSummary: getConnectionRuleSummary(connectionType, bufferMinutes, target.defaultEventType || 'departure'),
        stopCode,
        stopName,
        activeEventCount: activeTimes.length,
        activeEventPreview: activeTimes.slice(0, 3).map(formatPreviewTime)
    };
}
