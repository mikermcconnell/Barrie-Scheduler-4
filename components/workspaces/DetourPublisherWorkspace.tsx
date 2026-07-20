import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactElement,
    type ReactNode,
} from 'react';
import {
    AlertTriangle,
    Archive,
    ArrowLeft,
    Bus,
    CalendarClock,
    Check,
    Clipboard,
    Copy,
    Download,
    FileImage,
    FileText,
    Link2,
    Loader2,
    MapPin,
    MousePointer2,
    Plus,
    RefreshCw,
    Route,
    Save,
    Search,
    Trash2,
    Undo2,
    Upload,
    X,
} from 'lucide-react';

import { useAuth } from '../contexts/AuthContext';
import { useTeam } from '../contexts/TeamContext';
import { useToast } from '../contexts/ToastContext';
import {
    DetourMapCanvas,
    type DetourMapCanvasHandle,
    type DetourMapMode,
    type DetourMapSelection,
} from '../detours/DetourMapCanvas';
import { DetourNoticePreview } from '../detours/DetourNoticePreview';
import { createDetourNotice } from '../../utils/detours/detourFactory';
import { createDetourOverlayFromGtfsPattern } from '../../utils/detours/detourGtfsAdapter';
import {
    deleteDetourControlPoint,
    moveDetourControlPoint,
    snapDetourWaypointsToRoad,
} from '../../utils/detours/detourAuthoring';
import {
    splitDetourRoute,
    suggestBypassedStopIds,
    type DetourRouteAnchor,
} from '../../utils/detours/detourGeometry';
import {
    deleteDetourNotice,
    duplicateDetourNotice,
    listDetourNotices,
    loadDetourNotice,
    markDetourPosted,
    saveDetourNotice,
    DetourRevisionConflictError,
} from '../../utils/detours/detourNoticeService';
import { validateDetourNotice } from '../../utils/detours/detourValidation';
import type {
    DetourCoordinate,
    DetourDay,
    DetourNotice,
    DetourNoticeSummary,
    DetourNoticeType,
    DetourRouteOverlay,
    DetourStopImpactStatus,
} from '../../utils/detours/detourTypes';
import {
    buildMyRideCopyPackage,
    toDetourExportNoticeInput,
} from '../../utils/detours/detourCopy';
import {
    captureDetourNoticePng,
    downloadBlob,
    downloadDetourPdf,
} from '../../utils/detours/detourExport';
import { loadRoutePlanner2GtfsImportPatterns } from '../../utils/route-planner-2/routePlanner2GtfsClient';
import type { RoutePlanner2GtfsImportPattern } from '../../utils/route-planner-2/routePlanner2GtfsImport';
import { useUnsavedChangesWarning } from '../../hooks/useUnsavedChangesWarning';

interface DetourPublisherWorkspaceProps {
    onClose: () => void;
}

type WorkspaceScreen = 'library' | 'editor';
type LibraryFilter = 'all' | 'draft' | 'upcoming' | 'active' | 'update-needed' | 'expired' | 'archived';

const DAYS: Array<{ id: DetourDay; label: string }> = [
    { id: 'monday', label: 'Mon' },
    { id: 'tuesday', label: 'Tue' },
    { id: 'wednesday', label: 'Wed' },
    { id: 'thursday', label: 'Thu' },
    { id: 'friday', label: 'Fri' },
    { id: 'saturday', label: 'Sat' },
    { id: 'sunday', label: 'Sun' },
];

function cx(...classes: Array<string | false | null | undefined>): string {
    return classes.filter(Boolean).join(' ');
}

function formatUpdated(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
        month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
        timeZone: 'America/Toronto',
    }).format(date);
}

