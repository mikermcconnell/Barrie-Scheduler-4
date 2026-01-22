/**
 * OptimizationPanel
 *
 * Controls for running connection optimization and viewing results.
 * Supports shift, individual, and hybrid optimization modes.
 */

import React, { useState } from 'react';
import {
    Play,
    RotateCcw,
    Loader2,
    CheckCircle2,
    XCircle,
    ArrowRight,
    TrendingUp,
    TrendingDown,
    Minus,
    Info
} from 'lucide-react';
import type { MasterRouteTable } from '../../../utils/masterScheduleParser';
import type {
    ConnectionLibrary,
    RouteConnectionConfig,
    OptimizationMode,
    OptimizationResult,
    ConnectionReportEntry
} from '../../../utils/connectionTypes';
import { formatConnectionTime } from '../../../utils/connectionTypes';
import { optimizeForConnections } from '../../../utils/connectionOptimizer';

interface OptimizationPanelProps {
    schedules: MasterRouteTable[];
    config: RouteConnectionConfig | null;
    library: ConnectionLibrary | null;
    mode: OptimizationMode;
    onModeChange: (mode: OptimizationMode) => void;
    onOptimize: (result: OptimizationResult) => void;
    onReset: () => void;
    result: OptimizationResult | null;
    isOptimizing: boolean;
    canOptimize: boolean;
}

