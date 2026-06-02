import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { ArrowLeft, GraduationCap } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import {
  BARRIE_SCHOOLS,
  minutesToDisplayTime,
} from '../../utils/transit-app/studentPassUtils';
import type { SchoolConfig, StudentPassResult, TripOptions, ZoneStopOption } from '../../utils/transit-app/studentPassUtils';
import {
    enrichStudentPassWalks,
    findTripOptionsRaptor,
    getStudentPassServiceDateInfo,
} from '../../utils/transit-app/studentPassRaptorAdapter';
import { StudentPassMap } from './StudentPassMap';
import { StudentPassPanel } from './StudentPassPanel';
import StudentPassTimeline, {
    buildMorningSegments,
    buildAfternoonSegments,
    resolveColor,
} from './StudentPassTimeline';
import type { TimelineSegment } from './StudentPassTimeline';
import './studentPass.css';

interface StudentPassModuleProps {
    onBack: () => void;
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

function getContrastingTextColor(hexColor: string): 'white' | 'black' {
    const [r, g, b] = hexToRgb(hexColor);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? 'black' : 'white';
}

async function prepareMapForExport(mapEl: HTMLElement): Promise<void> {
    mapEl.classList.add('student-pass-export-map');
    await new Promise(resolve => setTimeout(resolve, 100));
}

async function captureStudentPassMapCanvas(mapEl: HTMLElement): Promise<HTMLCanvasElement> {
    const rect = mapEl.getBoundingClientRect();
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = rect.width * scale;
    canvas.height = rect.height * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);

    ctx.fillStyle = '#dfeef8';
    ctx.fillRect(0, 0, rect.width, rect.height);

    const glCanvas = mapEl.querySelector('canvas.mapboxgl-canvas') as HTMLCanvasElement | null;
    if (glCanvas) {
        ctx.drawImage(glCanvas, 0, 0, rect.width, rect.height);
    }

    try {
        const overlayCanvas = await html2canvas(mapEl, {
            useCORS: true,
            scale,
            backgroundColor: null,
            ignoreElements: (el: Element) => el.tagName === 'CANVAS',
        });
        ctx.drawImage(overlayCanvas, 0, 0, rect.width, rect.height);
    } catch {
        // HTML overlay capture failed — map canvas alone is fine
    }