function getSummaryState(summary: DetourNoticeSummary, now = new Date()): Exclude<LibraryFilter, 'all'> {
    if (summary.status === 'archived') return 'archived';
    if (summary.status === 'draft') return 'draft';
    if (summary.latestPostedRevision === null || summary.revision > summary.latestPostedRevision) return 'update-needed';
    const local = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now);
    const get = (part: Intl.DateTimeFormatPartTypes) => local.find(item => item.type === part)?.value ?? '';
    const current = `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
    const start = `${summary.schedule.startDate}T${summary.schedule.startTime}`;
    if (current < start) return 'upcoming';
    if (summary.schedule.end.mode === 'fixed' && current > `${summary.schedule.end.date}T${summary.schedule.end.time}`) return 'expired';
    return 'active';
}

function statusClass(status: Exclude<LibraryFilter, 'all'>): string {
    switch (status) {
        case 'active': return 'bg-emerald-100 text-emerald-700';
        case 'upcoming': return 'bg-blue-100 text-blue-700';
        case 'update-needed': return 'bg-amber-100 text-amber-800';
        case 'expired': return 'bg-slate-200 text-slate-600';
        case 'archived': return 'bg-gray-100 text-gray-500';
        default: return 'bg-indigo-100 text-indigo-700';
    }
}

function statusLabel(status: Exclude<LibraryFilter, 'all'>): string {
    return status === 'update-needed' ? 'Update needed' : `${status[0]?.toUpperCase()}${status.slice(1)}`;
}

function isValidMyRideUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && (url.hostname === 'myridebarrie.ca' || url.hostname === 'www.myridebarrie.ca');
    } catch {
        return false;
    }
}

function walkingDistanceMetres(first: DetourCoordinate, second: DetourCoordinate): number {
    const radians = (value: number) => value * Math.PI / 180;
    const dLat = radians(second.latitude - first.latitude);
    const dLng = radians(second.longitude - first.longitude);
    const lat1 = radians(first.latitude);
    const lat2 = radians(second.latitude);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return Math.round(6_371_000 * 2 * Math.asin(Math.sqrt(a)));
}

function labelsCollide(labels: Array<{ position: DetourCoordinate }>): boolean {
    return labels.some((label, index) => labels.slice(index + 1)
        .some(other => walkingDistanceMetres(label.position, other.position) < 35));
}

function cloneNotice(notice: DetourNotice): DetourNotice {
    return structuredClone(notice);
}

export function DetourPublisherWorkspace({ onClose }: DetourPublisherWorkspaceProps) {
    const { user } = useAuth();
    const { team } = useTeam();
    const toast = useToast();
    const [screen, setScreen] = useState<WorkspaceScreen>('library');
    const [summaries, setSummaries] = useState<DetourNoticeSummary[]>([]);
    const [libraryLoading, setLibraryLoading] = useState(true);
    const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('all');
    const [librarySearch, setLibrarySearch] = useState('');
    const [notice, setNotice] = useState<DetourNotice | null>(null);
    const [history, setHistory] = useState<DetourNotice[]>([]);
    const [future, setFuture] = useState<DetourNotice[]>([]);
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [activeOverlayId, setActiveOverlayId] = useState<string | null>(null);
    const [mapMode, setMapMode] = useState<DetourMapMode>('select');
    const [mapSelection, setMapSelection] = useState<DetourMapSelection>(null);
    const [snappingOverlayId, setSnappingOverlayId] = useState<string | null>(null);
    const [showRoutePicker, setShowRoutePicker] = useState(false);
    const [patterns, setPatterns] = useState<RoutePlanner2GtfsImportPattern[]>([]);
    const [patternsLoading, setPatternsLoading] = useState(false);
    const [patternQuery, setPatternQuery] = useState('');
    const [patternDay, setPatternDay] = useState('All');
    const [showPreview, setShowPreview] = useState(false);
    const [mapImage, setMapImage] = useState<string>('');
    const [exporting, setExporting] = useState(false);
    const [lastExport, setLastExport] = useState<{ pdf: string; png: string } | null>(null);
    const [showPostDialog, setShowPostDialog] = useState(false);
    const [postUrl, setPostUrl] = useState('');
    const [validationVisible, setValidationVisible] = useState(false);
    const mapRef = useRef<DetourMapCanvasHandle | null>(null);
    const previewRef = useRef<HTMLDivElement | null>(null);
    useUnsavedChangesWarning(dirty, 'You have unsaved detour notice changes. Leave anyway?');

    const loadLibrary = useCallback(async () => {
        if (!team) return;
        setLibraryLoading(true);
        try {
            setSummaries(await listDetourNotices(team.id));
        } catch (error) {
            console.error('Failed to list detour notices', error);
            toast?.error('Detours unavailable', 'The team detour library could not be loaded.');
        } finally {
            setLibraryLoading(false);
        }
    }, [team, toast]);

    useEffect(() => { void loadLibrary(); }, [loadLibrary]);

    const filteredSummaries = useMemo(() => summaries.filter((summary) => {
        const status = getSummaryState(summary);
        const matchesFilter = libraryFilter === 'all' || status === libraryFilter;
        const query = librarySearch.trim().toLowerCase();
        const matchesSearch = !query || summary.title.toLowerCase().includes(query)
            || summary.affectedRouteTags.some(route => route.toLowerCase().includes(query));
        return matchesFilter && matchesSearch;
    }), [libraryFilter, librarySearch, summaries]);

    const activeOverlay = useMemo(() => notice?.overlays.find(overlay => overlay.id === activeOverlayId)
        ?? notice?.overlays[0] ?? null, [activeOverlayId, notice]);
    const additionalOverlays = useMemo(() => notice?.overlays.filter(overlay => overlay.id !== activeOverlay?.id) ?? [], [activeOverlay, notice]);
    const validation = useMemo(() => notice ? validateDetourNotice(notice) : null, [notice]);
    const exportNotice = useMemo(() => notice ? toDetourExportNoticeInput(notice) : null, [notice]);
    const myRideCopy = useMemo(() => exportNotice ? buildMyRideCopyPackage(exportNotice) : null, [exportNotice]);

    const commitNotice = useCallback((updater: (current: DetourNotice) => DetourNotice, trackHistory = true) => {
        setNotice((current) => {
            if (!current) return current;
            if (trackHistory) setHistory(items => [...items.slice(-39), cloneNotice(current)]);
            if (trackHistory) setFuture([]);
            return updater(current);
        });
        setDirty(true);
        setLastExport(null);
    }, []);

    const updateOverlay = useCallback((overlayId: string, updater: (overlay: DetourRouteOverlay) => DetourRouteOverlay, trackHistory = true) => {
        commitNotice(current => ({
            ...current,
            overlays: current.overlays.map(overlay => overlay.id === overlayId ? updater(overlay) : overlay),
        }), trackHistory);
    }, [commitNotice]);

    const beginNewNotice = useCallback((type: DetourNoticeType) => {
        if (!team || !user) return;
        const created = createDetourNotice({ teamId: team.id, userId: user.uid, type });
        setNotice(created);
        setActiveOverlayId(null);
        setHistory([]);
        setFuture([]);
        setDirty(true);
        setMapImage('');
        setLastExport(null);
        setValidationVisible(false);
        setScreen('editor');
    }, [team, user]);

    const openNotice = useCallback(async (summary: DetourNoticeSummary) => {
        if (!team) return;
        try {
            const loaded = await loadDetourNotice(team.id, summary.id);
            if (!loaded) throw new Error('Notice was not found.');
            setNotice(loaded);
            setActiveOverlayId(loaded.overlays[0]?.id ?? null);
            setHistory([]);
            setFuture([]);
            setDirty(false);
            setMapImage('');
            setLastExport(null);
            setValidationVisible(false);
            setScreen('editor');
        } catch (error) {
            console.error('Failed to open detour notice', error);
            toast?.error('Open failed', error instanceof Error ? error.message : 'The notice could not be opened.');
        }
    }, [team, toast]);

    const saveNotice = useCallback(async (): Promise<DetourNotice | null> => {
        if (!notice || !user) return null;
        setSaving(true);
        try {
            const saved = await saveDetourNotice({ notice, userId: user.uid, expectedRevision: notice.revision });
            setNotice(saved);
            setDirty(false);
            setHistory([]);
            setFuture([]);
            toast?.success('Detour saved', 'The team notice is up to date.');
            return saved;
        } catch (error) {
            if (error instanceof DetourRevisionConflictError) {
                toast?.error('Newer version found', 'Another user changed this notice. Your local edits remain open; reload before saving again.');
            } else {
                console.error('Failed to save detour notice', error);
                toast?.error('Save failed', 'Your edits remain in this browser. Try saving again.');
            }
            return null;
        } finally {
            setSaving(false);
        }
    }, [notice, toast, user]);

    const loadPatterns = useCallback(async (forceRefresh = false) => {
        setPatternsLoading(true);
        try {
            setPatterns(await loadRoutePlanner2GtfsImportPatterns({ forceRefresh }));
        } catch (error) {
            console.error('Failed to load GTFS route patterns', error);
            toast?.error('Routes unavailable', 'Current GTFS routes could not be loaded.');
        } finally {
            setPatternsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        if (showRoutePicker && patterns.length === 0 && !patternsLoading) void loadPatterns();
    }, [loadPatterns, patterns.length, patternsLoading, showRoutePicker]);

    const visiblePatterns = useMemo(() => patterns.filter(pattern => {
        const query = patternQuery.trim().toLowerCase();
        const matchesQuery = !query || `${pattern.routeShortName} ${pattern.routeLongName ?? ''} ${pattern.tripHeadsign ?? ''}`.toLowerCase().includes(query);
        const matchesDay = patternDay === 'All' || pattern.dayTypeLabel === patternDay;
        return matchesQuery && matchesDay;
    }).slice(0, 100), [patternDay, patternQuery, patterns]);
    const patternDays = useMemo(() => ['All', ...new Set(patterns.map(pattern => pattern.dayTypeLabel))], [patterns]);

    const addPattern = useCallback((pattern: RoutePlanner2GtfsImportPattern) => {
        const duplicate = notice?.overlays.some(overlay => overlay.routeSnapshot.routeId === pattern.routeId
            && overlay.routeSnapshot.serviceId === pattern.serviceId
            && overlay.routeSnapshot.directionId === pattern.directionId
            && overlay.routeSnapshot.headsign === pattern.tripHeadsign);
        if (duplicate) {
            toast?.warning('Route already added', 'Choose a different route direction or service pattern.');
            return;
        }
        const overlay = createDetourOverlayFromGtfsPattern(pattern);
        commitNotice(current => ({
            ...current,
            affectedRouteTags: [...new Set([...current.affectedRouteTags, pattern.routeShortName])],
            overlays: [...current.overlays, overlay],
        }));
        setActiveOverlayId(overlay.id);
        setShowRoutePicker(false);
        setMapMode(notice?.type === 'route-detour' ? 'closure-start' : 'select');
    }, [commitNotice, notice, toast]);

    const removeOverlay = useCallback((overlayId: string) => {
        if (!notice) return;
        const remaining = notice.overlays.filter(overlay => overlay.id !== overlayId);
        commitNotice(current => ({
            ...current,
            overlays: current.overlays.filter(overlay => overlay.id !== overlayId),
            affectedRouteTags: [...new Set(current.overlays
                .filter(overlay => overlay.id !== overlayId)
                .map(overlay => overlay.routeSnapshot.routeShortName))],
        }));
        if (activeOverlayId === overlayId) setActiveOverlayId(remaining[0]?.id ?? null);
    }, [activeOverlayId, commitNotice, notice]);

    const resnapOverlay = useCallback(async (overlayId: string, waypoints: DetourCoordinate[]) => {
        if (waypoints.length < 2) return;
        setSnappingOverlayId(overlayId);
        try {
            const result = await snapDetourWaypointsToRoad(waypoints);
            updateOverlay(overlayId, overlay => ({
                ...overlay,
                detourGeometry: {
                    coordinates: result.geometry,
                    source: result.source === 'mapbox' ? 'road-snapped' : 'manual',
                    manualRoutingAcknowledged: !result.requiresAcknowledgement,
                },
                busSuitabilityConfirmed: false,
                updatedAt: new Date(),
            }), false);
        } catch (error) {
            console.error('Road snapping failed', error);
            toast?.warning('Manual path retained', 'Road snapping failed. Review and acknowledge the manual path before export.');
        } finally {
            setSnappingOverlayId(null);
        }
    }, [toast, updateOverlay]);

    const applyClosureAnchor = useCallback((kind: 'start' | 'end', anchor: DetourRouteAnchor) => {
        if (!activeOverlay) return;
        const nextStart = kind === 'start' ? anchor : activeOverlay.closureStart;
        const nextEnd = kind === 'end' ? anchor : activeOverlay.closureEnd;
        let nextOverlay: DetourRouteOverlay = {
            ...activeOverlay,
            closureStart: nextStart,
            closureEnd: nextEnd,
            updatedAt: new Date(),
        };
        if (nextStart && nextEnd) {
            const split = splitDetourRoute(activeOverlay.routeSnapshot.originalGeometry, nextStart, nextEnd, activeOverlay.routeSnapshot.isLoop);
            if (split) {
                const suggested = new Set(suggestBypassedStopIds(
                    activeOverlay.routeSnapshot.stops.map(stop => ({ id: stop.stopId, position: stop.position })),
                    split.bypassed,
                ));
                const temporary = activeOverlay.stopImpacts.filter(impact => impact.status === 'temporary' && !impact.sourceStop);
                nextOverlay = {
                    ...nextOverlay,
                    closureGeometry: { coordinates: split.bypassed, source: 'gtfs', manualRoutingAcknowledged: true },
                    detourWaypoints: [nextStart.coordinate, nextEnd.coordinate],
                    detourGeometry: { coordinates: [nextStart.coordinate, nextEnd.coordinate], source: 'manual', manualRoutingAcknowledged: false },
                    stopImpacts: [
                        ...activeOverlay.routeSnapshot.stops.map(stop => ({
                            id: `${activeOverlay.id}-stop-${stop.stopId}`,
                            sourceStop: stop,
                            status: suggested.has(stop.stopId) ? 'closed' as const : 'open' as const,
                            suggestedStatus: suggested.has(stop.stopId) ? 'closed' as const : 'open' as const,
                            reviewed: !suggested.has(stop.stopId),
                        })),
                        ...temporary,
                    ],
                    busSuitabilityConfirmed: false,
                };
            }
        }
        updateOverlay(activeOverlay.id, () => nextOverlay);
        setMapMode(kind === 'start' ? 'closure-end' : 'select');
        if (nextOverlay.detourWaypoints.length >= 2) void resnapOverlay(nextOverlay.id, nextOverlay.detourWaypoints);
    }, [activeOverlay, resnapOverlay, updateOverlay]);

    const addWaypoint = useCallback((coordinate: DetourCoordinate) => {
        if (!activeOverlay || activeOverlay.detourWaypoints.length < 2) return;
        const next = [
            ...activeOverlay.detourWaypoints.slice(0, -1),
            coordinate,
            activeOverlay.detourWaypoints.at(-1)!,
        ];
        updateOverlay(activeOverlay.id, overlay => ({ ...overlay, detourWaypoints: next }));
        void resnapOverlay(activeOverlay.id, next);
    }, [activeOverlay, resnapOverlay, updateOverlay]);

    const moveWaypoint = useCallback((index: number, coordinate: DetourCoordinate) => {
        if (!activeOverlay) return;
        const next = moveDetourControlPoint(activeOverlay.detourWaypoints, index, coordinate);
        updateOverlay(activeOverlay.id, overlay => ({ ...overlay, detourWaypoints: next }));
        void resnapOverlay(activeOverlay.id, next);
    }, [activeOverlay, resnapOverlay, updateOverlay]);

    const removeWaypoint = useCallback((index: number) => {
        if (!activeOverlay || index === 0 || index === activeOverlay.detourWaypoints.length - 1) return;
        const next = deleteDetourControlPoint(activeOverlay.detourWaypoints, index);
        updateOverlay(activeOverlay.id, overlay => ({ ...overlay, detourWaypoints: next }));
        void resnapOverlay(activeOverlay.id, next);
    }, [activeOverlay, resnapOverlay, updateOverlay]);

    const addTemporaryStop = useCallback((coordinate: DetourCoordinate) => {
        if (!activeOverlay) return;
        updateOverlay(activeOverlay.id, overlay => ({
            ...overlay,
            stopImpacts: [...overlay.stopImpacts, {
                id: `temporary-${crypto.randomUUID()}`,
                status: 'temporary',
                suggestedStatus: 'temporary',
                reviewed: true,
                temporaryStopName: 'Temporary stop',
                temporaryStopPosition: coordinate,
            }],
        }));
        setMapMode('select');
    }, [activeOverlay, updateOverlay]);

    const addStopClosureReplacement = useCallback((coordinate: DetourCoordinate) => {
        commitNotice(current => {
            const existing = current.stopClosure ?? { closedStop: null, replacementStop: null, instructions: '' };
            const replacement = {
                stopId: `temporary-${crypto.randomUUID()}`,
                name: 'Temporary stop',
                position: coordinate,
                sequence: (current.overlays[0]?.routeSnapshot.stops.length ?? 0) + 1,
            };
            const walkingGeometry = existing.closedStop ? {
                coordinates: [existing.closedStop.position, coordinate],
                source: 'manual' as const,
                manualRoutingAcknowledged: true,
            } : undefined;
            return {
                ...current,
                stopClosure: {
                    ...existing,
                    replacementStop: replacement,
                    walkingGeometry,
                    walkingDistanceMetres: existing.closedStop
                        ? walkingDistanceMetres(existing.closedStop.position, coordinate)
                        : undefined,
                },
            };
        });
        setMapMode('select');
    }, [commitNotice]);

    const updateMapFrame = useCallback((mapFrame: DetourNotice['mapFrame']) => {
        setNotice(current => {
            if (!current) return current;
            const unchanged = Math.abs(current.mapFrame.center.latitude - mapFrame.center.latitude) < 0.000001
                && Math.abs(current.mapFrame.center.longitude - mapFrame.center.longitude) < 0.000001
                && Math.abs(current.mapFrame.zoom - mapFrame.zoom) < 0.001
                && Math.abs(current.mapFrame.bearing - mapFrame.bearing) < 0.001
                && Math.abs(current.mapFrame.pitch - mapFrame.pitch) < 0.001;
            if (unchanged) return current;
            setDirty(true);
            setLastExport(null);
            return { ...current, mapFrame };
        });
    }, []);

    const addPresetLabel = useCallback(() => {
        if (!activeOverlay) return;
        const geometry = activeOverlay.closureGeometry.coordinates.length
            ? activeOverlay.closureGeometry.coordinates
            : activeOverlay.routeSnapshot.originalGeometry;
        const position = geometry[Math.floor(geometry.length / 2)];
        if (!position) return;
        const id = `label-${crypto.randomUUID()}`;
        updateOverlay(activeOverlay.id, overlay => {
            const labels = [...overlay.labels, { id, text: 'Road closed', position }];
            return { ...overlay, labels, labelCollisionAcknowledged: labelsCollide(labels) ? false : true };
        });
        setMapSelection({ type: 'label', id });
    }, [activeOverlay, updateOverlay]);

    const selectStopClosureStop = useCallback((kind: 'closed' | 'replacement', stopId: string) => {
        if (!notice || !activeOverlay) return;
        const stop = activeOverlay.routeSnapshot.stops.find(item => item.stopId === stopId) ?? null;
        commitNotice(current => {
            const existing = current.stopClosure ?? { closedStop: null, replacementStop: null, instructions: '' };
            const closed = kind === 'closed' ? stop : existing.closedStop;
            const replacement = kind === 'replacement' ? stop : existing.replacementStop;
            const walkingGeometry = closed && replacement ? {
                coordinates: [closed.position, replacement.position],
                source: 'manual' as const,
                manualRoutingAcknowledged: true,
            } : undefined;
            return {
                ...current,
                stopClosure: {
                    ...existing,
                    closedStop: closed,
                    replacementStop: replacement,
                    walkingGeometry,
                    walkingDistanceMetres: closed && replacement ? walkingDistanceMetres(closed.position, replacement.position) : undefined,
                },
            };
        });
    }, [activeOverlay, commitNotice, notice]);

    const toggleRecurrenceDay = useCallback((day: DetourDay) => {
        commitNotice(current => {
            const recurrence = current.schedule.recurrence;
            if (recurrence.mode !== 'weekly') return current;
            const selected = recurrence.days.includes(day);
            return {
                ...current,
                schedule: {
                    ...current.schedule,
                    recurrence: {
                        ...recurrence,
                        days: selected ? recurrence.days.filter(item => item !== day) : [...recurrence.days, day],
                    },
                },
            };
        });
    }, [commitNotice]);

    const captureMap = useCallback((): string | null => {
        const captured = mapRef.current?.captureImage('image/png') ?? null;
        if (captured) setMapImage(captured);
        return captured;
    }, []);

    const openPreview = useCallback(() => {
        if (!notice) return;
        captureMap();
        setValidationVisible(true);
        setShowPreview(true);
    }, [captureMap, notice]);

    const exportPackage = useCallback(async () => {
        if (!notice || !exportNotice) return;
        setValidationVisible(true);
        const result = validateDetourNotice(notice);
        if (!result.canExport) {
            toast?.warning('Notice is not ready', 'Resolve the blocking checklist items before exporting.');
            return;
        }
        if (dirty || notice.revision === 0) {
            toast?.warning('Save before exporting', 'Save the current revision so the exported notice can be tracked.');
            return;
        }
        const captured = mapImage || captureMap();
        if (!captured) {
            toast?.error('Map capture failed', 'Wait for the map to finish loading and try again.');
            return;
        }
        setExporting(true);
        try {
            const pdf = downloadDetourPdf({ notice: exportNotice, mapImageDataUrl: captured });
            await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
            const pngResult = await captureDetourNoticePng(previewRef.current, exportNotice);
            downloadBlob(pngResult.blob, pngResult.filename);
            setLastExport({ pdf, png: pngResult.filename });
            toast?.success('Notice package ready', 'PDF and PNG downloaded. MyRide copy is ready below.');
        } catch (error) {
            console.error('Detour export failed', error);
            toast?.error('Export failed', error instanceof Error ? error.message : 'The notice could not be exported.');
        } finally {
            setExporting(false);
        }
    }, [captureMap, dirty, exportNotice, mapImage, notice, toast]);

    const copyText = useCallback(async (text: string, label: string) => {
        try {
            await navigator.clipboard.writeText(text);
            toast?.success(`${label} copied`, 'Paste it into the MyRide News editor.');
        } catch {
            toast?.error('Copy failed', 'Select the text manually and copy it.');
        }
    }, [toast]);

    const submitPosted = useCallback(async () => {
        if (!notice || !user || !lastExport || !isValidMyRideUrl(postUrl)) return;
        try {
            const posted = await markDetourPosted({
                teamId: notice.teamId,
                noticeId: notice.id,
                userId: user.uid,
                expectedRevision: notice.revision,
                myRideUrl: postUrl,
                filenames: lastExport,
            });
            setNotice(posted);
            setShowPostDialog(false);
            setPostUrl('');
            toast?.success('Marked posted', 'The MyRide link and posted revision were recorded.');
        } catch (error) {
            console.error('Failed to mark detour posted', error);
            toast?.error('Could not mark posted', error instanceof Error ? error.message : 'Try again.');
        }
    }, [lastExport, notice, postUrl, toast, user]);

    const returnToLibrary = useCallback(async () => {
        if (dirty && !confirm('Leave without saving your detour changes?')) return;
        setScreen('library');
        setNotice(null);
        await loadLibrary();
    }, [dirty, loadLibrary]);

    const undo = useCallback(() => {
        const previous = history.at(-1);
        if (!previous || !notice) return;
        setFuture(items => [cloneNotice(notice), ...items].slice(0, 40));
        setNotice(previous);
        setHistory(items => items.slice(0, -1));
        setDirty(true);
        setLastExport(null);
    }, [history, notice]);

    const redo = useCallback(() => {
        const next = future[0];
        if (!next || !notice) return;
        setHistory(items => [...items.slice(-39), cloneNotice(notice)]);
        setNotice(next);
        setFuture(items => items.slice(1));
        setDirty(true);
        setLastExport(null);
    }, [future, notice]);

    if (!user || !team) {
        return (
            <div className="grid h-full place-items-center bg-slate-50 p-8 text-center">
                <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
                    <Bus className="mx-auto h-10 w-10 text-blue-600" />
                    <h2 className="mt-4 text-xl font-black text-slate-900">Team access required</h2>
                    <p className="mt-2 text-sm text-slate-600">Sign in and select a team before creating detour notices.</p>
                    <button type="button" onClick={onClose} className="mt-5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white">Back</button>
                </div>
            </div>
        );
    }

    if (screen === 'library') {
        return (
            <div className="h-full overflow-y-auto bg-slate-50">
                <div className="mx-auto max-w-7xl px-6 py-6">
                    <button type="button" onClick={onClose} className="flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-800">
                        <ArrowLeft className="h-4 w-4" /> Scheduled Transit
                    </button>
                    <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <div className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Scheduled Transit</div>
                            <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">Detour Publisher</h1>
                            <p className="mt-2 max-w-2xl text-sm text-slate-600">Create consistent route-detour and stop-closure notices from current GTFS routes.</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={() => beginNewNotice('stop-closure')} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-700 shadow-sm hover:bg-slate-50">
                                <MapPin className="mr-2 inline h-4 w-4" /> New stop closure
                            </button>
                            <button type="button" onClick={() => beginNewNotice('route-detour')} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-black text-white shadow-sm hover:bg-blue-700">
                                <Plus className="mr-2 inline h-4 w-4" /> New detour
                            </button>
                        </div>
                    </div>

                    <div className="mt-7 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div className="flex flex-wrap gap-2">
                                {(['all', 'draft', 'upcoming', 'active', 'update-needed', 'expired', 'archived'] as LibraryFilter[]).map(filter => (
                                    <button key={filter} type="button" onClick={() => setLibraryFilter(filter)} className={cx(
                                        'rounded-full px-3 py-1.5 text-xs font-black transition',
                                        libraryFilter === filter ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                                    )}>{filter === 'all' ? 'All notices' : statusLabel(filter)}</button>
                                ))}
                            </div>
                            <div className="relative min-w-[260px]">
                                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                                <input value={librarySearch} onChange={event => setLibrarySearch(event.target.value)} placeholder="Search title or route" className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-400" />
                            </div>
                        </div>
                    </div>

                    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                        {libraryLoading ? (
                            <div className="grid min-h-64 place-items-center text-sm font-bold text-slate-500"><Loader2 className="mb-2 h-6 w-6 animate-spin text-blue-600" /> Loading notices</div>
                        ) : filteredSummaries.length === 0 ? (
                            <div className="grid min-h-64 place-items-center p-8 text-center">
                                <div><Route className="mx-auto h-9 w-9 text-slate-300" /><h2 className="mt-3 font-black text-slate-800">No matching notices</h2><p className="mt-1 text-sm text-slate-500">Create a detour or change the filters.</p></div>
                            </div>
                        ) : (
                            <div className="divide-y divide-slate-100">
                                {filteredSummaries.map(summary => {
                                    const state = getSummaryState(summary);
                                    return (
                                        <article key={summary.id} className="flex flex-col gap-4 p-4 hover:bg-slate-50/80 md:flex-row md:items-center">
                                            <button type="button" onClick={() => void openNotice(summary)} className="min-w-0 flex-1 text-left">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <h3 className="truncate font-black text-slate-900">{summary.title || 'Untitled notice'}</h3>
                                                    <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-black', statusClass(state))}>{statusLabel(state)}</span>
                                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">{summary.type === 'route-detour' ? 'Route detour' : 'Stop closure'}</span>
                                                </div>
                                                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-slate-500">
                                                    <span>{summary.affectedRouteTags.length ? `Routes ${summary.affectedRouteTags.join(', ')}` : 'Route not selected'}</span>
                                                    <span>{summary.overlayCount} route direction{summary.overlayCount === 1 ? '' : 's'}</span>
                                                    <span>Updated {formatUpdated(summary.updatedAt)}</span>
                                                </div>
                                            </button>
                                            <div className="flex items-center gap-1 self-end md:self-auto">
                                                <button type="button" onClick={() => void duplicateDetourNotice(team.id, summary.id, user.uid).then(loadLibrary)} className="rounded-lg p-2 text-slate-500 hover:bg-white hover:text-blue-600" title="Duplicate"><Copy className="h-4 w-4" /></button>
                                                <button type="button" onClick={() => {
                                                    if (confirm(`Delete ${summary.title || 'this notice'}?`)) void deleteDetourNotice(team.id, summary.id).then(loadLibrary);
                                                }} className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-4 w-4" /></button>
                                                <button type="button" onClick={() => void openNotice(summary)} className="ml-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white">Open</button>
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    if (!notice) return null;

    const selectedImpact = activeOverlay && mapSelection?.type === 'stop-impact'
        ? activeOverlay.stopImpacts.find(impact => impact.id === mapSelection.id) ?? null
        : null;
    const selectedLabel = activeOverlay && mapSelection?.type === 'label'
        ? activeOverlay.labels.find(label => label.id === mapSelection.id) ?? null
        : null;
    const weeklyRecurrence = notice.schedule.recurrence.mode === 'weekly'
        ? notice.schedule.recurrence
        : null;

    return (
        <div className="flex h-full min-h-0 flex-col bg-slate-100">
            <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
                <button type="button" onClick={() => void returnToLibrary()} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-5 w-5" /></button>
                <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-600">Detour Publisher</div>
                    <input value={notice.title} onChange={event => commitNotice(current => ({ ...current, title: event.target.value }))} placeholder="Untitled public notice" className="w-full border-0 bg-transparent p-0 text-lg font-black text-slate-900 outline-none" />
                </div>
                <span className={cx('rounded-full px-2.5 py-1 text-xs font-black', dirty ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700')}>{dirty ? 'Unsaved changes' : `Saved revision ${notice.revision}`}</span>
                <button type="button" disabled={history.length === 0} onClick={undo} className="rounded-lg border border-slate-200 p-2 text-slate-600 disabled:opacity-30" title="Undo"><Undo2 className="h-4 w-4" /></button>
                <button type="button" disabled={future.length === 0} onClick={redo} className="rounded-lg border border-slate-200 p-2 text-slate-600 disabled:opacity-30" title="Redo"><Undo2 className="h-4 w-4 -scale-x-100" /></button>
                <button type="button" disabled={saving || !dirty} onClick={() => void saveNotice()} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-black text-slate-700 disabled:opacity-40"><Save className="mr-2 inline h-4 w-4" />{saving ? 'Saving' : 'Save'}</button>
                <button type="button" onClick={() => commitNotice(current => ({ ...current, status: current.status === 'archived' ? 'draft' : 'archived' }))} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-black text-slate-600"><Archive className="mr-2 inline h-4 w-4" />{notice.status === 'archived' ? 'Restore' : 'Archive'}</button>
                <button type="button" onClick={openPreview} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-black text-white"><FileText className="mr-2 inline h-4 w-4" />Preview & export</button>
            </header>

            <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)_340px] gap-3 p-3">
                <aside className="min-h-0 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Routes and tools</h2>
                        <button type="button" onClick={() => setShowRoutePicker(true)} className="rounded-lg bg-blue-50 p-2 text-blue-700" title="Add route"><Plus className="h-4 w-4" /></button>
                    </div>
                    <div className="mt-3 space-y-2">
                        {notice.overlays.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-xs font-semibold text-slate-500">Add a GTFS route and direction to begin.</p> : notice.overlays.map(overlay => (
                            <div key={overlay.id} className={cx('flex items-center rounded-xl border', activeOverlay?.id === overlay.id ? 'border-blue-300 bg-blue-50' : 'border-slate-200 hover:bg-slate-50')}>
                                <button type="button" onClick={() => setActiveOverlayId(overlay.id)} className="min-w-0 flex-1 p-3 text-left">
                                    <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: overlay.routeSnapshot.routeColor }} /><span className="font-black text-slate-900">Route {overlay.routeSnapshot.routeShortName}</span></div>
                                    <div className="mt-1 truncate text-xs font-semibold text-slate-500">{overlay.routeSnapshot.directionLabel}</div>
                                </button>
                                <button type="button" onClick={() => removeOverlay(overlay.id)} className="mr-2 rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Remove route"><Trash2 className="h-4 w-4" /></button>
                            </div>
                        ))}
                    </div>
                    {activeOverlay && notice.type === 'route-detour' && (
                        <div className="mt-5 grid grid-cols-2 gap-2">
                            <ToolButton active={mapMode === 'select'} onClick={() => setMapMode('select')} icon={<MousePointer2 />} label="Select" />
                            <ToolButton active={mapMode === 'closure-start'} onClick={() => setMapMode('closure-start')} icon={<Archive />} label="Start closure" />
                            <ToolButton active={mapMode === 'closure-end'} onClick={() => setMapMode('closure-end')} icon={<Archive />} label="End closure" />
                            <ToolButton active={mapMode === 'add-waypoint'} disabled={activeOverlay.detourWaypoints.length < 2} onClick={() => setMapMode('add-waypoint')} icon={<Route />} label="Add bend" />
                            <ToolButton active={mapMode === 'add-temporary-stop'} onClick={() => setMapMode('add-temporary-stop')} icon={<MapPin />} label="Temp stop" />
                            <ToolButton onClick={addPresetLabel} icon={<FileText />} label="Add callout" />
                            <ToolButton onClick={() => mapRef.current?.fitToNotice()} icon={<RefreshCw />} label="Fit map" />
                        </div>
                    )}
                    {activeOverlay && notice.type === 'stop-closure' && (
                        <div className="mt-5 grid grid-cols-2 gap-2">
                            <ToolButton active={mapMode === 'select'} onClick={() => setMapMode('select')} icon={<MousePointer2 />} label="Select" />
                            <ToolButton active={mapMode === 'add-temporary-stop'} onClick={() => setMapMode('add-temporary-stop')} icon={<MapPin />} label="Place replacement" />
                            <ToolButton onClick={addPresetLabel} icon={<FileText />} label="Add callout" />
                            <ToolButton onClick={() => mapRef.current?.fitToNotice()} icon={<RefreshCw />} label="Fit map" />
                        </div>
                    )}
                    {activeOverlay && (
                        <div className="mt-5 space-y-3 border-t border-slate-100 pt-4">
                            <label className="flex items-start gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={activeOverlay.busSuitabilityConfirmed} onChange={event => updateOverlay(activeOverlay.id, overlay => ({ ...overlay, busSuitabilityConfirmed: event.target.checked }))} className="mt-0.5" />Replacement path checked for bus suitability</label>
                            {activeOverlay.detourGeometry.source === 'manual' && (
                                <label className="flex items-start gap-2 text-xs font-semibold text-amber-800"><input type="checkbox" checked={activeOverlay.detourGeometry.manualRoutingAcknowledged} onChange={event => updateOverlay(activeOverlay.id, overlay => ({ ...overlay, detourGeometry: { ...overlay.detourGeometry, manualRoutingAcknowledged: event.target.checked } }))} className="mt-0.5" />Manual routing reviewed</label>
                            )}
                            {snappingOverlayId === activeOverlay.id && <div className="flex items-center gap-2 text-xs font-bold text-blue-700"><Loader2 className="h-4 w-4 animate-spin" /> Snapping to roads</div>}
                            {activeOverlay.labelCollisionAcknowledged === false && <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-xs font-semibold text-amber-800"><input type="checkbox" onChange={event => event.target.checked && updateOverlay(activeOverlay.id, overlay => ({ ...overlay, labelCollisionAcknowledged: true }))} />Labels may overlap; reposition or acknowledge</label>}
                        </div>
                    )}
                </aside>

                <main className="min-h-0 min-w-0">
                    {activeOverlay ? (
                        <DetourMapCanvas
                            ref={mapRef}
                            overlay={activeOverlay}
                            additionalOverlays={additionalOverlays}
                            walkingGeometry={notice.stopClosure?.walkingGeometry}
                            stopClosureMarkers={notice.stopClosure ? {
                                closed: notice.stopClosure.closedStop ? { id: notice.stopClosure.closedStop.stopId, label: notice.stopClosure.closedStop.name, position: notice.stopClosure.closedStop.position } : null,
                                replacement: notice.stopClosure.replacementStop ? { id: notice.stopClosure.replacementStop.stopId, label: notice.stopClosure.replacementStop.name, position: notice.stopClosure.replacementStop.position } : null,
                            } : undefined}
                            mapFrame={notice.mapFrame}
                            mode={mapMode}
                            selectedItem={mapSelection}
                            closureStart={activeOverlay.closureStart}
                            closureEnd={activeOverlay.closureEnd}
                            labels={activeOverlay.labels ?? []}
                            className="h-full min-h-[520px]"
                            onSelectClosureStart={anchor => applyClosureAnchor('start', anchor)}
                            onSelectClosureEnd={anchor => applyClosureAnchor('end', anchor)}
                            onAddWaypoint={addWaypoint}
                            onMoveWaypoint={moveWaypoint}
                            onDeleteWaypoint={removeWaypoint}
                            onAddTemporaryStop={notice.type === 'stop-closure' ? addStopClosureReplacement : addTemporaryStop}
                            onMoveTemporaryStop={(impactId, coordinate) => updateOverlay(activeOverlay.id, overlay => ({ ...overlay, stopImpacts: overlay.stopImpacts.map(impact => impact.id === impactId ? { ...impact, temporaryStopPosition: coordinate } : impact) }))}
                            onConfirmStopImpact={(impactId, status) => updateOverlay(activeOverlay.id, overlay => ({ ...overlay, stopImpacts: overlay.stopImpacts.map(impact => impact.id === impactId ? { ...impact, status, reviewed: true } : impact) }))}
                            onMoveLabel={(labelId, position) => updateOverlay(activeOverlay.id, overlay => {
                                const labels = overlay.labels.map(label => label.id === labelId ? { ...label, position } : label);
                                return { ...overlay, labels, labelCollisionAcknowledged: labelsCollide(labels) ? false : true };
                            })}
                            onSelectItem={setMapSelection}
                            onCaptureImage={setMapImage}
                            onMapFrameChange={updateMapFrame}
                        />
                    ) : (
                        <div className="grid h-full min-h-[520px] place-items-center rounded-2xl border border-dashed border-slate-300 bg-white text-center"><div><Route className="mx-auto h-10 w-10 text-slate-300" /><h2 className="mt-3 font-black text-slate-800">Add a route to start mapping</h2><button type="button" onClick={() => setShowRoutePicker(true)} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-black text-white">Choose GTFS route</button></div></div>
                    )}
                </main>

                <aside className="min-h-0 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <h2 className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Notice details</h2>
                    <div className="mt-4 space-y-4">
                        <Field label="Reason"><input value={notice.reason} onChange={event => commitNotice(current => ({ ...current, reason: event.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100" placeholder="Road closure, construction, event…" /></Field>
                        <Field label="MyRide summary"><textarea value={notice.publicSummary} onChange={event => commitNotice(current => ({ ...current, publicSummary: event.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 min-h-20" placeholder="Short public summary" /></Field>
                        <Field label="Rider details"><textarea value={notice.publicDetails} onChange={event => commitNotice(current => ({ ...current, publicDetails: event.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 min-h-28" placeholder="What riders need to know" /></Field>

                        <div className="rounded-xl border border-slate-200 p-3">
                            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-600"><CalendarClock className="h-4 w-4 text-blue-600" /> Effective schedule</div>
                            <div className="mt-3 grid grid-cols-2 gap-2">
                                <input type="date" value={notice.schedule.startDate} onChange={event => commitNotice(current => ({ ...current, schedule: { ...current.schedule, startDate: event.target.value } }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
                                <input type="time" value={notice.schedule.startTime} onChange={event => commitNotice(current => ({ ...current, schedule: { ...current.schedule, startTime: event.target.value } }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
                            </div>
                            <select value={notice.schedule.end.mode} onChange={event => commitNotice(current => ({ ...current, schedule: { ...current.schedule, end: event.target.value === 'fixed' ? { mode: 'fixed', date: current.schedule.startDate, time: current.schedule.startTime } : { mode: event.target.value as 'until-further-notice' | 'until-construction-complete' } } }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 mt-2">
                                <option value="fixed">Exact end date</option><option value="until-further-notice">Until further notice</option><option value="until-construction-complete">Until construction is complete</option>
                            </select>
                            {notice.schedule.end.mode === 'fixed' && <div className="mt-2 grid grid-cols-2 gap-2"><input type="date" value={notice.schedule.end.date} onChange={event => commitNotice(current => ({ ...current, schedule: { ...current.schedule, end: { ...current.schedule.end, date: event.target.value } } }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100" /><input type="time" value={notice.schedule.end.time} onChange={event => commitNotice(current => ({ ...current, schedule: { ...current.schedule, end: { ...current.schedule.end, time: event.target.value } } }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100" /></div>}
                            <select value={notice.schedule.recurrence.mode} onChange={event => commitNotice(current => ({ ...current, schedule: { ...current.schedule, recurrence: event.target.value === 'weekly' ? { mode: 'weekly', days: [], startTime: current.schedule.startTime, endTime: '23:59' } : { mode: 'continuous' } } }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 mt-2"><option value="continuous">Continuous</option><option value="weekly">Repeats weekly</option></select>
                            {weeklyRecurrence && <div className="mt-2"><div className="flex flex-wrap gap-1">{DAYS.map(day => <button key={day.id} type="button" onClick={() => toggleRecurrenceDay(day.id)} className={cx('rounded-md px-2 py-1 text-[11px] font-black', weeklyRecurrence.days.includes(day.id) ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600')}>{day.label}</button>)}</div><div className="mt-2 grid grid-cols-2 gap-2"><input type="time" value={weeklyRecurrence.startTime} onChange={event => commitNotice(current => current.schedule.recurrence.mode === 'weekly' ? { ...current, schedule: { ...current.schedule, recurrence: { ...current.schedule.recurrence, startTime: event.target.value } } } : current)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100" /><input type="time" value={weeklyRecurrence.endTime} onChange={event => commitNotice(current => current.schedule.recurrence.mode === 'weekly' ? { ...current, schedule: { ...current.schedule, recurrence: { ...current.schedule.recurrence, endTime: event.target.value } } } : current)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100" /></div></div>}
                        </div>

                        {notice.type === 'stop-closure' && activeOverlay && (
                            <div className="rounded-xl border border-slate-200 p-3">
                                <div className="text-xs font-black uppercase tracking-wide text-slate-600">Stop replacement</div>
                                <Field label="Closed stop"><select value={notice.stopClosure?.closedStop?.stopId ?? ''} onChange={event => selectStopClosureStop('closed', event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"><option value="">Select stop</option>{activeOverlay.routeSnapshot.stops.map(stop => <option key={stop.stopId} value={stop.stopId}>{stop.stopCode ? `${stop.stopCode} · ` : ''}{stop.name}</option>)}</select></Field>
                                <Field label="Replacement stop"><select value={notice.stopClosure?.replacementStop?.stopId ?? ''} onChange={event => selectStopClosureStop('replacement', event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"><option value="">No replacement selected</option>{notice.stopClosure?.replacementStop && !activeOverlay.routeSnapshot.stops.some(stop => stop.stopId === notice.stopClosure?.replacementStop?.stopId) && <option value={notice.stopClosure.replacementStop.stopId}>{notice.stopClosure.replacementStop.name}</option>}{activeOverlay.routeSnapshot.stops.map(stop => <option key={stop.stopId} value={stop.stopId}>{stop.stopCode ? `${stop.stopCode} · ` : ''}{stop.name}</option>)}</select></Field>
                                {notice.stopClosure?.replacementStop && !activeOverlay.routeSnapshot.stops.some(stop => stop.stopId === notice.stopClosure?.replacementStop?.stopId) && <Field label="Temporary stop name"><input value={notice.stopClosure.replacementStop.name} onChange={event => commitNotice(current => current.stopClosure?.replacementStop ? { ...current, stopClosure: { ...current.stopClosure, replacementStop: { ...current.stopClosure.replacementStop, name: event.target.value } } } : current)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100" /></Field>}
                                {notice.stopClosure?.walkingDistanceMetres != null && <p className="mt-2 text-xs font-bold text-slate-500">Approx. {notice.stopClosure.walkingDistanceMetres} m straight-line connection; planner verification required.</p>}
                                <Field label="Walking/replacement instructions"><textarea value={notice.stopClosure?.instructions ?? ''} onChange={event => commitNotice(current => ({ ...current, stopClosure: { ...(current.stopClosure ?? { closedStop: null, replacementStop: null, instructions: '' }), instructions: event.target.value } }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 min-h-20" /></Field>
                            </div>
                        )}

                        {selectedImpact && activeOverlay && (
                            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
                                <div className="flex items-center justify-between"><div className="text-xs font-black text-blue-900">{selectedImpact.sourceStop?.name ?? selectedImpact.temporaryStopName ?? 'Temporary stop'}</div><button type="button" onClick={() => setMapSelection(null)}><X className="h-4 w-4 text-blue-500" /></button></div>
                                <select value={selectedImpact.status} onChange={event => updateOverlay(activeOverlay.id, overlay => ({ ...overlay, stopImpacts: overlay.stopImpacts.map(impact => impact.id === selectedImpact.id ? { ...impact, status: event.target.value as DetourStopImpactStatus, reviewed: true } : impact) }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 mt-2"><option value="open">Active</option><option value="closed">Closed</option><option value="temporary">Temporary</option></select>
                                {selectedImpact.status === 'temporary' && <input value={selectedImpact.temporaryStopName ?? ''} onChange={event => updateOverlay(activeOverlay.id, overlay => ({ ...overlay, stopImpacts: overlay.stopImpacts.map(impact => impact.id === selectedImpact.id ? { ...impact, temporaryStopName: event.target.value } : impact) }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 mt-2" placeholder="Temporary stop name" />}
                                {!selectedImpact.reviewed && <button type="button" onClick={() => updateOverlay(activeOverlay.id, overlay => ({ ...overlay, stopImpacts: overlay.stopImpacts.map(impact => impact.id === selectedImpact.id ? { ...impact, reviewed: true } : impact) }))} className="mt-2 w-full rounded-lg bg-blue-600 py-2 text-xs font-black text-white"><Check className="mr-1 inline h-4 w-4" />Confirm impact</button>}
                            </div>
                        )}

                        {selectedLabel && activeOverlay && (
                            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
                                <div className="flex items-center justify-between"><div className="text-xs font-black text-blue-900">Map callout</div><button type="button" onClick={() => setMapSelection(null)}><X className="h-4 w-4 text-blue-500" /></button></div>
                                <input value={selectedLabel.text} onChange={event => updateOverlay(activeOverlay.id, overlay => ({ ...overlay, labels: overlay.labels.map(label => label.id === selectedLabel.id ? { ...label, text: event.target.value } : label) }))} className="mt-2 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400" />
                                <button type="button" onClick={() => { updateOverlay(activeOverlay.id, overlay => ({ ...overlay, labels: overlay.labels.filter(label => label.id !== selectedLabel.id) })); setMapSelection(null); }} className="mt-2 w-full rounded-lg border border-red-200 bg-white py-2 text-xs font-black text-red-600"><Trash2 className="mr-1 inline h-4 w-4" />Remove callout</button>
                            </div>
                        )}

                        {validationVisible && validation && (validation.errors.length > 0 || validation.warnings.length > 0) && (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs">
                                <div className="flex items-center gap-2 font-black text-amber-900"><AlertTriangle className="h-4 w-4" /> Export checklist</div>
                                <ul className="mt-2 space-y-1 text-amber-900">{validation.errors.map(item => <li key={`${item.code}-${item.path}`}>• {item.message}</li>)}{validation.warnings.map(item => <li key={`${item.code}-${item.path}`}>• {item.message}</li>)}</ul>
                            </div>
                        )}
                    </div>
                </aside>
            </div>

            {showRoutePicker && (
                <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40" role="dialog" aria-modal="true" aria-label="Choose GTFS route">
                    <div className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl">
                        <div className="flex items-center gap-3 border-b border-slate-200 p-4"><div className="flex-1"><h2 className="text-lg font-black text-slate-900">Choose current route pattern</h2><p className="text-xs text-slate-500">The selected geometry and stops are copied into this notice.</p></div><button type="button" onClick={() => setShowRoutePicker(false)} className="rounded-lg p-2 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
                        <div className="flex gap-2 border-b border-slate-100 p-4"><div className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={patternQuery} onChange={event => setPatternQuery(event.target.value)} placeholder="Search route or destination" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 pl-9" /></div><select value={patternDay} onChange={event => setPatternDay(event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 w-40">{patternDays.map(day => <option key={day}>{day}</option>)}</select><button type="button" onClick={() => void loadPatterns(true)} className="rounded-lg border border-slate-200 p-2 text-slate-600"><RefreshCw className={cx('h-4 w-4', patternsLoading && 'animate-spin')} /></button></div>
                        <div className="min-h-0 flex-1 overflow-y-auto p-4">{patternsLoading && patterns.length === 0 ? <div className="grid h-48 place-items-center text-sm font-bold text-slate-500"><Loader2 className="h-6 w-6 animate-spin" /></div> : <div className="space-y-2">{visiblePatterns.map(pattern => <button key={pattern.id} type="button" onClick={() => addPattern(pattern)} className="w-full rounded-xl border border-slate-200 p-3 text-left hover:border-blue-300 hover:bg-blue-50"><div className="flex items-center justify-between gap-2"><span className="font-black text-slate-900">Route {pattern.routeShortName}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-600">{pattern.dayTypeLabel}</span></div><div className="mt-1 text-sm font-semibold text-slate-600">{pattern.tripHeadsign || pattern.routeLongName || 'Route direction'}</div><div className="mt-1 text-xs text-slate-400">{pattern.stopCount} stops · {pattern.tripCount} trips</div></button>)}</div>}</div>
                    </div>
                </div>
            )}

            {showPreview && exportNotice && (
                <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 p-4" role="dialog" aria-modal="true" aria-label="Detour notice preview">
                    <div className="mx-auto max-w-7xl rounded-2xl bg-white shadow-2xl">
                        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4"><div className="flex-1"><h2 className="text-lg font-black text-slate-900">Notice preview and MyRide package</h2><p className="text-xs text-slate-500">Review the map and public copy before downloading.</p></div><button type="button" onClick={() => captureMap()} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-black text-slate-700"><FileImage className="mr-2 inline h-4 w-4" />Recapture map</button><button type="button" disabled={exporting} onClick={() => void exportPackage()} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-black text-white disabled:opacity-50"><Download className="mr-2 inline h-4 w-4" />{exporting ? 'Exporting' : 'Download package'}</button><button type="button" onClick={() => setShowPreview(false)} className="rounded-lg p-2 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
                        <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                            <div className="overflow-auto rounded-xl bg-slate-100 p-4"><div className="origin-top-left" style={{ width: 1100, height: 850, transform: 'scale(0.72)', transformOrigin: 'top left', marginBottom: -238, marginRight: -308 }}><DetourNoticePreview ref={previewRef} notice={exportNotice} mapImageDataUrl={mapImage} /></div></div>
                            <aside className="space-y-3">{myRideCopy && <><CopyCard label="MyRide title" text={myRideCopy.title} onCopy={copyText} /><CopyCard label="Summary" text={myRideCopy.summary} onCopy={copyText} /><CopyCard label="Accessible details" text={myRideCopy.accessibleDetails} onCopy={copyText} /><CopyCard label="Image alt text" text={myRideCopy.altText} onCopy={copyText} /><div className="rounded-xl border border-slate-200 p-3"><div className="text-xs font-black uppercase tracking-wide text-slate-500">Route tags</div><div className="mt-2 flex flex-wrap gap-1">{myRideCopy.routeTags.map(tag => <span key={tag} className="rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">{tag}</span>)}</div></div></>}
                                {lastExport && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><div className="flex items-center gap-2 text-sm font-black text-emerald-800"><Check className="h-4 w-4" /> Files exported</div><p className="mt-1 break-all text-xs text-emerald-700">{lastExport.pdf}<br />{lastExport.png}</p><button type="button" onClick={() => setShowPostDialog(true)} className="mt-3 w-full rounded-lg bg-emerald-700 py-2 text-xs font-black text-white"><Upload className="mr-1 inline h-4 w-4" />Mark posted to MyRide</button></div>}
                            </aside>
                        </div>
                    </div>
                </div>
            )}

            {showPostDialog && (
                <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-label="Mark notice posted">
                    <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"><div className="flex items-center gap-3"><Link2 className="h-6 w-6 text-blue-600" /><div><h2 className="font-black text-slate-900">Mark posted</h2><p className="text-xs text-slate-500">Paste the public MyRide News URL.</p></div></div><input value={postUrl} onChange={event => setPostUrl(event.target.value)} placeholder="https://www.myridebarrie.ca/News/…" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 mt-4" />{postUrl && !isValidMyRideUrl(postUrl) && <p className="mt-2 text-xs font-bold text-red-600">Enter a secure myridebarrie.ca URL.</p>}<div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setShowPostDialog(false)} className="rounded-lg px-3 py-2 text-sm font-bold text-slate-600">Cancel</button><button type="button" disabled={!isValidMyRideUrl(postUrl)} onClick={() => void submitPosted()} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-black text-white disabled:opacity-40">Save public link</button></div></div>
                </div>
            )}
        </div>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return <label className="block"><span className="mb-1 block text-xs font-black text-slate-600">{label}</span>{children}</label>;
}

function ToolButton({ active, disabled, onClick, icon, label }: { active?: boolean; disabled?: boolean; onClick: () => void; icon: ReactElement; label: string }) {
    return <button type="button" disabled={disabled} onClick={onClick} className={cx('flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border p-2 text-center text-[10px] font-black', active ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50', disabled && 'opacity-40')}>{icon && <span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>}{label}</button>;
}

function CopyCard({ label, text, onCopy }: { label: string; text: string; onCopy: (text: string, label: string) => void }) {
    return <div className="rounded-xl border border-slate-200 p-3"><div className="flex items-center justify-between gap-2"><div className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</div><button type="button" onClick={() => void onCopy(text, label)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" title={`Copy ${label}`}><Clipboard className="h-4 w-4" /></button></div><p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">{text}</p></div>;
}
