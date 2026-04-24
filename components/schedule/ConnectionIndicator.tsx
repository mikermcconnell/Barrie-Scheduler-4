/**
 * ConnectionIndicator Component
 *
 * Displays connection status indicators in schedule table cells.
 * Uses per-connection colored tokens in-grid and exposes full details in a hover/focus popover.
 */

import React, { useId } from 'react';
import { Clock } from 'lucide-react';
import type { ConnectionMatch } from '../../utils/connections/connectionUtils';
import { formatGapTimeForEvent } from '../../utils/connections/connectionUtils';

interface ConnectionIndicatorProps {
    connections: ConnectionMatch[];
    popoverAlign?: 'left' | 'center' | 'right';
}

function getQualityRank(quality: ConnectionMatch['quality']): number {
    switch (quality) {
        case 'bad':
            return 0;
        case 'good':
            return 1;
        case 'excellent':
        default:
            return 2;
    }
}

function sortConnectionsForDisplay(connections: ConnectionMatch[]): ConnectionMatch[] {
    return [...connections].sort((a, b) => {
        if (a.meetsConnection !== b.meetsConnection) {
            return a.meetsConnection ? 1 : -1;
        }

        const qualityDiff = getQualityRank(a.quality) - getQualityRank(b.quality);
        if (qualityDiff !== 0) {
            return qualityDiff;
        }

        return Math.abs(a.gapMinutes) - Math.abs(b.gapMinutes);
    });
}

function formatCompactGap(gapMinutes: number): string {
    const absGap = Math.abs(gapMinutes);
    if (gapMinutes === 0) return '0m';
    return `${gapMinutes > 0 ? '+' : '-'}${absGap}m`;
}

function getEventWord(eventType: ConnectionMatch['eventType']): string {
    return eventType === 'arrival' ? 'arrival' : 'departure';
}

function getTargetTypeLabel(iconType: ConnectionMatch['icon']): string {
    switch (iconType) {
        case 'train':
            return 'Train';
        case 'bus':
            return 'Route';
        case 'clock':
        default:
            return 'Bell';
    }
}

function getConnectionKindLabel(connection: ConnectionMatch): string {
    return `${getTargetTypeLabel(connection.icon)} ${getEventWord(connection.eventType)}`;
}

function getBusAnchorLabel(busAnchor: ConnectionMatch['busAnchor']): 'ARR' | 'DEP' {
    return busAnchor === 'arrival' ? 'ARR' : 'DEP';
}

function getConnectionTone(connection: ConnectionMatch) {
    if (!connection.meetsConnection) {
        return 'border-red-200 bg-red-500 text-white';
    }

    if (connection.quality === 'excellent') {
        return 'border-green-200 bg-green-500 text-white';
    }

    return 'border-amber-200 bg-amber-500 text-white';
}

function getDetailTone(connection: ConnectionMatch) {
    if (!connection.meetsConnection) {
        return 'border-red-200 bg-red-50 text-red-700';
    }

    if (connection.quality === 'excellent') {
        return 'border-green-100 bg-green-50 text-green-700';
    }

    return 'border-amber-100 bg-amber-50 text-amber-700';
}

function getStatusLabel(connection: ConnectionMatch): string {
    if (!connection.meetsConnection) return 'Missed';
    return connection.quality === 'excellent' ? 'Excellent' : 'Good';
}

function buildTitle(connections: ConnectionMatch[]): string {
    return connections
        .map(connection => {
            const status = connection.meetsConnection ? connection.quality : 'missed';
            return `${connection.targetName} | ${connection.targetTimeLabel} | ${formatGapTimeForEvent(connection.gapMinutes, connection.eventType)} | ${status}`;
        })
        .join('\n');
}

function buildAriaLabel(connections: ConnectionMatch[]): string {
    const detailText = connections
        .map(connection => `${connection.targetShortLabel || getTargetTypeLabel(connection.icon)}, ${connection.targetName}, ${getConnectionKindLabel(connection)}, shown on ${getBusAnchorLabel(connection.busAnchor)}, ${connection.targetTimeLabel}, ${formatGapTimeForEvent(connection.gapMinutes, connection.eventType)}`)
        .join('. ');

    return `${connections.length} connection${connections.length === 1 ? '' : 's'}. ${detailText}`;
}

function getPopoverPositionClasses(popoverAlign: 'left' | 'center' | 'right'): string {
    switch (popoverAlign) {
        case 'left':
            return 'left-0 translate-x-0';
        case 'right':
            return 'right-0 left-auto translate-x-0';
        case 'center':
        default:
            return 'left-1/2 -translate-x-1/2';
    }
}

