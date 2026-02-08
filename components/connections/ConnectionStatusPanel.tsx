/**
 * ConnectionStatusPanel
 *
 * Shared component that displays the current status of connection optimization.
 * Shows a progress bar and detailed gap table for configured connections.
 * Used in both New Schedule wizard (Step 5) and Schedule Editor.
 */

import React, { useState } from 'react';
import {
    ChevronDown,
    ChevronUp,
    CheckCircle2,
    XCircle,
    AlertCircle,
    Loader2,
    Settings2
} from 'lucide-react';
import type { ConnectionCheckResult } from '../../utils/connectionOptimizer';
import { formatConnectionTime } from '../../utils/connectionTypes';

interface ConnectionStatusPanelProps {
    checkResult: ConnectionCheckResult | null;
    isLoading: boolean;
    onConfigureClick?: () => void;
    compact?: boolean; // For embedded use in Schedule Editor
}

export const ConnectionStatusPanel: React.FC<ConnectionStatusPanelProps> = ({
    checkResult,
    isLoading,
    onConfigureClick,
    compact = false
}) => {
    const [isExpanded, setIsExpanded] = useState(!compact);

    // No connections configured
    if (!checkResult || checkResult.totalConnections === 0) {
        return (
            <div className={`bg-gray-50 border border-gray-200 rounded-lg ${compact ? 'p-3' : 'p-4'}`}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-gray-500">
                        <AlertCircle className="w-4 h-4" />
                        <span className="text-sm">No connections configured</span>
                    </div>
                    {onConfigureClick && (
                        <button
                            onClick={onConfigureClick}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 transition-colors"
                        >
                            <Settings2 className="w-3.5 h-3.5" />
                            Configure
                        </button>
                    )}
                </div>
            </div>
        );
    }

    const { totalConnections, connectionsMet, connectionsMissed, gaps } = checkResult;
    const percentageMet = totalConnections > 0 ? (connectionsMet / totalConnections) * 100 : 0;

    // Determine status color
    const getStatusColor = () => {
        if (percentageMet === 100) return 'bg-green-500';
        if (percentageMet >= 75) return 'bg-green-400';
        if (percentageMet >= 50) return 'bg-yellow-400';
        return 'bg-red-400';
    };

    const getStatusTextColor = () => {
        if (percentageMet === 100) return 'text-green-700';
        if (percentageMet >= 75) return 'text-green-600';
        if (percentageMet >= 50) return 'text-yellow-600';
        return 'text-red-600';
    };

    return (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            {/* Header */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className={`w-full flex items-center justify-between ${compact ? 'px-3 py-2' : 'px-4 py-3'} bg-gray-50 hover:bg-gray-100 transition-colors`}
            >
                <div className="flex items-center gap-3">
                    <span className={`${compact ? 'text-sm' : 'text-base'} font-medium text-gray-900`}>
                        Connection Status
                    </span>
                    {isLoading ? (
                        <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                    ) : (
                        <span className={`text-sm font-semibold ${getStatusTextColor()}`}>
                            {connectionsMet} of {totalConnections} met
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {onConfigureClick && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onConfigureClick();
                            }}
                            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        >
                            <Settings2 className="w-3.5 h-3.5" />
                        </button>
                    )}
                    {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-gray-400" />
                    ) : (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                    )}
                </div>
            </button>

            {/* Progress Bar */}
            <div className={`${compact ? 'px-3 py-2' : 'px-4 py-3'} border-t border-gray-100`}>
                <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                    <div
                        className={`h-full ${getStatusColor()} transition-all duration-500 ease-out`}
                        style={{ width: `${percentageMet}%` }}
                    />
                </div>
                <div className="flex justify-between mt-1.5 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-green-500" />
                        {connectionsMet} met
                    </span>
                    <span className="flex items-center gap-1">
                        <XCircle className="w-3 h-3 text-red-500" />
                        {connectionsMissed} missed
                    </span>
                </div>
            </div>

            {/* Expanded Gap Table */}
            {isExpanded && gaps.length > 0 && (
                <div className={`border-t border-gray-100 ${compact ? 'max-h-64' : 'max-h-96'} overflow-auto`}>
                    <table className="w-full text-xs">
                        <thead className="bg-gray-50 sticky top-0">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium text-gray-600">Target</th>
                                <th className="px-3 py-2 text-left font-medium text-gray-600">Stop</th>
                                <th className="px-3 py-2 text-center font-medium text-gray-600">Target</th>
                                <th className="px-3 py-2 text-center font-medium text-gray-600">Trip</th>
                                <th className="px-3 py-2 text-center font-medium text-gray-600">Gap</th>
                                <th className="px-3 py-2 text-center font-medium text-gray-600">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {gaps.map((gap, idx) => (
                                <tr
                                    key={`${gap.tripId}-${idx}`}
                                    className={gap.meetsConnection ? 'bg-green-50/50' : 'bg-red-50/50'}
                                >
                                    <td className="px-3 py-2 text-gray-900 font-medium truncate max-w-[120px]" title={gap.targetName}>
                                        {gap.targetName}
                                    </td>
                                    <td className="px-3 py-2 text-gray-600 truncate max-w-[120px]" title={gap.stopName ? `${gap.stopName} (#${gap.stopCode})` : `#${gap.stopCode}`}>
                                        {gap.stopName || `#${gap.stopCode}`}
                                        {gap.stopCode && <span className="text-gray-400 text-[10px] ml-1">#{gap.stopCode}</span>}
                                    </td>
                                    <td className="px-3 py-2 text-center text-gray-700">
                                        {formatConnectionTime(gap.targetTime)}
                                    </td>
                                    <td className="px-3 py-2 text-center text-gray-700">
                                        {formatConnectionTime(gap.tripTime)}
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                                            gap.gapMinutes >= gap.bufferRequired
                                                ? 'bg-green-100 text-green-700'
                                                : gap.gapMinutes >= 0
                                                    ? 'bg-yellow-100 text-yellow-700'
                                                    : 'bg-red-100 text-red-700'
                                        }`}>
                                            {gap.gapMinutes >= 0 ? '+' : ''}{gap.gapMinutes}m
                                        </span>
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        {gap.meetsConnection ? (
                                            <CheckCircle2 className="w-4 h-4 text-green-500 inline" />
                                        ) : (
                                            <XCircle className="w-4 h-4 text-red-500 inline" />
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default ConnectionStatusPanel;