    mapEl.classList.remove('student-pass-export-map');
    return canvas;
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
            doc.setFontSize(7);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(146, 64, 14);
            doc.text(`${seg.durationMinutes}m`, curX + segW / 2, y + barHeight / 2 + 1, { align: 'center' });
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


export const StudentPassModule: React.FC<StudentPassModuleProps> = ({ onBack }) => {
    const serviceDateInfo = useMemo(() => getStudentPassServiceDateInfo(), []);
    const [selectedSchoolId, setSelectedSchoolId] = useState<string>(BARRIE_SCHOOLS[0].id);
    const [bellStart, setBellStart] = useState<string>('');
    const [bellEnd, setBellEnd] = useState<string>('');
    const [serviceDate, setServiceDate] = useState<string>(serviceDateInfo.defaultDate);
    const [polygon, setPolygon] = useState<[number, number][] | null>(null);
    const [selectedZoneStopId, setSelectedZoneStopId] = useState<string | null>(null);
    const [tripOptions, setTripOptions] = useState<TripOptions | null>(null);
    const [selectedMorningIdx, setSelectedMorningIdx] = useState(0);
    const [selectedAfternoonIdx, setSelectedAfternoonIdx] = useState(0);
    const [isCalculating, setIsCalculating] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [journeyMode, setJourneyMode] = useState<'am' | 'pm'>('am');
    const [isFullscreen, setIsFullscreen] = useState(false);

    const selectedSchool: SchoolConfig =
        BARRIE_SCHOOLS.find((s) => s.id === selectedSchoolId) ?? BARRIE_SCHOOLS[0];

    const handlePolygonComplete = useCallback((coords: [number, number][]) => {
        setPolygon(coords);
    }, []);

    const handlePolygonClear = useCallback(() => {
        setPolygon(null);
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

    const handleServiceDateChange = useCallback((value: string) => {
        setServiceDate(value);
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
    }, [polygon, selectedSchool, effectiveBellStart, effectiveBellEnd, serviceDate, selectedZoneStopId]);

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

    const handleExportPdf = useCallback(async () => {
        if (!result?.found) return;
        setIsExporting(true);
        try {
            const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
            const pageW = doc.internal.pageSize.getWidth();
            const pageH = doc.internal.pageSize.getHeight();
            const margin = 14;
            const contentW = pageW - margin * 2;

            // ── Title Banner ─────────────────────────────────────
            doc.setFillColor(0, 78, 126);
            doc.rect(0, 0, pageW, 22, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.text(selectedSchool.name, margin, 11);
            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(214, 237, 250);
            doc.text('Student Transit Pass', margin, 18);
            doc.text(formatDisplayDate(serviceDate), pageW - margin, 11, { align: 'right' });

            let y = 28;

            // ── Map Capture ──────────────────────────────────────
            const mapEl = document.querySelector('.student-pass-map') as HTMLElement | null;
            const mapH = 120;
            if (mapEl) {
                try {
                    await prepareMapForExport(mapEl);
                    const canvas = await captureStudentPassMapCanvas(mapEl);
                    const imgData = canvas.toDataURL('image/png');
                    doc.setDrawColor(200, 220, 235);
                    doc.setLineWidth(0.3);
                    doc.rect(margin, y, contentW, mapH, 'S');
                    doc.addImage(imgData, 'PNG', margin, y, contentW, mapH);
                    y += mapH + 6;
                } catch {
                    y += 4;
                }
            }

            // ── Morning Timeline ─────────────────────────────────
            const morningSegs = buildMorningSegments(result);
            const morningTotal = morningSegs.reduce((sum, s) => sum + s.durationMinutes, 0);

            if (morningSegs.length > 0) {
                doc.setFontSize(8);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(0, 78, 126);
                doc.text('MORNING JOURNEY', margin, y);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(100, 116, 139);
                doc.text(`${morningTotal} min`, pageW - margin, y, { align: 'right' });
                y += 4;

                y = drawTimelineBar(doc, morningSegs, margin, y, contentW, 12);
                y += 4;
            }

            // ── Afternoon Timeline ───────────────────────────────
            const afternoonSegs = buildAfternoonSegments(result);
            const afternoonTotal = afternoonSegs.reduce((sum, s) => sum + s.durationMinutes, 0);

            if (afternoonSegs.length > 0) {
                doc.setFontSize(8);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(0, 78, 126);
                doc.text('AFTERNOON JOURNEY', margin, y);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(100, 116, 139);
                doc.text(`${afternoonTotal} min`, pageW - margin, y, { align: 'right' });
                y += 4;

                y = drawTimelineBar(doc, afternoonSegs, margin, y, contentW, 12);
            }

            // ── Footer ───────────────────────────────────────────
            const footerY = pageH - 10;
            doc.setDrawColor(0, 78, 126);
            doc.setLineWidth(0.3);
            doc.line(margin, footerY - 4, pageW - margin, footerY - 4);
            doc.setFontSize(7);
            doc.setTextColor(94, 127, 150);
            doc.text('Barrie Transit', margin, footerY);
            const today = new Date().toLocaleDateString('en-CA');
            doc.text(
                `${formatDisplayDate(serviceDate)} | Exported ${today}`,
                pageW - margin,
                footerY,
                { align: 'right' },
            );

            // ── Save ─────────────────────────────────────────────
            const safeName = selectedSchool.name.replace(/[^a-zA-Z0-9]/g, '-');
            doc.save(`${safeName}-Student-Transit-Pass.pdf`);
        } finally {
            setIsExporting(false);
        }
    }, [result, selectedSchool, serviceDate]);

    return (
        <div className={`flex flex-col overflow-hidden ${isFullscreen ? 'fixed inset-0 z-50' : 'h-full'}`}>
            {/* Dark header */}
            {!isFullscreen && (
                <div
                    className="flex items-center gap-3 px-6 py-3 flex-shrink-0"
                    style={{ background: '#0B1121', borderBottom: '1px solid rgba(99, 126, 184, 0.12)' }}
                >
                    <button onClick={onBack} className="text-[#94A3B8] hover:text-[#E2E8F0] transition-colors">
                        <ArrowLeft size={18} />
                    </button>
                    <GraduationCap size={18} className="text-emerald-400" />
                    <h2
                        className="text-[15px] font-semibold text-[#E2E8F0]"
                        style={{ fontFamily: "'JetBrains Mono', monospace" }}
                    >
                        Student Transit Pass
                    </h2>
                </div>
            )}

            {/* Map fills everything */}
            <div className="flex-1 relative overflow-hidden" style={{ background: '#0B1121' }}>
                <div className="absolute inset-0 student-pass-dark">
                    <StudentPassMap
                        school={selectedSchool}
                        result={result}
                        journeyMode={journeyMode}
                        zoneStops={tripOptions?.zoneStops ?? []}
                        selectedZoneStopId={effectiveZoneStopId}
                        onPolygonComplete={handlePolygonComplete}
                        onPolygonClear={handlePolygonClear}
                        onZoneStopSelect={handleZoneStopChange}
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
                    />
                )}
            </div>
        </div>
    );
};
