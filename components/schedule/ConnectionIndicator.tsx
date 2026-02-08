/**
 * ConnectionIndicator Component
 *
 * Displays connection status indicators in schedule table cells.
 * Shows icon + gap time (e.g., "5 min early" or "3 min late").
 */

import React from 'react';
import { Clock, Train, Bus } from 'lucide-react';
import type { ConnectionMatch } from '../../utils/connectionUtils';
import { formatGapTimeForEvent, getGapClasses } from '../../utils/connectionUtils';

interface ConnectionIndicatorProps {
    connections: ConnectionMatch[];
}

/**
 * Get the icon component for a connection type.
 */
function getIcon(iconType: 'train' | 'clock' | 'bus') {
    switch (iconType) {
        case 'train':
            return <Train size={10} className="flex-shrink-0" />;
        case 'bus':
            return <Bus size={10} className="flex-shrink-0" />;
        case 'clock':
        default:
            return <Clock size={10} className="flex-shrink-0" />;
    }
}

export const ConnectionIndicator: React.FC<ConnectionIndicatorProps> = ({ connections }) => {
    if (!connections || connections.length === 0) return null;

    // Show the closest connection (first in sorted array)
    const primary = connections[0];
    const hasMore = connections.length > 1;

    const gapText = formatGapTimeForEvent(primary.gapMinutes, primary.eventType);
    const colorClasses = getGapClasses(primary.meetsConnection, primary.quality);
    const bgClass = !primary.meetsConnection
        ? 'bg-red-50'
        : primary.quality === 'excellent'
            ? 'bg-green-50'
            : primary.quality === 'good'
                ? 'bg-amber-50'
                : 'bg-red-50';

    // Build tooltip text
    let tooltipText = `${primary.targetName}\n${primary.targetTimeLabel}\n${primary.eventType}\n${gapText}\n${primary.quality}`;
    if (hasMore) {
        tooltipText += `\n\n+${connections.length - 1} more:`;
        connections.slice(1).forEach(conn => {
            tooltipText += `\n• ${conn.targetName} (${formatGapTimeForEvent(conn.gapMinutes, conn.eventType)})`;
        });
    }

    return (
        <div
            className={`flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium ${colorClasses} ${bgClass} whitespace-nowrap cursor-help`}
            title={tooltipText}
        >
            {getIcon(primary.icon)}
            <span className="truncate max-w-[60px]">{gapText}</span>
            {hasMore && (
                <span className="text-gray-400 ml-0.5">+{connections.length - 1}</span>
            )}
        </div>
    );
};
