import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, GraduationCap, Maximize2, Minimize2 } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import {
  BARRIE_SCHOOLS,
  getPolygonCentroid,
  isPointInPolygon,
  minutesToDisplayTime,
} from '../../utils/transit-app/studentPassUtils';
import type { SchoolConfig, StudentPassResult, TripOptions, ZoneStopOption } from '../../utils/transit-app/studentPassUtils';
import {
    enrichStudentPassWalks,
    findTripOptionsRaptor,
    getStudentPassServiceDateInfo,
} from '../../utils/transit-app/studentPassRaptorAdapter';
import { buildStudentPassRouteLoadLookup } from '../../utils/transit-app/studentPassLoadMetrics';
import { getPerformanceData } from '../../utils/performanceDataService';
import type { PerformanceDataSummary } from '../../utils/performanceDataTypes';
import { StudentPassMap } from './StudentPassMap';
import { StudentPassPanel } from './StudentPassPanel';
import StudentPassTimeline, {
    buildMorningSegments,
    buildAfternoonSegments,
    resolveColor,
} from './StudentPassTimeline';
import type { TimelineSegment } from './StudentPassTimeline';
import { getContrastingTextColor } from '../../utils/config/routeColors';
import type { MapRef } from 'react-map-gl/mapbox';
import './studentPass.css';

interface StudentPassModuleProps {
    onBack: () => void;
    teamId?: string;
}

function parseInputDate(value: string): Date {
    return new Date(`${value}T00:00:00`);
}

function formatDisplayDate(value: string): string {
    return new Intl.DateTimeFormat('en-CA', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    }).format(parseInputDate(value));
}

function hexToRgb(hex: string): [number, number, number] {
    const h = hex.replace('#', '');
    return [
        parseInt(h.substring(0, 2), 16),
        parseInt(h.substring(2, 4), 16),
        parseInt(h.substring(4, 6), 16),
    ];
}

function drawTimelineBar(
    doc: jsPDF,
    segments: TimelineSegment[],
    x: number,
    y: number,
    width: number,
    barHeight: number,
): number {
    const totalMinutes = segments.reduce((sum, s) => sum + s.durationMinutes, 0);
    if (totalMinutes === 0 || segments.length === 0) return y;

    const gap = 1;
    const totalGaps = (segments.length - 1) * gap;
    const availableWidth = width - totalGaps;
    const MIN_WIDTH = 12;

    const rawWidths = segments.map(
        (s) => Math.max((s.durationMinutes / totalMinutes) * availableWidth, MIN_WIDTH)
    );
    const rawTotal = rawWidths.reduce((a, b) => a + b, 0);
    const scale = availableWidth / rawTotal;
    const widths = rawWidths.map((w) => w * scale);

    const radius = 2;
    let curX = x;

    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const segW = widths[i];

        if (seg.type === 'walk') {
            doc.setFillColor(100, 116, 139);
            doc.roundedRect(curX, y, segW, barHeight, radius, radius, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(7);
            doc.setFont('helvetica', 'bold');
            doc.text('Walk', curX + segW / 2, y + barHeight / 2 - 1, { align: 'center' });
            doc.setFontSize(6);
            doc.setFont('helvetica', 'normal');
            doc.text(`${seg.durationMinutes}m`, curX + segW / 2, y + barHeight / 2 + 3, { align: 'center' });
        } else if (seg.type === 'ride') {
            const color = resolveColor(seg.routeColor);
            const [r, g, b] = hexToRgb(color);
            doc.setFillColor(r, g, b);
            doc.roundedRect(curX, y, segW, barHeight, radius, radius, 'F');
            const textColor = getContrastingTextColor(color);
            if (textColor === 'white') {
                doc.setTextColor(255, 255, 255);
            } else {
                doc.setTextColor(0, 0, 0);
            }
            doc.setFontSize(7);
            doc.setFont('helvetica', 'bold');
            doc.text(`Rt ${seg.routeShortName}`, curX + segW / 2, y + barHeight / 2 - 1, { align: 'center' });
            doc.setFontSize(6);
            doc.setFont('helvetica', 'normal');
            doc.text(`${seg.durationMinutes}m`, curX + segW / 2, y + barHeight / 2 + 3, { align: 'center' });
        } else {
            doc.setFillColor(254, 243, 199);
            doc.roundedRect(curX, y, segW, barHeight, radius, radius, 'F');
            doc.setDrawColor(245, 158, 11);
            doc.setLineWidth(0.5);
            doc.setLineDashPattern([1, 1], 0);
            doc.roundedRect(curX, y, segW, barHeight, radius, radius, 'S');
            doc.setLineDashPattern([], 0);
            doc.setTextColor(146, 64, 14);
            doc.setFontSize(6);
            doc.setFont('helvetica', 'bold');
            doc.text('Transfer', curX + segW / 2, y + barHeight / 2 - 1, { align: 'center' });
            doc.setFontSize(6);
            doc.setFont('helvetica', 'normal');
            doc.text(`${seg.durationMinutes}m`, curX + segW / 2, y + barHeight / 2 + 3, { align: 'center' });
        }

        curX += segW + gap;
    }

    curX = x;
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const segW = widths[i];
        if (seg.type === 'ride' && seg.startMinutes != null) {
            doc.setFontSize(6);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(100, 116, 139);
            doc.text(minutesToDisplayTime(seg.startMinutes), curX + 1, y + barHeight + 4);
        }
        curX += segW + gap;
    }

    return y + barHeight + 6;
}

