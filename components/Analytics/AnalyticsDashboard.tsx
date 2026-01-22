/**
 * Analytics Dashboard
 *
 * Landing page for the Analytics section with cards for different analysis tools.
 */

import React, { useState } from 'react';
import { GitBranch, BarChart3, MapPin, ArrowRight } from 'lucide-react';

interface AnalyticsDashboardProps {
    onClose: () => void;
}

type AnalyticsView = 'dashboard' | 'block-efficiency' | 'coverage';

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({ onClose }) => {
    const [view, setView] = useState<AnalyticsView>('dashboard');

    return (
        <div className="h-full overflow-auto custom-scrollbar p-6">
            <div className="max-w-4xl mx-auto">
                <div className="mb-8">
                    <h2 className="text-2xl font-bold text-gray-900 tracking-tight mb-2">Analytics</h2>
                    <p className="text-gray-500">Analyze schedules, find efficiencies, and optimize operations.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {/* Interlining Opportunities Card - Coming Soon */}
                    <div className="relative bg-gray-50 p-6 rounded-xl border border-gray-200 shadow-sm text-left flex flex-col h-full opacity-60 cursor-not-allowed">
                        <div className="absolute top-3 right-3 px-2 py-0.5 bg-gray-200 text-gray-500 text-[10px] font-bold rounded-full uppercase tracking-wide">
                            Coming Soon
                        </div>
                        <div className="flex items-center justify-between mb-4">
                            <div className="bg-gray-100 p-2.5 rounded-lg text-gray-400">
                                <GitBranch size={20} />
                            </div>
                            <ArrowRight size={16} className="text-gray-300" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-500 mb-1">Interlining Opportunities</h3>
                        <p className="text-sm text-gray-400 leading-relaxed">
                            Find where one bus could serve multiple routes based on terminus timing.
                        </p>
                    </div>

                    {/* Block Efficiency Card - Coming Soon */}
                    <div className="relative bg-gray-50 p-6 rounded-xl border border-gray-200 shadow-sm text-left flex flex-col h-full opacity-60 cursor-not-allowed">
                        <div className="absolute top-3 right-3 px-2 py-0.5 bg-gray-200 text-gray-500 text-[10px] font-bold rounded-full uppercase tracking-wide">
                            Coming Soon
                        </div>
                        <div className="flex items-center justify-between mb-4">
                            <div className="bg-gray-100 p-2.5 rounded-lg text-gray-400">
                                <BarChart3 size={20} />
                            </div>
                            <ArrowRight size={16} className="text-gray-300" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-500 mb-1">Block Efficiency</h3>
                        <p className="text-sm text-gray-400 leading-relaxed">
                            Analyze vehicle utilization and identify consolidation opportunities.
                        </p>
                    </div>

                    {/* Coverage Gaps Card - Coming Soon */}
                    <div className="relative bg-gray-50 p-6 rounded-xl border border-gray-200 shadow-sm text-left flex flex-col h-full opacity-60 cursor-not-allowed">
                        <div className="absolute top-3 right-3 px-2 py-0.5 bg-gray-200 text-gray-500 text-[10px] font-bold rounded-full uppercase tracking-wide">
                            Coming Soon
                        </div>
                        <div className="flex items-center justify-between mb-4">
                            <div className="bg-gray-100 p-2.5 rounded-lg text-gray-400">
                                <MapPin size={20} />
                            </div>
                            <ArrowRight size={16} className="text-gray-300" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-500 mb-1">Coverage Gaps</h3>
                        <p className="text-sm text-gray-400 leading-relaxed">
                            Identify service gaps by time and route to justify schedule changes.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};
