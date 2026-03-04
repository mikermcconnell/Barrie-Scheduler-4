import React, { useState, useCallback, useEffect } from 'react';
import { AlertTriangle, Download, Loader2, GraduationCap, ArrowRight, ArrowLeft } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import {
    BARRIE_SCHOOLS,
    findTripOptions,
    minutesToDisplayTime,
} from '../../utils/transit-app/studentPassUtils';
import type { SchoolConfig, StudentPassResult, TripOptions, RouteOption } from '../../utils/transit-app/studentPassUtils';
import { StudentPassMap } from './StudentPassMap';
import { StudentPassPanel } from './StudentPassPanel';
import StudentPassTimeline from './StudentPassTimeline';
import './studentPass.css';

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
            const options = findTripOptions(polygon, schoolWithOverrides);
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
            {/* Dark header */}
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

            {/* Map fills everything */}
            <div className="flex-1 relative overflow-hidden" style={{ background: '#0B1121' }}>
                <div className="absolute inset-0 student-pass-dark">
                    <StudentPassMap
                        school={selectedSchool}
                        result={result}
                        onPolygonComplete={handlePolygonComplete}
                        onPolygonClear={handlePolygonClear}
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
                    effectiveBellStart={effectiveBellStart}
                    effectiveBellEnd={effectiveBellEnd}
                    polygon={polygon}
                    isCalculating={isCalculating}
                    tripOptions={tripOptions}
                    result={result}
                    selectedMorningIdx={selectedMorningIdx}
                    selectedAfternoonIdx={selectedAfternoonIdx}
                    onMorningSelect={setSelectedMorningIdx}
                    onAfternoonSelect={setSelectedAfternoonIdx}
                    onExport={handleExportPdf}
                    isExporting={isExporting}
                />

                {/* Journey timeline at bottom */}
                {result?.found && (
                    <StudentPassTimeline result={result} />
                )}
            </div>
        </div>
    );
};