async function prepareMapForExport(mapEl: HTMLElement): Promise<void> {
    if (document.fonts?.ready) {
        await document.fonts.ready.catch((): void => undefined);
    }

    await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    const mapCanvas = mapEl.querySelector('.mapboxgl-canvas') as HTMLCanvasElement | null;
    if (!mapCanvas) return;

    try {
        mapCanvas.toDataURL('image/png');
    } catch (error) {
        console.warn('Student pass map export could not read Mapbox canvas.', error);
    }
}

function waitForImageLoad(image: HTMLImageElement): Promise<void> {
    if (image.complete) return Promise.resolve();

    return new Promise((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Image load failed.'));
    });
}

function prepareOverlayClone(clonedRoot: HTMLElement): void {
    clonedRoot.classList.add('student-pass-export-map');
    clonedRoot.style.background = 'transparent';

    clonedRoot.querySelectorAll('.mapboxgl-canvas').forEach((element) => {
        if (element instanceof HTMLElement) {
            element.style.visibility = 'hidden';
            element.style.opacity = '0';
        }
    });

    clonedRoot.querySelectorAll('.mapboxgl-canvas-container').forEach((element) => {
        if (element instanceof HTMLElement) {
            element.style.background = 'transparent';
        }
    });
}

async function captureStudentPassMapCanvas(mapEl: HTMLElement): Promise<HTMLCanvasElement> {
    const liveCanvas = mapEl.querySelector('.mapboxgl-canvas') as HTMLCanvasElement | null;
    if (!liveCanvas) {
        throw new Error('Mapbox canvas not found for export.');
    }

    const mapBounds = mapEl.getBoundingClientRect();
    const displayWidth = Math.max(1, Math.round(mapBounds.width));
    const displayHeight = Math.max(1, Math.round(mapBounds.height));
    const exportWidth = Math.max(1, liveCanvas.width || Math.round(displayWidth * Math.max(window.devicePixelRatio || 1, 1)));
    const exportHeight = Math.max(1, liveCanvas.height || Math.round(displayHeight * Math.max(window.devicePixelRatio || 1, 1)));
    const overlayScale = Math.max(exportWidth / displayWidth, exportHeight / displayHeight, 1);

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = exportWidth;
    exportCanvas.height = exportHeight;

    const ctx = exportCanvas.getContext('2d');
    if (!ctx) {
        throw new Error('Could not create export canvas context.');
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, exportWidth, exportHeight);

    const mapImage = new Image();
    mapImage.decoding = 'async';
    mapImage.src = liveCanvas.toDataURL('image/png');
    await waitForImageLoad(mapImage);
    ctx.drawImage(mapImage, 0, 0, exportWidth, exportHeight);

    try {
        const overlayCanvas = await html2canvas(mapEl, {
            useCORS: true,
            backgroundColor: null,
            scale: overlayScale,
            onclone: (clonedDoc) => {
                const clonedMapEl = clonedDoc.querySelector('.student-pass-map') as HTMLElement | null;
                if (!clonedMapEl) return;
                prepareOverlayClone(clonedMapEl);
            },
        });

        ctx.drawImage(overlayCanvas, 0, 0, exportWidth, exportHeight);
    } catch (error) {
        console.warn('Student pass map export could not capture overlay markers.', error);
    }

    return exportCanvas;
}

