import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { ArrowLeft, GraduationCap } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import {
  BARRIE_SCHOOLS,
  minutesToDisplayTime,
} from '../../utils/transit-app/studentPassUtils';
import type { SchoolConfig, StudentPassResult, TripOptions, TransferInfo, ZoneStopOption } from '../../utils/transit-app/studentPassUtils';
import {
    enrichStudentPassWalks,
    findTripOptionsRaptor,
    getStudentPassServiceDateInfo,
} from '../../utils/transit-app/studentPassRaptorAdapter';
import { StudentPassMap } from './StudentPassMap';
import { StudentPassPanel } from './StudentPassPanel';
import StudentPassTimeline from './StudentPassTimeline';
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

function getJourneyTransfers(
    result: StudentPassResult,
    mode: 'am' | 'pm'
): TransferInfo[] {
    if (mode === 'am') {
        if (result.morningTransfers?.length) return result.morningTransfers;
        if (result.morningTransfer) return [result.morningTransfer];
        if (result.transfers?.length) return result.transfers;
        if (result.transfer) return [result.transfer];
        return [];
    }

    if (result.afternoonTransfers?.length) return result.afternoonTransfers;
    if (result.afternoonTransfer) return [result.afternoonTransfer];
    return [];
}

function buildMorningSteps(result: StudentPassResult, bellStart: string): string[] {
    const steps: string[] = [];
    let stepNumber = 1;
    const transfers = getJourneyTransfers(result, 'am');

    if (result.walkToStop) {
        steps.push(
            `${stepNumber}. Walk ${result.walkToStop.walkMinutes} min (${(result.walkToStop.distanceKm * 1000).toFixed(0)}m) to ${result.walkToStop.label.replace(/^Walk to /, '')}`
        );
        stepNumber++;
    }

    result.morningLegs.forEach((leg, index) => {
        steps.push(
            `${stepNumber}. Board Rt ${leg.routeShortName} at ${minutesToDisplayTime(leg.departureMinutes)} from ${leg.fromStop}`
        );
        stepNumber++;
        steps.push(
            `${stepNumber}. Arrive ${leg.toStop} at ${minutesToDisplayTime(leg.arrivalMinutes)}`
        );
        stepNumber++;

        const transfer = transfers[index];
        if (transfer) {
            steps.push(
                `${stepNumber}. Transfer at ${leg.toStop} (${transfer.waitMinutes} min wait)`
            );
            stepNumber++;
        }
    });

    if (result.walkToSchool) {
        steps.push(
            `${stepNumber}. Walk ${result.walkToSchool.walkMinutes} min (${(result.walkToSchool.distanceKm * 1000).toFixed(0)}m) to school`
        );
    } else {
        steps.push(`${stepNumber}. Walk to school`);
    }
    stepNumber++;
    steps.push(`${stepNumber}. Bell time ${bellStart}`);

    return steps;
}

