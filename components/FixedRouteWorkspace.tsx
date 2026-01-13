
import React, { useState } from 'react';
import {
    Settings2,
    CalendarPlus,
    Timer,
    BarChart2,
    ArrowRight,
    ArrowLeft,
    FileSpreadsheet,
    FileText,
    GitBranch
} from 'lucide-react';

import { OTPAnalysis } from './OTPAnalysis';
import { ScheduleTweakerWorkspace } from './ScheduleTweakerWorkspace';
import { NewScheduleWizard } from './NewSchedule/NewScheduleWizard';
import { MasterScheduleBrowser } from './MasterScheduleBrowser';
import { ReportsDashboard } from './Reports/ReportsDashboard';
import { AnalyticsDashboard } from './Analytics/AnalyticsDashboard';
import { ScheduleDraft, SavedFile } from '../utils/dataService';

// --- Placeholder Components ---
const DwellAssessment: React.FC = () => (
    <div className="flex flex-col items-center justify-center h-96 space-y-6 animate-in fade-in duration-500">
        <div className="bg-orange-50 p-8 rounded-full"><Timer size={64} className="text-orange-500" /></div>
        <div className="text-center space-y-2">
            <h3 className="text-2xl font-extrabold text-gray-800">Dwell Time Analysis</h3>
            <p className="text-gray-500 font-bold max-w-md">Analyze stop-level dwell times to optimize schedule padding and improve on-time performance.</p>
            <div className="inline-block bg-gray-100 text-gray-500 text-xs font-black px-3 py-1 rounded-full uppercase tracking-wider mt-4">Coming Soon</div>
        </div>
    </div>
);

type FixedRouteViewMode = 'dashboard' | 'tweaker' | 'new-schedule' | 'dwell' | 'otp' | 'master' | 'reports' | 'analytics';

