/**
 * Reports Dashboard
 *
 * Landing page for the Reports section with cards for different report types.
 */

import React, { useState } from 'react';
import { FileText, FileSpreadsheet, ArrowRight } from 'lucide-react';
import { PublicTimetable } from './PublicTimetable';

interface ReportsDashboardProps {
    onClose: () => void;
}

type ReportView = 'dashboard' | 'timetable' | 'gtfs';

export const ReportsDashboard: React.FC<ReportsDashboardProps> = ({ onClose }) => {
    const [view, setView] = useState<ReportView>('dashboard');

    if (view === 'timetable') {
        return <PublicTimetable onBack={() => setView('dashboard')} />;
    }

    return (
        <div className="h-full overflow-auto custom-scrollbar p-6">
            <div className="max-w-4xl mx-auto">
                <div className="mb-8">
                    <h2 className="text-2xl font-bold text-gray-900 tracking-tight mb-2">Reports</h2>
                    <p className="text-gray-500">Generate public timetables and export-ready outputs.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {/* Public Timetables Card */}
                    <button
                        onClick={() => setView('timetable')}
                        className="group bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-amber-300 transition-all text-left flex flex-col h-full active:scale-[0.99]"
                    >
                        <div className="flex items-center justify-between mb-4">
                            <div className="bg-amber-50/50 p-2.5 rounded-lg text-amber-600 group-hover:bg-amber-100 transition-colors">
                                <FileText size={20} />
                            </div>
                            <ArrowRight size={16} className="text-gray-300 group-hover:text-amber-500 transition-colors" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 mb-1">Public Timetables</h3>
                        <p className="text-sm text-gray-500 leading-relaxed">
                            Generate rider-friendly timetables in grid or linear format for print or web.
                        </p>
                    </button>

                    {/* GTFS Export Card - Phase 2 */}
                    <div className="relative bg-gray-50 p-6 rounded-xl border border-gray-200 shadow-sm text-left flex flex-col h-full opacity-60 cursor-not-allowed">
                        <div className="absolute top-3 right-3 px-2 py-0.5 bg-gray-200 text-gray-500 text-[10px] font-bold rounded-full uppercase tracking-wide">
                            Phase 2
                        </div>
                        <div className="flex items-center justify-between mb-4">
                            <div className="bg-gray-100 p-2.5 rounded-lg text-gray-400">
                                <FileSpreadsheet size={20} />
                            </div>
                        </div>
                        <h3 className="text-lg font-bold text-gray-500 mb-1">GTFS Export</h3>
                        <p className="text-sm text-gray-400 leading-relaxed">
                            Export schedules to GTFS format for Google Maps and transit apps.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};
