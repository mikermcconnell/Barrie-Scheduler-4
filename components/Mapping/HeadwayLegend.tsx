/**
 * Headway Legend
 *
 * Color/weight scale legend overlay for the corridor headway map.
 */

import React from 'react';

const LEGEND_ITEMS = [
    { label: 'Every 10 min or less', color: '#ef4444', weight: 9 },
    { label: 'Every 10–15 min',      color: '#f97316', weight: 7 },
    { label: 'Every 15–20 min',      color: '#22c55e', weight: 5 },
    { label: 'Every 20–30 min',      color: '#3b82f6', weight: 4 },
    { label: 'Every 30+ min',        color: '#9ca3af', weight: 3 },
    { label: 'Single route',         color: '#888888', weight: 2 },
] as const;

export const HeadwayLegend: React.FC = () => (
    <div className="absolute bottom-6 left-2 z-[1000] bg-white/95 backdrop-blur-sm rounded-lg shadow-md border border-gray-200 px-2.5 py-2 text-[10px] pointer-events-auto">
        <div className="font-bold text-gray-600 mb-1.5 text-[11px]">Combined Headway</div>
        {LEGEND_ITEMS.map((item, i) => (
            <div key={i} className="flex items-center gap-2 py-[2px]">
                <span
                    className="inline-block rounded-sm flex-shrink-0"
                    style={{
                        backgroundColor: item.color,
                        width: Math.max(item.weight * 2.5, 8),
                        height: item.weight,
                        opacity: i === LEGEND_ITEMS.length - 1 ? 0.6 : 0.85,
                    }}
                />
                <span className="text-gray-500">{item.label}</span>
            </div>
        ))}
    </div>
);
