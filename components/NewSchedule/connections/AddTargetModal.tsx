/**
 * AddTargetModal
 *
 * Modal for adding manual connection targets (GO trains, College bells).
 */

import React, { useState } from 'react';
import {
    X,
    Plus,
    Train,
    Clock,
    Trash2,
    AlertCircle,
    ToggleLeft,
    ToggleRight,
    ChevronDown,
    ChevronUp
} from 'lucide-react';
import type {
    ConnectionTarget,
    ConnectionTime,
    ConnectionTargetType,
    ConnectionEventType,
    ConnectionQualityWindowSettings
} from '../../../utils/connections/connectionTypes';
import {
    generateConnectionId,
    MAX_SERVICE_MINUTES,
    parseConnectionTime,
    formatConnectionTime,
    DEFAULT_CONNECTION_QUALITY_WINDOW_SETTINGS
} from '../../../utils/connections/connectionTypes';
import type { DayType } from '../../../utils/parsers/masterScheduleParser';
import { formatGapTimeForEvent } from '../../../utils/connections/connectionUtils';

/**
 * Stop with name for auto-populate display.
 */
export interface StopWithName {
    code: string;
    name: string;
    enabled: boolean;
}

export interface StopOption {
    code: string;
    name: string;
}

/**
 * Initial data for pre-filling the form (from templates).
 */
export interface AddTargetInitialData {
    name?: string;
    location?: string;
    stopCode?: string;
    stops?: StopWithName[];      // Stops with names for auto-populate
    icon?: 'train' | 'clock';
    times?: ConnectionTime[];
    autoPopulateStops?: boolean; // Auto-apply to all matching stops
    qualityWindowSettings?: ConnectionQualityWindowSettings; // Optional per-target override
    defaultEventType?: ConnectionEventType;
    dataSource?: 'gtfs' | 'fallback';
}

interface AddTargetModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAdd: (target: Omit<ConnectionTarget, 'id' | 'createdAt' | 'updatedAt'>) => void;
    dayType: DayType;
    existingTargetNames: string[];
    validStopCodes?: string[];
    availableStops?: StopOption[];
    defaultQualityWindowSettings?: ConnectionQualityWindowSettings;
    initialData?: AddTargetInitialData;
    mode?: 'add' | 'edit';
}

