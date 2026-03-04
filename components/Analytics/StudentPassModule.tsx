import React, { useState, useCallback } from 'react';
import { AlertTriangle, Download, Loader2, GraduationCap, Bus, ArrowRight } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import {
    BARRIE_SCHOOLS,
    findBestTrip,
    minutesToDisplayTime,
} from '../../utils/transit-app/studentPassUtils';
import type { SchoolConfig, StudentPassResult } from '../../utils/transit-app/studentPassUtils';
import { StudentPassMap } from './StudentPassMap';
import { StudentPassPreview } from './StudentPassPreview';

export const StudentPassModule: React.FC = () => {
    const [selectedSchoolId, setSelectedSchoolId] = useState<string>(BARRIE_SCHOOLS[0].id);
    const [bellStart, setBellStart] = useState<string>('');
    const [bellEnd, setBellEnd] = useState<string>('');
    const [polygon, setPolygon] = useState<[number, number][] | null>(null);
    const [result, setResult] = useState<StudentPassResult | null>(null);
    const [isCalculating, setIsCalculating] = useState(false);
    const [isExporting, setIsExporting] = useState(false);

    const selectedSchool: SchoolConfig =
        BARRIE_SCHOOLS.find((s) => s.id === selectedSchoolId) ?? BARRIE_SCHOOLS[0];

    const handlePolygonComplete = useCallback(
        (coords: [number, number][]) => {
            setPolygon(coords);
            if (selectedSchool) {
                setIsCalculating(true);
                requestAnimationFrame(() => {
                    const schoolWithOverrides: SchoolConfig = {
                        ...selectedSchool,
                        bellStart: bellStart || selectedSchool.bellStart,
                        bellEnd: bellEnd || selectedSchool.bellEnd,
                    };
                    const tripResult = findBestTrip(coords, schoolWithOverrides);
                    setResult(tripResult);
                    setIsCalculating(false);
                });
            }
        },
        [selectedSchool, bellStart, bellEnd]
    );

    const handlePolygonClear = useCallback(() => {
        setPolygon(null);
        setResult(null);
    }, []);

    const handleSchoolChange = (id: string) => {
        setSelectedSchoolId(id);
        setBellStart('');
        setBellEnd('');
        setResult(null);
    };

    const effectiveBellStart = bellStart || selectedSchool.bellStart;
    const effectiveBellEnd = bellEnd || selectedSchool.bellEnd;

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
            if (result.isDirect && result.morningLegs.length === 1) {
                const leg = result.morningLegs[0];
                morningSteps.push(`1. Board Rt ${leg.routeShortName} at ${minutesToDisplayTime(leg.departureMinutes)}`);
                morningSteps.push(`   from ${leg.fromStop}`);
                morningSteps.push(`2. Arrive ${leg.toStop}`);
                morningSteps.push(`   at ${minutesToDisplayTime(leg.arrivalMinutes)}`);
                morningSteps.push(`3. Walk to school`);
                morningSteps.push(`   Bell: ${effectiveBellStart}`);
            } else if (!result.isDirect && result.morningLegs.length === 2) {
                const legA = result.morningLegs[0];
                const legB = result.morningLegs[1];
                const waitMin = result.transfer?.waitMinutes ?? (legB.departureMinutes - legA.arrivalMinutes);
                morningSteps.push(`1. Board Rt ${legA.routeShortName} at ${minutesToDisplayTime(legA.departureMinutes)}`);
                morningSteps.push(`   from ${legA.fromStop}`);
                morningSteps.push(`2. Transfer at ${legA.toStop}`);
                morningSteps.push(`   (${waitMin} min wait)`);
                morningSteps.push(`3. Board Rt ${legB.routeShortName} at ${minutesToDisplayTime(legB.departureMinutes)}`);
                morningSteps.push(`4. Arrive ${legB.toStop}`);
                morningSteps.push(`   at ${minutesToDisplayTime(legB.arrivalMinutes)}`);
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
        <div className="flex h-[680px] border border-gray-200 rounded-lg overflow-hidden bg-white">
            {/* Left config panel */}
            <div className="w-72 bg-gray-50 border-r border-gray-200 flex flex-col overflow-y-auto">
                <div className="p-4 border-b border-gray-200">
                    <div className="flex items-center gap-2 mb-1">
                        <GraduationCap size={18} className="text-blue-600" />
                        <h3 className="font-semibold text-gray-900 text-sm">Student Pass Planner</h3>
                    </div>
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

                {/* Bell time overrides */}
                <div className="p-4 border-b border-gray-200">
                    <p className="text-xs font-medium text-gray-700 mb-2">Bell Times</p>
                    <div className="space-y-2">
                        <div>
                            <label className="text-xs text-gray-500 mb-0.5 block">Start</label>
                            <input
                                type="time"
                                value={bellStart}
                                placeholder={selectedSchool.bellStart}
                                onChange={(e) => setBellStart(e.target.value)}
                                className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            {!bellStart && (
                                <p className="text-xs text-gray-400 mt-0.5">
                                    Default: {selectedSchool.bellStart}
                                </p>
                            )}
                        </div>
                        <div>
                            <label className="text-xs text-gray-500 mb-0.5 block">End</label>
                            <input
                                type="time"
                                value={bellEnd}
                                placeholder={selectedSchool.bellEnd}
                                onChange={(e) => setBellEnd(e.target.value)}
                                className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            {!bellEnd && (
                                <p className="text-xs text-gray-400 mt-0.5">
                                    Default: {selectedSchool.bellEnd}
                                </p>
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

                {/* Trip result summary */}
                <div className="p-4 flex-1">
                    {isCalculating && (
                        <div className="flex items-center gap-2 text-sm text-blue-600">
                            <Loader2 size={16} className="animate-spin" />
                            <span>Calculating...</span>
                        </div>
                    )}

                    {!isCalculating && result && !result.found && (
                        <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3">
                            <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                            <div>
                                <p className="font-medium">No trip found</p>
                                <p className="text-xs mt-0.5 text-amber-600">
                                    No weekday service connects this zone to {selectedSchool.name} before{' '}
                                    {effectiveBellStart}.
                                </p>
                            </div>
                        </div>
                    )}

                    {!isCalculating && result?.found && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <Bus size={15} className="text-green-600" />
                                <span className="text-sm font-semibold text-gray-900">
                                    {result.isDirect ? 'Direct Trip' : '1-Transfer Trip'}
                                </span>
                            </div>

                            {/* Morning legs */}
                            <div>
                                <p className="text-xs text-gray-500 mb-1.5 font-medium uppercase tracking-wide">
                                    Morning
                                </p>
                                <div className="space-y-1.5">
                                    {result.morningLegs.map((leg, i) => (
                                        <div key={i} className="text-xs bg-white border border-gray-200 rounded p-2">
                                            <div className="flex items-center gap-1.5 mb-1">
                                                <span
                                                    className="px-1.5 py-0.5 rounded text-white font-bold text-[10px]"
                                                    style={{ backgroundColor: leg.routeColor || '#6B7280' }}
                                                >
                                                    {leg.routeShortName}
                                                </span>
                                                <span className="text-gray-500">
                                                    {minutesToDisplayTime(leg.departureMinutes)}
                                                    <ArrowRight size={10} className="inline mx-0.5" />
                                                    {minutesToDisplayTime(leg.arrivalMinutes)}
                                                </span>
                                            </div>
                                            <p className="text-gray-600 truncate">
                                                {leg.fromStop} → {leg.toStop}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Transfer info */}
                            {result.transfer && (
                                <div
                                    className="text-xs rounded p-2 border"
                                    style={{
                                        borderColor: result.transfer.color,
                                        backgroundColor: `${result.transfer.color}15`,
                                        color: result.transfer.color,
                                    }}
                                >
                                    <span className="font-semibold">{result.transfer.label}</span>
                                    {' — '}
                                    {result.transfer.waitMinutes} min wait
                                </div>
                            )}

                            {/* Afternoon legs */}
                            {result.afternoonLegs.length > 0 && (
                                <div>
                                    <p className="text-xs text-gray-500 mb-1.5 font-medium uppercase tracking-wide">
                                        Afternoon Return
                                    </p>
                                    <div className="space-y-1.5">
                                        {result.afternoonLegs.map((leg, i) => (
                                            <div
                                                key={i}
                                                className="text-xs bg-white border border-gray-200 rounded p-2"
                                            >
                                                <div className="flex items-center gap-1.5 mb-1">
                                                    <span
                                                        className="px-1.5 py-0.5 rounded text-white font-bold text-[10px]"
                                                        style={{ backgroundColor: leg.routeColor || '#6B7280' }}
                                                    >
                                                        {leg.routeShortName}
                                                    </span>
                                                    <span className="text-gray-500">
                                                        {minutesToDisplayTime(leg.departureMinutes)}
                                                        <ArrowRight size={10} className="inline mx-0.5" />
                                                        {minutesToDisplayTime(leg.arrivalMinutes)}
                                                    </span>
                                                </div>
                                                <p className="text-gray-600 truncate">
                                                    {leg.fromStop} → {leg.toStop}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                    {result.nextAfternoonDepartureMinutes != null && (
                                        <p className="text-xs text-gray-400 mt-1">
                                            Next bus: {minutesToDisplayTime(result.nextAfternoonDepartureMinutes)}
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Frequency */}
                            {result.frequencyPerHour != null && (
                                <p className="text-xs text-gray-500">
                                    AM peak frequency:{' '}
                                    <span className="font-medium text-gray-700">
                                        {result.frequencyPerHour.toFixed(1)} trips/hr
                                    </span>
                                </p>
                            )}
                        </div>
                    )}

                    {!isCalculating && !result && (
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
                        <div className="h-full flex items-center justify-center bg-gray-50">
                            <div className="text-center px-6">
                                <GraduationCap size={32} className="text-gray-300 mx-auto mb-2" />
                                <p className="text-sm text-gray-400">
                                    Pass preview will appear here after a zone is drawn.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
