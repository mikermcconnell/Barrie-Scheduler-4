/**
 * ConnectionAddChooser
 *
 * Popup panel offering multiple ways to add a connection target:
 * - Quick Templates (GO Train, Georgian College)
 * - Manual Entry
 * - GTFS Import
 */

import React, { useState } from 'react';
import {
    X,
    Train,
    Clock,
    Edit3,
    Download,
    ChevronRight,
    Loader2,
    RefreshCw
} from 'lucide-react';
import type { DayType } from '../../../utils/masterScheduleParser';
import type { ConnectionTime } from '../../../utils/connectionTypes';
import type { GoDataSource } from '../../../utils/goTransitService';
import {
    QUICK_TEMPLATES,
    fetchGoTransitGTFS,
    getCachedData,
    isCacheFresh,
    getCacheAge
} from '../../../utils/goTransitService';

export interface ConnectionAddChooserProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectManual: () => void;
    onSelectTemplate: (data: {
        name: string;
        location: string;
        stopCode: string;
        icon: 'train' | 'clock';
        defaultEventType?: 'departure' | 'arrival';
        times: ConnectionTime[];
        dataSource?: GoDataSource;
    }) => void;
    onSelectGtfsImport: () => void;
    dayType: DayType;
}

export const ConnectionAddChooser: React.FC<ConnectionAddChooserProps> = ({
    isOpen,
    onClose,
    onSelectManual,
    onSelectTemplate,
    onSelectGtfsImport,
    dayType
}) => {
    const [isLoadingGtfs, setIsLoadingGtfs] = useState(false);
    const [gtfsError, setGtfsError] = useState<string | null>(null);
    const [gtfsNotice, setGtfsNotice] = useState<string | null>(null);

    if (!isOpen) return null;

    const handleQuickTemplate = async (templateId: string) => {
        const template = QUICK_TEMPLATES.find(t => t.id === templateId);
        if (!template) return;
        setGtfsNotice(null);

        // Keep GO templates tied to GTFS cache freshness where possible.
        if (template.id.startsWith('go-') && !isCacheFresh()) {
            try {
                setIsLoadingGtfs(true);
                await fetchGoTransitGTFS();
            } catch (error) {
                console.error('Error refreshing GTFS for template:', error);
                const details = error instanceof Error ? ` (${error.message})` : '';
                setGtfsNotice(`Using fallback GO times because GTFS data is unavailable right now${details}.`);
                // Continue with fallback template data.
            } finally {
                setIsLoadingGtfs(false);
            }
        }

        const data = template.getData(dayType);
        if (template.id.startsWith('go-') && data.dataSource === 'fallback') {
            setGtfsNotice('Using fallback GO times (not GTFS) for this template.');
        }
        onSelectTemplate(data);
    };

    const handleGtfsImport = async () => {
        setIsLoadingGtfs(true);
        setGtfsError(null);

        try {
            await fetchGoTransitGTFS();
            onSelectGtfsImport();
        } catch (error) {
            console.error('Error fetching GTFS:', error);
            const details = error instanceof Error ? ` ${error.message}` : '';
            setGtfsError(`Failed to fetch GO Transit schedule.${details}`);
        } finally {
            setIsLoadingGtfs(false);
        }
    };

    const cacheAge = getCacheAge();
    const hasFreshCache = isCacheFresh();
    const cacheMeta = getCachedData();

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[200]">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-gray-900">
                        Add Connection
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-1 text-gray-400 hover:text-gray-600 rounded"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Options */}
                <div className="p-4 space-y-3">
                    {/* Quick Templates Section */}
                    <div className="space-y-2">
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide px-1">
                            Quick Templates
                        </p>

                        {/* Barrie South GO - Departures */}
                        <button
                            onClick={() => handleQuickTemplate('go-barrie-south-departures')}
                            className="w-full flex items-center gap-3 p-3 bg-gray-50 hover:bg-green-50 border border-gray-200 hover:border-green-300 rounded-lg transition-colors group text-left"
                        >
                            <div className="p-2 bg-green-100 text-green-700 rounded-lg group-hover:bg-green-200">
                                <Train className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900">Barrie South GO Departures</p>
                                <p className="text-sm text-gray-500 truncate">
                                    Bus arrives before train leaves
                                </p>
                            </div>
                            <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-green-600" />
                        </button>

                        {/* Barrie South GO - Arrivals */}
                        <button
                            onClick={() => handleQuickTemplate('go-barrie-south-arrivals')}
                            className="w-full flex items-center gap-3 p-3 bg-gray-50 hover:bg-green-50 border border-gray-200 hover:border-green-300 rounded-lg transition-colors group text-left"
                        >
                            <div className="p-2 bg-green-100 text-green-700 rounded-lg group-hover:bg-green-200">
                                <Train className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900">Barrie South GO Arrivals</p>
                                <p className="text-sm text-gray-500 truncate">
                                    Bus departs after train arrives
                                </p>
                            </div>
                            <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-green-600" />
                        </button>

                        {/* Barrie Allandale Waterfront GO - Departures */}
                        <button
                            onClick={() => handleQuickTemplate('go-allandale-waterfront-departures')}
                            className="w-full flex items-center gap-3 p-3 bg-gray-50 hover:bg-green-50 border border-gray-200 hover:border-green-300 rounded-lg transition-colors group text-left"
                        >
                            <div className="p-2 bg-green-100 text-green-700 rounded-lg group-hover:bg-green-200">
                                <Train className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900">Allandale Waterfront GO Departures</p>
                                <p className="text-sm text-gray-500 truncate">
                                    Bus arrives before train leaves
                                </p>
                            </div>
                            <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-green-600" />
                        </button>

                        {/* Barrie Allandale Waterfront GO - Arrivals */}
                        <button
                            onClick={() => handleQuickTemplate('go-allandale-waterfront-arrivals')}
                            className="w-full flex items-center gap-3 p-3 bg-gray-50 hover:bg-green-50 border border-gray-200 hover:border-green-300 rounded-lg transition-colors group text-left"
                        >
                            <div className="p-2 bg-green-100 text-green-700 rounded-lg group-hover:bg-green-200">
                                <Train className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900">Allandale Waterfront GO Arrivals</p>
                                <p className="text-sm text-gray-500 truncate">
                                    Bus departs after train arrives
                                </p>
                            </div>
                            <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-green-600" />
                        </button>

                        {/* Georgian College */}
                        <button
                            onClick={() => handleQuickTemplate('georgian')}
                            className="w-full flex items-center gap-3 p-3 bg-gray-50 hover:bg-teal-50 border border-gray-200 hover:border-teal-300 rounded-lg transition-colors group text-left"
                        >
                            <div className="p-2 bg-teal-100 text-teal-700 rounded-lg group-hover:bg-teal-200">
                                <Clock className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900">Georgian College Bells</p>
                                <p className="text-sm text-gray-500 truncate">
                                    Pre-filled class bell times
                                </p>
                            </div>
                            <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-teal-600" />
                        </button>
                    </div>

                    {/* Divider */}
                    <div className="border-t border-gray-200 my-4" />

                    {/* Other Options */}
                    <div className="space-y-2">
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide px-1">
                            Other Options
                        </p>

                        {/* Manual Entry */}
                        <button
                            onClick={() => {
                                onClose();
                                onSelectManual();
                            }}
                            className="w-full flex items-center gap-3 p-3 bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-300 rounded-lg transition-colors group text-left"
                        >
                            <div className="p-2 bg-blue-100 text-blue-700 rounded-lg group-hover:bg-blue-200">
                                <Edit3 className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900">Manual Entry</p>
                                <p className="text-sm text-gray-500 truncate">
                                    Create custom connection target
                                </p>
                            </div>
                            <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-blue-600" />
                        </button>

                        {/* GTFS Import */}
                        <button
                            onClick={handleGtfsImport}
                            disabled={isLoadingGtfs}
                            className="w-full flex items-center gap-3 p-3 bg-gray-50 hover:bg-purple-50 border border-gray-200 hover:border-purple-300 rounded-lg transition-colors group text-left disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <div className="p-2 bg-purple-100 text-purple-700 rounded-lg group-hover:bg-purple-200">
                                {isLoadingGtfs ? (
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                ) : (
                                    <Download className="w-5 h-5" />
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900">
                                    Import from GO Transit GTFS
                                </p>
                                <p className="text-sm text-gray-500 truncate">
                                    {isLoadingGtfs
                                        ? 'Fetching Metrolinx schedule...'
                                        : hasFreshCache
                                            ? `Cached ${cacheAge}`
                                            : 'Fetch live schedule data'}
                                </p>
                                {cacheMeta?.fetchedAt && (
                                    <p className="text-[11px] text-gray-400 truncate">
                                        Synced: {new Date(cacheMeta.fetchedAt).toLocaleString()}
                                    </p>
                                )}
                            </div>
                            {hasFreshCache && !isLoadingGtfs && (
                                <RefreshCw className="w-4 h-4 text-gray-400" />
                            )}
                            {!hasFreshCache && !isLoadingGtfs && (
                                <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-purple-600" />
                            )}
                        </button>

                        {/* GTFS Error */}
                        {gtfsError && (
                            <p className="text-sm text-red-600 px-1">
                                {gtfsError}
                            </p>
                        )}
                        {gtfsNotice && (
                            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                                {gtfsNotice}
                            </p>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-gray-200 bg-gray-50">
                    <button
                        onClick={onClose}
                        className="w-full px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConnectionAddChooser;