export const StudentPassModule: React.FC<StudentPassModuleProps> = ({ onBack, teamId }) => {
    const serviceDateInfo = useMemo(() => getStudentPassServiceDateInfo(), []);
    const [selectedSchoolId, setSelectedSchoolId] = useState<string>(BARRIE_SCHOOLS[0].id);
    const [bellStart, setBellStart] = useState<string>('');
    const [bellEnd, setBellEnd] = useState<string>('');
    const [serviceDate, setServiceDate] = useState<string>(serviceDateInfo.defaultDate);
    const [polygon, setPolygon] = useState<[number, number][] | null>(null);
    const [zoneOrigin, setZoneOrigin] = useState<[number, number] | null>(null);
    const [selectedZoneStopId, setSelectedZoneStopId] = useState<string | null>(null);
    const [tripOptions, setTripOptions] = useState<TripOptions | null>(null);
    const [selectedMorningIdx, setSelectedMorningIdx] = useState(0);
    const [selectedAfternoonIdx, setSelectedAfternoonIdx] = useState(0);
    const [isCalculating, setIsCalculating] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [journeyMode, setJourneyMode] = useState<'am' | 'pm'>('am');
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [performanceData, setPerformanceData] = useState<PerformanceDataSummary | null>(null);
    const mapInstanceRef = useRef<MapRef | null>(null);

    const selectedSchool: SchoolConfig =
        BARRIE_SCHOOLS.find((s) => s.id === selectedSchoolId) ?? BARRIE_SCHOOLS[0];

    const handlePolygonComplete = useCallback((coords: [number, number][]) => {
        setPolygon(coords);
        setZoneOrigin((currentOrigin) => {
            if (currentOrigin && isPointInPolygon(currentOrigin, coords)) {
                return currentOrigin;
            }
            return getPolygonCentroid(coords);
        });
    }, []);

    const handlePolygonClear = useCallback(() => {
        setPolygon(null);
        setZoneOrigin(null);
        setSelectedZoneStopId(null);
        setTripOptions(null);
        setSelectedMorningIdx(0);
        setSelectedAfternoonIdx(0);
        setIsCalculating(false);
        setJourneyMode('am');
    }, []);

    const handleSchoolChange = (id: string) => {
        setSelectedSchoolId(id);
        setBellStart('');
        setBellEnd('');
        setTripOptions(null);
        setSelectedZoneStopId(null);
        setSelectedMorningIdx(0);
        setSelectedAfternoonIdx(0);
        setJourneyMode('am');
    };

    const handleZoneStopChange = useCallback((stopId: string) => {
        setSelectedZoneStopId(stopId);
        setTripOptions(null);
        setSelectedMorningIdx(0);
        setSelectedAfternoonIdx(0);
        setJourneyMode('am');
    }, []);

    const handleZoneStopClear = useCallback(() => {
        setSelectedZoneStopId(null);
        setTripOptions(null);
        setSelectedMorningIdx(0);
        setSelectedAfternoonIdx(0);
        setJourneyMode('am');
    }, []);

    const handleServiceDateChange = useCallback((value: string) => {
        setServiceDate(value);
        setTripOptions(null);
        setSelectedMorningIdx(0);
        setSelectedAfternoonIdx(0);
        setJourneyMode('am');
    }, []);

    const handleZoneOriginChange = useCallback((coords: [number, number]) => {
        setZoneOrigin(coords);
        setTripOptions(null);
        setSelectedMorningIdx(0);
        setSelectedAfternoonIdx(0);
        setJourneyMode('am');
    }, []);

    const effectiveBellStart = bellStart || selectedSchool.bellStart;
    const effectiveBellEnd = bellEnd || selectedSchool.bellEnd;
    const effectiveZoneStopId = selectedZoneStopId ?? tripOptions?.selectedZoneStopId ?? null;
    const selectedZoneStop: ZoneStopOption | null = useMemo(() => {
        if (!tripOptions?.zoneStops?.length) return null;
        return tripOptions.zoneStops.find((stop) => stop.stopId === effectiveZoneStopId) ?? null;
    }, [effectiveZoneStopId, tripOptions?.zoneStops]);

    useEffect(() => {
        if (!teamId) {
            setPerformanceData(null);
            return;
        }

        let cancelled = false;
        getPerformanceData(teamId)
            .then((data) => {
                if (!cancelled) setPerformanceData(data);
            })
            .catch((error) => {
                console.error('Error loading performance data for student pass:', error);
                if (!cancelled) setPerformanceData(null);
            });

        return () => {
            cancelled = true;
        };
    }, [teamId]);

    useEffect(() => {
        if (!polygon) {
            setIsCalculating(false);
            return;
        }

        let cancelled = false;

        setIsCalculating(true);
        const rafId = requestAnimationFrame(() => {
            const schoolWithOverrides: SchoolConfig = {
                ...selectedSchool,
                bellStart: effectiveBellStart,
                bellEnd: effectiveBellEnd,
            };
            const options = findTripOptionsRaptor(polygon, schoolWithOverrides, {
                serviceDate: parseInputDate(serviceDate),
                zoneStopId: selectedZoneStopId,
                zoneOrigin,
            });
            if (cancelled) return;
            setTripOptions(options);
            setSelectedMorningIdx(0);
            setSelectedAfternoonIdx(0);
            setIsCalculating(false);

            // Enrich walk legs with Mapbox street-level geometry (async)
            const allResults = [
                ...options.morningOptions.map((o) => o.result),
                ...options.afternoonOptions.map((o) => o.result),
            ];
            Promise.all(allResults.map(enrichStudentPassWalks)).then((enriched) => {
                if (cancelled) return;
                let idx = 0;
                const enrichedOptions = { ...options };
                enrichedOptions.morningOptions = options.morningOptions.map((o) => ({
                    ...o,
                    result: enriched[idx++],
                }));
                enrichedOptions.afternoonOptions = options.afternoonOptions.map((o) => ({
                    ...o,
                    result: enriched[idx++],
                }));
                setTripOptions(enrichedOptions);
            });
        });

        return () => {
            cancelled = true;
            cancelAnimationFrame(rafId);
        };
    }, [polygon, selectedSchool, effectiveBellStart, effectiveBellEnd, serviceDate, selectedZoneStopId, zoneOrigin]);

    // Compose result from selected morning + selected afternoon option
    const result: StudentPassResult | null = (() => {
        if (!tripOptions) return null;
        const option = tripOptions.morningOptions[selectedMorningIdx];
        if (!option) return { found: false as const, isDirect: false, morningLegs: [], afternoonLegs: [] };

        const pm = tripOptions.afternoonOptions[selectedAfternoonIdx];
        if (!pm) return option.result;

        return {
            ...option.result,
            afternoonLegs: pm.result.afternoonLegs,
            afternoonRouteShapes: pm.result.afternoonRouteShapes,
            walkFromSchool: pm.result.walkFromSchool,
            walkToZone: pm.result.walkToZone,
            afternoonTransfer: pm.result.afternoonTransfer,
            afternoonTransfers: pm.result.afternoonTransfers,
            nextAfternoonDepartureMinutes: pm.result.nextAfternoonDepartureMinutes,
        };
    })();

    const routeLoadLookup = useMemo(
        () => buildStudentPassRouteLoadLookup(performanceData, serviceDate),
        [performanceData, serviceDate]
    );

    useEffect(() => {
        const timer = window.setTimeout(() => {
            mapInstanceRef.current?.resize();
        }, 120);

        return () => window.clearTimeout(timer);
    }, [isFullscreen]);

    // ── PDF export helpers ─────────────────────────────────────────────────────

    function getJourneyGeoPoints(
        r: StudentPassResult,
        mode: 'am' | 'pm',
        school: SchoolConfig,
        origin: [number, number] | null,
        poly: [number, number][] | null,
    ): [number, number][] {
        const pts: [number, number][] = [];
        const shapes = mode === 'am' ? r.routeShapes : r.afternoonRouteShapes;
        shapes?.forEach((s) => pts.push(...s.points));
        pts.push([school.lat, school.lon]);
        if (origin) pts.push(origin);
        else if (r.zoneCentroid) pts.push(r.zoneCentroid);
        if (poly) pts.push(...poly);
        return pts;
    }

    function cropCanvasToContent(
        fullCanvas: HTMLCanvasElement,
        mapEl: HTMLElement,
        map: MapRef,
        geoPoints: [number, number][],
    ): HTMLCanvasElement {
        if (geoPoints.length === 0) return fullCanvas;

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const [lat, lng] of geoPoints) {
            const px = map.project([lng, lat]);
            minX = Math.min(minX, px.x);
            maxX = Math.max(maxX, px.x);
            minY = Math.min(minY, px.y);
            maxY = Math.max(maxY, px.y);
        }

        const padX = Math.max(50, (maxX - minX) * 0.15);
        const padY = Math.max(50, (maxY - minY) * 0.15);
        const cW = mapEl.clientWidth;
        const cH = mapEl.clientHeight;
        minX = Math.max(0, minX - padX);
        minY = Math.max(0, minY - padY);
        maxX = Math.min(cW, maxX + padX);
        maxY = Math.min(cH, maxY + padY);

        const scaleX = fullCanvas.width / cW;
        const scaleY = fullCanvas.height / cH;
        const cx = Math.round(minX * scaleX);
        const cy = Math.round(minY * scaleY);
        const cropW = Math.round((maxX - minX) * scaleX);
        const cropH = Math.round((maxY - minY) * scaleY);

        if (cropW <= 0 || cropH <= 0) return fullCanvas;

        const cropped = document.createElement('canvas');
        cropped.width = cropW;
        cropped.height = cropH;
        const ctx = cropped.getContext('2d');
        if (!ctx) return fullCanvas;
        ctx.drawImage(fullCanvas, cx, cy, cropW, cropH, 0, 0, cropW, cropH);
        return cropped;
    }

    function buildJourneySummary(
        r: StudentPassResult,
        mode: 'am' | 'pm',
        school: SchoolConfig,
        bellTime: string,
    ): string[] {
        const legs = mode === 'am' ? r.morningLegs : (r.afternoonLegs ?? []);
        if (legs.length === 0) return [];

        const steps: string[] = [];

        if (mode === 'am') {
            if (r.walkToStop) {
                steps.push(`Walk ${r.walkToStop.walkMinutes} min to ${legs[0].fromStop}`);
            }
            for (let i = 0; i < legs.length; i++) {
                const leg = legs[i];
                const dur = leg.arrivalMinutes - leg.departureMinutes;
                if (i === 0) {
                    steps.push(`Board Route ${leg.routeShortName} at ${minutesToDisplayTime(leg.departureMinutes)} (${dur} min ride)`);
                } else {
                    const wait = leg.departureMinutes - legs[i - 1].arrivalMinutes;
                    steps.push(`Transfer to Route ${leg.routeShortName} — ${wait} min wait, ${dur} min ride`);
                }
            }
            if (r.walkToSchool) {
                steps.push(`Walk ${r.walkToSchool.walkMinutes} min to ${school.name}`);
            }
            const walkBefore = r.walkToStop?.walkMinutes ?? 0;
            const walkAfter = r.walkToSchool?.walkMinutes ?? 0;
            const total = (legs[legs.length - 1].arrivalMinutes - legs[0].departureMinutes) + walkBefore + walkAfter;
            steps.push(`Total door-to-door: about ${total} min — bell time: ${bellTime}`);
        } else {
            steps.push(`Bell rings at ${bellTime}`);
            if (r.walkFromSchool) {
                steps.push(`Walk ${r.walkFromSchool.walkMinutes} min from school to ${legs[0].fromStop}`);
            }
            for (let i = 0; i < legs.length; i++) {
                const leg = legs[i];
                const dur = leg.arrivalMinutes - leg.departureMinutes;
                if (i === 0) {
                    steps.push(`Board Route ${leg.routeShortName} at ${minutesToDisplayTime(leg.departureMinutes)} (${dur} min ride)`);
                } else {
                    const wait = leg.departureMinutes - legs[i - 1].arrivalMinutes;
                    steps.push(`Transfer to Route ${leg.routeShortName} — ${wait} min wait, ${dur} min ride`);
                }
            }
            if (r.walkToZone) {
                steps.push(`Walk ${r.walkToZone.walkMinutes} min home`);
            }
            const walkBefore = r.walkFromSchool?.walkMinutes ?? 0;
            const walkAfter = r.walkToZone?.walkMinutes ?? 0;
            const total = (legs[legs.length - 1].arrivalMinutes - legs[0].departureMinutes) + walkBefore + walkAfter;
            steps.push(`Total door-to-door: about ${total} min`);
        }

        return steps;
    }

    const handleExportPdf = useCallback(async () => {
        if (!result?.found) return;
        setIsExporting(true);
        const originalMode = journeyMode;
        try {
            const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
            const pageW = doc.internal.pageSize.getWidth();
            const pageH = doc.internal.pageSize.getHeight();
            const margin = 14;
            const contentW = pageW - margin * 2;
            const displayDate = formatDisplayDate(serviceDate);
            const today = new Date().toLocaleDateString('en-CA');

            const morningSegs = buildMorningSegments(result);
            const afternoonSegs = buildAfternoonSegments(result);
            const hasAfternoon = afternoonSegs.length > 0;

            // ── Captures (switch mode, capture map + timeline) ──
            const mapEl = document.querySelector('.student-pass-map') as HTMLElement | null;
            const map = mapInstanceRef.current;
            let amMapImg: string | null = null;
            let pmMapImg: string | null = null;
            let amTimelineImg: string | null = null;
            let pmTimelineImg: string | null = null;
            let amAspect = 4 / 3;
            let pmAspect = 4 / 3;
            let amTimelineAspect = 6;
            let pmTimelineAspect = 6;

            const waitForRender = () => new Promise<void>((resolve) => {
                requestAnimationFrame(() => setTimeout(resolve, 800));
            });

            async function captureTimeline(): Promise<{ img: string; aspect: number } | null> {
                const el = document.getElementById('student-pass-timeline');
                if (!el) return null;
                const canvas = await html2canvas(el, {
                    useCORS: true,
                    backgroundColor: '#00263e',
                    scale: 2,
                });
                return {
                    img: canvas.toDataURL('image/png'),
                    aspect: canvas.width / Math.max(canvas.height, 1),
                };
            }

            if (mapEl) {
                // AM capture
                try {
                    setJourneyMode('am');
                    await waitForRender();
                    await prepareMapForExport(mapEl);
                    const fullCanvas = await captureStudentPassMapCanvas(mapEl);
                    if (map) {
                        const pts = getJourneyGeoPoints(result, 'am', selectedSchool, zoneOrigin, polygon);
                        const cropped = cropCanvasToContent(fullCanvas, mapEl, map, pts);
                        amAspect = cropped.width / Math.max(cropped.height, 1);
                        amMapImg = cropped.toDataURL('image/png');
                    } else {
                        amAspect = fullCanvas.width / Math.max(fullCanvas.height, 1);
                        amMapImg = fullCanvas.toDataURL('image/png');
                    }
                    const tl = await captureTimeline();
                    if (tl) { amTimelineImg = tl.img; amTimelineAspect = tl.aspect; }
                } catch { /* skip AM */ }

                // PM capture
                if (hasAfternoon) {
                    try {
                        setJourneyMode('pm');
                        await waitForRender();
                        await prepareMapForExport(mapEl);
                        const fullCanvas = await captureStudentPassMapCanvas(mapEl);
                        if (map) {
                            const pts = getJourneyGeoPoints(result, 'pm', selectedSchool, zoneOrigin, polygon);
                            const cropped = cropCanvasToContent(fullCanvas, mapEl, map, pts);
                            pmAspect = cropped.width / Math.max(cropped.height, 1);
                            pmMapImg = cropped.toDataURL('image/png');
                        } else {
                            pmAspect = fullCanvas.width / Math.max(fullCanvas.height, 1);
                            pmMapImg = fullCanvas.toDataURL('image/png');
                        }
                        const tl = await captureTimeline();
                        if (tl) { pmTimelineImg = tl.img; pmTimelineAspect = tl.aspect; }
                    } catch { /* skip PM */ }
                }

                setJourneyMode(originalMode);
            }

            const eBellStart = bellStart || selectedSchool.bellStart;
            const eBellEnd = bellEnd || selectedSchool.bellEnd;

            // ── Shared helpers ────────────────────────────────────
            function drawBanner(journeyLabel: string) {
                doc.setFillColor(0, 78, 126);
                doc.rect(0, 0, pageW, 22, 'F');
                doc.setTextColor(255, 255, 255);
                doc.setFontSize(14);
                doc.setFont('helvetica', 'bold');
                doc.text(selectedSchool.name, margin, 11);
                doc.setFontSize(9);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(214, 237, 250);
                doc.text('Student Transit Pass Pilot', margin, 18);
                doc.setTextColor(255, 255, 255);
                doc.text(displayDate, pageW - margin, 11, { align: 'right' });
                doc.setFontSize(7);
                doc.setTextColor(214, 237, 250);
                doc.text(journeyLabel, pageW - margin, 18, { align: 'right' });
            }

            function drawFooter() {
                const footerY = pageH - 10;
                doc.setDrawColor(0, 78, 126);
                doc.setLineWidth(0.3);
                doc.line(margin, footerY - 4, pageW - margin, footerY - 4);
                doc.setFontSize(7);
                doc.setTextColor(94, 127, 150);
                doc.text('Barrie Transit', margin, footerY);
                doc.text(
                    `${displayDate} | Exported ${today}`,
                    pageW - margin,
                    footerY,
                    { align: 'right' },
                );
            }

            function drawSummary(steps: string[], yPos: number): number {
                if (steps.length === 0) return yPos;
                let cy = yPos + 4;
                for (let i = 0; i < steps.length; i++) {
                    const num = `${i + 1}.`;
                    doc.setFontSize(8);
                    doc.setFont('helvetica', 'bold');
                    doc.setTextColor(0, 78, 126);
                    doc.text(num, margin, cy);
                    doc.setFont('helvetica', 'normal');
                    doc.setTextColor(60, 60, 60);
                    const wrapped: string[] = doc.splitTextToSize(steps[i], contentW - 8);
                    doc.text(wrapped, margin + 8, cy);
                    cy += wrapped.length * 3.5;
                }
                return cy;
            }

            // ═══ PAGE 1: MORNING JOURNEY ═════════════════════════
            drawBanner('Morning Journey');
            let y = 28;

            if (amMapImg) {
                const maxMapH = pageH - 28 - 60;
                const amMapH = Math.min(contentW / amAspect, maxMapH);
                doc.setDrawColor(200, 220, 235);
                doc.setLineWidth(0.3);
                doc.rect(margin, y, contentW, amMapH, 'S');
                doc.addImage(amMapImg, 'PNG', margin, y, contentW, amMapH);
                y += amMapH + 4;
            }

            if (amTimelineImg) {
                const tlH = contentW / amTimelineAspect;
                doc.addImage(amTimelineImg, 'PNG', margin, y, contentW, tlH);
                y += tlH + 3;
            }

            y = drawSummary(buildJourneySummary(result, 'am', selectedSchool, eBellStart), y);
            drawFooter();

            // ═══ PAGE 2: AFTERNOON JOURNEY ═══════════════════════
            if (hasAfternoon) {
                doc.addPage();
                drawBanner('Afternoon Journey');
                y = 28;

                if (pmMapImg) {
                    const maxMapH = pageH - 28 - 60;
                    const pmMapH = Math.min(contentW / pmAspect, maxMapH);
                    doc.setDrawColor(200, 220, 235);
                    doc.setLineWidth(0.3);
                    doc.rect(margin, y, contentW, pmMapH, 'S');
                    doc.addImage(pmMapImg, 'PNG', margin, y, contentW, pmMapH);
                    y += pmMapH + 4;
                }

                if (pmTimelineImg) {
                    const tlH = contentW / pmTimelineAspect;
                    doc.addImage(pmTimelineImg, 'PNG', margin, y, contentW, tlH);
                    y += tlH + 3;
                }

                y = drawSummary(buildJourneySummary(result, 'pm', selectedSchool, eBellEnd), y);
                drawFooter();
            }

            // ── Save ─────────────────────────────────────────────
            const safeName = selectedSchool.name.replace(/[^a-zA-Z0-9]/g, '-');
            doc.save(`${safeName}-Student-Transit-Pass.pdf`);
        } finally {
            setIsExporting(false);
        }
    }, [result, selectedSchool, serviceDate, journeyMode, bellStart, bellEnd, zoneOrigin]);

    return (
        <div className={`student-pass-theme flex flex-col overflow-hidden ${isFullscreen ? 'fixed inset-0 z-50' : 'h-full'}`}>
            {/* Dark header */}
            {!isFullscreen && (
                <div
                    className="flex items-center gap-3 px-6 py-3 flex-shrink-0"
                    style={{ background: 'var(--student-pass-panel-strong)', borderBottom: '1px solid var(--student-pass-border)' }}
                >
                    <button onClick={onBack} className="transition-colors" style={{ color: 'var(--student-pass-muted)' }}>
                        <ArrowLeft size={18} />
                    </button>
                    <GraduationCap size={18} style={{ color: 'var(--student-pass-accent-strong)' }} />
                    <h2
                        className="text-[15px] font-semibold"
                        style={{ color: 'var(--student-pass-text)', fontFamily: "'JetBrains Mono', monospace" }}
                    >
                        Student Transit Pass
                    </h2>
                </div>
            )}

            {/* Map fills everything */}
            <div className="flex-1 relative overflow-hidden" style={{ background: 'var(--student-pass-blue-ink)' }}>
                <button
                    type="button"
                    onClick={() => setIsFullscreen((current) => !current)}
                    className="absolute top-4 right-4 z-20 flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors"
                    style={{
                        background: 'var(--student-pass-panel)',
                        border: '1px solid var(--student-pass-border)',
                        color: 'var(--student-pass-text)',
                        fontFamily: "'JetBrains Mono', monospace",
                    }}
                    title={isFullscreen ? 'Exit fullscreen map' : 'Open fullscreen map'}
                >
                    {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                    <span>{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</span>
                </button>

                <div className="absolute inset-0 student-pass-dark">
                    <StudentPassMap
                        mapRef={mapInstanceRef}
                        school={selectedSchool}
                        result={result}
                        journeyMode={journeyMode}
                        polygon={polygon}
                        zoneOrigin={zoneOrigin}
                        zoneStops={tripOptions?.zoneStops ?? []}
                        selectedZoneStopId={effectiveZoneStopId}
                        onPolygonComplete={handlePolygonComplete}
                        onPolygonClear={handlePolygonClear}
                        onZoneStopSelect={handleZoneStopChange}
                        onZoneOriginChange={handleZoneOriginChange}
                    />
                </div>

                {/* Floating panel overlay */}
                <StudentPassPanel
                    selectedSchoolId={selectedSchoolId}
                    onSchoolChange={handleSchoolChange}
                    selectedSchool={selectedSchool}
                    bellStart={bellStart}
                    bellEnd={bellEnd}
                    onBellStartChange={setBellStart}
                    onBellEndChange={setBellEnd}
                    serviceDate={serviceDate}
                    onServiceDateChange={handleServiceDateChange}
                    minServiceDate={serviceDateInfo.minDate}
                    maxServiceDate={serviceDateInfo.maxDate}
                    serviceDateWarning={serviceDateInfo.defaultDateWarning}
                    effectiveBellStart={effectiveBellStart}
                    effectiveBellEnd={effectiveBellEnd}
                    polygon={polygon}
                    isCalculating={isCalculating}
                    tripOptions={tripOptions}
                    result={result}
                    selectedZoneStopId={effectiveZoneStopId}
                    selectedZoneStop={selectedZoneStop}
                    selectedMorningIdx={selectedMorningIdx}
                    selectedAfternoonIdx={selectedAfternoonIdx}
                    onMorningSelect={setSelectedMorningIdx}
                    onAfternoonSelect={setSelectedAfternoonIdx}
                    onZoneStopSelect={handleZoneStopChange}
                    journeyMode={journeyMode}
                    onJourneyModeChange={setJourneyMode}
                    onExport={handleExportPdf}
                    isExporting={isExporting}
                />

                {/* Journey timeline at bottom */}
                {result?.found && (
                    <StudentPassTimeline
                        result={result}
                        journeyMode={journeyMode}
                        onJourneyModeChange={setJourneyMode}
                        routeLoadLookup={routeLoadLookup}
                    />
                )}
            </div>
        </div>
    );
};
