
import React, { useMemo } from 'react';
import { MasterRouteTable } from '../utils/masterScheduleParser';

interface RouteSummaryProps {
    table: MasterRouteTable;
    orientation?: 'horizontal' | 'vertical' | 'header';
}

export const RouteSummary: React.FC<RouteSummaryProps> = ({ table, orientation = 'horizontal' }) => {
    const stats = useMemo(() => {
        let totalCycle = 0;
        let totalRec = 0;
        let totalTravel = 0;
        let activeTrips = 0;

        table.trips.forEach(trip => {
            totalCycle += trip.cycleTime || 0;
            totalRec += trip.recoveryTime || 0;
            totalTravel += trip.travelTime || 0;
            activeTrips++;
        });

        // Safe division - Recovery Ratio = Recovery / Travel Time (not Cycle)
        const avgRatio = totalTravel > 0 ? (totalRec / totalTravel) * 100 : 0;
        return { totalCycle, totalRec, totalTravel, activeTrips, avgRatio };
    }, [table]);

    if (orientation === 'vertical') {
        return (
            <div className="flex flex-col gap-3 w-full">
                <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                    <div className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-1">Total Trips</div>
                    <div className="text-2xl font-bold text-gray-900">{stats.activeTrips}</div>
                </div>
                <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                    <div className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-1">Total Travel Time</div>
                    <div className="text-2xl font-bold text-gray-900">{(stats.totalTravel / 60).toFixed(1)}<span className="text-sm font-medium text-gray-400 ml-1">hrs</span></div>
                </div>
                <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                    <div className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-1">Total Recovery</div>
                    <div className="text-2xl font-bold text-gray-900">{(stats.totalRec / 60).toFixed(1)}<span className="text-sm font-medium text-gray-400 ml-1">hrs</span></div>
                </div>
                <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                    <div className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-1">Total Cycle Time</div>
                    <div className="text-2xl font-bold text-gray-900">{(stats.totalCycle / 60).toFixed(1)}<span className="text-sm font-medium text-gray-400 ml-1">hrs</span></div>
                </div>
                <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                    <div className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-1">Recovery Ratio</div>
                    <div className={`text-2xl font-bold ${stats.avgRatio < 10 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {stats.avgRatio.toFixed(1)}%
                    </div>
                </div>
            </div>
        );
    }

    if (orientation === 'header') {
        return (
            <div className="flex items-center gap-4 ml-2">
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Trips</span>
                    <span className="text-sm font-bold text-gray-900">{stats.activeTrips}</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider hidden xl:inline">Travel</span>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider xl:hidden">Trav</span>
                    <span className="text-sm font-bold text-gray-900">{(stats.totalTravel / 60).toFixed(1)}<span className="text-[10px] text-gray-400 font-normal ml-0.5">h</span></span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider hidden xl:inline">Recovery</span>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider xl:hidden">Rec</span>
                    <span className="text-sm font-bold text-gray-900">{(stats.totalRec / 60).toFixed(1)}<span className="text-[10px] text-gray-400 font-normal ml-0.5">h</span></span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider hidden xl:inline">Cycle</span>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider xl:hidden">Cyc</span>
                    <span className="text-sm font-bold text-gray-900">{(stats.totalCycle / 60).toFixed(1)}<span className="text-[10px] text-gray-400 font-normal ml-0.5">h</span></span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Ratio</span>
                    <span className={`text-sm font-bold ${stats.avgRatio < 10 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {stats.avgRatio.toFixed(1)}%
                    </span>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm mb-6 flex divide-x divide-gray-100">
            <div className="px-6 py-4 flex-1">
                <div className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-1">Total Trips</div>
                <div className="text-2xl font-bold text-gray-900">{stats.activeTrips}</div>
            </div>
            <div className="px-6 py-4 flex-1">
                <div className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-1">Total Travel Time</div>
                <div className="text-2xl font-bold text-gray-900">{(stats.totalTravel / 60).toFixed(1)}<span className="text-sm font-medium text-gray-400 ml-1">hrs</span></div>
            </div>
            <div className="px-6 py-4 flex-1">
                <div className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-1">Total Recovery</div>
                <div className="text-2xl font-bold text-gray-900">{(stats.totalRec / 60).toFixed(1)}<span className="text-sm font-medium text-gray-400 ml-1">hrs</span></div>
            </div>
            <div className="px-6 py-4 flex-1">
                <div className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-1">Total Cycle Time</div>
                <div className="text-2xl font-bold text-gray-900">{(stats.totalCycle / 60).toFixed(1)}<span className="text-sm font-medium text-gray-400 ml-1">hrs</span></div>
            </div>
            <div className="px-6 py-4 flex-1">
                <div className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-1">Recovery Ratio</div>
                <div className="flex items-center gap-2">
                    <div className={`text-2xl font-bold ${stats.avgRatio < 10 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {stats.avgRatio.toFixed(1)}%
                    </div>
                </div>
            </div>
        </div>
    );
};
