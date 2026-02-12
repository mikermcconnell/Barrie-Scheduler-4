import React from 'react';

export const MetricCard: React.FC<{
    icon: React.ReactNode;
    label: string;
    value: string;
    color: 'cyan' | 'indigo' | 'emerald' | 'amber';
    subValue?: string;
}> = ({ icon, label, value, color, subValue }) => {
    const colors = {
        cyan: 'bg-cyan-50 text-cyan-600',
        indigo: 'bg-indigo-50 text-indigo-600',
        emerald: 'bg-emerald-50 text-emerald-600',
        amber: 'bg-amber-50 text-amber-600',
    };

    return (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center gap-3 mb-2">
                <div className={`p-2 rounded-lg ${colors[color]}`}>{icon}</div>
            </div>
            <p className="text-2xl font-bold text-gray-900">{value}</p>
            <p className="text-sm text-gray-500">{label}</p>
            {subValue && <p className="text-xs text-gray-400 mt-0.5">{subValue}</p>}
        </div>
    );
};

export const ChartCard: React.FC<{
    title: string;
    subtitle: string;
    headerExtra?: React.ReactNode;
    children: React.ReactNode;
}> = ({ title, subtitle, headerExtra, children }) => (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
            <div>
                <h3 className="font-bold text-gray-900">{title}</h3>
                <p className="text-xs text-gray-400">{subtitle}</p>
            </div>
            {headerExtra}
        </div>
        {children}
    </div>
);

export const NoData: React.FC<{ message?: string }> = ({ message }) => (
    <div className="flex items-center justify-center h-[200px] text-gray-400 text-sm">
        {message || 'No data available'}
    </div>
);

export const fmt = (n: number) => n.toLocaleString();

/** Format time band codes to human labels: am_peak → "AM Peak" */
export function formatTimeBand(band: string): string {
    switch (band) {
        case 'am_peak': return 'AM Peak';
        case 'midday': return 'Midday';
        case 'pm_peak': return 'PM Peak';
        case 'evening': return 'Evening';
        case 'overnight': return 'Overnight';
        case 'all_day': return 'All Day';
        default: return band.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
}

/** Format day type codes to human labels: weekday → "Weekday" */
export function formatDayType(dayType: string): string {
    switch (dayType) {
        case 'weekday': return 'Weekday';
        case 'saturday': return 'Saturday';
        case 'sunday': return 'Sunday';
        default: return dayType.charAt(0).toUpperCase() + dayType.slice(1);
    }
}

/** Format season codes to human labels: jan → "January" */
export function formatSeason(season: string): string {
    switch (season) {
        case 'jan': return 'January';
        case 'jul': return 'July';
        case 'sep': return 'September';
        case 'other': return 'Other';
        default: return season.charAt(0).toUpperCase() + season.slice(1);
    }
}

/** Format season codes to short labels: jan → "Jan" */
export function formatSeasonShort(season: string): string {
    switch (season) {
        case 'jan': return 'Jan';
        case 'jul': return 'Jul';
        case 'sep': return 'Sep';
        case 'other': return 'Other';
        default: return season.charAt(0).toUpperCase() + season.slice(1);
    }
}