export const AddTargetModal: React.FC<AddTargetModalProps> = ({
    isOpen,
    onClose,
    onAdd,
    dayType,
    existingTargetNames,
    validStopCodes,
    availableStops,
    defaultQualityWindowSettings,
    initialData,
    mode = 'add'
}) => {
    type NewTimeEventChoice = 'default' | ConnectionEventType;
    type TimeDayPattern = 'current' | 'weekday' | 'saturday' | 'sunday' | 'daily';
    const [name, setName] = useState('');
    const [location, setLocation] = useState('');
    const [stopCode, setStopCode] = useState('');
    const [stopSearch, setStopSearch] = useState('');
    const [stops, setStops] = useState<StopWithName[]>([]);
    const [autoPopulateStops, setAutoPopulateStops] = useState(false);
    const [icon, setIcon] = useState<'train' | 'clock'>('train');
    const [times, setTimes] = useState<ConnectionTime[]>([]);
    const [newTimeStr, setNewTimeStr] = useState('');
    const [newTimeLabel, setNewTimeLabel] = useState('');
    const [newTimeEventType, setNewTimeEventType] = useState<NewTimeEventChoice>('default');
    const [newTimeDayPattern, setNewTimeDayPattern] = useState<TimeDayPattern>('current');
    const [defaultEventType, setDefaultEventType] = useState<ConnectionEventType>('departure');
    const [previewTripTime, setPreviewTripTime] = useState('8:00 AM');
    const [error, setError] = useState('');
    const [hasInitialized, setHasInitialized] = useState(false);
    const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
    const [useLibraryTimingDefaults, setUseLibraryTimingDefaults] = useState(true);
    const [qualityWindowSettings, setQualityWindowSettings] = useState<ConnectionQualityWindowSettings>(
        defaultQualityWindowSettings || DEFAULT_CONNECTION_QUALITY_WINDOW_SETTINGS
    );
    const knownStopCodes = React.useMemo(
        () => new Set((validStopCodes || []).map(code => code.trim()).filter(Boolean)),
        [validStopCodes]
    );
    const editModeAllowedStopCodes = React.useMemo(() => {
        const allowed = new Set<string>();
        if (mode !== 'edit' || !initialData) return allowed;
        if (initialData.stopCode?.trim()) {
            allowed.add(initialData.stopCode.trim());
        }
        (initialData.stops || []).forEach(stop => {
            const code = stop.code?.trim();
            if (code) allowed.add(code);
        });
        return allowed;
    }, [mode, initialData]);
    const isKnownOrExistingStopCode = React.useCallback((code: string) => {
        const normalized = code.trim();
        if (!normalized) return false;
        return knownStopCodes.has(normalized) || editModeAllowedStopCodes.has(normalized);
    }, [knownStopCodes, editModeAllowedStopCodes]);
    const activeDefaultQualitySettings = React.useMemo(
        () => defaultQualityWindowSettings || DEFAULT_CONNECTION_QUALITY_WINDOW_SETTINGS,
        [defaultQualityWindowSettings]
    );
    const selectableStops = React.useMemo<StopOption[]>(() => {
        const optionMap = new Map<string, string>();
        const sourceStops = stops.length > 0
            ? stops.map(stop => ({ code: stop.code, name: stop.name }))
            : (availableStops || []);

        sourceStops.forEach(stop => {
            const code = stop.code?.trim();
            const name = stop.name?.trim();
            if (!code) return;
            optionMap.set(code, name || `Stop ${code}`);
        });

        editModeAllowedStopCodes.forEach(code => {
            if (!optionMap.has(code)) {
                optionMap.set(code, `Current stop (${code})`);
            }
        });

        return Array.from(optionMap.entries())
            .map(([code, name]) => ({ code, name }))
            .sort((a, b) => {
                const nameCompare = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
                return nameCompare !== 0 ? nameCompare : a.code.localeCompare(b.code, undefined, { sensitivity: 'base' });
            });
    }, [availableStops, editModeAllowedStopCodes, stops]);
    const selectedStopOption = React.useMemo(
        () => selectableStops.find(option => option.code === stopCode.trim()),
        [selectableStops, stopCode]
    );
    const filteredSelectableStops = React.useMemo(() => {
        const query = stopSearch.trim().toLowerCase();
        if (!query) return selectableStops.slice(0, 8);
        return selectableStops
            .filter(option => option.name.toLowerCase().includes(query) || option.code.toLowerCase().includes(query))
            .slice(0, 8);
    }, [selectableStops, stopSearch]);
    const stopPickerEnabled = selectableStops.length > 0 && !(autoPopulateStops && stops.length > 0);

    // Track if icon was set from template (hide Type selector)
    const iconFromTemplate = initialData?.icon !== undefined;

    // Get enabled stop codes for submission
    const enabledStopCodes = stops.filter(s => s.enabled).map(s => s.code);

    // Toggle individual stop
    const handleToggleStop = (code: string) => {
        setStops(stops.map(s =>
            s.code === code ? { ...s, enabled: !s.enabled } : s
        ));
    };

    const selectStopOption = (option: StopOption) => {
        setStopCode(option.code);
        setStopSearch(`${option.name} (${option.code})`);
        setError('');
    };

    React.useEffect(() => {
        if (selectedStopOption && !autoPopulateStops) {
            setStopSearch(`${selectedStopOption.name} (${selectedStopOption.code})`);
        }
    }, [autoPopulateStops, selectedStopOption]);

    // Apply initial data when modal opens with new initialData
    React.useEffect(() => {
        if (isOpen && initialData && !hasInitialized) {
            if (initialData.name) setName(initialData.name);
            if (initialData.location) setLocation(initialData.location);
            if (initialData.stopCode) {
                setStopCode(initialData.stopCode);
                const matchedStop = selectableStops.find(stop => stop.code === initialData.stopCode);
                setStopSearch(matchedStop ? `${matchedStop.name} (${matchedStop.code})` : initialData.stopCode);
            }
            if (initialData.stops) setStops(initialData.stops);
            if (initialData.autoPopulateStops !== undefined) setAutoPopulateStops(initialData.autoPopulateStops);
            if (initialData.icon) setIcon(initialData.icon);
            if (initialData.times) setTimes(initialData.times);
            if (initialData.defaultEventType) {
                setDefaultEventType(initialData.defaultEventType);
            } else {
                setDefaultEventType('departure');
            }
            if (initialData.times && initialData.times.length > 0) {
                setNewTimeEventType(initialData.times[0].eventType || 'default');
            }
            if (initialData.qualityWindowSettings) {
                setQualityWindowSettings(initialData.qualityWindowSettings);
                setUseLibraryTimingDefaults(false);
            } else {
                setQualityWindowSettings(activeDefaultQualitySettings);
                setUseLibraryTimingDefaults(true);
            }
            setIsAdvancedOpen(Boolean(
                initialData.defaultEventType === 'arrival'
                || initialData.qualityWindowSettings
                || initialData.times?.some(time => Boolean(time.eventType))
            ));
            setHasInitialized(true);
        } else if (isOpen && !initialData && !hasInitialized) {
            setQualityWindowSettings(activeDefaultQualitySettings);
            setUseLibraryTimingDefaults(true);
            setIsAdvancedOpen(false);
            setHasInitialized(true);
        }
        if (isOpen && !hasInitialized && !initialData) {
            setStopSearch('');
        }
        // Reset initialization flag when modal closes
        if (!isOpen) {
            setHasInitialized(false);
            setStopSearch('');
            setIsAdvancedOpen(false);
        }
    }, [isOpen, initialData, hasInitialized, activeDefaultQualitySettings, selectableStops]);

    if (!isOpen) return null;

    const getDaysForPattern = (pattern: TimeDayPattern): DayType[] => {
        switch (pattern) {
            case 'weekday':
                return ['Weekday'];
            case 'saturday':
                return ['Saturday'];
            case 'sunday':
                return ['Sunday'];
            case 'daily':
                return ['Weekday', 'Saturday', 'Sunday'];
            case 'current':
            default:
                return [dayType];
        }
    };

    const splitTimeEntries = (value: string): string[] => value
        .split(/[\n,;]+/)
        .map(entry => entry.trim())
        .filter(Boolean);

    // Add one or more times
    const handleAddTime = () => {
        const rawEntries = splitTimeEntries(newTimeStr);

        if (rawEntries.length === 0) {
            setError('Enter at least one time');
            return;
        }

        const parsedMinutes: number[] = [];
        const seenMinutes = new Set<number>();

        for (const rawEntry of rawEntries) {
            const minutes = parseConnectionTime(rawEntry);
            const isMidnight = /^\s*(12:00\s*[ap]m?|00:00)\s*$/i.test(rawEntry);

            if (minutes === 0 && !isMidnight) {
                setError(`Invalid time "${rawEntry}". Use HH:MM AM/PM or HH:MM`);
                return;
            }

            if (minutes < 0 || minutes > MAX_SERVICE_MINUTES) {
                setError(`Time "${rawEntry}" must be between 0 and ${MAX_SERVICE_MINUTES} minutes`);
                return;
            }

            if (seenMinutes.has(minutes) || times.some(t => t.time === minutes)) {
                setError(`Time "${rawEntry}" already exists`);
                return;
            }

            seenMinutes.add(minutes);
            parsedMinutes.push(minutes);
        }

        const daysActive = getDaysForPattern(newTimeDayPattern);
        const newTimes: ConnectionTime[] = parsedMinutes.map(minutes => ({
            id: generateConnectionId(),
            time: minutes,
            label: newTimeLabel.trim() || undefined,
            eventType: newTimeEventType === 'default' ? undefined : newTimeEventType,
            daysActive,
            enabled: true
        }));

        setTimes([...times, ...newTimes].sort((a, b) => a.time - b.time));
        setNewTimeStr('');
        setNewTimeLabel('');
        setError('');
    };

    // Remove a time
    const handleRemoveTime = (timeId: string) => {
        setTimes(times.filter(t => t.id !== timeId));
    };

    // Toggle day for a time
    const handleToggleDay = (timeId: string, day: DayType) => {
        setTimes(times.map(t => {
            if (t.id !== timeId) return t;
            const daysActive = t.daysActive.includes(day)
                ? t.daysActive.filter(d => d !== day)
                : [...t.daysActive, day];
            return { ...t, daysActive };
        }));
    };

    // Submit
    const handleSubmit = () => {
        if (!name.trim()) {
            setError('Name is required');
            return;
        }

        const normalizedName = name.trim().toLowerCase();
        const initialNormalizedName = initialData?.name?.trim().toLowerCase();
        if (existingTargetNames.some(existing => {
            const existingNormalized = existing.trim().toLowerCase();
            if (mode === 'edit' && initialNormalizedName && existingNormalized === initialNormalizedName) {
                return false;
            }
            return existingNormalized === normalizedName;
        })) {
            setError('A target with this name already exists');
            return;
        }

        if (autoPopulateStops && stops.length > 0) {
            if (enabledStopCodes.length === 0) {
                setError('Select at least one stop');
                return;
            }
            if (knownStopCodes.size > 0 && enabledStopCodes.some(code => !isKnownOrExistingStopCode(code))) {
                setError('One or more selected stop codes are not in the loaded schedule stop IDs');
                return;
            }
        } else if (!stopCode.trim()) {
            setError('Stop code is required');
            return;
        } else if (knownStopCodes.size > 0 && !isKnownOrExistingStopCode(stopCode.trim())) {
            setError('Stop code must match a loaded schedule stop ID');
            return;
        }

        if (times.length === 0) {
            setError('Add at least one time');
            return;
        }

        const enabledTimes = times.filter(t => t.enabled && t.daysActive.length > 0);
        if (enabledTimes.length === 0) {
            setError('At least one enabled time with a day selected is required');
            return;
        }

        if (!useLibraryTimingDefaults) {
            if (qualityWindowSettings.goodMin < 0 || qualityWindowSettings.excellentMin < 0 || qualityWindowSettings.excellentMax < 0 || qualityWindowSettings.goodMax < 0) {
                setError('Timing windows must be 0 or greater');
                return;
            }
            if (!(qualityWindowSettings.goodMin <= qualityWindowSettings.excellentMin
                && qualityWindowSettings.excellentMin <= qualityWindowSettings.excellentMax
                && qualityWindowSettings.excellentMax <= qualityWindowSettings.goodMax)) {
                setError('Timing windows must be ordered: Good Min <= Excellent Min <= Excellent Max <= Good Max');
                return;
            }
        }

        onAdd({
            name: name.trim(),
            type: 'manual' as ConnectionTargetType,
            location: location.trim() || undefined,
            stopCode: autoPopulateStops && enabledStopCodes.length > 0 ? enabledStopCodes[0] : stopCode.trim(),
            stopName: autoPopulateStops && enabledStopCodes.length > 0
                ? stops.find(stop => stop.code === enabledStopCodes[0])?.name
                : selectedStopOption?.name,
            icon,
            times,
            color: icon === 'train' ? 'green' : 'teal',
            defaultEventType,
            // Store auto-populate metadata for connection matching
            ...(autoPopulateStops && enabledStopCodes.length > 0 && {
                stopCodes: enabledStopCodes,
                autoPopulateStops: true
            }),
            qualityWindowSettings: useLibraryTimingDefaults ? undefined : qualityWindowSettings
        });

        // Reset form
        setName('');
        setLocation('');
        setStopCode('');
        setStopSearch('');
        setIcon('train');
        setTimes([]);
        setNewTimeEventType('default');
        setNewTimeDayPattern('current');
        setDefaultEventType('departure');
        setIsAdvancedOpen(false);
        setQualityWindowSettings(activeDefaultQualitySettings);
        setUseLibraryTimingDefaults(true);
        setError('');
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[200]">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-gray-900">
                        {mode === 'edit' ? 'Edit Connection Target' : 'Add Connection Target'}
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-1 text-gray-400 hover:text-gray-600 rounded"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                    {/* Error message */}
                    {error && (
                        <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                            <AlertCircle className="w-4 h-4" />
                            {error}
                        </div>
                    )}
                    {initialData?.dataSource === 'fallback' && (
                        <div className="flex items-center gap-2 p-3 bg-amber-50 text-amber-800 rounded-lg text-sm">
                            <AlertCircle className="w-4 h-4" />
                            Using fallback GO times because GTFS-derived times were unavailable.
                        </div>
                    )}
                    {(() => {
                        const effectiveTypes = new Set(
                            times.map(t => t.eventType || defaultEventType)
                        );
                        const hasMissingLabels = times.some(t => !t.label?.trim());
                        if (effectiveTypes.size > 1 && hasMissingLabels) {
                            return (
                                <div className="flex items-center gap-2 p-3 bg-amber-50 text-amber-800 rounded-lg text-sm">
                                    <AlertCircle className="w-4 h-4" />
                                    Mixed DEP/ARR times detected. Add labels to clarify each event.
                                </div>
                            );
                        }
                        return null;
                    })()}

                    {/* Name */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Name *
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g., GO Train to Toronto"
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>

                    {/* Location */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Location
                        </label>
                        <input
                            type="text"
                            value={location}
                            onChange={(e) => setLocation(e.target.value)}
                            placeholder="e.g., Allandale Waterfront GO Station"
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>

                    {/* Stop - show toggle if auto-populate available */}
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <label className="block text-sm font-medium text-gray-700">
                                Stop *
                            </label>
                            {stops.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => setAutoPopulateStops(!autoPopulateStops)}
                                    className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900"
                                >
                                    {autoPopulateStops ? (
                                        <ToggleRight className="w-5 h-5 text-teal-600" />
                                    ) : (
                                        <ToggleLeft className="w-5 h-5 text-gray-400" />
                                    )}
                                    <span>Auto-apply to {location} stops</span>
                                </button>
                            )}
                        </div>

                        {autoPopulateStops && stops.length > 0 ? (
                            <div className="p-3 bg-teal-50 border border-teal-200 rounded-lg">
                                <p className="text-sm text-teal-800 mb-2">
                                    Click stops to toggle on/off:
                                </p>
                                <div className="space-y-1.5">
                                    {stops.map(stop => (
                                        <button
                                            key={stop.code}
                                            type="button"
                                            onClick={() => handleToggleStop(stop.code)}
                                            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-sm transition-colors ${
                                                stop.enabled
                                                    ? 'bg-teal-100 text-teal-800 hover:bg-teal-200'
                                                    : 'bg-gray-100 text-gray-400 hover:bg-gray-200 line-through'
                                            }`}
                                        >
                                            <span className="font-mono text-xs w-8">{stop.code}</span>
                                            <span className="flex-1 truncate">{stop.name}</span>
                                            {stop.enabled && (
                                                <span className="text-teal-600 text-xs">✓</span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                                {enabledStopCodes.length === 0 && (
                                    <p className="text-xs text-red-600 mt-2">
                                        Select at least one stop
                                    </p>
                                )}
                            </div>
                        ) : stopPickerEnabled ? (
                            <div className="space-y-2">
                                <input
                                    type="text"
                                    value={stopSearch}
                                    onChange={(e) => {
                                        const nextValue = e.target.value;
                                        setStopSearch(nextValue);
                                        const normalized = nextValue.trim().toLowerCase();
                                        const exactMatch = selectableStops.find(option => {
                                            const label = `${option.name} (${option.code})`.toLowerCase();
                                            return option.code.toLowerCase() === normalized
                                                || option.name.toLowerCase() === normalized
                                                || label === normalized;
                                        });
                                        setStopCode(exactMatch?.code || '');
                                    }}
                                    placeholder="Search stop name or code"
                                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                                <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                                    {filteredSelectableStops.length > 0 ? (
                                        <div className="max-h-40 overflow-y-auto">
                                            {filteredSelectableStops.map(option => {
                                                const isSelected = option.code === stopCode.trim();
                                                return (
                                                    <button
                                                        key={option.code}
                                                        type="button"
                                                        onClick={() => selectStopOption(option)}
                                                        className={`w-full px-3 py-2 flex items-center justify-between text-left text-sm border-b border-gray-100 last:border-b-0 ${
                                                            isSelected
                                                                ? 'bg-blue-50 text-blue-700'
                                                                : 'hover:bg-gray-50 text-gray-700'
                                                        }`}
                                                    >
                                                        <span className="truncate pr-3">{option.name}</span>
                                                        <span className="font-mono text-xs text-gray-500">{option.code}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="px-3 py-3 text-sm text-gray-500">
                                            No stops match that search.
                                        </div>
                                    )}
                                </div>
                                {selectedStopOption ? (
                                    <p className="text-xs text-gray-600">
                                        Selected: <span className="font-medium text-gray-800">{selectedStopOption.name}</span> ({selectedStopOption.code})
                                    </p>
                                ) : (
                                    <p className="text-xs text-gray-500">
                                        Choose a stop from the list to fill the stop code automatically.
                                    </p>
                                )}
                            </div>
                        ) : (
                            <input
                                type="text"
                                value={stopCode}
                                onChange={(e) => setStopCode(e.target.value)}
                                placeholder="e.g., 1234"
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                        )}
                    </div>

                    {/* Icon/Type - only show when not from template */}
                    {!iconFromTemplate && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Type
                            </label>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setIcon('train')}
                                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border ${
                                        icon === 'train'
                                            ? 'border-green-500 bg-green-50 text-green-700'
                                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                                    }`}
                                >
                                    <Train className="w-4 h-4" />
                                    GO Train
                                </button>
                                <button
                                    onClick={() => setIcon('clock')}
                                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border ${
                                        icon === 'clock'
                                            ? 'border-teal-500 bg-teal-50 text-teal-700'
                                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                                    }`}
                                >
                                    <Clock className="w-4 h-4" />
                                    Bell/Schedule
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Times */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Times *
                        </label>
                        {/* Add time form */}
                        <div className="grid grid-cols-[minmax(0,1.5fr)_auto] gap-2 mb-2">
                            <textarea
                                value={newTimeStr}
                                onChange={(e) => setNewTimeStr(e.target.value)}
                                placeholder="7:15 AM, 8:45 AM or one per line"
                                rows={3}
                                className="min-h-[76px] px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
                            />
                            <select
                                value={newTimeDayPattern}
                                onChange={(e) => setNewTimeDayPattern(e.target.value as TimeDayPattern)}
                                className="w-28 h-fit px-2 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                                title="Day pattern for new times"
                            >
                                <option value="current">{dayType}</option>
                                <option value="weekday">Weekdays</option>
                                <option value="saturday">Saturday</option>
                                <option value="sunday">Sunday</option>
                                <option value="daily">Daily</option>
                            </select>
                        </div>
                        <div className="flex gap-2 mb-3">
                            <input
                                type="text"
                                value={newTimeLabel}
                                onChange={(e) => setNewTimeLabel(e.target.value)}
                                placeholder="Label for added times (optional)"
                                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                            <button
                                onClick={handleAddTime}
                                className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                                title="Add times"
                            >
                                <Plus className="w-4 h-4" />
                            </button>
                        </div>
                        <p className="text-xs text-gray-500 mb-3">
                            Paste several times at once. Separate them with commas, semicolons, or line breaks. The selected day pattern applies to each new time.
                        </p>

                        <button
                            type="button"
                            onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
                            aria-expanded={isAdvancedOpen}
                            aria-controls="add-target-modal-advanced"
                            className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                        >
                            <span>Advanced</span>
                            {isAdvancedOpen ? (
                                <ChevronUp className="w-4 h-4" />
                            ) : (
                                <ChevronDown className="w-4 h-4" />
                            )}
                            <span className="text-xs font-normal text-gray-500">
                                default event, timing preview, quality windows
                            </span>
                        </button>

                        {isAdvancedOpen && (
                            <div id="add-target-modal-advanced" className="space-y-3 mb-3 rounded-lg border border-gray-200 bg-gray-50/70 p-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">
                                        Default Event
                                    </label>
                                    <select
                                        value={defaultEventType}
                                        onChange={(e) => setDefaultEventType(e.target.value as ConnectionEventType)}
                                        aria-label="Default connection event"
                                        className="px-2 py-1 border border-gray-200 rounded text-sm bg-white"
                                    >
                                        <option value="departure">Departure</option>
                                        <option value="arrival">Arrival</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">
                                        Event for New Times
                                    </label>
                                    <select
                                        value={newTimeEventType}
                                        onChange={(e) => setNewTimeEventType(e.target.value as NewTimeEventChoice)}
                                        aria-label="New time event override"
                                        className="w-36 px-2 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                                        title="Connection event type"
                                    >
                                        <option value="default">Use default</option>
                                        <option value="departure">Departure</option>
                                        <option value="arrival">Arrival</option>
                                    </select>
                                    <p className="mt-1 text-xs text-gray-500">
                                        Use this when a new time needs a different connection side than the default.
                                    </p>
                                </div>

                                {times.length > 0 && (
                                    <div className="border border-gray-200 rounded-lg p-3 bg-white">
                                        <div className="flex items-center justify-between mb-2">
                                            <label className="text-sm font-medium text-gray-700">Preview Simulation</label>
                                            <input
                                                type="text"
                                                value={previewTripTime}
                                                onChange={(e) => setPreviewTripTime(e.target.value)}
                                                className="w-28 px-2 py-1 border border-gray-200 rounded text-sm"
                                                placeholder="8:00 AM"
                                            />
                                        </div>
                                        {(() => {
                                            const previewMinutes = parseConnectionTime(previewTripTime);
                                            const isMidnight = /^\s*(12:00\s*[ap]m?|00:00)\s*$/i.test(previewTripTime);
                                            if (previewMinutes === 0 && !isMidnight) {
                                                return <p className="text-xs text-gray-500">Enter valid preview time.</p>;
                                            }
                                            const activeTimes = times.filter(t => t.enabled && t.daysActive.includes(dayType));
                                            if (activeTimes.length === 0) {
                                                return <p className="text-xs text-gray-500">No enabled times for {dayType}.</p>;
                                            }

                                            const ranked = activeTimes
                                                .map(t => {
                                                    const eventType = t.eventType || defaultEventType;
                                                    const gap = eventType === 'arrival'
                                                        ? previewMinutes - t.time
                                                        : t.time - previewMinutes;
                                                    return { time: t, eventType, gap };
                                                })
                                                .sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap))
                                                .slice(0, 3);

                                            return (
                                                <div className="space-y-1">
                                                    {ranked.map(item => (
                                                        <div key={item.time.id} className="text-xs text-gray-700 flex items-center justify-between">
                                                            <span>
                                                                {formatConnectionTime(item.time.time)} {item.time.label || ''}
                                                                <span className="ml-1 px-1 rounded bg-gray-100">
                                                                    {item.eventType === 'arrival' ? 'ARR' : 'DEP'}
                                                                </span>
                                                            </span>
                                                            <span>{formatGapTimeForEvent(item.gap, item.eventType)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            );
                                        })()}
                                    </div>
                                )}

                                <div className="border border-gray-200 rounded-lg p-3 bg-white">
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="block text-sm font-medium text-gray-700">
                                            Connection Timing
                                        </label>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const nextUseDefault = !useLibraryTimingDefaults;
                                                setUseLibraryTimingDefaults(nextUseDefault);
                                                if (nextUseDefault) {
                                                    setQualityWindowSettings(activeDefaultQualitySettings);
                                                }
                                            }}
                                            className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900"
                                        >
                                            {useLibraryTimingDefaults ? (
                                                <ToggleRight className="w-5 h-5 text-teal-600" />
                                            ) : (
                                                <ToggleLeft className="w-5 h-5 text-gray-400" />
                                            )}
                                            <span>Use library default</span>
                                        </button>
                                    </div>
                                    {!useLibraryTimingDefaults && (
                                        <div className="grid grid-cols-2 gap-2">
                                            <label className="text-xs text-gray-600">
                                                Good Min
                                                <input
                                                    type="number"
                                                    min={0}
                                                    value={qualityWindowSettings.goodMin}
                                                    onChange={(e) => setQualityWindowSettings({ ...qualityWindowSettings, goodMin: Number(e.target.value || 0) })}
                                                    className="mt-1 w-full px-2 py-1 border border-gray-200 rounded text-sm"
                                                />
                                            </label>
                                            <label className="text-xs text-gray-600">
                                                Excellent Min
                                                <input
                                                    type="number"
                                                    min={0}
                                                    value={qualityWindowSettings.excellentMin}
                                                    onChange={(e) => setQualityWindowSettings({ ...qualityWindowSettings, excellentMin: Number(e.target.value || 0) })}
                                                    className="mt-1 w-full px-2 py-1 border border-gray-200 rounded text-sm"
                                                />
                                            </label>
                                            <label className="text-xs text-gray-600">
                                                Excellent Max
                                                <input
                                                    type="number"
                                                    min={0}
                                                    value={qualityWindowSettings.excellentMax}
                                                    onChange={(e) => setQualityWindowSettings({ ...qualityWindowSettings, excellentMax: Number(e.target.value || 0) })}
                                                    className="mt-1 w-full px-2 py-1 border border-gray-200 rounded text-sm"
                                                />
                                            </label>
                                            <label className="text-xs text-gray-600">
                                                Good Max
                                                <input
                                                    type="number"
                                                    min={0}
                                                    value={qualityWindowSettings.goodMax}
                                                    onChange={(e) => setQualityWindowSettings({ ...qualityWindowSettings, goodMax: Number(e.target.value || 0) })}
                                                    className="mt-1 w-full px-2 py-1 border border-gray-200 rounded text-sm"
                                                />
                                            </label>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Time list */}
                        {times.length === 0 ? (
                            <div className="text-sm text-gray-500 text-center py-4 bg-gray-50 rounded-lg">
                                No times added yet
                            </div>
                        ) : (
                            <div className="space-y-2 max-h-48 overflow-y-auto">
                                {times.map(time => (
                                    <div
                                        key={time.id}
                                        className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg"
                                    >
                                        <span className="font-mono text-sm font-medium text-gray-900 w-20">
                                            {formatConnectionTime(time.time)}
                                        </span>
                                        <span className="text-sm text-gray-500 flex-1 truncate">
                                            {time.label || '-'}
                                        </span>
                                        <span
                                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                                !time.eventType
                                                    ? 'bg-gray-100 text-gray-700'
                                                    : time.eventType === 'arrival'
                                                        ? 'bg-indigo-100 text-indigo-700'
                                                        : 'bg-emerald-100 text-emerald-700'
                                            }`}
                                            title={!time.eventType
                                                ? `Inherits ${defaultEventType === 'arrival' ? 'Arrival' : 'Departure'} default`
                                                : time.eventType === 'arrival' ? 'Arrival event' : 'Departure event'}
                                        >
                                            {!time.eventType ? 'DEF' : time.eventType === 'arrival' ? 'ARR' : 'DEP'}
                                        </span>
                                        {/* Day toggles */}
                                        <div className="flex gap-1">
                                            {(['Weekday', 'Saturday', 'Sunday'] as DayType[]).map(day => (
                                                <button
                                                    key={day}
                                                    onClick={() => handleToggleDay(time.id, day)}
                                                    className={`px-1.5 py-0.5 text-xs rounded ${
                                                        time.daysActive.includes(day)
                                                            ? 'bg-blue-100 text-blue-700'
                                                            : 'bg-gray-200 text-gray-400'
                                                    }`}
                                                >
                                                    {day.slice(0, 3)}
                                                </button>
                                            ))}
                                        </div>
                                        <button
                                            onClick={() => handleRemoveTime(time.id)}
                                            className="p-1 text-gray-400 hover:text-red-500"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                        {mode === 'edit' ? 'Save Changes' : 'Add Target'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AddTargetModal;