export const FixedRouteWorkspace: React.FC = () => {
    const [viewMode, setViewMode] = useState<FixedRouteViewMode>('dashboard');

    // Optional: Pass initial data to tweaker if we want to support "Open in Tweaker" from Dashboard in the future
    // For now, Tweaker handles its own loading.
    const [tweakerInitialData, setTweakerInitialData] = useState<{ draft?: ScheduleDraft, file?: SavedFile } | undefined>(undefined);

    // --- Handlers ---

    const handleOpenTweaker = () => {
        setTweakerInitialData(undefined); // Start fresh
        setViewMode('tweaker');
    };

    const handleOpenNewSchedule = () => {
        setViewMode('new-schedule');
    };

    const handleOpenMasterSchedule = () => {
        setViewMode('master');
    };

    const handleExportToTweaker = (draft: ScheduleDraft) => {
        // This is the bridge from New Schedule -> Tweaker
        setTweakerInitialData({ draft });
        setViewMode('tweaker');
    };

    // --- Render Logic ---

    // 1. Dashboard View
    if (viewMode === 'dashboard') {
        return (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 max-w-6xl mx-auto pt-8">
                <div className="mb-8 px-4">
                    <h2 className="text-2xl font-bold text-gray-900 tracking-tight mb-2">Fixed Route Operations</h2>
                    <p className="text-gray-500">Select a tool to manage schedules or analyze performance.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 px-4">
                    {/* Tweaker Card */}
                    <button onClick={handleOpenTweaker} className="group bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-blue-300 transition-all text-left flex flex-col h-full active:scale-[0.99]">
                        <div className="flex items-center justify-between mb-4">
                            <div className="bg-blue-50/50 p-2.5 rounded-lg text-blue-600 group-hover:bg-blue-100 transition-colors"><Settings2 size={20} /></div>
                            <ArrowRight size={16} className="text-gray-300 group-hover:text-blue-500 transition-colors" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 mb-1">Schedule Tweaker</h3>
                        <p className="text-sm text-gray-500 leading-relaxed">Fine-tune master schedules, adjust timepoints, and manage block recovery times.</p>
                    </button>

                    {/* New Schedule Card */}
                    <button onClick={handleOpenNewSchedule} className="group bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-emerald-300 transition-all text-left flex flex-col h-full active:scale-[0.99]">
                        <div className="flex items-center justify-between mb-4">
                            <div className="bg-emerald-50/50 p-2.5 rounded-lg text-emerald-600 group-hover:bg-emerald-100 transition-colors"><CalendarPlus size={20} /></div>
                            <ArrowRight size={16} className="text-gray-300 group-hover:text-emerald-500 transition-colors" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 mb-1">New Schedules</h3>
                        <p className="text-sm text-gray-500 leading-relaxed">Generate optimized schedules from scratch using AI-powered run cutting.</p>
                    </button>

                    {/* Master Schedule Card */}
                    <button onClick={handleOpenMasterSchedule} className="group bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-purple-300 transition-all text-left flex flex-col h-full active:scale-[0.99]">
                        <div className="flex items-center justify-between mb-4">
                            <div className="bg-purple-50/50 p-2.5 rounded-lg text-purple-600 group-hover:bg-purple-100 transition-colors"><FileSpreadsheet size={20} /></div>
                            <ArrowRight size={16} className="text-gray-300 group-hover:text-purple-500 transition-colors" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 mb-1">Master Schedule</h3>
                        <p className="text-sm text-gray-500 leading-relaxed">Browse your team's source of truth. View versions and manage all routes.</p>
                    </button>

                    {/* Dwell Assessment Card - Coming Soon */}
                    <div className="relative bg-gray-50 p-6 rounded-xl border border-gray-200 shadow-sm text-left flex flex-col h-full opacity-60 cursor-not-allowed">
                        <div className="absolute top-3 right-3 px-2 py-0.5 bg-gray-200 text-gray-500 text-[10px] font-bold rounded-full uppercase tracking-wide">Coming Soon</div>
                        <div className="flex items-center justify-between mb-4">
                            <div className="bg-gray-100 p-2.5 rounded-lg text-gray-400"><Timer size={20} /></div>
                            <ArrowRight size={16} className="text-gray-300" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-500 mb-1">Dwell Assessment</h3>
                        <p className="text-sm text-gray-400 leading-relaxed">Analyze stop-level dwell times.</p>
                    </div>

                    {/* OTP Analysis Card - Coming Soon */}
                    <div className="relative bg-gray-50 p-6 rounded-xl border border-gray-200 shadow-sm text-left flex flex-col h-full opacity-60 cursor-not-allowed">
                        <div className="absolute top-3 right-3 px-2 py-0.5 bg-gray-200 text-gray-500 text-[10px] font-bold rounded-full uppercase tracking-wide">Coming Soon</div>
                        <div className="flex items-center justify-between mb-4">
                            <div className="bg-gray-100 p-2.5 rounded-lg text-gray-400"><BarChart2 size={20} /></div>
                            <ArrowRight size={16} className="text-gray-300" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-500 mb-1">OTP Analysis</h3>
                        <p className="text-sm text-gray-400 leading-relaxed">Monitor On-Time Performance metrics.</p>
                    </div>

                    {/* Reports Card */}
                    <button onClick={() => setViewMode('reports')} className="group bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-amber-300 transition-all text-left flex flex-col h-full active:scale-[0.99]">
                        <div className="flex items-center justify-between mb-4">
                            <div className="bg-amber-50/50 p-2.5 rounded-lg text-amber-600 group-hover:bg-amber-100 transition-colors"><FileText size={20} /></div>
                            <ArrowRight size={16} className="text-gray-300 group-hover:text-amber-500 transition-colors" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 mb-1">Reports</h3>
                        <p className="text-sm text-gray-500 leading-relaxed">Generate public timetables, GTFS exports, and driver sheets.</p>
                    </button>

                    {/* Analytics Card */}
                    <button onClick={() => setViewMode('analytics')} className="group bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-cyan-300 transition-all text-left flex flex-col h-full active:scale-[0.99]">
                        <div className="flex items-center justify-between mb-4">
                            <div className="bg-cyan-50/50 p-2.5 rounded-lg text-cyan-600 group-hover:bg-cyan-100 transition-colors"><GitBranch size={20} /></div>
                            <ArrowRight size={16} className="text-gray-300 group-hover:text-cyan-500 transition-colors" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 mb-1">Analytics</h3>
                        <p className="text-sm text-gray-500 leading-relaxed">Discover interlining opportunities and analyze route efficiency.</p>
                    </button>
                </div>
            </div>
        );
    }

    // 2. Active Workspace Views
    return (
        <div className="flex flex-col h-full">
            {/* Navigation Header - hidden for new-schedule since wizard has its own */}
            {viewMode !== 'new-schedule' && (
                <div className="flex items-center gap-4 mb-6 px-4">
                    <button
                        onClick={() => setViewMode('dashboard')}
                        className="flex items-center gap-2 text-gray-400 hover:text-gray-600 font-bold transition-colors"
                    >
                        <ArrowLeft size={20} /> Back to Dashboard
                    </button>
                    <div className="h-6 w-px bg-gray-300"></div>
                    <div className="text-sm font-bold text-gray-500 uppercase tracking-wider">
                        {viewMode === 'tweaker' && 'Schedule Tweaker'}
                        {viewMode === 'new-schedule' && 'New Schedule'}
                        {viewMode === 'master' && 'Master Schedule'}
                        {viewMode === 'dwell' && 'Dwell Assessment'}
                        {viewMode === 'otp' && 'OTP Assessment'}
                        {viewMode === 'reports' && 'Reports'}
                        {viewMode === 'analytics' && 'Analytics'}
                    </div>
                </div>
            )}

            <div className="flex-grow overflow-hidden relative bg-white rounded-3xl border-2 border-gray-100 shadow-sm">
                <div className="absolute inset-0">
                    {viewMode === 'tweaker' && (
                        <ScheduleTweakerWorkspace
                            key={tweakerInitialData?.draft?.id || tweakerInitialData?.file?.id || 'empty'}
                            initialDraft={tweakerInitialData?.draft}
                            initialFile={tweakerInitialData?.file}
                            onClose={() => setViewMode('dashboard')}
                        />
                    )}

                    {viewMode === 'new-schedule' && (
                        <NewScheduleWizard
                            onBack={() => setViewMode('dashboard')}
                            // In this separated model, onGenerate doesn't auto-load Tweaker anymore.
                            // The Wizard itself should handle saving and potentially offer an "Export" action via a new prop or internal logic.
                            // However, since we haven't updated NewScheduleWizard to have an "Export" specific callback yet,
                            // we can bridge it here if NewScheduleWizard still calls onGenerate with tables.
                            // Ideally, NewScheduleWizard should be updated to return a Draft object or similar for export.
                            // For now, let's keep it simple: The Wizard saves to Projects.
                            // If we want to bridge, we'd implementation that in the Wizard's Project Manager.
                            onGenerate={() => {
                                // Optional: Could show a toast saying "Available in Projects"
                            }}
                        />
                    )}

                    {viewMode === 'master' && (
                        <MasterScheduleBrowser
                            onLoadToTweaker={(schedules) => {
                                // Bridge from Master Schedule -> Tweaker
                                const draft: ScheduleDraft = {
                                    id: `master-${Date.now()}`,
                                    name: schedules[0]?.routeName || 'Loaded from Master',
                                    schedules: schedules,
                                    originalSchedules: schedules,
                                    createdAt: new Date(),
                                    updatedAt: new Date()
                                };
                                setTweakerInitialData({ draft });
                                setViewMode('tweaker');
                            }}
                            onClose={() => setViewMode('dashboard')}
                        />
                    )}

                    {viewMode === 'dwell' && (
                        <div className="p-6 overflow-auto custom-scrollbar h-full">
                            <DwellAssessment />
                        </div>
                    )}

                    {viewMode === 'otp' && (
                        <div className="p-6 overflow-auto custom-scrollbar h-full">
                            <OTPAnalysis />
                        </div>
                    )}

                    {viewMode === 'reports' && (
                        <ReportsDashboard onClose={() => setViewMode('dashboard')} />
                    )}

                    {viewMode === 'analytics' && (
                        <AnalyticsDashboard onClose={() => setViewMode('dashboard')} />
                    )}
                </div>
            </div>
        </div>
    );
};

