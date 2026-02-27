/**
 * OD Matrix Workspace
 *
 * Tabbed workspace for OD matrix analysis.
 * Follows TransitAppWorkspace tab pattern.
 */

import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import {
    ArrowLeft,
    RefreshCw,
    LayoutDashboard,
    BarChart3,
    Trophy,
    Grid3X3,
    Route,
    Clock,
    Download,
    FileText,
    CheckCircle2,
} from 'lucide-react';
import type { ODMatrixDataSummary, GeocodeCache } from '../../utils/od-matrix/odMatrixTypes';
import { ODOverviewPanel } from './ODOverviewPanel';
import { ODTopPairsModule } from './ODTopPairsModule';
import { ODStationRankingsModule } from './ODStationRankingsModule';
import { ODHeatmapGridModule } from './ODHeatmapGridModule';
import { ODRouteEstimationModule } from './ODRouteEstimationModule';
import { ODDataConfidencePanel } from './ODDataConfidencePanel';
import { ODImportFileManager } from './ODImportFileManager';
import { exportODExcel, exportODPdf, exportStopReportExcel, exportStopReportPdf } from '../../utils/od-matrix/odReportExporter';
import { computeODConfidenceReport } from '../../utils/od-matrix/odDataConfidence';

interface ODMatrixWorkspaceProps {
    data: ODMatrixDataSummary;
    geocodeCache: GeocodeCache | null;
    teamId: string;
    onReimport: () => void;
    onFixCoordinates: () => void;
    onBack: () => void;
    onSwitchImport: (importId: string) => void;
    onDeletedImport: (deletedId: string, result: string | null | 'unchanged') => void;
}

interface TabConfig {
    id: string;
    label: string;
    icon: React.FC<{ size?: number }>;
    enabled: boolean;
}

const TAB_CONFIG: TabConfig[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard, enabled: true },
    { id: 'route-estimation', label: 'Route Assignment', icon: Route, enabled: true },
    { id: 'top-pairs', label: 'Top Pairs', icon: BarChart3, enabled: true },
    { id: 'rankings', label: 'Station Rankings', icon: Trophy, enabled: true },
    { id: 'heatmap', label: 'Heatmap Grid', icon: Grid3X3, enabled: true },
];

