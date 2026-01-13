/**
 * Interlining Analyzer
 *
 * Analyzes schedules to find opportunities where one bus could serve
 * multiple routes based on terminus timing alignment.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
    ArrowLeft,
    Download,
    RefreshCw,
    Filter,
    CheckCircle2,
    AlertCircle,
    Clock,
    GitBranch,
    ChevronDown,
    ChevronUp,
    Zap
} from 'lucide-react';
import { useTeam } from '../TeamContext';
import { getAllMasterSchedules, getMasterSchedule } from '../../utils/masterScheduleService';
import { buildRouteIdentity } from '../../utils/masterScheduleTypes';
import type { MasterScheduleEntry, MasterScheduleContent, DayType } from '../../utils/masterScheduleTypes';
import {
    analyzeInterliningOpportunities,
    filterOpportunities,
    exportOpportunitiesToCSV,
    getOpportunitySummary,
    type InterliningOpportunity,
    type InterliningFeasibility,
    type InterliningAnalysisResult
} from '../../utils/interliningAnalysis';

interface InterliningAnalyzerProps {
    onBack: () => void;
}

export const InterliningAnalyzer: React.FC<InterliningAnalyzerProps> = ({ onBack }) => {
    const { team } = useTeam();
    const [loading, setLoading] = useState(true);
    const [analyzing, setAnalyzing] = useState(false);

    // Data
    const [entries, setEntries] = useState<MasterScheduleEntry[]>([]);
    const [analysisResult, setAnalysisResult] = useState<InterliningAnalysisResult | null>(null);

    // Filters
    const [dayType, setDayType] = useState<DayType>('Weekday');
    const [minGap, setMinGap] = useState(5);
    const [maxGap, setMaxGap] = useState(20);
    const [showActive, setShowActive] = useState(true);
    const [showSameRoute, setShowSameRoute] = useState(false);
    const [selectedTerminus, setSelectedTerminus] = useState<string>('');
    const [selectedFeasibility, setSelectedFeasibility] = useState<InterliningFeasibility[]>(['good', 'tight', 'marginal']);

    // UI state
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [showFilters, setShowFilters] = useState(false);

    // Load available schedules
    useEffect(() => {
        const loadEntries = async () => {
            if (!team?.id) {
                setLoading(false);
                return;
            }
            try {
                const allEntries = await getAllMasterSchedules(team.id);
                setEntries(allEntries);
            } catch (error) {
                console.error('Error loading schedules:', error);
            } finally {
                setLoading(false);
            }
        };
        loadEntries();
    }, [team?.id]);

    // Run analysis
    const runAnalysis = async () => {
        if (!team?.id) return;

        setAnalyzing(true);
        try {
            // Get entries for selected day type
            const dayEntries = entries.filter(e => e.dayType === dayType);

            // Load all schedule content
            const schedules = new Map<string, MasterScheduleContent>();
            for (const entry of dayEntries) {
                const routeIdentity = buildRouteIdentity(entry.routeNumber, entry.dayType);
                const result = await getMasterSchedule(team.id, routeIdentity);
                if (result) {
                    schedules.set(routeIdentity, result.content);
                }
            }

            // Run analysis
            const result = analyzeInterliningOpportunities(schedules, {
                minGapMinutes: minGap,
                maxGapMinutes: maxGap,
                dayType
            });

            setAnalysisResult(result);
        } catch (error) {
            console.error('Error running analysis:', error);
        } finally {
            setAnalyzing(false);
        }
    };

    // Filter opportunities
    const filteredOpportunities = useMemo(() => {
        if (!analysisResult) return [];

        return filterOpportunities(analysisResult.opportunities, {
            terminus: selectedTerminus || undefined,
            feasibility: selectedFeasibility.length > 0 ? selectedFeasibility : undefined,
            showActive,
            showSameRoute
        });
    }, [analysisResult, selectedTerminus, selectedFeasibility, showActive, showSameRoute]);

    // Summary
    const summary = useMemo(() => {
        if (filteredOpportunities.length === 0) return null;
        return getOpportunitySummary(filteredOpportunities);
    }, [filteredOpportunities]);

    // Export CSV
    const handleExportCSV = () => {
        if (filteredOpportunities.length === 0) return;

        const csv = exportOpportunitiesToCSV(filteredOpportunities);
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `interlining_opportunities_${dayType}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // Toggle feasibility filter
    const toggleFeasibility = (f: InterliningFeasibility) => {
        setSelectedFeasibility(prev =>
            prev.includes(f)
                ? prev.filter(x => x !== f)
                : [...prev, f]
        );
    };

    // Get available day types
    const availableDayTypes = useMemo(() => {
        const types = new Set<DayType>();
        entries.forEach(e => types.add(e.dayType));
        return Array.from(types);
    }, [entries]);

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <RefreshCw className="animate-spin text-gray-400" size={32} />
            </div>
        );
    }

    if (!team) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="text-center">
                    <p className="text-gray-500 mb-4">Join a team to access master schedules.</p>
                    <button onClick={onBack} className="text-cyan-600 hover:underline">
                        ← Back to Analytics
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="flex items-center gap-2 text-gray-500 hover:text-gray-700 transition-colors"
                    >
                        <ArrowLeft size={20} />
                        Back
                    </button>
                    <h2 className="text-xl font-bold text-gray-900">Interlining Opportunities</h2>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                            showFilters
                                ? 'bg-cyan-100 text-cyan-700'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                    >
                        <Filter size={18} />
                        Filters
                    </button>
                    <button
                        onClick={handleExportCSV}
                        disabled={filteredOpportunities.length === 0}
                        className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <Download size={18} />
                        Export CSV
                    </button>
                </div>
            </div>

            {/* Analysis Controls */}
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
                <div className="flex items-center gap-4 flex-wrap">
                    {/* Day Type */}
                    <div className="flex items-center gap-2">
                        <label className="text-sm font-medium text-gray-600">Day Type:</label>
                        <div className="flex gap-1">
                            {(['Weekday', 'Saturday', 'Sunday'] as DayType[]).map(day => (
                                <button
                                    key={day}
                                    onClick={() => setDayType(day)}
                                    disabled={!availableDayTypes.includes(day)}
                                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                        dayType === day
                                            ? 'bg-cyan-600 text-white'
                                            : availableDayTypes.includes(day)
                                                ? 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                                                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                    }`}
                                >
                                    {day}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Gap Range */}
                    <div className="flex items-center gap-2">
                        <label className="text-sm font-medium text-gray-600">Gap:</label>
                        <input
                            type="number"
                            value={minGap}
                            onChange={(e) => setMinGap(parseInt(e.target.value) || 0)}
                            className="w-16 px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                            min={0}
                            max={maxGap}
                        />
                        <span className="text-gray-500">to</span>
                        <input
                            type="number"
                            value={maxGap}
                            onChange={(e) => setMaxGap(parseInt(e.target.value) || 30)}
                            className="w-16 px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                            min={minGap}
                        />
                        <span className="text-sm text-gray-500">min</span>
                    </div>

                    {/* Analyze Button */}
                    <button
                        onClick={runAnalysis}
                        disabled={analyzing || entries.length === 0}
                        className="flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {analyzing ? (
                            <RefreshCw className="animate-spin" size={18} />
                        ) : (
                            <GitBranch size={18} />
                        )}
                        {analyzing ? 'Analyzing...' : 'Analyze'}
                    </button>
                </div>

                {/* Filters Panel */}
                {showFilters && (
                    <div className="mt-4 pt-4 border-t border-gray-200 flex items-center gap-6 flex-wrap">
                        {/* Feasibility */}
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-600">Feasibility:</span>
                            {(['good', 'tight', 'marginal'] as InterliningFeasibility[]).map(f => (
                                <button
                                    key={f}
                                    onClick={() => toggleFeasibility(f)}
                                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                                        selectedFeasibility.includes(f)
                                            ? f === 'good'
                                                ? 'bg-green-100 text-green-700 border border-green-300'
                                                : f === 'tight'
                                                    ? 'bg-yellow-100 text-yellow-700 border border-yellow-300'
                                                    : 'bg-orange-100 text-orange-700 border border-orange-300'
                                            : 'bg-gray-100 text-gray-400'
                                    }`}
                                >
                                    {f.charAt(0).toUpperCase() + f.slice(1)}
                                </button>
                            ))}
                        </div>

                        {/* Terminus Filter */}
                        {analysisResult && (
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-600">Terminus:</span>
                                <select
                                    value={selectedTerminus}
                                    onChange={(e) => setSelectedTerminus(e.target.value)}
                                    className="px-2 py-1 border border-gray-300 rounded-lg text-sm"
                                >
                                    <option value="">All</option>
                                    {analysisResult.terminusLocations.map(t => (
                                        <option key={t} value={t}>{t}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* Toggle Switches */}
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={showActive}
                                onChange={(e) => setShowActive(e.target.checked)}
                                className="rounded border-gray-300 text-cyan-600 focus:ring-cyan-500"
                            />
                            <span className="text-sm text-gray-600">Show active interlines</span>
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={showSameRoute}
                                onChange={(e) => setShowSameRoute(e.target.checked)}
                                className="rounded border-gray-300 text-cyan-600 focus:ring-cyan-500"
                            />
                            <span className="text-sm text-gray-600">Show same-route connections</span>
                        </label>
                    </div>
                )}
            </div>

            {/* Summary Stats */}
            {summary && (
                <div className="px-6 py-3 bg-cyan-50 border-b border-cyan-100">
                    <div className="flex items-center gap-6 text-sm">
                        <div className="flex items-center gap-2">
                            <GitBranch size={16} className="text-cyan-600" />
                            <span className="font-medium text-cyan-800">{summary.total} opportunities</span>
                        </div>
                        <div className="flex items-center gap-4 text-cyan-700">
                            <span className="flex items-center gap-1">
                                <CheckCircle2 size={14} className="text-green-500" />
                                {summary.byFeasibility.good} good
                            </span>
                            <span className="flex items-center gap-1">
                                <AlertCircle size={14} className="text-yellow-500" />
                                {summary.byFeasibility.tight} tight
                            </span>
                            <span className="flex items-center gap-1">
                                <Clock size={14} className="text-orange-500" />
                                {summary.byFeasibility.marginal} marginal
                            </span>
                        </div>
                        {summary.currentlyActive > 0 && (
                            <span className="text-cyan-600">
                                <Zap size={14} className="inline mr-1" />
                                {summary.currentlyActive} currently active
                            </span>
                        )}
                    </div>
                </div>
            )}

            {/* Results */}
            <div className="flex-1 overflow-auto p-6">
                {!analysisResult ? (
                    <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-gray-200 rounded-lg">
                        <GitBranch size={48} className="text-gray-300 mb-4" />
                        <p className="text-gray-400 text-center">
                            Click "Analyze" to find interlining opportunities
                        </p>
                    </div>
                ) : filteredOpportunities.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-gray-200 rounded-lg">
                        <Filter size={48} className="text-gray-300 mb-4" />
                        <p className="text-gray-400 text-center">
                            No opportunities found matching filters
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {filteredOpportunities.map((opp) => (
                            <div
                                key={opp.id}
                                className={`bg-white rounded-lg border shadow-sm overflow-hidden transition-all ${
                                    opp.isCurrentlyActive
                                        ? 'border-cyan-300'
                                        : 'border-gray-200 hover:border-gray-300'
                                }`}
                            >
                                {/* Main Row */}
                                <button
                                    onClick={() => setExpandedId(expandedId === opp.id ? null : opp.id)}
                                    className="w-full px-4 py-3 flex items-center gap-4 text-left"
                                >
                                    {/* Feasibility Badge */}
                                    <div className={`px-2 py-1 rounded text-xs font-bold ${
                                        opp.feasibility === 'good'
                                            ? 'bg-green-100 text-green-700'
                                            : opp.feasibility === 'tight'
                                                ? 'bg-yellow-100 text-yellow-700'
                                                : 'bg-orange-100 text-orange-700'
                                    }`}>
                                        {opp.feasibility.toUpperCase()}
                                    </div>

                                    {/* Route Info */}
                                    <div className="flex-1 flex items-center gap-3">
                                        <div className="text-sm">
                                            <span className="font-bold text-gray-900">{opp.route1.variant}</span>
                                            <span className="text-gray-500 ml-1">{opp.route1.direction}bound</span>
                                        </div>
                                        <div className="text-gray-400">→</div>
                                        <div className="text-sm">
                                            <span className="font-bold text-gray-900">{opp.route2.variant}</span>
                                            <span className="text-gray-500 ml-1">{opp.route2.direction}bound</span>
                                        </div>
                                    </div>

                                    {/* Terminus */}
                                    <div className="text-sm text-gray-600 max-w-32 truncate" title={opp.terminus}>
                                        @ {opp.terminus}
                                    </div>

                                    {/* Times */}
                                    <div className="text-sm text-gray-500 flex items-center gap-2">
                                        <span>{opp.route1.endTimeStr}</span>
                                        <span className="text-gray-300">→</span>
                                        <span>{opp.route2.startTimeStr}</span>
                                    </div>

                                    {/* Gap */}
                                    <div className="text-sm font-medium text-gray-700 w-16 text-right">
                                        {opp.gapMinutes}m gap
                                    </div>

                                    {/* Active Badge */}
                                    {opp.isCurrentlyActive && (
                                        <div className="px-2 py-1 bg-cyan-100 text-cyan-700 rounded text-xs font-medium">
                                            Active
                                        </div>
                                    )}

                                    {/* Expand Icon */}
                                    {expandedId === opp.id ? (
                                        <ChevronUp size={18} className="text-gray-400" />
                                    ) : (
                                        <ChevronDown size={18} className="text-gray-400" />
                                    )}
                                </button>

                                {/* Expanded Details */}
                                {expandedId === opp.id && (
                                    <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
                                        <div className="grid grid-cols-2 gap-4 text-sm">
                                            <div>
                                                <h4 className="font-bold text-gray-700 mb-2">Arriving Trip</h4>
                                                <div className="space-y-1 text-gray-600">
                                                    <div>Route: <span className="font-medium">{opp.route1.variant} ({opp.route1.direction}bound)</span></div>
                                                    <div>Trip: <span className="font-medium">#{opp.route1.tripIndex + 1}</span></div>
                                                    <div>Block: <span className="font-medium">{opp.route1.blockId}</span></div>
                                                    <div>Arrives: <span className="font-medium">{opp.route1.endTimeStr}</span> at {opp.route1.terminus}</div>
                                                </div>
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-gray-700 mb-2">Departing Trip</h4>
                                                <div className="space-y-1 text-gray-600">
                                                    <div>Route: <span className="font-medium">{opp.route2.variant} ({opp.route2.direction}bound)</span></div>
                                                    <div>Trip: <span className="font-medium">#{opp.route2.tripIndex + 1}</span></div>
                                                    <div>Block: <span className="font-medium">{opp.route2.blockId}</span></div>
                                                    <div>Departs: <span className="font-medium">{opp.route2.startTimeStr}</span> from {opp.route2.terminus}</div>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="mt-3 pt-3 border-t border-gray-200 text-sm text-gray-600">
                                            <span className="font-medium">Potential:</span> {opp.potentialSavings}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