function buildAfternoonSteps(result: StudentPassResult, bellEnd: string): string[] {
    const steps: string[] = [`1. Bell rings at ${bellEnd}`];
    let stepNumber = 2;
    const transfers = getJourneyTransfers(result, 'pm');

    if (result.walkFromSchool) {
        steps.push(
            `${stepNumber}. Walk ${result.walkFromSchool.walkMinutes} min (${(result.walkFromSchool.distanceKm * 1000).toFixed(0)}m) to ${result.walkFromSchool.label.replace(/^Walk to /, '')}`
        );
        stepNumber++;
    }

    result.afternoonLegs.forEach((leg, index) => {
        steps.push(
            `${stepNumber}. Board Rt ${leg.routeShortName} at ${minutesToDisplayTime(leg.departureMinutes)} from ${leg.fromStop}`
        );
        stepNumber++;
        steps.push(
            `${stepNumber}. Arrive ${leg.toStop} at ${minutesToDisplayTime(leg.arrivalMinutes)}`
        );
        stepNumber++;

        const transfer = transfers[index];
        if (transfer) {
            steps.push(
                `${stepNumber}. Transfer at ${leg.toStop} (${transfer.waitMinutes} min wait)`
            );
            stepNumber++;
        }
    });

    if (result.walkToZone) {
        steps.push(
            `${stepNumber}. Walk ${result.walkToZone.walkMinutes} min (${(result.walkToZone.distanceKm * 1000).toFixed(0)}m) home`
        );
        stepNumber++;
    }

    if (result.nextAfternoonDepartureMinutes != null) {
        steps.push(
            `${stepNumber}. Next bus after school departs at ${minutesToDisplayTime(result.nextAfternoonDepartureMinutes)}`
        );
    }

    return steps;
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
            const margin = 14;
            const contentW = pageW - margin * 2;

            // Title bar
            doc.setFillColor(31, 41, 55); // gray-900
            doc.rect(0, 0, pageW, 22, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.text(selectedSchool.name, margin, 13);
            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(209, 213, 219); // gray-300
            doc.text('Student Transit Pass', margin, 19);
            doc.text(formatDisplayDate(serviceDate), pageW - margin, 13, { align: 'right' });

            let y = 30;

            // Try to capture map
            const mapEl = document.querySelector('.student-pass-map') as HTMLElement | null;
            if (mapEl) {
                try {
                    const canvas = await html2canvas(mapEl, { useCORS: true, scale: 1.5 });
                    const imgData = canvas.toDataURL('image/jpeg', 0.85);
                    const mapH = contentW * 0.55;
                    doc.addImage(imgData, 'JPEG', margin, y, contentW, mapH);
                    y += mapH + 6;
                } catch {
                    // Map capture failed — continue without it
                }
            }

            // "In Numbers" section header
            doc.setFontSize(9);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(31, 41, 55);
            doc.text('ZONE — IN NUMBERS', margin, y);
            y += 5;

            // Stats box background
            const statsLines: string[] = [];
            const tripDuration = result.morningLegs.length > 0
                ? result.morningLegs[result.morningLegs.length - 1].arrivalMinutes - result.morningLegs[0].departureMinutes
                : 0;
            statsLines.push(`Service Date: ${formatDisplayDate(serviceDate)}`);
            if (selectedZoneStop) {
                statsLines.push(`Selected Stop: ${selectedZoneStop.stopName}`);
            }
            statsLines.push(`Trip Time: ${tripDuration} min`);

            if (result.walkToStop) {
                statsLines.push(`Walk to Stop: ${result.walkToStop.walkMinutes} min (${(result.walkToStop.distanceKm * 1000).toFixed(0)}m)`);
            }
            if (result.walkToSchool) {
                statsLines.push(`Walk to School: ${result.walkToSchool.walkMinutes} min (${(result.walkToSchool.distanceKm * 1000).toFixed(0)}m)`);
            }

            if (!result.isDirect && result.morningLegs.length === 2) {
                statsLines.push(`Transfer: Rt ${result.morningLegs[0].routeShortName} -> Rt ${result.morningLegs[1].routeShortName} at ${result.morningLegs[0].toStop}`);
            }
            if (!result.isDirect && result.transfer) {
                statsLines.push(`Connection: ${result.transfer.label} (${result.transfer.waitMinutes} min wait)`);
            }
            if (result.frequencyPerHour != null && result.frequencyPerHour > 0) {
                const intervalMin = Math.round(60 / result.frequencyPerHour);
                statsLines.push(`Bus Frequency: Every ${intervalMin} min`);
            }
            const routes = [...new Set([
                ...result.morningLegs.map((l) => l.routeShortName),
                ...result.afternoonLegs.map((l) => l.routeShortName),
            ])].join(', ');
            statsLines.push(`Routes: ${routes}`);

            doc.setFillColor(249, 250, 251); // gray-50
            doc.setDrawColor(229, 231, 235); // gray-200
            const statsBoxH = statsLines.length * 5 + 6;
            doc.roundedRect(margin, y, contentW, statsBoxH, 2, 2, 'FD');
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(55, 65, 81);
            statsLines.forEach((line, i) => {
                doc.text(line, margin + 4, y + 5 + i * 5);
            });
            y += statsBoxH + 6;

            // Morning / Afternoon two-column headers
            const colW = contentW / 2;
            doc.setFontSize(8);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(29, 78, 216); // blue-700
            doc.text('MORNING TRIP', margin, y);
            doc.setTextColor(180, 83, 9); // amber-700
            doc.text('AFTERNOON TRIP', margin + colW, y);
            y += 5;

            const morningSteps = buildMorningSteps(result, effectiveBellStart);
            const afternoonSteps = result.afternoonLegs.length > 0 || result.walkFromSchool || result.walkToZone
                ? buildAfternoonSteps(result, effectiveBellEnd)
                : ['1. No return trip found for this stop and date'];

            // Print two columns
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.5);
            const maxRows = Math.max(morningSteps.length, afternoonSteps.length);
            for (let i = 0; i < maxRows; i++) {
                const rowY = y + i * 4.5;
                doc.setTextColor(55, 65, 81);
                if (morningSteps[i]) doc.text(morningSteps[i], margin, rowY);
                if (afternoonSteps[i]) doc.text(afternoonSteps[i], margin + colW, rowY);
            }

            // Footer
            const footerY = doc.internal.pageSize.getHeight() - 10;
            doc.setFontSize(7);
            doc.setTextColor(156, 163, 175); // gray-400
            const today = new Date().toLocaleDateString('en-CA');
            doc.text('Barrie Transit', margin, footerY);
            doc.text(`${formatDisplayDate(serviceDate)} | Exported ${today}`, pageW - margin, footerY, { align: 'right' });

            // Save
            const safeName = selectedSchool.name.replace(/[^a-zA-Z0-9]/g, '-');
            doc.save(`${safeName}-Student-Transit-Pass.pdf`);
        } finally {
            setIsExporting(false);
        }
    }, [result, selectedSchool, effectiveBellStart, effectiveBellEnd, selectedZoneStop, serviceDate]);

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