export const ODMatrixWorkspace: React.FC<ODMatrixWorkspaceProps> = ({
    data,
    geocodeCache,
    teamId,
    onReimport,
    onFixCoordinates,
    onBack,
    onSwitchImport,
    onDeletedImport,
}) => {
    const [activeTab, setActiveTab] = useState('overview');
    const tabBarRef = useRef<HTMLDivElement>(null);
    const mapElRef = useRef<HTMLDivElement | null>(null);
    const rankingsElRef = useRef<HTMLDivElement>(null);
    const heatmapElRef = useRef<HTMLDivElement>(null);
    const [exportingExcel, setExportingExcel] = useState(false);
    const [exportingPDF, setExportingPDF] = useState(false);
    const [exportingStop, setExportingStop] = useState(false);
    const [exportingStopPdf, setExportingStopPdf] = useState(false);
    const [isolatedStation, setIsolatedStation] = useState<string | null>(null);
    const confidenceReport = useMemo(() => computeODConfidenceReport(data), [data]);
    const savedAtLabel = useMemo(() => {
        const savedAt = new Date(data.metadata.importedAt);
        if (Number.isNaN(savedAt.getTime())) return null;
        return savedAt.toLocaleString([], {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
        });
    }, [data.metadata.importedAt]);

    const handleIsolatedStationChange = useCallback((station: string | null) => {
        setIsolatedStation(station);
    }, []);

    const handleExportExcel = useCallback(async () => {
        setExportingExcel(true);
        try { await exportODExcel(data); }
        finally { setExportingExcel(false); }
    }, [data]);

    const handleExportStopReport = useCallback(async () => {
        if (!isolatedStation) return;
        setExportingStop(true);
        try { await exportStopReportExcel(data, isolatedStation); }
        finally { setExportingStop(false); }
    }, [data, isolatedStation]);

    const handleExportStopPdf = useCallback(async () => {
        if (!isolatedStation) return;
        setExportingStopPdf(true);
        try { await exportStopReportPdf(data, isolatedStation, mapElRef.current); }
        finally { setExportingStopPdf(false); }
    }, [data, isolatedStation]);

    const handleExportPDF = useCallback(async () => {
        setExportingPDF(true);
        try {
            await exportODPdf(
                data,
                mapElRef.current,
                rankingsElRef.current,
                heatmapElRef.current,
            );
        }
        finally { setExportingPDF(false); }
    }, [data]);

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
                return (
                    <ODOverviewPanel
                        data={data}
                        geocodeCache={geocodeCache}
                        onNavigate={handleNavigate}
                        onFixCoordinates={onFixCoordinates}
                        onMapElReady={(el) => { mapElRef.current = el; }}
                        onIsolatedStationChange={handleIsolatedStationChange}
                        isolatedStation={isolatedStation}
                    />
                );
            case 'top-pairs':
                return <ODTopPairsModule data={data} />;
            case 'rankings':
                return <ODStationRankingsModule data={data} chartContainerRef={rankingsElRef} />;
            case 'heatmap':
                return <ODHeatmapGridModule data={data} containerRef={heatmapElRef} />;
            case 'route-estimation':
                return <ODRouteEstimationModule data={data} geocodeCache={geocodeCache} />;
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
                        <h2 className="text-xl font-bold text-gray-900">Ontario Northland</h2>
                        <p className="text-sm text-gray-500">
                            {data.stationCount} stations &middot; {data.totalJourneys.toLocaleString()} journeys
                            {data.metadata.dateRange && ` &middot; ${data.metadata.dateRange}`}
                        </p>
                        <div className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1">
                            <CheckCircle2 size={12} className="text-emerald-600" />
                            <span className="text-xs font-medium text-emerald-700">Planning data saved</span>
                            {savedAtLabel && (
                                <>
                                    <Clock size={11} className="text-emerald-500" />
                                    <span className="text-xs text-emerald-700">{savedAtLabel}</span>
                                </>
                            )}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <ODImportFileManager
                        teamId={teamId}
                        activeImportId={data.metadata.importId}
                        onSwitch={onSwitchImport}
                        onDeleted={onDeletedImport}
                        onReimport={onReimport}
                    />
                    <button
                        onClick={onReimport}
                        className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
                    >
                        <RefreshCw size={16} />
                        Re-import Data
                    </button>
                </div>
            </div>

            {/* Tab Bar */}
            <ODDataConfidencePanel
                report={confidenceReport}
                title="Active Dataset Integrity"
                subtitle="Metadata and recalculated totals are validated against the currently displayed dataset before planning decisions."
                metadata={{
                    importId: data.metadata.importId,
                    fileName: data.metadata.fileName,
                    importedAt: data.metadata.importedAt,
                    importedBy: data.metadata.importedBy,
                    dateRange: data.metadata.dateRange,
                }}
            />

            {/* Export Toolbar */}
            <div className="flex items-center justify-between px-1 py-2.5 border-b border-gray-100 mt-3">
                {/* Network exports */}
                <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mr-1">Network</span>
                    <button
                        onClick={handleExportExcel}
                        disabled={exportingExcel}
                        title="Export full network Excel report"
                        className="px-3 py-1.5 text-xs font-bold text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
                    >
                        <Download size={14} />
                        {exportingExcel ? 'Exporting...' : 'Excel'}
                    </button>
                    <button
                        onClick={handleExportPDF}
                        disabled={exportingPDF}
                        title="Export full network PDF report"
                        className="px-3 py-1.5 text-xs font-bold text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
                    >
                        <FileText size={14} />
                        {exportingPDF ? 'Exporting...' : 'PDF'}
                    </button>
                </div>

                {/* Stop Focus exports */}
                <div className={`flex items-center gap-2 rounded-xl px-3 py-1.5 transition-colors ${isolatedStation ? 'bg-violet-50 ring-1 ring-violet-200' : 'opacity-50'}`}>
                    <span className={`text-[11px] font-semibold uppercase tracking-wide mr-1 ${isolatedStation ? 'text-violet-500' : 'text-gray-400'}`}>
                        {isolatedStation ? isolatedStation : 'Stop Focus'}
                    </span>
                    <button
                        onClick={handleExportStopReport}
                        disabled={!isolatedStation || exportingStop}
                        title={isolatedStation ? `Export stop Excel: ${isolatedStation}` : 'Select a stop on the map first'}
                        className={`px-3 py-1.5 text-xs font-bold rounded-lg flex items-center gap-1.5 transition-colors disabled:cursor-not-allowed ${isolatedStation ? 'bg-violet-100 text-violet-700 hover:bg-violet-200' : 'bg-gray-100 text-gray-400'}`}
                    >
                        <Download size={14} />
                        {exportingStop ? 'Exporting...' : 'Excel'}
                    </button>
                    <button
                        onClick={handleExportStopPdf}
                        disabled={!isolatedStation || exportingStopPdf}
                        title={isolatedStation ? `Export stop PDF: ${isolatedStation}` : 'Select a stop on the map first'}
                        className={`px-3 py-1.5 text-xs font-bold rounded-lg flex items-center gap-1.5 transition-colors disabled:cursor-not-allowed ${isolatedStation ? 'bg-violet-100 text-violet-700 hover:bg-violet-200' : 'bg-gray-100 text-gray-400'}`}
                    >
                        <FileText size={14} />
                        {exportingStopPdf ? 'Exporting...' : 'PDF'}
                    </button>
                </div>
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
