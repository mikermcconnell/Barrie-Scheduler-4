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
import { estimateRoutesFromGtfsTextFiles, type ODRouteEstimationResult } from '../../utils/od-matrix/odRouteEstimation';
import { BUNDLED_OD_GTFS_FILE_NAME, loadBundledGtfsTextFiles } from '../../utils/od-matrix/odBundledGtfs';
import { ODOverviewPanel } from './ODOverviewPanel';
import { ODTopPairsModule } from './ODTopPairsModule';
import { ODStationRankingsModule } from './ODStationRankingsModule';
import { ODHeatmapGridModule } from './ODHeatmapGridModule';
import { ODRouteEstimationModule } from './ODRouteEstimationModule';
import { ODDataConfidencePanel } from './ODDataConfidencePanel';
import { ODImportFileManager } from './ODImportFileManager';
import {
    exportODExcel,
    exportODPdf,
    exportStopReportExcel,
    exportStopReportPdf,
    type StopReportPdfMapOptions,
} from '../../utils/od-matrix/odReportExporter';
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
    { id: 'heatmap', label: 'Heatmap Grid', icon: Grid3X3, enabled: true },
    { id: 'route-estimation', label: 'Routes & Transfers', icon: Route, enabled: true },
    { id: 'top-pairs', label: 'Top Pairs', icon: BarChart3, enabled: true },
    { id: 'rankings', label: 'Station Rankings', icon: Trophy, enabled: true },
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
    const manualRouteOverrideRef = useRef(false);
    const [exportingExcel, setExportingExcel] = useState(false);
    const [exportingPDF, setExportingPDF] = useState(false);
    const [exportingStop, setExportingStop] = useState(false);
    const [exportingStopPdf, setExportingStopPdf] = useState(false);
    const [isolatedStation, setIsolatedStation] = useState<string | null>(null);
    const [routeEstimation, setRouteEstimation] = useState<ODRouteEstimationResult | null>(null);
    const [routeEstimationLoading, setRouteEstimationLoading] = useState(false);
    const [routeEstimationError, setRouteEstimationError] = useState<string | null>(null);
    const [routeEstimationFileName, setRouteEstimationFileName] = useState(BUNDLED_OD_GTFS_FILE_NAME);
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

    const handleRouteEstimationReady = useCallback((result: ODRouteEstimationResult, fileName: string) => {
        manualRouteOverrideRef.current = fileName !== BUNDLED_OD_GTFS_FILE_NAME;
        setRouteEstimation(result);
        setRouteEstimationFileName(fileName);
        setRouteEstimationError(null);
        setRouteEstimationLoading(false);
    }, []);

    useEffect(() => {
        let cancelled = false;

        manualRouteOverrideRef.current = false;
        setRouteEstimation(null);
        setRouteEstimationLoading(true);
        setRouteEstimationError(null);
        setRouteEstimationFileName(BUNDLED_OD_GTFS_FILE_NAME);

        (async () => {
            try {
                const gtfsFiles = await loadBundledGtfsTextFiles();
                if (cancelled) return;
                const estimation = estimateRoutesFromGtfsTextFiles(gtfsFiles, data);
                if (!cancelled && !manualRouteOverrideRef.current) {
                    setRouteEstimation(estimation);
                    setRouteEstimationFileName(BUNDLED_OD_GTFS_FILE_NAME);
                }
            } catch (error) {
                if (!cancelled) {
                    setRouteEstimationError(error instanceof Error ? error.message : 'Failed to preload OD route estimation');
                    console.error('Failed to preload OD route estimation:', error);
                }
            } finally {
                if (!cancelled) {
                    setRouteEstimationLoading(false);
                }
            }
        })();

        return () => { cancelled = true; };
    }, [data]);

    const handleExportExcel = useCallback(async () => {
        setExportingExcel(true);
        try { await exportODExcel(data, routeEstimation); }
        finally { setExportingExcel(false); }
    }, [data, routeEstimation]);

    const handleExportStopReport = useCallback(async () => {
        if (!isolatedStation) return;
        setExportingStop(true);
        try { await exportStopReportExcel(data, isolatedStation, routeEstimation); }
        finally { setExportingStop(false); }
    }, [data, isolatedStation, routeEstimation]);

    const handleExportStopPdf = useCallback(async () => {
        if (!isolatedStation) return;
        setExportingStopPdf(true);
        try { await exportStopReportPdf(data, isolatedStation, mapElRef.current, routeEstimation, heatmapElRef.current); }
        finally { setExportingStopPdf(false); }
    }, [data, isolatedStation, routeEstimation]);

    const handleExportPDF = useCallback(async () => {
        setExportingPDF(true);
        try {
            await exportODPdf(
                data,
                mapElRef.current,
                rankingsElRef.current,
                heatmapElRef.current,
                routeEstimation,
            );
        }
        finally { setExportingPDF(false); }
    }, [data, routeEstimation]);

    const handleHeatmapStopExcel = useCallback(async (stopName: string) => {
        await exportStopReportExcel(data, stopName, routeEstimation);
    }, [data, routeEstimation]);

    const handleHeatmapStopPdf = useCallback(async (
        stopName: string,
        sourceMapEl?: HTMLDivElement | null,
        mapOptions?: StopReportPdfMapOptions,
    ) => {
        await exportStopReportPdf(
            data,
            stopName,
            sourceMapEl ?? mapElRef.current,
            routeEstimation,
            heatmapElRef.current,
            mapOptions,
        );
    }, [data, routeEstimation]);

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
                        routeEstimation={routeEstimation}
                        routeEstimationLoading={routeEstimationLoading}
                    />
                );
            case 'top-pairs':
                return <ODTopPairsModule data={data} />;
            case 'rankings':
                return <ODStationRankingsModule data={data} chartContainerRef={rankingsElRef} />;
            case 'heatmap':
                return <ODHeatmapGridModule data={data} containerRef={heatmapElRef} onExportStopExcel={handleHeatmapStopExcel} onExportStopPdf={handleHeatmapStopPdf} />;
            case 'route-estimation':
                return (
                    <ODRouteEstimationModule
                        data={data}
                        geocodeCache={geocodeCache}
                        routeEstimation={routeEstimation}
                        routeEstimationLoading={routeEstimationLoading}
                        routeEstimationError={routeEstimationError}
                        routeEstimationFileName={routeEstimationFileName}
                        onResultReady={handleRouteEstimationReady}
                        onExportStopExcel={handleHeatmapStopExcel}
                        onExportStopPdf={handleHeatmapStopPdf}
                    />
                );
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

            {/* Sticky Tab Bar with integrated exports */}
            <div className="sticky top-0 z-10 bg-white border-b border-gray-200 rounded-t-lg -mx-1 px-1 mt-1">
                <div className="flex items-center justify-between">
                    {/* Tabs */}
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

                    {/* Export buttons */}
                    <div className="flex items-center gap-1.5 pr-2 shrink-0">
                        {/* Stop focus exports (when a station is selected) */}
                        {isolatedStation && (
                            <div className="flex items-center gap-1.5 bg-violet-50 rounded-lg px-2 py-1 mr-1">
                                <span className="text-[10px] font-semibold text-violet-500 max-w-[100px] truncate">{isolatedStation}</span>
                                <button
                                    onClick={handleExportStopReport}
                                    disabled={exportingStop}
                                    title={`Export stop Excel: ${isolatedStation}`}
                                    className="p-1 text-violet-600 hover:bg-violet-100 rounded transition-colors disabled:opacity-50"
                                >
                                    <Download size={13} />
                                </button>
                                <button
                                    onClick={handleExportStopPdf}
                                    disabled={exportingStopPdf}
                                    title={`Export stop PDF: ${isolatedStation}`}
                                    className="p-1 text-violet-600 hover:bg-violet-100 rounded transition-colors disabled:opacity-50"
                                >
                                    <FileText size={13} />
                                </button>
                            </div>
                        )}
                        {/* Network exports */}
                        <button
                            onClick={handleExportExcel}
                            disabled={exportingExcel}
                            title="Export full network Excel report"
                            className="px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50 flex items-center gap-1.5 transition-colors"
                        >
                            <Download size={13} />
                            {exportingExcel ? '...' : 'Excel'}
                        </button>
                        <button
                            onClick={handleExportPDF}
                            disabled={exportingPDF}
                            title="Export full network PDF report"
                            className="px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50 flex items-center gap-1.5 transition-colors"
                        >
                            <FileText size={13} />
                            {exportingPDF ? '...' : 'PDF'}
                        </button>
                    </div>
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