export const OptimizationPanel: React.FC<OptimizationPanelProps> = ({
    schedules,
    config,
    library,
    mode,
    onModeChange,
    onOptimize,
    onReset,
    result,
    isOptimizing,
    canOptimize
}) => {
    const [previewShift, setPreviewShift] = useState(0);

    // Mode descriptions
    const modeDescriptions: Record<OptimizationMode, string> = {
        shift: 'Shift all trips by the same amount to best meet connections',
        individual: 'Adjust individual trips to meet their specific connections',
        hybrid: 'Shift first, then fine-tune individual trips (recommended)'
    };

    // Run optimization using the real optimizer
    const handleOptimize = async () => {
        if (!config || !library || !canOptimize) return;

        try {
            const result = optimizeForConnections(
                schedules,
                config,
                library,
                mode
            );
            onOptimize(result);
        } catch (error) {
            console.error('Optimization failed:', error);
        }
    };

    // Get status icon for report entry
    const getStatusIcon = (status: ConnectionReportEntry['status']) => {
        switch (status) {
            case 'met':
                return <CheckCircle2 className="w-4 h-4 text-green-500" />;
            case 'improved':
                return <TrendingUp className="w-4 h-4 text-blue-500" />;
            case 'worsened':
                return <TrendingDown className="w-4 h-4 text-orange-500" />;
            case 'missed':
                return <XCircle className="w-4 h-4 text-red-500" />;
            default:
                return <Minus className="w-4 h-4 text-gray-400" />;
        }
    };

    return (
        <div className="divide-y divide-gray-100">
            {/* Mode selector */}
            <div className="p-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                    Optimization Mode
                </label>
                <div className="grid grid-cols-3 gap-2">
                    {(['shift', 'individual', 'hybrid'] as OptimizationMode[]).map(m => (
                        <button
                            key={m}
                            onClick={() => onModeChange(m)}
                            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                mode === m
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                        >
                            {m.charAt(0).toUpperCase() + m.slice(1)}
                            {m === 'hybrid' && (
                                <span className="ml-1 text-xs opacity-75">★</span>
                            )}
                        </button>
                    ))}
                </div>
                <p className="mt-2 text-xs text-gray-500">
                    {modeDescriptions[mode]}
                </p>
            </div>

            {/* Shift preview (for shift/hybrid modes) */}
            {(mode === 'shift' || mode === 'hybrid') && (
                <div className="p-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        Schedule Shift Preview
                    </label>
                    <div className="flex items-center gap-4">
                        <input
                            type="range"
                            min={-30}
                            max={30}
                            value={previewShift}
                            onChange={(e) => setPreviewShift(parseInt(e.target.value))}
                            className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                        />
                        <div className="w-20 text-center">
                            <span className={`text-lg font-mono font-bold ${
                                previewShift > 0 ? 'text-green-600' :
                                previewShift < 0 ? 'text-red-600' : 'text-gray-500'
                            }`}>
                                {previewShift > 0 ? '+' : ''}{previewShift}
                            </span>
                            <span className="text-xs text-gray-500 block">min</span>
                        </div>
                    </div>
                    <div className="flex justify-between text-xs text-gray-400 mt-1">
                        <span>-30 min (earlier)</span>
                        <span>+30 min (later)</span>
                    </div>
                </div>
            )}

            {/* Action buttons */}
            <div className="p-4 flex gap-3">
                <button
                    onClick={handleOptimize}
                    disabled={!canOptimize || isOptimizing}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    {isOptimizing ? (
                        <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Optimizing...
                        </>
                    ) : (
                        <>
                            <Play className="w-4 h-4" />
                            Run Optimization
                        </>
                    )}
                </button>
                {result && (
                    <button
                        onClick={onReset}
                        className="flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors"
                    >
                        <RotateCcw className="w-4 h-4" />
                        Reset
                    </button>
                )}
            </div>

            {/* Results summary */}
            {result && (
                <div className="p-4">
                    <h4 className="text-sm font-medium text-gray-900 mb-3">
                        Optimization Results
                    </h4>

                    {/* Summary stats */}
                    <div className="grid grid-cols-4 gap-3 mb-4">
                        <div className="bg-gray-50 rounded-lg p-3 text-center">
                            <div className="text-2xl font-bold text-gray-900">
                                {result.summary.totalConnections}
                            </div>
                            <div className="text-xs text-gray-500">Total</div>
                        </div>
                        <div className="bg-green-50 rounded-lg p-3 text-center">
                            <div className="text-2xl font-bold text-green-600">
                                {result.summary.connectionsMet}
                            </div>
                            <div className="text-xs text-green-600">Met</div>
                        </div>
                        <div className="bg-red-50 rounded-lg p-3 text-center">
                            <div className="text-2xl font-bold text-red-600">
                                {result.summary.connectionsMissed}
                            </div>
                            <div className="text-xs text-red-600">Missed</div>
                        </div>
                        <div className="bg-blue-50 rounded-lg p-3 text-center">
                            <div className="text-2xl font-bold text-blue-600">
                                {result.summary.shiftApplied !== undefined
                                    ? `${result.summary.shiftApplied > 0 ? '+' : ''}${result.summary.shiftApplied}`
                                    : '-'}
                            </div>
                            <div className="text-xs text-blue-600">Shift</div>
                        </div>
                    </div>

                    {/* Connection report */}
                    {result.connectionReport.length > 0 && (
                        <div className="border border-gray-200 rounded-lg overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Trip</th>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Target</th>
                                        <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">Before</th>
                                        <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">After</th>
                                        <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {result.connectionReport.slice(0, 10).map((entry, idx) => (
                                        <tr key={idx} className="hover:bg-gray-50">
                                            <td className="px-3 py-2">
                                                <span className="font-mono text-xs">
                                                    {formatConnectionTime(entry.tripStartTime)}
                                                </span>
                                                <span className="text-gray-400 ml-1 text-xs">
                                                    {entry.direction}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-gray-600">
                                                {entry.targetName}
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                <span className={`font-mono text-xs ${
                                                    entry.originalGap >= entry.bufferRequired
                                                        ? 'text-green-600'
                                                        : 'text-red-600'
                                                }`}>
                                                    {entry.originalGap > 0 ? '+' : ''}{entry.originalGap}m
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                <span className={`font-mono text-xs ${
                                                    entry.newGap >= entry.bufferRequired
                                                        ? 'text-green-600'
                                                        : 'text-red-600'
                                                }`}>
                                                    {entry.newGap > 0 ? '+' : ''}{entry.newGap}m
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                {getStatusIcon(entry.status)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {result.connectionReport.length > 10 && (
                                <div className="px-3 py-2 bg-gray-50 text-xs text-gray-500 text-center">
                                    Showing 10 of {result.connectionReport.length} connections
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Help text */}
            {!result && (
                <div className="p-4 bg-gray-50">
                    <div className="flex items-start gap-2 text-xs text-gray-500">
                        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="font-medium text-gray-700">How it works:</p>
                            <ul className="mt-1 space-y-0.5 list-disc list-inside">
                                <li><strong>Meet departing:</strong> Bus arrives before the target departs</li>
                                <li><strong>Feed arriving:</strong> Bus departs after the target arrives</li>
                                <li>Buffer time ensures passengers can make the connection</li>
                            </ul>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default OptimizationPanel;
