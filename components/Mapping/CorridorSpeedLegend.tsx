import React from 'react';
import type { CorridorSpeedMetric } from '../../utils/gtfs/corridorSpeed';

interface CorridorSpeedLegendProps {
    metric: CorridorSpeedMetric;
}

const DELAY_MINUTES_ITEMS = [
    { label: '1.5+ min faster', color: '#16a34a' },
    { label: 'Near schedule', color: '#3b82f6' },
    { label: '1 to 3 min slower', color: '#f59e0b' },
    { label: '3+ min slower', color: '#dc2626' },
] as const;

const DELAY_PERCENT_ITEMS = [
    { label: '10%+ faster', color: '#16a34a' },
    { label: 'Near schedule', color: '#3b82f6' },
    { label: '5% to 20% slower', color: '#f59e0b' },
    { label: '20%+ slower', color: '#dc2626' },
] as const;

const SPEED_ITEMS = [
    { label: '28+ km/h', color: '#16a34a' },
    { label: '22 to 28 km/h', color: '#3b82f6' },
    { label: '16 to 22 km/h', color: '#f59e0b' },
    { label: 'Under 16 km/h', color: '#dc2626' },
] as const;

function getLegend(metric: CorridorSpeedMetric): { title: string; items: readonly { label: string; color: string }[] } {
    switch (metric) {
        case 'delay-percent':
            return { title: 'Observed vs Scheduled', items: DELAY_PERCENT_ITEMS };
        case 'observed-speed':
            return { title: 'Observed Speed', items: SPEED_ITEMS };
        case 'scheduled-speed':
            return { title: 'Scheduled Speed', items: SPEED_ITEMS };
        case 'delay-minutes':
        default:
            return { title: 'Observed vs Scheduled', items: DELAY_MINUTES_ITEMS };
    }
}

export const CorridorSpeedLegend: React.FC<CorridorSpeedLegendProps> = ({ metric }) => {
    const legend = getLegend(metric);

    return (
        <div className="absolute bottom-6 left-2 z-[1000] bg-white/95 backdrop-blur-sm rounded-lg shadow-md border border-gray-200 px-2.5 py-2 text-[10px] pointer-events-auto">
            <div className="font-bold text-gray-600 mb-1.5 text-[11px]">{legend.title}</div>
            {legend.items.map((item) => (
                <div key={item.label} className="flex items-center gap-2 py-[2px]">
                    <span
                        className="inline-block rounded-sm flex-shrink-0"
                        style={{
                            backgroundColor: item.color,
                            width: 16,
                            height: 6,
                            opacity: 0.85,
                        }}
                    />
                    <span className="text-gray-500">{item.label}</span>
                </div>
            ))}
            <div className="flex items-center gap-2 py-[2px] mt-1 border-t border-gray-100 pt-1.5">
                <span className="inline-block rounded-sm flex-shrink-0 bg-gray-400 opacity-80" style={{ width: 16, height: 6 }} />
                <span className="text-gray-500">Low confidence</span>
            </div>
            <div className="flex items-center gap-2 py-[2px]">
                <span className="inline-block rounded-sm flex-shrink-0 bg-slate-300 opacity-70" style={{ width: 16, height: 6 }} />
                <span className="text-gray-500">No observed data</span>
            </div>
        </div>
    );
};
