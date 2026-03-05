import React, { useState, useCallback, useEffect } from 'react';
import { AlertTriangle, Download, Loader2, GraduationCap, Bus, ArrowRight, ArrowLeft } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import {
    BARRIE_SCHOOLS,
    minutesToDisplayTime,
} from '../../utils/transit-app/studentPassUtils';
import type { SchoolConfig, StudentPassResult, TripOptions, RouteOption } from '../../utils/transit-app/studentPassUtils';
import { findTripOptionsRaptor } from '../../utils/transit-app/studentPassRaptorAdapter';
import { StudentPassMap } from './StudentPassMap';
import { StudentPassPreview } from './StudentPassPreview';

interface StudentPassModuleProps {
    onBack: () => void;
}

export const StudentPassModule: React.FC<StudentPassModuleProps> = ({ onBack }) => {
    const [selectedSchoolId, setSelectedSchoolId] = useState<string>(BARRIE_SCHOOLS[0].id);
    const [bellStart, setBellStart] = useState<string>('');
    const [bellEnd, setBellEnd] = useState<string>('');
    const [polygon, setPolygon] = useState<[number, number][] | null>(null);
    const [tripOptions, setTripOptions] = useState<TripOptions | null>(null);
    const [selectedMorningIdx, setSelectedMorningIdx] = useState(0);
    const [selectedAfternoonIdx, setSelectedAfternoonIdx] = useState(0);
    const [isCalculating, setIsCalculating] = useState(false);
    const [isExporting, setIsExporting] = useState(false);

    const selectedSchool: SchoolConfig =
        BARRIE_SCHOOLS.find((s) => s.id === selectedSchoolId) ?? BARRIE_SCHOOLS[0];

    const handlePolygonComplete = useCallback((coords: [number, number][]) => {
        setPolygon(coords);
    }, []);

    const handlePolygonClear = useCallback(() => {
        setPolygon(null);
        setTripOptions(null);
        setSelectedMorningIdx(0);
        setSelectedAfternoonIdx(0);
        setIsCalculating(false);
    }, []);

    const handleSchoolChange = (id: string) => {
        setSelectedSchoolId(id);
        setBellStart('');
        setBellEnd('');
        setTripOptions(null);
        setSelectedMorningIdx(0);
        setSelectedAfternoonIdx(0);
    };

    const effectiveBellStart = bellStart || selectedSchool.bellStart;
    const effectiveBellEnd = bellEnd || selectedSchool.bellEnd;

    useEffect(() => {
        if (!polygon) {
            setIsCalculating(false);
            return;
        }

        setIsCalculating(true);
        const rafId = requestAnimationFrame(() => {
            const schoolWithOverrides: SchoolConfig = {
                ...selectedSchool,
                bellStart: effectiveBellStart,
                bellEnd: effectiveBellEnd,
            };
            const options = findTripOptionsRaptor(polygon, schoolWithOverrides);
            setTripOptions(options);
            setSelectedMorningIdx(0);
            setSelectedAfternoonIdx(0);
            setIsCalculating(false);
        });

        return () => cancelAnimationFrame(rafId);
    }, [polygon, selectedSchool, effectiveBellStart, effectiveBellEnd]);

    // Compose the displayed result from selected morning + afternoon options
    const result: StudentPassResult | null = (() => {
        if (!tripOptions) return null;
        const am = tripOptions.morningOptions[selectedMorningIdx];
        const pm = tripOptions.afternoonOptions[selectedAfternoonIdx];
        if (!am) return { found: false as const, isDirect: false, morningLegs: [], afternoonLegs: [] };

        if (!pm) return am.result;

        // Merge: morning from selected AM, afternoon from selected PM
        return {
            ...am.result,
            afternoonLegs: pm.result.afternoonLegs,
            afternoonRouteShapes: pm.result.afternoonRouteShapes,
            walkFromSchool: pm.result.walkFromSchool,
            walkToZone: pm.result.walkToZone,
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

            // Morning steps
            const morningSteps: string[] = [];
            let stepNum = 1;

            // Walk to boarding stop
            if (result.walkToStop) {
                const w = result.walkToStop;
                morningSteps.push(`${stepNum}. Walk ${w.walkMinutes} min (${(w.distanceKm * 1000).toFixed(0)}m)`);
                morningSteps.push(`   to ${result.morningLegs[0]?.fromStop ?? 'bus stop'}`);
                stepNum++;
            }

            if (result.isDirect && result.morningLegs.length === 1) {
                const leg = result.morningLegs[0];
                morningSteps.push(`${stepNum}. Board Rt ${leg.routeShortName} at ${minutesToDisplayTime(leg.departureMinutes)}`);
                morningSteps.push(`   from ${leg.fromStop}`);
                stepNum++;
                morningSteps.push(`${stepNum}. Arrive ${leg.toStop}`);
                morningSteps.push(`   at ${minutesToDisplayTime(leg.arrivalMinutes)}`);
                stepNum++;
            } else if (!result.isDirect && result.morningLegs.length === 2) {
                const legA = result.morningLegs[0];
                const legB = result.morningLegs[1];
                const waitMin = result.transfer?.waitMinutes ?? (legB.departureMinutes - legA.arrivalMinutes);
                morningSteps.push(`${stepNum}. Board Rt ${legA.routeShortName} at ${minutesToDisplayTime(legA.departureMinutes)}`);
                morningSteps.push(`   from ${legA.fromStop}`);
                stepNum++;
                morningSteps.push(`${stepNum}. Transfer at ${legA.toStop}`);
                morningSteps.push(`   (${waitMin} min wait)`);
                stepNum++;
                morningSteps.push(`${stepNum}. Board Rt ${legB.routeShortName} at ${minutesToDisplayTime(legB.departureMinutes)}`);
                stepNum++;
                morningSteps.push(`${stepNum}. Arrive ${legB.toStop}`);
                morningSteps.push(`   at ${minutesToDisplayTime(legB.arrivalMinutes)}`);
                stepNum++;
            }

            // Walk to school
            if (result.walkToSchool) {
                const w = result.walkToSchool;
                morningSteps.push(`${stepNum}. Walk ${w.walkMinutes} min (${(w.distanceKm * 1000).toFixed(0)}m) to school`);
                morningSteps.push(`   Bell: ${effectiveBellStart}`);
            } else {
                morningSteps.push(`${stepNum}. Walk to school`);
                morningSteps.push(`   Bell: ${effectiveBellStart}`);
            }

            // Afternoon steps
            const afternoonSteps: string[] = [];
            afternoonSteps.push(`1. Bell rings at ${effectiveBellEnd}`);
            if (result.afternoonLegs.length > 0) {
                const leg = result.afternoonLegs[0];
                afternoonSteps.push(`2. Board Rt ${leg.routeShortName} at ${minutesToDisplayTime(leg.departureMinutes)}`);
                afternoonSteps.push(`   from ${leg.fromStop}`);
                afternoonSteps.push(`3. Arrive ${leg.toStop}`);
                afternoonSteps.push(`   at ${minutesToDisplayTime(leg.arrivalMinutes)}`);
                if (result.nextAfternoonDepartureMinutes != null) {
                    afternoonSteps.push(`Next bus: ${minutesToDisplayTime(result.nextAfternoonDepartureMinutes)}`);
                }
            } else {
                afternoonSteps.push('2. No service data available');
            }

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
            doc.text(today, pageW - margin, footerY, { align: 'right' });

            // Save
            const safeName = selectedSchool.name.replace(/[^a-zA-Z0-9]/g, '-');
            doc.save(`${safeName}-Student-Transit-Pass.pdf`);
        } finally {
            setIsExporting(false);
        }
    }, [result, selectedSchool, effectiveBellStart, effectiveBellEnd]);

    return (
        <div className="h-full flex flex-col overflow-hidden">
            {/* Header with back button */}
            <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-200 bg-white flex-shrink-0">
                <button
                    onClick={onBack}
                    className="p-1 rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
                >
                    <ArrowLeft size={18} />
                </button>
                <div className="flex items-center gap-2">
                    <GraduationCap size={18} className="text-amber-600" />
                    <h2 className="text-lg font-bold text-gray-900">Student Transit Pass</h2>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
            {/* Left config panel */}
            <div className="w-72 bg-gray-50 border-r border-gray-200 flex flex-col overflow-y-auto">
                <div className="p-4 border-b border-gray-200">
                    <p className="text-xs text-gray-500">
                        Draw a zone on the map to find transit options.
                    </p>
                </div>

                {/* School selection */}
                <div className="p-4 border-b border-gray-200">
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">School</label>
                    <select
                        value={selectedSchoolId}
                        onChange={(e) => handleSchoolChange(e.target.value)}
                        className="w-full text-sm border border-gray-300 rounded-md px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                        {BARRIE_SCHOOLS.map((s) => (
                            <option key={s.id} value={s.id}>
                                {s.name}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Bell time overrides — horizontal layout */}
                <div className="p-4 border-b border-gray-200">
                    <p className="text-xs font-medium text-gray-700 mb-2">Bell Times</p>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-[10px] text-gray-500 mb-0.5 block uppercase tracking-wide">Start</label>
                            <input
                                type="time"
                                value={bellStart}
                                placeholder={selectedSchool.bellStart}
                                onChange={(e) => setBellStart(e.target.value)}
                                className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                            />
                            {!bellStart && (
                                <p className="text-[10px] text-gray-400 mt-0.5">{selectedSchool.bellStart}</p>
                            )}
                        </div>
                        <div>
                            <label className="text-[10px] text-gray-500 mb-0.5 block uppercase tracking-wide">End</label>
                            <input
                                type="time"
                                value={bellEnd}
                                placeholder={selectedSchool.bellEnd}
                                onChange={(e) => setBellEnd(e.target.value)}
                                className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                            />
                            {!bellEnd && (
                                <p className="text-[10px] text-gray-400 mt-0.5">{selectedSchool.bellEnd}</p>
                            )}
                        </div>
                    </div>
                </div>

                {/* Zone info */}
                <div className="p-4 border-b border-gray-200">
                    <p className="text-xs font-medium text-gray-700 mb-1">Zone Status</p>
                    {polygon ? (
                        <div className="text-xs text-gray-600 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
                            Zone drawn ({polygon.length} vertices)
                        </div>
                    ) : (
                        <p className="text-xs text-gray-400 italic">
                            Use the polygon tool (top-right of map) to draw a zone.
                        </p>
                    )}
                </div>

                {/* Route options */}
                <div className="p-4 flex-1">
                    {isCalculating && (
                        <div className="flex items-center gap-2 text-sm text-blue-600">
                            <Loader2 size={16} className="animate-spin" />
                            <span>Calculating...</span>
                        </div>
                    )}

                    {!isCalculating && tripOptions && tripOptions.morningOptions.length === 0 && (
                        <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3">
                            <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                            <div>
                                <p className="font-medium">No trip found</p>
                                <p className="text-xs mt-0.5 text-amber-600">
                                    No weekday service connects this zone to {selectedSchool.name} within 30 min of bell time.
                                </p>
                            </div>
                        </div>
                    )}

                    {!isCalculating && tripOptions && tripOptions.morningOptions.length > 0 && (
                        <div className="space-y-3">
                            {/* Morning options */}
                            <div>
                                <p className="text-xs text-blue-700 mb-1.5 font-semibold uppercase tracking-wide">
                                    Morning Options
                                </p>
                                <div className="space-y-1.5">
                                    {tripOptions.morningOptions.map((opt, i) => {
                                        const isSelected = i === selectedMorningIdx;
                                        const legs = opt.result.morningLegs;
                                        const firstLeg = legs[0];
                                        const lastLeg = legs[legs.length - 1];
                                        const walkMin = opt.result.walkToStop?.walkMinutes;
                                        return (
                                            <button
                                                key={opt.id}
                                                onClick={() => setSelectedMorningIdx(i)}
                                                className={`w-full text-left text-xs rounded-lg p-2.5 border-2 transition-all ${
                                                    isSelected
                                                        ? 'border-blue-500 bg-blue-50 shadow-sm'
                                                        : 'border-gray-200 bg-white hover:border-gray-300'
                                                }`}
                                            >
                                                <div className="flex items-center justify-between mb-1">
                                                    <div className="flex items-center gap-1.5">
                                                        {legs.map((leg, li) => (
                                                            <React.Fragment key={li}>
                                                                {li > 0 && <ArrowRight size={8} className="text-gray-400" />}
                                                                <span
                                                                    className="px-1.5 py-0.5 rounded text-white font-bold text-[10px]"
                                                                    style={{ backgroundColor: leg.routeColor || '#6B7280' }}
                                                                >
                                                                    {leg.routeShortName}
                                                                </span>
                                                            </React.Fragment>
                                                        ))}
                                                    </div>
                                                    {isSelected && (
                                                        <span className="text-blue-600 text-[10px] font-semibold">Selected</span>
                                                    )}
                                                </div>
                                                <div className="text-gray-600">
                                                    {firstLeg && lastLeg && (
                                                        <span>
                                                            {minutesToDisplayTime(firstLeg.departureMinutes)}
                                                            {' → '}
                                                            {minutesToDisplayTime(lastLeg.arrivalMinutes)}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-gray-400 mt-0.5">
                                                    {opt.result.isDirect ? 'Direct' : 'Transfer'}
                                                    {walkMin != null && ` · ${walkMin} min walk`}
                                                    {opt.result.transfer && ` · ${opt.result.transfer.waitMinutes} min wait`}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Afternoon options */}
                            {tripOptions.afternoonOptions.length > 0 && (
                                <div>
                                    <p className="text-xs text-amber-700 mb-1.5 font-semibold uppercase tracking-wide">
                                        Afternoon Options
                                    </p>
                                    <div className="space-y-1.5">
                                        {tripOptions.afternoonOptions.map((opt, i) => {
                                            const isSelected = i === selectedAfternoonIdx;
                                            const leg = opt.result.afternoonLegs[0];
                                            if (!leg) return null;
                                            return (
                                                <button
                                                    key={opt.id}
                                                    onClick={() => setSelectedAfternoonIdx(i)}
                                                    className={`w-full text-left text-xs rounded-lg p-2.5 border-2 transition-all ${
                                                        isSelected
                                                            ? 'border-amber-500 bg-amber-50 shadow-sm'
                                                            : 'border-gray-200 bg-white hover:border-gray-300'
                                                    }`}
                                                >
                                                    <div className="flex items-center justify-between mb-1">
                                                        <div className="flex items-center gap-1.5">
                                                            <span
                                                                className="px-1.5 py-0.5 rounded text-white font-bold text-[10px]"
                                                                style={{ backgroundColor: leg.routeColor || '#6B7280' }}
                                                            >
                                                                {leg.routeShortName}
                                                            </span>
                                                        </div>
                                                        {isSelected && (
                                                            <span className="text-amber-600 text-[10px] font-semibold">Selected</span>
                                                        )}
                                                    </div>
                                                    <div className="text-gray-600">
                                                        {minutesToDisplayTime(leg.departureMinutes)}
                                                        {' → '}
                                                        {minutesToDisplayTime(leg.arrivalMinutes)}
                                                    </div>
                                                    <div className="text-gray-400 mt-0.5">
                                                        {leg.fromStop}
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Walking + frequency summary for selected option */}
                            {result?.found && (
                                <div className="bg-gray-50 border border-gray-200 rounded-md p-2 space-y-1">
                                    {result.walkToStop && (
                                        <p className="text-xs text-gray-600">
                                            Walk to stop: <span className="font-medium text-gray-800">{result.walkToStop.walkMinutes} min</span> ({(result.walkToStop.distanceKm * 1000).toFixed(0)}m)
                                        </p>
                                    )}
                                    {result.walkToSchool && (
                                        <p className="text-xs text-gray-600">
                                            Walk to school: <span className="font-medium text-gray-800">{result.walkToSchool.walkMinutes} min</span> ({(result.walkToSchool.distanceKm * 1000).toFixed(0)}m)
                                        </p>
                                    )}
                                    {result.frequencyPerHour != null && (
                                        <p className="text-xs text-gray-500">
                                            AM frequency: <span className="font-medium text-gray-700">{result.frequencyPerHour.toFixed(1)} trips/hr</span>
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {!isCalculating && !tripOptions && (
                        <p className="text-xs text-gray-400 italic">
                            Draw a zone on the map to see transit options.
                        </p>
                    )}
                </div>

                {/* PDF export button */}
                <div className="p-4 border-t border-gray-200">
                    <button
                        onClick={handleExportPdf}
                        disabled={!result?.found || isExporting}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium shadow-sm disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                        title={result?.found ? 'Download student transit pass PDF' : 'No trip result to export'}
                    >
                        {isExporting ? (
                            <>
                                <Loader2 size={15} className="animate-spin" />
                                Generating...
                            </>
                        ) : (
                            <>
                                <Download size={15} />
                                Download PDF
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Right: map + preview */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Map (~60% of height) */}
                <div className="flex-[3] min-h-0">
                    <StudentPassMap
                        school={selectedSchool}
                        result={result}
                        onPolygonComplete={handlePolygonComplete}
                        onPolygonClear={handlePolygonClear}
                    />
                </div>

                {/* Flyer preview — shown only when result found */}
                <div className="flex-[2] min-h-0 overflow-y-auto">
                    {result?.found ? (
                        <StudentPassPreview
                            school={selectedSchool}
                            result={result}
                            bellStart={effectiveBellStart}
                            bellEnd={effectiveBellEnd}
                        />
                    ) : (
                        <div className="h-full flex items-center justify-center bg-gray-50/80">
                            <div className="px-8 py-6 max-w-xs">
                                <div className="space-y-3">
                                    {[
                                        { step: '1', label: 'Select a school', done: true },
                                        { step: '2', label: 'Draw a residential zone on the map', done: !!polygon },
                                        { step: '3', label: 'Review trip & download PDF', done: false },
                                    ].map((item, i) => (
                                        <div key={i} className="flex items-center gap-3">
                                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                                                item.done
                                                    ? 'bg-amber-500 text-white'
                                                    : 'bg-gray-200 text-gray-400'
                                            }`}>
                                                {item.done ? '✓' : item.step}
                                            </div>
                                            <span className={`text-sm ${item.done ? 'text-gray-700' : 'text-gray-400'}`}>
                                                {item.label}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
        </div>
    );
};
