import React, { useMemo, useState, useCallback } from 'react';
import { Calendar } from 'lucide-react';
import type { DayType } from '../../../utils/performanceDataTypes';
import { compareDateStrings } from '../../../utils/performanceDateUtils';

export interface DateRangeSelection {
    startDate: string;
    endDate: string;
    dayTypeFilter: DayType | 'all';
}

interface DateRangePickerProps {
    availableDates: string[];
    value: DateRangeSelection;
    onChange: (selection: DateRangeSelection) => void;
}

type Preset = 'last7' | 'last14' | 'last30' | 'thisMonth' | 'lastMonth' | 'all' | 'custom';

const DAY_TYPE_LABELS: Record<DayType | 'all', string> = {
    all: 'All',
    weekday: 'Weekday',
    saturday: 'Saturday',
    sunday: 'Sunday',
};

function getPresetRange(preset: Preset, sortedDates: string[]): { start: string; end: string } | null {
    if (sortedDates.length === 0) return null;
    const last = sortedDates[sortedDates.length - 1];
    const lastDate = new Date(last + 'T12:00:00');

    switch (preset) {
        case 'last7': {
            const start = new Date(lastDate);
            start.setDate(start.getDate() - 6);
            return { start: start.toISOString().slice(0, 10), end: last };
        }
        case 'last14': {
            const start = new Date(lastDate);
            start.setDate(start.getDate() - 13);
            return { start: start.toISOString().slice(0, 10), end: last };
        }
        case 'last30': {
            const start = new Date(lastDate);
            start.setDate(start.getDate() - 29);
            return { start: start.toISOString().slice(0, 10), end: last };
        }
        case 'thisMonth': {
            const start = new Date(lastDate.getFullYear(), lastDate.getMonth(), 1);
            return { start: start.toISOString().slice(0, 10), end: last };
        }
        case 'lastMonth': {
            const start = new Date(lastDate.getFullYear(), lastDate.getMonth() - 1, 1);
            const end = new Date(lastDate.getFullYear(), lastDate.getMonth(), 0);
            return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
        }
        case 'all':
            return { start: sortedDates[0], end: last };
        default:
            return null;
    }
}

function detectPreset(start: string, end: string, sortedDates: string[]): Preset {
    if (sortedDates.length === 0) return 'custom';
    for (const p of ['last7', 'last14', 'last30', 'thisMonth', 'lastMonth', 'all'] as Preset[]) {
        const range = getPresetRange(p, sortedDates);
        if (range && range.start === start && range.end === end) return p;
    }
    return 'custom';
}

export const DateRangePicker: React.FC<DateRangePickerProps> = ({ availableDates, value, onChange }) => {
    const sortedDates = useMemo(() => [...availableDates].sort(compareDateStrings), [availableDates]);
    const minDate = sortedDates[0] ?? '';
    const maxDate = sortedDates[sortedDates.length - 1] ?? '';

    const [activePreset, setActivePreset] = useState<Preset>(() =>
        detectPreset(value.startDate, value.endDate, sortedDates)
    );

    const availableDayTypes = useMemo(() => {
        const types = new Set<DayType>();
        // Derive day types from dates
        for (const d of sortedDates) {
            const date = new Date(d + 'T12:00:00');
            const dow = date.getDay();
            if (dow === 0) types.add('sunday');
            else if (dow === 6) types.add('saturday');
            else types.add('weekday');
        }
        return (['weekday', 'saturday', 'sunday'] as DayType[]).filter(t => types.has(t));
    }, [sortedDates]);

    const handlePreset = useCallback((preset: Preset) => {
        const range = getPresetRange(preset, sortedDates);
        if (!range) return;
        setActivePreset(preset);
        onChange({ startDate: range.start, endDate: range.end, dayTypeFilter: value.dayTypeFilter });
    }, [sortedDates, value.dayTypeFilter, onChange]);

    const handleCustomDate = useCallback((field: 'startDate' | 'endDate', dateVal: string) => {
        setActivePreset('custom');
        onChange({ ...value, [field]: dateVal });
    }, [value, onChange]);

    const handleDayType = useCallback((dt: DayType | 'all') => {
        onChange({ ...value, dayTypeFilter: dt });
    }, [value, onChange]);

    const daysInRange = useMemo(() => {
        return sortedDates.filter(d => d >= value.startDate && d <= value.endDate).length;
    }, [sortedDates, value.startDate, value.endDate]);

    const presets: { id: Preset; label: string }[] = [
        { id: 'last7', label: 'Last 7 days' },
        { id: 'last14', label: 'Last 14 days' },
        { id: 'last30', label: 'Last 30 days' },
        { id: 'thisMonth', label: 'This month' },
        { id: 'lastMonth', label: 'Last month' },
        { id: 'all', label: 'All data' },
    ];

    return (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-cyan-50 text-cyan-600">
                        <Calendar size={16} />
                    </div>
                    <span className="text-sm font-bold text-gray-700">Date Range</span>
                </div>

                {/* Preset buttons */}
                <div className="flex flex-wrap gap-1">
                    {presets.map(p => (
                        <button
                            key={p.id}
                            onClick={() => handlePreset(p.id)}
                            className={`px-2.5 py-1 text-xs font-bold rounded-full transition-colors ${
                                activePreset === p.id
                                    ? 'bg-cyan-100 text-cyan-700'
                                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                            }`}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>

                {/* Custom date inputs */}
                <div className="flex items-center gap-1.5">
                    <input
                        type="date"
                        value={value.startDate}
                        min={minDate}
                        max={value.endDate}
                        onChange={e => handleCustomDate('startDate', e.target.value)}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-cyan-300"
                    />
                    <span className="text-gray-400 text-xs">to</span>
                    <input
                        type="date"
                        value={value.endDate}
                        min={value.startDate}
                        max={maxDate}
                        onChange={e => handleCustomDate('endDate', e.target.value)}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-cyan-300"
                    />
                </div>

                {/* Day type filter */}
                <div className="flex items-center gap-1 ml-auto">
                    {(['all', ...availableDayTypes] as (DayType | 'all')[]).map(dt => (
                        <button
                            key={dt}
                            onClick={() => handleDayType(dt)}
                            className={`px-2.5 py-1 text-xs font-bold rounded-full transition-colors ${
                                value.dayTypeFilter === dt
                                    ? 'bg-cyan-100 text-cyan-700'
                                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                            }`}
                        >
                            {DAY_TYPE_LABELS[dt]}
                        </button>
                    ))}
                </div>

                {/* Days count badge */}
                <span className="text-xs text-gray-400">
                    {daysInRange} day{daysInRange !== 1 ? 's' : ''}
                </span>
            </div>
        </div>
    );
};
