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
import type { ConnectionTime, StopInfo } from '../../../utils/connections/connectionTypes';
import type { GoDataSource } from '../../../utils/gtfs/goTransitService';
import {
    QUICK_TEMPLATES,
    fetchGoTransitGTFS,
    getBarrieGoStops,
    getCachedData,
    isCacheFresh,
    getCacheAge
} from '../../../utils/gtfs/goTransitService';
import { buildRouteAttachmentPreview } from '../../../utils/connections/routeConnectionDefaults';

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
    routeAttachmentContext?: {
        routeLabel: string;
        availableStops?: StopInfo[];
    };
}

export const ConnectionAddChooser: React.FC<ConnectionAddChooserProps> = ({
    isOpen,
    onClose,
    onSelectManual,
    onSelectTemplate,
    onSelectGtfsImport,
    dayType,
    routeAttachmentContext
}) => {
    const [isLoadingGtfs, setIsLoadingGtfs] = useState(false);
    const [gtfsError, setGtfsError] = useState<string | null>(null);
    const [gtfsNotice, setGtfsNotice] = useState<string | null>(null);
    const [selectedGtfsTemplateIds, setSelectedGtfsTemplateIds] = useState<string[]>([]);
    const [isGoTemplateBuilderOpen, setIsGoTemplateBuilderOpen] = useState(false);
    const [selectedGoStationId, setSelectedGoStationId] = useState<'barrie-south' | 'allandale-waterfront'>('allandale-waterfront');
    const [selectedGoServiceType, setSelectedGoServiceType] = useState<'departures' | 'arrivals'>('departures');

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
    const routeScopedTitle = routeAttachmentContext
        ? `Create connection for ${routeAttachmentContext.routeLabel}`
        : 'Add connection';
    const routeScopedSubtitle = routeAttachmentContext
        ? `Create a new connection, then add it to ${routeAttachmentContext.routeLabel} on ${dayType}.`
        : 'Choose what this route should connect with.';
    const singleGoActionLabel = routeAttachmentContext
        ? `Use this GO connection for ${routeAttachmentContext.routeLabel}`
        : 'Use this GO connection';
    const importAllGoLabel = routeAttachmentContext
        ? `Add all GO options to ${routeAttachmentContext.routeLabel}`
        : 'Import all GO options';
    const importSelectedGoLabel = routeAttachmentContext
        ? `Save and add selected GO options to ${routeAttachmentContext.routeLabel}`
        : 'Import selected GO options';
    const selectedRoutePreviews = routeAttachmentContext
        ? selectedGtfsTemplateIds
            .map(templateId => QUICK_TEMPLATES.find(template => template.id === templateId))
            .filter((template): template is NonNullable<typeof template> => !!template)
            .map(template => {
                const target = template.getData(dayType);
                const preview = buildRouteAttachmentPreview(
                    target,
                    routeAttachmentContext.availableStops || [],
                    dayType
                );
                return {
                    id: template.id,
                    name: target.name,
                    location: target.location,
                    preview
                };
            })
        : [];
    const selectedPreviewMissingStopCount = selectedRoutePreviews.filter(entry => !entry.preview.canAttach).length;

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-black bg-opacity-50 p-4 sm:items-center">
            <div className="my-auto flex max-h-[calc(100vh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-xl">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900">
                            {routeScopedTitle}
                        </h2>
                        <p className="text-sm text-gray-500">
                            {routeScopedSubtitle}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1 text-gray-400 hover:text-gray-600 rounded"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Options */}
                <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3">
                    {routeAttachmentContext && (
                        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                            <p className="text-sm font-medium text-blue-900">
                                Route-first add mode
                            </p>
                            <p className="text-xs text-blue-700 mt-1">
                                Anything you choose here will be saved first and then added to {routeAttachmentContext.routeLabel} for {dayType}.
                            </p>
                        </div>
                    )}
                    {/* Quick Templates Section */}
                    <div className="space-y-2">
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide px-1">
                            Common connections
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
                                    Pick a station and whether the bus connects before departure or after arrival
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
                                        Bus timing
                                        <select
                                            value={selectedGoServiceType}
                                            onChange={(e) => setSelectedGoServiceType(e.target.value as 'departures' | 'arrivals')}
                                            className="mt-1 w-full px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                                        >
                                            <option value="departures">Before departure</option>
                                            <option value="arrivals">After arrival</option>
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
                                    {singleGoActionLabel}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleImportAllGoTemplates}
                                    disabled={isLoadingGtfs}
                                    className="w-full px-3 py-2 bg-white border border-green-200 text-green-700 rounded-lg hover:bg-green-50 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {importAllGoLabel}
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
                                    Use pre-filled class and bell times
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
                            Custom connection
                        </p>

                        {/* Manual Entry */}
                        <button
                            onClick={() => {
                                onSelectManual();
                            }}
                            className="w-full flex items-center gap-3 p-3 bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-300 rounded-lg transition-colors group text-left"
                        >
                            <div className="p-2 bg-blue-100 text-blue-700 rounded-lg group-hover:bg-blue-200">
                                <Edit3 className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900">Create custom connection</p>
                                <p className="text-sm text-gray-500 truncate">
                                    Make a new connection with your own times and stop
                                </p>
                            </div>
                            <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-blue-600" />
                        </button>

                        {/* GTFS Import */}
                        <div className="rounded-lg border border-purple-200 bg-purple-50/50 p-3 space-y-3">
                            <div>
                                <p className="text-sm font-medium text-gray-900">
                                    {routeAttachmentContext ? 'Add several GO options at once' : 'Bring in GO schedule data'}
                                </p>
                                <p className="text-xs text-gray-600 mt-1">
                                    {routeAttachmentContext
                                        ? `Choose the GO options you want to save and add to ${routeAttachmentContext.routeLabel}.`
                                        : 'Choose the GO options you want to add from live schedule data.'}
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
                                        Select all GO options
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
                            {routeAttachmentContext && (
                                <div className="rounded border border-purple-200 bg-white/80 px-3 py-2">
                                    <p className="text-xs font-medium text-purple-800">
                                        {selectedGtfsTemplateIds.length === 0
                                            ? `Select one or more GO options to add to ${routeAttachmentContext.routeLabel}.`
                                            : `${selectedGtfsTemplateIds.length} GO option${selectedGtfsTemplateIds.length === 1 ? '' : 's'} will be saved and attached to ${routeAttachmentContext.routeLabel}.`}
                                    </p>
                                    <p className="text-[11px] text-purple-700 mt-1">
                                        Matching route stops will be selected automatically when possible.
                                    </p>
                                </div>
                            )}
                            {routeAttachmentContext && selectedRoutePreviews.length > 0 && (
                                <div className="rounded border border-purple-200 bg-white p-3 space-y-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <p className="text-xs font-semibold uppercase tracking-wide text-purple-800">
                                                Route attach preview
                                            </p>
                                            <p className="text-xs text-purple-700 mt-1">
                                                Review which stop each GO option will use on {routeAttachmentContext.routeLabel} before saving.
                                            </p>
                                        </div>
                                        <span className="text-[11px] font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded px-2 py-1">
                                            {selectedRoutePreviews.length} selected
                                        </span>
                                    </div>

                                    <div className="space-y-2">
                                        {selectedRoutePreviews.map(entry => (
                                            <div
                                                key={entry.id}
                                                className="rounded-lg border border-purple-100 bg-purple-50/40 p-3"
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <p className="text-sm font-medium text-gray-900">
                                                            {entry.name}
                                                        </p>
                                                        {entry.location && (
                                                            <p className="text-xs text-gray-500 mt-0.5">
                                                                {entry.location}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <span className={`text-[11px] font-medium rounded px-2 py-1 border ${
                                                        entry.preview.canAttach
                                                            ? 'border-blue-200 bg-blue-50 text-blue-700'
                                                            : 'border-amber-200 bg-amber-50 text-amber-800'
                                                    }`}>
                                                        {entry.preview.canAttach ? 'Ready to attach' : 'Needs route stop'}
                                                    </span>
                                                </div>

                                                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                                                    <div>
                                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                                                            Route stop
                                                        </p>
                                                        {entry.preview.canAttach ? (
                                                            <p className="text-sm text-gray-900">
                                                                {entry.preview.stopName || 'Matched stop'} <span className="text-gray-500">({entry.preview.stopCode})</span>
                                                            </p>
                                                        ) : (
                                                            <p className="text-sm text-amber-800">
                                                                Pick a route stop after save
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div>
                                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                                                            Timing rule
                                                        </p>
                                                        <p className="text-sm text-gray-900">
                                                            {entry.preview.ruleSummary}
                                                        </p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                                                            Active events
                                                        </p>
                                                        {entry.preview.activeEventCount > 0 ? (
                                                            <p className="text-sm text-gray-900">
                                                                {entry.preview.activeEventPreview.join(' • ')}
                                                                {entry.preview.activeEventCount > entry.preview.activeEventPreview.length
                                                                    ? ` • +${entry.preview.activeEventCount - entry.preview.activeEventPreview.length} more`
                                                                    : ''}
                                                            </p>
                                                        ) : (
                                                            <p className="text-sm text-gray-500">
                                                                No active {dayType.toLowerCase()} GO events in this preview yet
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {selectedPreviewMissingStopCount > 0 && (
                                        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2">
                                            <p className="text-xs font-medium text-amber-800">
                                                {selectedPreviewMissingStopCount} selected GO option{selectedPreviewMissingStopCount === 1 ? '' : 's'} still need a route stop match before they can attach automatically.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}

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
                                        {importSelectedGoLabel}
                                    </p>
                                    <p className="text-sm text-gray-500 truncate">
                                        {isLoadingGtfs
                                            ? 'Fetching GO schedule data...'
                                            : hasFreshCache
                                                ? `Cached ${cacheAge}`
                                                : 'Fetch live GO schedule data'}
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
