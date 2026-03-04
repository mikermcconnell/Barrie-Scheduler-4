import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowLeft,
    RefreshCw,
    LayoutDashboard,
    TrendingUp,
    MapPin,
    ArrowLeftRight,
    Smartphone,
    Clock,
    MapPinned,
    Train,
    CheckCircle2,
    GraduationCap,
} from 'lucide-react';
import type { TransitAppDataSummary } from '../../utils/transit-app/transitAppTypes';
import { OverviewPanel } from './OverviewPanel';
import { RoutePerformanceModule } from './RoutePerformanceModule';
import { DemandModule } from './DemandModule';
import { TransfersModule } from './TransfersModule';
import { AppUsageModule } from './AppUsageModule';
import { ServiceGapsModule } from './ServiceGapsModule';
import { HeatmapModule } from './HeatmapModule';
import { StopAnalysisModule } from './StopAnalysisModule';
import { StudentPassModule } from './StudentPassModule';

interface TransitAppWorkspaceProps {
    data: TransitAppDataSummary;
    onReimport: () => void;
    onBack: () => void;
}

interface TabConfig {
    id: string;
    label: string;
    icon: React.FC<{ size?: number }>;
    status: 'complete' | 'partial' | 'not-started';
    underDevelopment?: boolean;
}

const TAB_CONFIG: TabConfig[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard, status: 'complete' },
    { id: 'demand', label: 'OD Pair', icon: MapPin, status: 'partial' },
    { id: 'transfers', label: 'Transfer', icon: ArrowLeftRight, status: 'complete' },
    { id: 'heatmaps', label: 'Heatmap', icon: MapPinned, status: 'partial' },
    { id: 'route-performance', label: 'Route Performance', icon: TrendingUp, status: 'complete' },
    { id: 'app-usage', label: 'App Usage', icon: Smartphone, status: 'complete' },
    { id: 'stops', label: 'Stop Analysis', icon: MapPinned, status: 'complete' },
    { id: 'go-integration', label: 'GO Integration', icon: Train, status: 'partial' },
    { id: 'validation', label: 'Validation', icon: CheckCircle2, status: 'not-started' },
    { id: 'service-gaps', label: 'Service Gaps', icon: Clock, status: 'partial', underDevelopment: true },
    { id: 'student-pass', label: 'Student Pass', icon: GraduationCap, status: 'complete' },
];

export const TransitAppWorkspace: React.FC<TransitAppWorkspaceProps> = ({
    data,
    onReimport,
    onBack,
}) => {
    const allowIncompleteTabs = true;
    const tabs = useMemo(
        () => TAB_CONFIG.map(tab => ({
            ...tab,
            enabled: !tab.underDevelopment && (tab.status === 'complete' || allowIncompleteTabs),
        })),
        [allowIncompleteTabs]
    );
    const defaultTabId =
        tabs.find(tab => tab.id === 'overview' && tab.enabled)?.id ??
        tabs.find(tab => tab.enabled)?.id ??
        'overview';
    const [activeTab, setActiveTab] = useState(defaultTabId);
    const tabBarRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const active = tabs.find(tab => tab.id === activeTab);
        if (!active?.enabled) {
            setActiveTab(defaultTabId);
        }
    }, [tabs, activeTab, defaultTabId]);

    const handleTabClick = (tab: TabConfig & { enabled: boolean }) => {
        if (!tab.enabled) return;
        setActiveTab(tab.id);
    };

    const handleNavigate = (tabId: string) => {
        const tab = tabs.find(t => t.id === tabId);
        if (tab?.enabled) {
            setActiveTab(tabId);
            // Scroll tab bar to show the selected tab
            if (tabBarRef.current) {
                const tabEl = tabBarRef.current.querySelector(`[data-tab="${tabId}"]`);
                tabEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }
        }
    };

    const renderPanel = () => {
        switch (activeTab) {
            case 'overview':
                return <OverviewPanel data={data} onNavigate={handleNavigate} />;
            case 'route-performance':
                return <RoutePerformanceModule data={data} />;
            case 'demand':
                return <DemandModule data={data} />;
            case 'heatmaps':
                return <HeatmapModule data={data} />;
            case 'transfers':
                return <TransfersModule data={data} />;
            case 'app-usage':
                return <AppUsageModule data={data} />;
            case 'service-gaps':
                return <ServiceGapsModule data={data} />;
            case 'stops':
                return <StopAnalysisModule data={data} />;
            case 'student-pass':
                return <StudentPassModule />;
            default:
                return <ComingSoonPlaceholder />;
        }
    };

    return (
        <div className="space-y-0">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <button
                        onClick={onBack}
                        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">Transit App Data</h2>
                        <p className="text-sm text-gray-500">
                            {data.metadata.dateRange.start} to {data.metadata.dateRange.end}
                        </p>
                    </div>
                </div>
                <button
                    onClick={onReimport}
                    className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
                >
                    <RefreshCw size={16} />
                    Re-import Data
                </button>
            </div>

            {/* Tab Bar */}
            <div className="border-b border-gray-200 bg-gray-50/50 rounded-t-lg -mx-1 px-1">
                <div
                    ref={tabBarRef}
                    className="flex overflow-x-auto scrollbar-hide"
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                >
                    {tabs.map(tab => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        const isDisabled = !tab.enabled;
                        const isUnderDevelopment = !!tab.underDevelopment;

                        return (
                            <button
                                key={tab.id}
                                data-tab={tab.id}
                                onClick={() => handleTabClick(tab)}
                                disabled={isDisabled}
                                className={`
                                    relative flex items-center gap-1.5 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors
                                    ${isActive
                                        ? 'text-gray-900 font-bold'
                                        : isDisabled
                                            ? 'text-gray-300 cursor-not-allowed'
                                            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                                    }
                                `}
                                title={isDisabled ? (isUnderDevelopment ? 'Under development' : 'In progress (available on localhost only)') : tab.label}
                            >
                                <Icon size={15} />
                                <span>{tab.label}</span>
                                {isActive && (
                                    <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-cyan-500 rounded-t" />
                                )}
                                {isDisabled && (
                                    <span className="px-1.5 py-0 bg-gray-200 text-gray-400 text-[9px] font-bold rounded-full uppercase tracking-wide ml-1">
                                        {isUnderDevelopment ? 'Under Dev' : 'Soon'}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Active Panel */}
            <div className="pt-6">
                {renderPanel()}
            </div>
        </div>
    );
};

const ComingSoonPlaceholder: React.FC = () => (
    <div className="flex flex-col items-center justify-center py-24 text-gray-400">
        <Clock size={48} className="mb-4 text-gray-300" />
        <h3 className="text-lg font-bold text-gray-500 mb-1">Coming Soon</h3>
        <p className="text-sm">This module is under development.</p>
    </div>
);
