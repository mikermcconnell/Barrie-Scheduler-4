import React, { useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import type { SchoolConfig, StudentPassResult, TransferQuality } from '../../utils/transit-app/studentPassUtils';
import { minutesToDisplayTime } from '../../utils/transit-app/studentPassUtils';

interface StudentPassPreviewProps {
    school: SchoolConfig;
    result: StudentPassResult;
    bellStart: string;
    bellEnd: string;
}

const QUALITY_STYLES: Record<TransferQuality, string> = {
    tight: 'bg-red-50 text-red-700 border-red-200',
    good: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    ok: 'bg-amber-50 text-amber-700 border-amber-200',
    long: 'bg-red-50 text-red-700 border-red-200',
};

function buildMorningSteps(result: StudentPassResult, bellStart: string): string[] {
    const steps: string[] = [];

    // Walk to boarding stop
    if (result.walkToStop) {
        const w = result.walkToStop;
        steps.push(`Walk ${w.walkMinutes} min (${(w.distanceKm * 1000).toFixed(0)}m) to ${result.morningLegs[0]?.fromStop ?? 'bus stop'}`);
    }

    if (result.isDirect && result.morningLegs.length === 1) {
        const leg = result.morningLegs[0];
        steps.push(`Board Route ${leg.routeShortName} at ${minutesToDisplayTime(leg.departureMinutes)} from ${leg.fromStop}`);
        steps.push(`Arrive at ${leg.toStop} at ${minutesToDisplayTime(leg.arrivalMinutes)}`);
    } else if (!result.isDirect && result.morningLegs.length === 2) {
        const legA = result.morningLegs[0];
        const legB = result.morningLegs[1];
        const waitMin = result.transfer ? result.transfer.waitMinutes : legB.departureMinutes - legA.arrivalMinutes;
        steps.push(`Board Route ${legA.routeShortName} at ${minutesToDisplayTime(legA.departureMinutes)} from ${legA.fromStop}`);
        steps.push(`Transfer at ${legA.toStop} (${waitMin} min wait) — Board Route ${legB.routeShortName} at ${minutesToDisplayTime(legB.departureMinutes)}`);
        steps.push(`Arrive at ${legB.toStop} at ${minutesToDisplayTime(legB.arrivalMinutes)}`);
    } else if (!result.isDirect && result.morningLegs.length === 3) {
        const legA = result.morningLegs[0];
        const legB = result.morningLegs[1];
        const legC = result.morningLegs[2];
        const wait1 = result.transfers?.[0]?.waitMinutes ?? (legB.departureMinutes - legA.arrivalMinutes);
        const wait2 = result.transfers?.[1]?.waitMinutes ?? (legC.departureMinutes - legB.arrivalMinutes);
        steps.push(`Board Route ${legA.routeShortName} at ${minutesToDisplayTime(legA.departureMinutes)} from ${legA.fromStop}`);
        steps.push(`Transfer at ${legA.toStop} (${wait1} min wait) — Board Route ${legB.routeShortName} at ${minutesToDisplayTime(legB.departureMinutes)}`);
        steps.push(`Transfer at ${legB.toStop} (${wait2} min wait) — Board Route ${legC.routeShortName} at ${minutesToDisplayTime(legC.departureMinutes)}`);
        steps.push(`Arrive at ${legC.toStop} at ${minutesToDisplayTime(legC.arrivalMinutes)}`);
    }

    // Walk from alighting stop to school
    if (result.walkToSchool) {
        const w = result.walkToSchool;
        steps.push(`Walk ${w.walkMinutes} min (${(w.distanceKm * 1000).toFixed(0)}m) to school — bell at ${bellStart}`);
    } else {
        steps.push(`Walk to school — bell at ${bellStart}`);
    }

    return steps;
}

function buildAfternoonSteps(result: StudentPassResult, bellEnd: string): string[] {
    const steps: string[] = [];

    if (result.afternoonLegs.length === 0) {
        steps.push(`Bell rings at ${bellEnd}`);
        steps.push('No afternoon service data available');
        return steps;
    }

    steps.push(`Bell rings at ${bellEnd}`);

    const leg = result.afternoonLegs[0];
    steps.push(`Board Route ${leg.routeShortName} at ${minutesToDisplayTime(leg.departureMinutes)} from ${leg.fromStop}`);
    steps.push(`Arrive at ${leg.toStop} at ${minutesToDisplayTime(leg.arrivalMinutes)}`);

    if (result.nextAfternoonDepartureMinutes != null) {
        steps.push(`Next bus: ${minutesToDisplayTime(result.nextAfternoonDepartureMinutes)}`);
    }

    return steps;
}

function getTripDurationMinutes(result: StudentPassResult): number {
    if (result.morningLegs.length === 0) return 0;
    const first = result.morningLegs[0];
    const last = result.morningLegs[result.morningLegs.length - 1];
    return last.arrivalMinutes - first.departureMinutes;
}

function getFrequencyText(result: StudentPassResult): string {
    if (result.frequencyPerHour == null || result.frequencyPerHour === 0) return 'Check schedule';
    const intervalMin = Math.round(60 / result.frequencyPerHour);
    return `Every ${intervalMin} min`;
}

function getConnectingRoutes(result: StudentPassResult): string {
    const routes = result.morningLegs.map((l) => l.routeShortName);
    if (result.afternoonLegs.length > 0) {
        for (const l of result.afternoonLegs) {
            if (!routes.includes(l.routeShortName)) routes.push(l.routeShortName);
        }
    }
    return routes.join(', ') || '—';
}

export const StudentPassPreview: React.FC<StudentPassPreviewProps> = ({
    school,
    result,
    bellStart,
    bellEnd,
}) => {
    const [collapsed, setCollapsed] = useState(false);

    const morningSteps = buildMorningSteps(result, bellStart);
    const afternoonSteps = buildAfternoonSteps(result, bellEnd);
    const tripDuration = getTripDurationMinutes(result);
    const frequencyText = getFrequencyText(result);
    const connectingRoutes = getConnectingRoutes(result);

    return (
        <div className="border-t border-gray-200 bg-white flex flex-col">
            {/* Collapse toggle bar */}
            <button
                onClick={() => setCollapsed((c) => !c)}
                className="w-full flex items-center justify-between px-4 py-2 bg-gray-100 hover:bg-gray-200 transition-colors text-sm font-medium text-gray-700 border-b border-gray-200"
                aria-expanded={!collapsed}
            >
                <span>Flyer Preview</span>
                {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </button>

            {!collapsed && (
                <div className="overflow-y-auto p-3">
                    {/* Flyer card */}
                    <div
                        id="student-pass-preview"
                        className="rounded-lg overflow-hidden border border-gray-200 shadow-sm text-xs"
                    >
                        {/* Title bar */}
                        <div className="bg-gray-900 px-4 py-3 text-white">
                            <p className="font-bold text-sm leading-tight">{school.name}</p>
                            <p className="text-gray-300 text-xs mt-0.5">Student Transit Pass</p>
                        </div>

                        {/* Zone — In Numbers */}
                        <div className="px-4 py-3 bg-white border-b border-gray-100">
                            <p className="font-semibold text-gray-800 text-xs uppercase tracking-wide mb-2">
                                Zone — In Numbers
                            </p>
                            <div className="bg-gray-50 rounded-md border border-gray-200 px-3 py-2 space-y-1.5">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-gray-500">Trip Time:</span>
                                    <span className="font-medium text-gray-800">{tripDuration} min</span>
                                </div>

                                {result.walkToStop && (
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-gray-500">Walk to Stop:</span>
                                        <span className="font-medium text-gray-800">
                                            {result.walkToStop.walkMinutes} min ({(result.walkToStop.distanceKm * 1000).toFixed(0)}m)
                                        </span>
                                    </div>
                                )}

                                {result.walkToSchool && (
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-gray-500">Walk to School:</span>
                                        <span className="font-medium text-gray-800">
                                            {result.walkToSchool.walkMinutes} min ({(result.walkToSchool.distanceKm * 1000).toFixed(0)}m)
                                        </span>
                                    </div>
                                )}

                                {!result.isDirect && result.morningLegs.length >= 2 && (
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="text-gray-500">Transfer:</span>
                                        <span className="font-medium text-gray-800">
                                            {result.morningLegs.map((l) => `Rt ${l.routeShortName}`).join(' → ')}
                                        </span>
                                    </div>
                                )}

                                {!result.isDirect && result.transfer && !result.transfers && (
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-gray-500">Connection:</span>
                                        <span
                                            className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${QUALITY_STYLES[result.transfer.quality]}`}
                                        >
                                            {result.transfer.label} ({result.transfer.waitMinutes} min)
                                        </span>
                                    </div>
                                )}

                                {!result.isDirect && result.transfers && result.transfers.map((t, i) => (
                                    <div key={i} className="flex items-center gap-1.5">
                                        <span className="text-gray-500">Transfer {i + 1}:</span>
                                        <span
                                            className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${QUALITY_STYLES[t.quality]}`}
                                        >
                                            {t.label} ({t.waitMinutes} min)
                                        </span>
                                    </div>
                                ))}

                                <div className="flex items-center gap-1.5">
                                    <span className="text-gray-500">Bus Frequency:</span>
                                    <span className="font-medium text-gray-800">{frequencyText}</span>
                                </div>

                                <div className="flex items-center gap-1.5">
                                    <span className="text-gray-500">Routes:</span>
                                    <span className="font-medium text-gray-800">{connectingRoutes}</span>
                                </div>
                            </div>
                        </div>

                        {/* Morning / Afternoon columns */}
                        <div className="grid grid-cols-2 divide-x divide-gray-200 bg-white">
                            {/* Morning */}
                            <div className="px-3 py-3">
                                <p className="font-semibold text-blue-700 text-[10px] uppercase tracking-wide mb-2">
                                    Morning Trip
                                </p>
                                <ol className="space-y-1.5">
                                    {morningSteps.map((step, i) => (
                                        <li key={i} className="flex gap-1.5 text-gray-700 leading-snug">
                                            <span className="font-bold text-gray-400 flex-shrink-0">{i + 1}.</span>
                                            <span>{step}</span>
                                        </li>
                                    ))}
                                </ol>
                            </div>

                            {/* Afternoon */}
                            <div className="px-3 py-3">
                                <p className="font-semibold text-amber-700 text-[10px] uppercase tracking-wide mb-2">
                                    Afternoon Trip
                                </p>
                                <ol className="space-y-1.5">
                                    {afternoonSteps.map((step, i) => (
                                        <li key={i} className="flex gap-1.5 text-gray-700 leading-snug">
                                            <span className="font-bold text-gray-400 flex-shrink-0">{i + 1}.</span>
                                            <span>{step}</span>
                                        </li>
                                    ))}
                                </ol>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
