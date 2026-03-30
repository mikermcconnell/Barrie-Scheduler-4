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
import type { DayType } from '../../../utils/parsers/masterScheduleParser';
import type { ConnectionTime } from '../../../utils/connections/connectionTypes';
import type { GoDataSource } from '../../../utils/gtfs/goTransitService';
import {
    QUICK_TEMPLATES,
    fetchGoTransitGTFS,
    getBarrieGoStops,
    getCachedData,
    isCacheFresh,
    getCacheAge
} from '../../../utils/gtfs/goTransitService';

export interface ConnectionTemplateSelection {
    name: string;
    location: string;
    stopCode: string;
    icon: 'train' | 'clock';
    defaultEventType?: 'departure' | 'arrival';
    times: ConnectionTime[];
    dataSource?: GoDataSource;
}

export interface ConnectionAddChooserProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectManual: () => void;
    onSelectTemplate: (data: ConnectionTemplateSelection) => void;
    onSelectGtfsImport: (targets: ConnectionTemplateSelection[]) => void;
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
    const [selectedGtfsTemplateIds, setSelectedGtfsTemplateIds] = useState<string[]>([]);
    const [isGoTemplateBuilderOpen, setIsGoTemplateBuilderOpen] = useState(false);
    const [selectedGoStationId, setSelectedGoStationId] = useState<'barrie-south' | 'allandale-waterfront'>('allandale-waterfront');
    const [selectedGoServiceType, setSelectedGoServiceType] = useState<'departures' | 'arrivals'>('departures');

    if (!isOpen) return null;
    const goTemplateIds = [
        'go-barrie-south-departures',
        'go-barrie-south-arrivals',
        'go-allandale-waterfront-departures',
        'go-allandale-waterfront-arrivals'
    ];
    const goStations = getBarrieGoStops();
    const goGtfsTemplates = goTemplateIds
        .map(id => QUICK_TEMPLATES.find(template => template.id === id))
        .filter((template): template is NonNullable<typeof template> => !!template);

    const toggleGtfsTemplate = (templateId: string) => {
        setSelectedGtfsTemplateIds(current =>
            current.includes(templateId)
                ? current.filter(id => id !== templateId)
                : [...current, templateId]
        );
        setGtfsError(null);
    };

    const getScopedGoTemplateId = (
        stationId: 'barrie-south' | 'allandale-waterfront',
        serviceType: 'departures' | 'arrivals'
    ) => `${stationId === 'barrie-south' ? 'go-barrie-south' : 'go-allandale-waterfront'}-${serviceType}`;

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
        setIsGoTemplateBuilderOpen(false);
        onSelectTemplate(data);
    };

    const handleGtfsImport = async () => {
        if (selectedGtfsTemplateIds.length === 0) {
            setGtfsError('Select at least one GO target to import.');
            return;
        }

        setIsLoadingGtfs(true);
        setGtfsError(null);
        setGtfsNotice(null);

        let fetchErrorDetails = '';

        try {
            await fetchGoTransitGTFS();
        } catch (error) {
            console.error('Error fetching GTFS:', error);
            fetchErrorDetails = error instanceof Error ? ` (${error.message})` : '';
            setGtfsNotice(`GTFS refresh failed; importing fallback GO times${fetchErrorDetails}.`);
        }

        try {
            const importedTargets = selectedGtfsTemplateIds
                .map((id) => QUICK_TEMPLATES.find(t => t.id === id))
                .filter((template): template is NonNullable<typeof template> => !!template)
                .map(template => template.getData(dayType));

            if (importedTargets.length === 0) {
                setGtfsError('No GO template targets are configured.');
                return;
            }

            const fallbackCount = importedTargets.filter(target => target.dataSource === 'fallback').length;
            if (fallbackCount > 0 && !fetchErrorDetails) {
                setGtfsNotice(`Imported with fallback GO times for ${fallbackCount} target(s).`);
            }

            onSelectGtfsImport(importedTargets);
        } catch (error) {
            console.error('Error importing GO targets:', error);
            const details = error instanceof Error ? ` ${error.message}` : '';
            setGtfsError(`Failed to import GO connection targets.${details}`);
        } finally {
            setIsLoadingGtfs(false);
        }
    };

    const handleImportAllGoTemplates = async () => {
        if (selectedGtfsTemplateIds.length !== goTemplateIds.length) {
            setSelectedGtfsTemplateIds(goTemplateIds);
        }
        await (async () => {
            setIsLoadingGtfs(true);
            setGtfsError(null);
            setGtfsNotice(null);

            let fetchErrorDetails = '';

            try {
                await fetchGoTransitGTFS();
            } catch (error) {
                console.error('Error fetching GTFS:', error);
                fetchErrorDetails = error instanceof Error ? ` (${error.message})` : '';
                setGtfsNotice(`GTFS refresh failed; importing fallback GO times${fetchErrorDetails}.`);
            }

            try {
                const importedTargets = goTemplateIds
                    .map((id) => QUICK_TEMPLATES.find(t => t.id === id))
                    .filter((template): template is NonNullable<typeof template> => !!template)
                    .map(template => template.getData(dayType));

                if (importedTargets.length === 0) {
                    setGtfsError('No GO template targets are configured.');
                    return;
                }

                const fallbackCount = importedTargets.filter(target => target.dataSource === 'fallback').length;
                if (fallbackCount > 0 && !fetchErrorDetails) {
                    setGtfsNotice(`Imported with fallback GO times for ${fallbackCount} target(s).`);
                }

                onSelectGtfsImport(importedTargets);
            } catch (error) {
                console.error('Error importing GO targets:', error);
                const details = error instanceof Error ? ` ${error.message}` : '';
                setGtfsError(`Failed to import GO connection targets.${details}`);
            } finally {
                setIsLoadingGtfs(false);
            }
        })();
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

                        <button
                            type="button"
                            onClick={() => setIsGoTemplateBuilderOpen(!isGoTemplateBuilderOpen)}
                            aria-expanded={isGoTemplateBuilderOpen}
                            aria-controls="go-template-builder"
                            className="w-full flex items-center gap-3 p-3 bg-gray-50 hover:bg-green-50 border border-gray-200 hover:border-green-300 rounded-lg transition-colors group text-left"
                        >
                            <div className="p-2 bg-green-100 text-green-700 rounded-lg group-hover:bg-green-200">
                                <Train className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900">GO Train</p>
                                <p className="text-sm text-gray-500 truncate">
                                    Pick station and arrivals or departures
                                </p>
                            </div>
                            <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-green-600" />
                        </button>

                        {isGoTemplateBuilderOpen && (
                            <div
                                id="go-template-builder"
                                className="rounded-lg border border-green-200 bg-green-50/60 p-3 space-y-3"
                            >
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <label className="text-xs text-gray-600">
                                        Station
                                        <select
                                            value={selectedGoStationId}
                                            onChange={(e) => setSelectedGoStationId(e.target.value as 'barrie-south' | 'allandale-waterfront')}
                                            className="mt-1 w-full px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                                        >
                                            {goStations.map(station => (
                                                <option key={station.id} value={station.id}>
                                                    {station.name}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="text-xs text-gray-600">
                                        Train times
                                        <select
                                            value={selectedGoServiceType}
                                            onChange={(e) => setSelectedGoServiceType(e.target.value as 'departures' | 'arrivals')}
                                            className="mt-1 w-full px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                                        >
                                            <option value="departures">Departures</option>
                                            <option value="arrivals">Arrivals</option>
                                        </select>
                                    </label>
                                </div>
                                <p className="text-xs text-gray-600">
                                    {selectedGoServiceType === 'departures'
                                        ? 'Bus should arrive before the train leaves.'
                                        : 'Bus should depart after the train arrives.'}
                                </p>
                                <button
                                    type="button"
                                    onClick={() => handleQuickTemplate(getScopedGoTemplateId(selectedGoStationId, selectedGoServiceType))}
                                    className="w-full px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium"
                                >
                                    Add GO template
                                </button>
                                <button
                                    type="button"
                                    onClick={handleImportAllGoTemplates}
                                    disabled={isLoadingGtfs}
                                    className="w-full px-3 py-2 bg-white border border-green-200 text-green-700 rounded-lg hover:bg-green-50 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Add all GO trains
                                </button>
                            </div>
                        )}

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
                        <div className="rounded-lg border border-purple-200 bg-purple-50/50 p-3 space-y-3">
                            <div>
                                <p className="text-sm font-medium text-gray-900">
                                    GO GTFS Import Scope
                                </p>
                                <p className="text-xs text-gray-600 mt-1">
                                    Choose only the GO target(s) you want to bring in.
                                </p>
                            </div>

                            <div className="space-y-2">
                                {goGtfsTemplates.map(template => {
                                    const isSelected = selectedGtfsTemplateIds.includes(template.id);
                                    return (
                                        <label
                                            key={template.id}
                                            className={`flex items-start gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                                                isSelected
                                                    ? 'border-purple-300 bg-white'
                                                    : 'border-purple-100 bg-white/70 hover:bg-white'
                                            }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => toggleGtfsTemplate(template.id)}
                                                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                            />
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium text-gray-900">
                                                    {template.name}
                                                </p>
                                                <p className="text-xs text-gray-500">
                                                    {template.description}
                                                </p>
                                            </div>
                                        </label>
                                    );
                                })}
                            </div>

                            <div className="flex items-center justify-between gap-3">
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSelectedGtfsTemplateIds(goTemplateIds);
                                            setGtfsError(null);
                                        }}
                                        className="px-2.5 py-1 text-xs font-medium text-purple-700 hover:bg-purple-100 rounded"
                                    >
                                        Select all
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSelectedGtfsTemplateIds([]);
                                            setGtfsError(null);
                                        }}
                                        className="px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded"
                                    >
                                        Clear
                                    </button>
                                </div>
                                <span className="text-xs text-gray-500">
                                    {selectedGtfsTemplateIds.length} selected
                                </span>
                            </div>

                            <button
                                onClick={handleGtfsImport}
                                disabled={isLoadingGtfs || selectedGtfsTemplateIds.length === 0}
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
                                        Import selected GO targets
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
                        </div>

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
