/**
 * Headway Filter Bar
 *
 * Time period selector + day type toggle for the corridor headway map.
 */

import React from 'react';
import {
    TIME_PERIODS,
    DAY_TYPES,
    type TimePeriod,
    type DayType,
} from '../../utils/gtfs/corridorHeadway';

interface HeadwayFilterBarProps {
    period: TimePeriod;
    dayType: DayType;
    onPeriodChange: (period: TimePeriod) => void;
    onDayTypeChange: (dayType: DayType) => void;
}

export const HeadwayFilterBar: React.FC<HeadwayFilterBarProps> = ({
    period,
    dayType,
    onPeriodChange,
    onDayTypeChange,
}) => (
    <div className="flex items-center gap-2">
        {/* Time Period */}
        <div className="flex bg-white rounded-md border border-gray-300 shadow-sm overflow-hidden">
            {TIME_PERIODS.map(p => (
                <button
                    key={p.id}
                    onClick={() => onPeriodChange(p.id)}
                    className={`px-2.5 py-1.5 text-[10px] font-bold uppercase transition-colors ${
                        period === p.id
                            ? 'bg-teal-50 text-teal-700'
                            : 'text-gray-500 hover:bg-gray-50'
                    }`}
                >
                    {p.label}
                </button>
            ))}
        </div>

        {/* Day Type */}
        <div className="flex bg-white rounded-md border border-gray-300 shadow-sm overflow-hidden">
            {DAY_TYPES.map(d => (
                <button
                    key={d.id}
                    onClick={() => onDayTypeChange(d.id)}
                    className={`px-2.5 py-1.5 text-[10px] font-bold uppercase transition-colors ${
                        dayType === d.id
                            ? 'bg-teal-50 text-teal-700'
                            : 'text-gray-500 hover:bg-gray-50'
                    }`}
                >
                    {d.label}
                </button>
            ))}
        </div>
    </div>
);
