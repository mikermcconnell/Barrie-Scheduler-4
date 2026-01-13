/**
 * ConnectionBadge
 *
 * Displays connection status badges on trips in the schedule editor.
 * Shows whether a trip meets its connection targets (GO trains, College bells, etc).
 */

import React from 'react';
import { Train, Clock, Bus, ArrowRight, ArrowLeft } from 'lucide-react';
import type { ExternalConnection } from '../../utils/connectionTypes';
import { formatConnectionTime } from '../../utils/connectionTypes';

interface ConnectionBadgeProps {
    connection: ExternalConnection;
    compact?: boolean;
}

/**
 * Single connection badge showing status and gap.
 */
export const ConnectionBadge: React.FC<ConnectionBadgeProps> = ({
    connection,
    compact = false
}) => {
    const { meetsConnection, gapMinutes, targetName, connectionType } = connection;

    // Determine colors based on status
    const bgColor = meetsConnection ? 'bg-green-100' : 'bg-red-100';
    const textColor = meetsConnection ? 'text-green-700' : 'text-red-700';

    // Determine icon based on target name
    const getIcon = () => {
        const name = targetName.toLowerCase();
        if (name.includes('go') || name.includes('train')) {
            return Train;
        }
        if (name.includes('bell') || name.includes('college') || name.includes('school')) {
            return Clock;
        }
        if (name.includes('route')) {
            return Bus;
        }
        return connectionType === 'meet_departing' ? ArrowRight : ArrowLeft;
    };

    const Icon = getIcon();

    // Format gap display
    const gapStr = gapMinutes >= 0 ? `+${gapMinutes}` : String(gapMinutes);

    // Get short name for compact display
    const shortName = targetName.length > 10
        ? targetName.substring(0, 8) + '...'
        : targetName;

    if (compact) {
        return (
            <span
                className={`inline-flex items-center gap-0.5 px-1 py-0.5 ${bgColor} ${textColor} rounded text-[8px] font-medium`}
                title={`${targetName} at ${formatConnectionTime(connection.targetTime)} - ${meetsConnection ? 'Met' : 'Missed'} (${gapStr}m)`}
            >
                <Icon size={8} />
                {gapStr}
            </span>
        );
    }

    return (
        <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 ${bgColor} ${textColor} rounded text-[9px] font-medium`}
            title={`${targetName} at ${formatConnectionTime(connection.targetTime)}`}
        >
            <Icon size={10} />
            <span>{shortName}</span>
            <span className="font-mono">{gapStr}m</span>
        </span>
    );
};

interface ConnectionBadgeGroupProps {
    connections: ExternalConnection[];
    maxVisible?: number;
}

/**
 * Group of connection badges for a single trip.
 */
export const ConnectionBadgeGroup: React.FC<ConnectionBadgeGroupProps> = ({
    connections,
    maxVisible = 3
}) => {
    if (!connections || connections.length === 0) {
        return null;
    }

    const visibleConnections = connections.slice(0, maxVisible);
    const hiddenCount = connections.length - maxVisible;

    // Count met/missed
    const metCount = connections.filter(c => c.meetsConnection).length;
    const missedCount = connections.length - metCount;

    return (
        <div className="flex flex-wrap gap-0.5 justify-center">
            {visibleConnections.map((conn, idx) => (
                <ConnectionBadge key={idx} connection={conn} compact={connections.length > 2} />
            ))}
            {hiddenCount > 0 && (
                <span
                    className="inline-flex items-center px-1 py-0.5 bg-gray-100 text-gray-600 rounded text-[8px] font-medium"
                    title={`${hiddenCount} more connection(s): ${metCount} met, ${missedCount} missed`}
                >
                    +{hiddenCount}
                </span>
            )}
        </div>
    );
};

/**
 * Summary badge showing overall connection status for a trip.
 */
export const ConnectionSummaryBadge: React.FC<{ connections: ExternalConnection[] }> = ({
    connections
}) => {
    if (!connections || connections.length === 0) {
        return <span className="text-gray-300 text-xs">-</span>;
    }

    const metCount = connections.filter(c => c.meetsConnection).length;
    const total = connections.length;
    const allMet = metCount === total;

    const bgColor = allMet ? 'bg-green-100' : metCount > 0 ? 'bg-amber-100' : 'bg-red-100';
    const textColor = allMet ? 'text-green-700' : metCount > 0 ? 'text-amber-700' : 'text-red-700';

    return (
        <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 ${bgColor} ${textColor} rounded text-[9px] font-medium`}
            title={`${metCount} of ${total} connections met`}
        >
            {metCount}/{total}
        </span>
    );
};

export default ConnectionBadge;
