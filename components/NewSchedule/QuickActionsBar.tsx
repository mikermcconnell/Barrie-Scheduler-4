/**
 * QuickActionsBar Component
 * Provides filtering, highlighting, and search controls for the schedule editor.
 */

import React, { useState } from 'react';
import { Search, Filter, Clock, AlertTriangle, ChevronDown, X } from 'lucide-react';
import { TimeUtils } from '../../utils/timeUtils';

export interface FilterState {
    timeRange: {
        start: number | null;
        end: number | null;
    };
    highlight: HighlightFilter | null;
    search: string;
}

export type HighlightFilter =
    | 'lowRecovery'      // < 15%
    | 'highRecovery'     // > 25%
    | 'longHeadway'      // > 30 min
    | 'longTravel';      // > 60 min

interface QuickActionsBarProps {
    filter: FilterState;
    onFilterChange: (filter: FilterState) => void;
}

const highlightOptions: { value: HighlightFilter; label: string; description: string }[] = [
    { value: 'lowRecovery', label: 'Low Recovery', description: 'Recovery ratio < 15%' },
    { value: 'highRecovery', label: 'High Recovery', description: 'Recovery ratio > 25%' },
    { value: 'longHeadway', label: 'Long Headway', description: 'Headway > 30 min' },
    { value: 'longTravel', label: 'Long Travel', description: 'Travel time > 60 min' },
];