function getConnectionKey(connection: ConnectionMatch): string {
    return [
        connection.connectionId || connection.targetId,
        connection.targetTime,
        connection.eventType,
        connection.busAnchor
    ].join('-');
}

function renderTokenContent(connection: ConnectionMatch) {
    if (connection.icon === 'clock') {
        return <Clock size={11} aria-hidden="true" />;
    }

    return <span className="truncate leading-none">{connection.targetShortLabel || (connection.icon === 'train' ? 'GO' : '?')}</span>;
}

export const ConnectionIndicator: React.FC<ConnectionIndicatorProps> = ({
    connections,
    popoverAlign = 'center'
}) => {
    const tooltipId = useId();

    if (!connections || connections.length === 0) return null;

    const orderedConnections = sortConnectionsForDisplay(connections);
    const titleText = buildTitle(orderedConnections);
    const ariaLabel = buildAriaLabel(orderedConnections);
    const missedCount = orderedConnections.filter(connection => !connection.meetsConnection).length;
    const metCount = orderedConnections.length - missedCount;
    const popoverPositionClasses = getPopoverPositionClasses(popoverAlign);

    return (
        <div className="group/connection relative mt-0.5 flex justify-center">
            <button
                type="button"
                className="inline-flex max-w-full items-center justify-center gap-1 rounded-md px-0.5 py-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300"
                title={titleText}
                aria-label={ariaLabel}
                aria-describedby={tooltipId}
            >
                <span className="inline-flex max-w-full flex-wrap items-center justify-center gap-1">
                    {orderedConnections.map(connection => (
                        <span
                            key={getConnectionKey(connection)}
                            className={`inline-flex h-5 min-w-5 max-w-[36px] items-center justify-center rounded-full border px-1 text-[9px] font-bold shadow-sm ${getConnectionTone(connection)}`}
                            aria-hidden="true"
                        >
                            {renderTokenContent(connection)}
                        </span>
                    ))}
                </span>
            </button>

            <div
                id={tooltipId}
                role="tooltip"
                className={`pointer-events-none absolute top-full z-50 mt-1 w-72 rounded-xl border border-gray-200 bg-white p-2 text-left opacity-0 shadow-xl transition-opacity duration-150 group-hover/connection:opacity-100 group-focus-within/connection:opacity-100 ${popoverPositionClasses}`}
            >
                <div className="mb-1 flex items-center justify-between gap-2 border-b border-gray-100 pb-1">
                    <span className="text-[11px] font-semibold text-gray-900">
                        {orderedConnections.length === 1 ? 'Connection detail' : `${orderedConnections.length} connections`}
                    </span>
                    <div className="flex items-center gap-1">
                        {missedCount > 0 && (
                            <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                                {missedCount} missed
                            </span>
                        )}
                        {metCount > 0 && (
                            <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">
                                {metCount} met
                            </span>
                        )}
                    </div>
                </div>

                <div className="space-y-1.5">
                    {orderedConnections.map(connection => {
                        const detailTone = getDetailTone(connection);
                        return (
                            <div
                                key={getConnectionKey(connection)}
                                className={`rounded-lg border px-2 py-1 ${!connection.meetsConnection ? 'bg-red-50/90 shadow-sm shadow-red-100/60' : 'border-gray-100 bg-gray-50/80'}`}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 text-[11px] font-semibold text-gray-900">
                                            <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1 text-[9px] font-bold shadow-sm ${getConnectionTone(connection)}`}>
                                                {renderTokenContent(connection)}
                                            </span>
                                            <span className="truncate">{connection.targetName}</span>
                                        </div>
                                        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-gray-600">
                                            <span className="rounded-full bg-gray-100 px-1.5 py-0.5 font-medium text-gray-700">
                                                {getConnectionKindLabel(connection)}
                                            </span>
                                            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">
                                                Shown on {getBusAnchorLabel(connection.busAnchor)}
                                            </span>
                                            <span>{connection.targetTimeLabel}</span>
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 flex-col items-end gap-1">
                                        <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${detailTone}`}>
                                            {getStatusLabel(connection)}
                                        </span>
                                        <span className="text-[10px] font-semibold text-gray-700">
                                            {formatCompactGap(connection.gapMinutes)}
                                        </span>
                                    </div>
                                </div>
                                <div className="mt-1 text-[10px] text-gray-700">
                                    {formatGapTimeForEvent(connection.gapMinutes, connection.eventType)}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
