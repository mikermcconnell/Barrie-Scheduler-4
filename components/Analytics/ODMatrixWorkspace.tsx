/**
 * OD Matrix Workspace
 *
 * Tabbed workspace for OD matrix analysis.
 * Follows TransitAppWorkspace tab pattern.
 */

import React, { useMemo, useRef, useState, useEffect } from 'react';
import {
    ArrowLeft,
    RefreshCw,
    LayoutDashboard,
    BarChart3,
    Trophy,
    Map,
    Grid3X3,
    Clock,
} from 'lucide-react';
import type { ODMatrixDataSummary, GeocodeCache } from '../../utils/od-matrix/odMatrixTypes';
import { ODOverviewPanel } from './ODOverviewPanel';
import { ODTopPairsModule } from './ODTopPairsModule';
import { ODStationRankingsModule } from './ODStationRankingsModule';
import { ODFlowMapModule } from './ODFlowMapModule';
import { ODHeatmapGridModule } from './ODHeatmapGridModule';

interface ODMatrixWorkspaceProps {
    data: ODMatrixDataSummary;
    geocodeCache: GeocodeCache | null;
    onReimport: () => void;
    onBack: () => void;
}

interface TabConfig {
    id: string;
    label: string;
    icon: React.FC<{ size?: number }>;
    enabled: boolean;
}

const TAB_CONFIG: TabConfig[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard, enabled: true },
    { id: 'top-pairs', label: 'Top Pairs', icon: BarChart3, enabled: true },
    { id: 'rankings', label: 'Station Rankings', icon: Trophy, enabled: true },
    { id: 'flow-map', label: 'Flow Map', icon: Map, enabled: true },
    { id: 'heatmap', label: 'Heatmap Grid', icon: Grid3X3, enabled: true },
];

export const ODMatrixWorkspace: React.FC<ODMatrixWorkspaceProps> = ({
    data,
    geocodeCache,
    onReimport,
    onBack,
}) => {
    const [activeTab, setActiveTab] = useState('overview');
    const tabBarRef = useRef<HTMLDivElement>(null);

    const tabs = useMemo(() => TAB_CONFIG, []);

    useEffect(() => {
        const active = tabs.find(t => t.id === activeTab);
        if (!active?.enabled) setActiveTab('overview');
    }, [tabs, activeTab]);

    const handleTabClick = (tab: TabConfig) => {
        if (!tab.enabled) return;
        setActiveTab(tab.id);
    };

    const handleNavigate = (tabId: string) => {
        const tab = tabs.find(t => t.id === tabId);
        if (tab?.enabled) {
            setActiveTab(tabId);
            if (tabBarRef.current) {
                const tabEl = tabBarRef.current.querySelector(`[data-tab="${tabId}"]`);
                tabEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }
        }
    };

    const renderPanel = () => {
        switch (activeTab) {
            case 'overview':
                return <ODOverviewPanel data={data} geocodeCache={geocodeCache} onNavigate={handleNavigate} />;
            case 'top-pairs':
                return <ODTopPairsModule data={data} />;
            case 'rankings':
                return <ODStationRankingsModule data={data} />;
            case 'flow-map':
                return <ODFlowMapModule data={data} geocodeCache={geocodeCache} />;
            case 'heatmap':
                return <ODHeatmapGridModule data={data} />;
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
                        <h2 className="text-xl font-bold text-gray-900">OD Matrix Analysis</h2>
                        <p className="text-sm text-gray-500">
                            {data.stationCount} stations &middot; {data.totalJourneys.toLocaleString()} journeys
                            {data.metadata.dateRange && ` &middot; ${data.metadata.dateRange}`}
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
                            >
                                <Icon size={15} />
                                <span>{tab.label}</span>
                                {isActive && (
                                    <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-violet-500 rounded-t" />
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
