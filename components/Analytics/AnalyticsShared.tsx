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

export const NoData: React.FC = () => (
    <div className="flex items-center justify-center h-[200px] text-gray-400 text-sm">
        No data available
    </div>
);

export const fmt = (n: number) => n.toLocaleString();
