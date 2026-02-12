import React, { useState, useMemo } from 'react';
import { X, GitCompare, ArrowRight, Plus, Minus, RotateCcw, TrendingUp, TrendingDown, Clock, Bus, Car } from 'lucide-react';
import { MasterRouteTable, MasterTrip } from '../utils/parsers/masterScheduleParser';

interface ScenarioComparisonModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentSchedules: MasterRouteTable[];
    baselineSchedules: MasterRouteTable[] | null;
    currentLabel: string;
    baselineLabel: string;
}

interface TripDiff {
    id: string;
    blockId: string;
    direction: string;
    status: 'added' | 'removed' | 'modified' | 'unchanged';
    currentTrip?: MasterTrip;
    baselineTrip?: MasterTrip;
    changes?: {
        field: string;
        from: string | number;
        to: string | number;
    }[];
}

interface MetricComparison {
    label: string;
    current: number | string;
    baseline: number | string;
    diff: number;
    unit?: string;
    isBetter?: boolean;
}

const formatTime = (mins: number) => {
    const h = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${m.toString().padStart(2, '0')} ${period}`;
};

export const ScenarioComparisonModal: React.FC<ScenarioComparisonModalProps> = ({
    isOpen,
    onClose,
    currentSchedules,
    baselineSchedules,
    currentLabel,
    baselineLabel
}) => {
    const [selectedRoute, setSelectedRoute] = useState<string | 'all'>('all');
    const [showOnlyChanges, setShowOnlyChanges] = useState(true);

    // Calculate trip diffs
    const tripDiffs = useMemo(() => {
        if (!baselineSchedules) return [];

        const diffs: TripDiff[] = [];

        // Create a map of baseline trips by ID
        const baselineTripsMap = new Map<string, MasterTrip>();
        baselineSchedules.forEach(table => {
            table.trips.forEach(trip => {
                baselineTripsMap.set(trip.id, trip);
            });
        });

        // Create a map of current trips by ID
        const currentTripsMap = new Map<string, MasterTrip>();
        currentSchedules.forEach(table => {
            table.trips.forEach(trip => {
                currentTripsMap.set(trip.id, trip);
            });
        });

        // Check for added and modified trips
        currentSchedules.forEach(table => {
            if (selectedRoute !== 'all' && !table.routeName.includes(selectedRoute)) return;

            table.trips.forEach(trip => {
                const baselineTrip = baselineTripsMap.get(trip.id);

                if (!baselineTrip) {
                    // Added trip
                    diffs.push({
                        id: trip.id,
                        blockId: trip.blockId,
                        direction: trip.direction || 'Unknown',
                        status: 'added',
                        currentTrip: trip
                    });
                } else {
                    // Check for modifications
                    const changes: TripDiff['changes'] = [];

                    if (trip.startTime !== baselineTrip.startTime) {
                        changes.push({
                            field: 'Start Time',
                            from: formatTime(baselineTrip.startTime),
                            to: formatTime(trip.startTime)
                        });
                    }
                    if (trip.endTime !== baselineTrip.endTime) {
                        changes.push({
                            field: 'End Time',
                            from: formatTime(baselineTrip.endTime),
                            to: formatTime(trip.endTime)
                        });
                    }
                    if (trip.travelTime !== baselineTrip.travelTime) {
                        changes.push({
                            field: 'Travel Time',
                            from: baselineTrip.travelTime,
                            to: trip.travelTime
                        });
                    }
                    if (trip.recoveryTime !== baselineTrip.recoveryTime) {
                        changes.push({
                            field: 'Recovery',
                            from: baselineTrip.recoveryTime,
                            to: trip.recoveryTime
                        });
                    }
                    if (trip.blockId !== baselineTrip.blockId) {
                        changes.push({
                            field: 'Block',
                            from: baselineTrip.blockId,
                            to: trip.blockId
                        });
                    }

                    if (changes.length > 0) {
                        diffs.push({
                            id: trip.id,
                            blockId: trip.blockId,
                            direction: trip.direction || 'Unknown',
                            status: 'modified',
                            currentTrip: trip,
                            baselineTrip: baselineTrip,
                            changes
                        });
                    } else if (!showOnlyChanges) {
                        diffs.push({
                            id: trip.id,
                            blockId: trip.blockId,
                            direction: trip.direction || 'Unknown',
                            status: 'unchanged',
                            currentTrip: trip,
                            baselineTrip: baselineTrip
                        });
                    }
                }
            });
        });

        // Check for removed trips
        baselineSchedules.forEach(table => {
            if (selectedRoute !== 'all' && !table.routeName.includes(selectedRoute)) return;

            table.trips.forEach(trip => {
                if (!currentTripsMap.has(trip.id)) {
                    diffs.push({
                        id: trip.id,
                        blockId: trip.blockId,
                        direction: trip.direction || 'Unknown',
                        status: 'removed',
                        baselineTrip: trip
                    });
                }
            });
        });

        // Sort by block and time
        return diffs.sort((a, b) => {
            const blockCompare = (a.blockId || '').localeCompare(b.blockId || '');
            if (blockCompare !== 0) return blockCompare;
            const aTime = a.currentTrip?.startTime || a.baselineTrip?.startTime || 0;
            const bTime = b.currentTrip?.startTime || b.baselineTrip?.startTime || 0;
            return aTime - bTime;
        });
    }, [currentSchedules, baselineSchedules, selectedRoute, showOnlyChanges]);

    // Calculate metrics comparison
    const metrics = useMemo((): MetricComparison[] => {
        if (!baselineSchedules) return [];

        const currentTrips = currentSchedules.flatMap(t => t.trips);
        const baselineTrips = baselineSchedules.flatMap(t => t.trips);

        const currentBlocks = new Set(currentTrips.map(t => t.blockId)).size;
        const baselineBlocks = new Set(baselineTrips.map(t => t.blockId)).size;

        const currentTravelSum = currentTrips.reduce((sum, t) => sum + (t.travelTime || 0), 0);
        const baselineTravelSum = baselineTrips.reduce((sum, t) => sum + (t.travelTime || 0), 0);

        const currentRecoverySum = currentTrips.reduce((sum, t) => sum + (t.recoveryTime || 0), 0);
        const baselineRecoverySum = baselineTrips.reduce((sum, t) => sum + (t.recoveryTime || 0), 0);

        const currentAvgRatio = currentTravelSum > 0 ? (currentRecoverySum / currentTravelSum) * 100 : 0;
        const baselineAvgRatio = baselineTravelSum > 0 ? (baselineRecoverySum / baselineTravelSum) * 100 : 0;

        return [
            {
                label: 'Total Trips',
                current: currentTrips.length,
                baseline: baselineTrips.length,
                diff: currentTrips.length - baselineTrips.length,
                isBetter: undefined // neutral
            },
            {
                label: 'Peak Vehicles',
                current: currentBlocks,
                baseline: baselineBlocks,
                diff: currentBlocks - baselineBlocks,
                isBetter: currentBlocks <= baselineBlocks
            },
            {
                label: 'Total Travel Time',
                current: currentTravelSum,
                baseline: baselineTravelSum,
                diff: currentTravelSum - baselineTravelSum,
                unit: 'min'
            },
            {
                label: 'Total Recovery',
                current: currentRecoverySum,
                baseline: baselineRecoverySum,
                diff: currentRecoverySum - baselineRecoverySum,
                unit: 'min'
            },
            {
                label: 'Avg Recovery Ratio',
                current: `${currentAvgRatio.toFixed(1)}%`,
                baseline: `${baselineAvgRatio.toFixed(1)}%`,
                diff: currentAvgRatio - baselineAvgRatio,
                isBetter: Math.abs(currentAvgRatio - 17.5) < Math.abs(baselineAvgRatio - 17.5) // closer to 17.5% is better
            }
        ];
    }, [currentSchedules, baselineSchedules]);

    // Get unique route names
    const routeNames = useMemo(() => {
        const names = new Set<string>();
        currentSchedules.forEach(t => {
            const baseName = t.routeName
                .replace(/\s*\((North|South)\)/gi, '')
                .replace(/\s*\((Weekday|Saturday|Sunday)\)/gi, '')
                .trim();
            names.add(baseName);
        });
        return Array.from(names).sort();
    }, [currentSchedules]);

    // Summary counts
    const summary = useMemo(() => {
        const added = tripDiffs.filter(d => d.status === 'added').length;
        const removed = tripDiffs.filter(d => d.status === 'removed').length;
        const modified = tripDiffs.filter(d => d.status === 'modified').length;
        return { added, removed, modified };
    }, [tripDiffs]);

    if (!isOpen) return null;

    return (
        // z-[10000] ensures comparison modal appears above fullscreen container (z-[9999])
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-purple-50 to-indigo-50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
                            <GitCompare size={20} className="text-purple-600" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-gray-900">Scenario Comparison</h2>
                            <p className="text-xs text-gray-500">
                                <span className="font-bold text-purple-600">{currentLabel}</span>
                                <ArrowRight size={10} className="inline mx-1" />
                                <span className="font-bold text-gray-600">{baselineLabel}</span>
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* No baseline warning */}
                {!baselineSchedules && (
                    <div className="p-6 text-center">
                        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <GitCompare size={32} className="text-gray-400" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-700 mb-2">No Baseline to Compare</h3>
                        <p className="text-sm text-gray-500">
                            You need to have original/baseline schedules to compare against.
                            This typically means loading a saved version or having the original schedule data.
                        </p>
                    </div>
                )}

                {baselineSchedules && (
                    <>
                        {/* Metrics Summary */}
                        <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
                            <div className="grid grid-cols-5 gap-4">
                                {metrics.map((m, i) => (
                                    <div key={i} className="bg-white rounded-xl p-3 border border-gray-200 shadow-sm">
                                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                                            {m.label}
                                        </div>
                                        <div className="flex items-end justify-between">
                                            <span className="text-lg font-bold text-gray-800">
                                                {m.current}{m.unit ? ` ${m.unit}` : ''}
                                            </span>
                                            <span className={`text-xs font-bold flex items-center gap-0.5 ${
                                                m.diff === 0 ? 'text-gray-400' :
                                                m.isBetter === true ? 'text-green-600' :
                                                m.isBetter === false ? 'text-red-600' :
                                                m.diff > 0 ? 'text-blue-600' : 'text-orange-600'
                                            }`}>
                                                {m.diff > 0 ? <TrendingUp size={12} /> : m.diff < 0 ? <TrendingDown size={12} /> : null}
                                                {m.diff > 0 ? '+' : ''}{typeof m.diff === 'number' ? m.diff.toFixed(m.label.includes('%') ? 1 : 0) : m.diff}
                                            </span>
                                        </div>
                                        <div className="text-[10px] text-gray-400 mt-0.5">
                                            was {m.baseline}{m.unit ? ` ${m.unit}` : ''}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Filters and Summary */}
                        <div className="px-6 py-3 border-b border-gray-100 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <select
                                    value={selectedRoute}
                                    onChange={(e) => setSelectedRoute(e.target.value)}
                                    className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-100"
                                >
                                    <option value="all">All Routes</option>
                                    {routeNames.map(name => (
                                        <option key={name} value={name}>{name}</option>
                                    ))}
                                </select>
                                <label className="flex items-center gap-2 text-sm text-gray-600">
                                    <input
                                        type="checkbox"
                                        checked={showOnlyChanges}
                                        onChange={(e) => setShowOnlyChanges(e.target.checked)}
                                        className="rounded border-gray-300"
                                    />
                                    Show only changes
                                </label>
                            </div>
                            <div className="flex items-center gap-3 text-xs">
                                <span className="flex items-center gap-1.5 px-2 py-1 bg-green-50 text-green-700 rounded-lg">
                                    <Plus size={12} /> {summary.added} added
                                </span>
                                <span className="flex items-center gap-1.5 px-2 py-1 bg-red-50 text-red-700 rounded-lg">
                                    <Minus size={12} /> {summary.removed} removed
                                </span>
                                <span className="flex items-center gap-1.5 px-2 py-1 bg-yellow-50 text-yellow-700 rounded-lg">
                                    <RotateCcw size={12} /> {summary.modified} modified
                                </span>
                            </div>
                        </div>

                        {/* Diff Table */}
                        <div className="flex-1 overflow-auto">
                            {tripDiffs.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                                    <GitCompare size={48} className="mb-4 opacity-30" />
                                    <p className="font-bold">No differences found</p>
                                    <p className="text-sm">The schedules are identical</p>
                                </div>
                            ) : (
                                <table className="w-full text-sm">
                                    <thead className="sticky top-0 bg-gray-50 z-10">
                                        <tr>
                                            <th className="px-4 py-2 text-left text-xs font-bold text-gray-500 uppercase">Status</th>
                                            <th className="px-4 py-2 text-left text-xs font-bold text-gray-500 uppercase">Block</th>
                                            <th className="px-4 py-2 text-left text-xs font-bold text-gray-500 uppercase">Direction</th>
                                            <th className="px-4 py-2 text-left text-xs font-bold text-gray-500 uppercase">Start</th>
                                            <th className="px-4 py-2 text-left text-xs font-bold text-gray-500 uppercase">End</th>
                                            <th className="px-4 py-2 text-left text-xs font-bold text-gray-500 uppercase">Changes</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {tripDiffs.map(diff => {
                                            const trip = diff.currentTrip || diff.baselineTrip;
                                            if (!trip) return null;

                                            return (
                                                <tr
                                                    key={diff.id}
                                                    className={`
                                                        ${diff.status === 'added' ? 'bg-green-50/50' : ''}
                                                        ${diff.status === 'removed' ? 'bg-red-50/50' : ''}
                                                        ${diff.status === 'modified' ? 'bg-yellow-50/30' : ''}
                                                        hover:bg-gray-50
                                                    `}
                                                >
                                                    <td className="px-4 py-2">
                                                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${
                                                            diff.status === 'added' ? 'bg-green-100 text-green-700' :
                                                            diff.status === 'removed' ? 'bg-red-100 text-red-700' :
                                                            diff.status === 'modified' ? 'bg-yellow-100 text-yellow-700' :
                                                            'bg-gray-100 text-gray-500'
                                                        }`}>
                                                            {diff.status === 'added' && <Plus size={10} />}
                                                            {diff.status === 'removed' && <Minus size={10} />}
                                                            {diff.status === 'modified' && <RotateCcw size={10} />}
                                                            {diff.status.charAt(0).toUpperCase() + diff.status.slice(1)}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-2 font-mono font-bold">{diff.blockId}</td>
                                                    <td className="px-4 py-2">
                                                        <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${
                                                            diff.direction === 'North' ? 'bg-blue-50 text-blue-600' :
                                                            diff.direction === 'South' ? 'bg-indigo-50 text-indigo-600' :
                                                            'bg-gray-50 text-gray-600'
                                                        }`}>
                                                            {diff.direction}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-2 font-mono text-gray-600">
                                                        {formatTime(trip.startTime)}
                                                    </td>
                                                    <td className="px-4 py-2 font-mono text-gray-600">
                                                        {formatTime(trip.endTime)}
                                                    </td>
                                                    <td className="px-4 py-2">
                                                        {diff.changes && diff.changes.length > 0 ? (
                                                            <div className="flex flex-wrap gap-1">
                                                                {diff.changes.map((change, i) => (
                                                                    <span key={i} className="inline-flex items-center gap-1 text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                                                                        <span className="font-medium text-gray-500">{change.field}:</span>
                                                                        <span className="text-red-500 line-through">{change.from}</span>
                                                                        <ArrowRight size={8} className="text-gray-400" />
                                                                        <span className="text-green-600 font-bold">{change.to}</span>
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <span className="text-gray-400">—</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