export const QuickActionsBar: React.FC<QuickActionsBarProps> = ({
    filter,
    onFilterChange,
}) => {
    const [showHighlightDropdown, setShowHighlightDropdown] = useState(false);
    const [startTimeInput, setStartTimeInput] = useState(
        filter.timeRange.start !== null ? TimeUtils.fromMinutes(filter.timeRange.start) : ''
    );
    const [endTimeInput, setEndTimeInput] = useState(
        filter.timeRange.end !== null ? TimeUtils.fromMinutes(filter.timeRange.end) : ''
    );

    const handleStartTimeBlur = () => {
        const mins = TimeUtils.toMinutes(startTimeInput);
        onFilterChange({
            ...filter,
            timeRange: { ...filter.timeRange, start: mins }
        });
    };

    const handleEndTimeBlur = () => {
        const mins = TimeUtils.toMinutes(endTimeInput);
        onFilterChange({
            ...filter,
            timeRange: { ...filter.timeRange, end: mins }
        });
    };

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        onFilterChange({
            ...filter,
            search: e.target.value
        });
    };

    const handleHighlightSelect = (value: HighlightFilter | null) => {
        onFilterChange({
            ...filter,
            highlight: value
        });
        setShowHighlightDropdown(false);
    };

    const clearTimeFilter = () => {
        setStartTimeInput('');
        setEndTimeInput('');
        onFilterChange({
            ...filter,
            timeRange: { start: null, end: null }
        });
    };

    const clearAllFilters = () => {
        setStartTimeInput('');
        setEndTimeInput('');
        onFilterChange({
            timeRange: { start: null, end: null },
            highlight: null,
            search: ''
        });
    };

    const hasActiveFilters = filter.timeRange.start !== null ||
                             filter.timeRange.end !== null ||
                             filter.highlight !== null ||
                             filter.search.length > 0;

    const selectedHighlight = highlightOptions.find(h => h.value === filter.highlight);

    return (
        <div className="flex items-center gap-3 px-4 py-2 bg-gray-50/80 border-b border-gray-100">
            {/* Time Range Filter */}
            <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 px-2 py-1">
                <Clock size={14} className="text-gray-400" />
                <input
                    type="text"
                    value={startTimeInput}
                    onChange={(e) => setStartTimeInput(e.target.value)}
                    onBlur={handleStartTimeBlur}
                    placeholder="From"
                    className="w-16 text-xs bg-transparent border-none focus:outline-none focus:ring-0 text-center"
                />
                <span className="text-gray-300">–</span>
                <input
                    type="text"
                    value={endTimeInput}
                    onChange={(e) => setEndTimeInput(e.target.value)}
                    onBlur={handleEndTimeBlur}
                    placeholder="To"
                    className="w-16 text-xs bg-transparent border-none focus:outline-none focus:ring-0 text-center"
                />
                {(filter.timeRange.start !== null || filter.timeRange.end !== null) && (
                    <button
                        onClick={clearTimeFilter}
                        className="text-gray-400 hover:text-gray-600"
                        title="Clear time filter"
                    >
                        <X size={12} />
                    </button>
                )}
            </div>

            {/* Highlight Filter Dropdown */}
            <div className="relative">
                <button
                    onClick={() => setShowHighlightDropdown(!showHighlightDropdown)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                        filter.highlight
                            ? 'bg-amber-50 border-amber-200 text-amber-700'
                            : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                >
                    <AlertTriangle size={12} />
                    {selectedHighlight ? selectedHighlight.label : 'Highlight'}
                    <ChevronDown size={12} />
                </button>

                {showHighlightDropdown && (
                    <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[180px]">
                        <button
                            onClick={() => handleHighlightSelect(null)}
                            className={`w-full px-3 py-2 text-left text-xs hover:bg-gray-50 ${!filter.highlight ? 'bg-gray-50 font-medium' : ''}`}
                        >
                            None
                        </button>
                        {highlightOptions.map(option => (
                            <button
                                key={option.value}
                                onClick={() => handleHighlightSelect(option.value)}
                                className={`w-full px-3 py-2 text-left hover:bg-gray-50 ${filter.highlight === option.value ? 'bg-amber-50' : ''}`}
                            >
                                <div className="text-xs font-medium text-gray-700">{option.label}</div>
                                <div className="text-[10px] text-gray-400">{option.description}</div>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Search Box */}
            <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 px-2 py-1 flex-1 max-w-xs">
                <Search size={14} className="text-gray-400" />
                <input
                    type="text"
                    value={filter.search}
                    onChange={handleSearchChange}
                    placeholder="Search blocks or stops..."
                    className="flex-1 text-xs bg-transparent border-none focus:outline-none focus:ring-0"
                />
                {filter.search && (
                    <button
                        onClick={() => onFilterChange({ ...filter, search: '' })}
                        className="text-gray-400 hover:text-gray-600"
                        title="Clear search"
                    >
                        <X size={12} />
                    </button>
                )}
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Clear All Filters */}
            {hasActiveFilters && (
                <button
                    onClick={clearAllFilters}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                >
                    <X size={12} />
                    Clear filters
                </button>
            )}
        </div>
    );
};

// Utility function to check if a trip should be grayed out based on filter
export const shouldGrayOutTrip = (
    tripStartTime: number,
    tripEndTime: number,
    filter: FilterState
): boolean => {
    // Time range filter
    if (filter.timeRange.start !== null && tripStartTime < filter.timeRange.start) {
        return true;
    }
    if (filter.timeRange.end !== null && tripEndTime > filter.timeRange.end) {
        return true;
    }
    return false;
};

// Utility function to check if a trip should be highlighted based on filter
export const shouldHighlightTrip = (
    travelTime: number,
    recoveryTime: number,
    headway: number | null,
    filter: FilterState
): boolean => {
    if (!filter.highlight) return false;

    const ratio = travelTime > 0 ? (recoveryTime / travelTime) * 100 : 0;

    switch (filter.highlight) {
        case 'lowRecovery':
            return ratio < 15;
        case 'highRecovery':
            return ratio > 25;
        case 'longHeadway':
            return headway !== null && headway > 30;
        case 'longTravel':
            return travelTime > 60;
        default:
            return false;
    }
};

// Utility function to check if a trip matches search
export const matchesSearch = (
    blockId: string,
    stops: string[],
    search: string
): boolean => {
    if (!search.trim()) return true;

    const searchLower = search.toLowerCase().trim();

    // Match block ID
    if (blockId.toLowerCase().includes(searchLower)) return true;

    // Match any stop name
    if (stops.some(stop => stop.toLowerCase().includes(searchLower))) return true;

    return false;
};

export default QuickActionsBar;
