import React, { useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Download, Loader2, ArrowRight } from 'lucide-react';
import { BARRIE_SCHOOLS, minutesToDisplayTime } from '../../utils/transit-app/studentPassUtils';
import { getContrastingTextColor } from '../../utils/config/routeColors';
import type {
    SchoolConfig,
    StudentPassResult,
    TripOptions,
    ZoneStopOption,
} from '../../utils/transit-app/studentPassUtils';

interface StudentPassPanelProps {
    selectedSchoolId: string;
    onSchoolChange: (id: string) => void;
    bellStart: string;
    bellEnd: string;
    onBellStartChange: (v: string) => void;
    onBellEndChange: (v: string) => void;
    serviceDate: string;
    onServiceDateChange: (v: string) => void;
    minServiceDate: string;
    maxServiceDate: string;
    serviceDateWarning: string | null;
    effectiveBellStart: string;
    effectiveBellEnd: string;
    polygon: [number, number][] | null;
    isCalculating: boolean;
    tripOptions: TripOptions | null;
    result: StudentPassResult | null;
    selectedZoneStopId: string | null;
    selectedZoneStop: ZoneStopOption | null;
    selectedMorningIdx: number;
    selectedAfternoonIdx: number;
    onMorningSelect: (i: number) => void;
    onAfternoonSelect: (i: number) => void;
    onZoneStopSelect: (stopId: string) => void;
    journeyMode: 'am' | 'pm';
    onJourneyModeChange: (mode: 'am' | 'pm') => void;
    onExport: () => void;
    isExporting: boolean;
    selectedSchool: SchoolConfig;
}

const BORDER = 'var(--student-pass-border)';
const BORDER_SUBTLE = 'var(--student-pass-border-subtle)';
const CARD_BG = 'var(--student-pass-blue-card)';
const CARD_SELECTED_BG = 'var(--student-pass-blue-card-alt)';
const PANEL_BG = 'var(--student-pass-panel)';

const SectionDivider: React.FC = () => (
    <div style={{ height: '1px', background: BORDER_SUBTLE, margin: '0' }} />
);

const SectionHeader: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <h3
        className="text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: 'var(--student-pass-muted)', fontFamily: "'JetBrains Mono', monospace" }}
    >
        {children}
    </h3>
);

function formatDisplayDate(value: string): string {
    return new Intl.DateTimeFormat('en-CA', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    }).format(new Date(`${value}T00:00:00`));
}

function getJourneyTransfers(result: StudentPassResult, mode: 'am' | 'pm') {
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

function getJourneyDisplayWindow(
    firstLeg: StudentPassResult['morningLegs'][number] | StudentPassResult['afternoonLegs'][number] | undefined,
    lastLeg: StudentPassResult['morningLegs'][number] | StudentPassResult['afternoonLegs'][number] | undefined,
    leadingWalkMinutes = 0,
    trailingWalkMinutes = 0,
) {
    if (!firstLeg || !lastLeg) return null;

    return {
        departureMinutes: firstLeg.departureMinutes - leadingWalkMinutes,
        arrivalMinutes: lastLeg.arrivalMinutes + trailingWalkMinutes,
    };
}

function formatTransferSummary(result: StudentPassResult, mode: 'am' | 'pm'): string | null {
    const transfers = getJourneyTransfers(result, mode);
    if (transfers.length === 0) return null;

    const waits = transfers.map((transfer) => `${transfer.waitMinutes} min wait`).join(' / ');
    const transferLabel = transfers.length === 1 ? '1 transfer' : `${transfers.length} transfers`;
    return `${transferLabel} · ${waits}`;
}

export const StudentPassPanel: React.FC<StudentPassPanelProps> = ({
    selectedSchoolId,
    onSchoolChange,
    bellStart,
    bellEnd,
    onBellStartChange,
    onBellEndChange,
    serviceDate,
    onServiceDateChange,
    minServiceDate,
    maxServiceDate,
    serviceDateWarning,
    effectiveBellStart,
    effectiveBellEnd,
    polygon,
    isCalculating,
    tripOptions,
    result,
    selectedZoneStopId,
    selectedZoneStop,
    selectedMorningIdx,
    selectedAfternoonIdx,
    onMorningSelect,
    onAfternoonSelect,
    onZoneStopSelect,
    journeyMode,
    onJourneyModeChange,
    onExport,
    isExporting,
    selectedSchool,
}) => {
    const [collapsed, setCollapsed] = useState(false);
    const [stopFilter, setStopFilter] = useState('');

    const hasAfternoonOptions = (tripOptions?.afternoonOptions.length ?? 0) > 0;
    const zoneStops = tripOptions?.zoneStops ?? [];
    const filteredZoneStops = useMemo(() => {
        const term = stopFilter.trim().toLowerCase();
        if (!term) return zoneStops;
        return zoneStops.filter((stop) => stop.stopName.toLowerCase().includes(term));
    }, [stopFilter, zoneStops]);

    return (
        <div
            className="absolute top-4 left-4 w-80 z-10 rounded-xl shadow-2xl overflow-hidden panel-enter flex flex-col"
            style={{
                background: PANEL_BG,
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: `1px solid ${BORDER}`,
                maxHeight: 'calc(100vh - 280px)',
            }}
        >
            {/* Panel header — always visible */}
            <div
                className="flex items-center justify-between px-4 py-3 flex-shrink-0"
                style={{ borderBottom: `1px solid ${BORDER}` }}
            >
                <span
                    className="text-[13px] font-semibold truncate flex-1 mr-2"
                    style={{ color: 'var(--student-pass-text)', fontFamily: "'DM Sans', sans-serif" }}
                >
                    {selectedSchool.name}
                </span>
                <span
                    className="text-[10px] px-2 py-1 rounded-md mr-2 hidden sm:inline"
                    style={{
                        color: 'var(--student-pass-accent-strong)',
                        background: 'var(--student-pass-accent-soft)',
                        border: '1px solid var(--student-pass-border)',
                        fontFamily: "'JetBrains Mono', monospace",
                    }}
                >
                    {serviceDate}
                </span>
                <button
                    onClick={() => setCollapsed((c) => !c)}
                    className="flex-shrink-0 p-1 rounded-md transition-colors"
                    style={{ color: 'var(--student-pass-muted)', background: 'var(--student-pass-accent-soft)' }}
                    aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
                >
                    {collapsed ? (
                        <ChevronRight size={15} />
                    ) : (
                        <ChevronLeft size={15} />
                    )}
                </button>
            </div>

            {/* Collapsible body */}
            {!collapsed && (
                <div
                    className="flex-1 overflow-y-auto dark-scrollbar"
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                >
                    {/* Hint */}
                    <div className="px-4 py-3">
                        <p className="text-[12px]" style={{ color: 'var(--student-pass-muted)' }}>
                            Draw a zone on the map to find transit options.
                        </p>
                    </div>

                    {serviceDateWarning && (
                        <>
                            <SectionDivider />
                            <div className="px-4 py-3">
                                <div
                                    className="rounded-lg p-3 text-[11px]"
                                    style={{
                                        color: 'var(--student-pass-text)',
                                        background: 'var(--student-pass-accent-soft)',
                                        border: '1px solid var(--student-pass-border)',
                                    }}
                                >
                                    {serviceDateWarning}
                                </div>
                            </div>
                        </>
                    )}

                    <SectionDivider />

                    {/* School selection */}
                    <div className="px-4 py-3 space-y-1.5">
                        <SectionHeader>School</SectionHeader>
                        <select
                            value={selectedSchoolId}
                            onChange={(e) => onSchoolChange(e.target.value)}
                            className="w-full text-[13px] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[rgba(99,126,184,0.4)] text-[#E2E8F0]"
                            style={{
                                background: CARD_BG,
                                border: `1px solid ${BORDER}`,
                                fontFamily: "'DM Sans', sans-serif",
                            }}
                        >
                            {BARRIE_SCHOOLS.map((s) => (
                                <option key={s.id} value={s.id}
                                    style={{ background: '#131B2E', color: '#E2E8F0' }}>
                                    {s.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <SectionDivider />

                    {/* Bell times */}
                    <div className="px-4 py-3 space-y-2">
                        <SectionHeader>Bell Times</SectionHeader>
                        <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-0.5">
                                <label
                                    className="text-[10px] uppercase tracking-wide text-[#94A3B8] block"
                                    style={{ fontFamily: "'JetBrains Mono', monospace" }}
                                >
                                    Start
                                </label>
                                <input
                                    type="time"
                                    value={bellStart || selectedSchool.bellStart}
                                    onChange={(e) => onBellStartChange(e.target.value)}
                                    className="w-full text-[12px] rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[rgba(99,126,184,0.4)] text-[#E2E8F0]"
                                    style={{
                                        background: CARD_BG,
                                        border: `1px solid ${BORDER}`,
                                        colorScheme: 'dark',
                                        fontFamily: "'DM Sans', sans-serif",
                                    }}
                                />
                            </div>
                            <div className="space-y-0.5">
                                <label
                                    className="text-[10px] uppercase tracking-wide text-[#94A3B8] block"
                                    style={{ fontFamily: "'JetBrains Mono', monospace" }}
                                >
                                    End
                                </label>
                                <input
                                    type="time"
                                    value={bellEnd || selectedSchool.bellEnd}
                                    onChange={(e) => onBellEndChange(e.target.value)}
                                    className="w-full text-[12px] rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[rgba(99,126,184,0.4)] text-[#E2E8F0]"
                                    style={{
                                        background: CARD_BG,
                                        border: `1px solid ${BORDER}`,
                                        colorScheme: 'dark',
                                        fontFamily: "'DM Sans', sans-serif",
                                    }}
                                />
                            </div>
                        </div>
                    </div>

                    <SectionDivider />

                    {/* Service date */}
                    <div className="px-4 py-3 space-y-1.5">
                        <SectionHeader>Service Date</SectionHeader>
                        <input
                            type="date"
                            value={serviceDate}
                            min={minServiceDate}
                            max={maxServiceDate}
                            onChange={(e) => onServiceDateChange(e.target.value)}
                            className="w-full text-[12px] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[rgba(99,126,184,0.4)] text-[#E2E8F0]"
                            style={{
                                background: CARD_BG,
                                border: `1px solid ${BORDER}`,
                                colorScheme: 'dark',
                                fontFamily: "'DM Sans', sans-serif",
                            }}
                        />
                        <p className="text-[11px] text-[#94A3B8]">
                            GTFS range {minServiceDate} to {maxServiceDate}.
                        </p>
                    </div>

                    <SectionDivider />

                    {/* Zone status */}
                    <div className="px-4 py-3 space-y-1.5">
                        <SectionHeader>Zone Status</SectionHeader>
                        {polygon ? (
                            <div className="space-y-1">
                                <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--student-pass-muted)' }}>
                                    <span
                                        className="w-2 h-2 rounded-full flex-shrink-0"
                                        style={{ background: 'var(--student-pass-accent)' }}
                                    />
                                    Zone drawn ({polygon.length} vertices)
                                </div>
                                <p className="text-[11px]" style={{ color: 'var(--student-pass-muted)' }}>
                                    Drag the blue home point on the map to fine-tune the exact starting location.
                                </p>
                            </div>
                        ) : (
                            <p className="text-[12px] italic" style={{ color: 'var(--student-pass-muted)' }}>
                                Use the polygon tool (top-right of map) to draw a zone.
                            </p>
                        )}
                    </div>

                    {zoneStops.length > 0 && (
                        <>
                            <SectionDivider />
                            <div className="px-4 py-3 space-y-2">
                                <SectionHeader>Zone Stops</SectionHeader>
                                <input
                                    type="text"
                                    value={stopFilter}
                                    onChange={(e) => setStopFilter(e.target.value)}
                                    placeholder="Filter stops..."
                                    className="w-full text-[12px] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[rgba(99,126,184,0.4)] text-[#E2E8F0]"
                                    style={{
                                        background: CARD_BG,
                                        border: `1px solid ${BORDER}`,
                                        fontFamily: "'DM Sans', sans-serif",
                                    }}
                                />
                                <p className="text-[11px]" style={{ color: 'var(--student-pass-muted)' }}>
                                    Every zone stop is evaluated. Selecting a stop forces that exact stop into the trip plan.
                                </p>
                                <div className="space-y-2 max-h-56 overflow-y-auto dark-scrollbar pr-1">
                                    {filteredZoneStops.map((stop) => {
                                        const isSelected = stop.stopId === selectedZoneStopId;
                                        const hasAnyService = stop.morningOptionCount > 0 || stop.afternoonOptionCount > 0;
                                        const bestArrival = stop.bestMorningArrivalMinutes != null
                                            ? minutesToDisplayTime(stop.bestMorningArrivalMinutes)
                                            : null;
                                        const bestDeparture = stop.bestAfternoonDepartureMinutes != null
                                            ? minutesToDisplayTime(stop.bestAfternoonDepartureMinutes)
                                            : null;
                                        return (
                                            <button
                                                key={stop.stopId}
                                                onClick={() => onZoneStopSelect(stop.stopId)}
                                                className="w-full text-left rounded-lg px-3 py-2 transition-all"
                                                style={{
                                                    background: isSelected ? CARD_SELECTED_BG : CARD_BG,
                                                    border: `1px solid ${isSelected ? 'var(--student-pass-accent)' : BORDER}`,
                                                    boxShadow: isSelected ? '0 0 16px rgba(86, 166, 213, 0.2)' : undefined,
                                                    opacity: hasAnyService ? 1 : 0.75,
                                                }}
                                            >
                                                <div className="flex items-center justify-between gap-3">
                                                    <span className="text-[12px] font-semibold" style={{ color: 'var(--student-pass-text)' }}>
                                                        {stop.stopName}
                                                    </span>
                                                    {isSelected && (
                                                        <span className="text-[10px] font-semibold" style={{ color: 'var(--student-pass-accent-strong)' }}>
                                                            Selected
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-[11px] mt-1" style={{ color: 'var(--student-pass-muted)' }}>
                                                    {stop.walkMinutes} min walk · {stop.morningOptionCount} AM / {stop.afternoonOptionCount} PM options
                                                </p>
                                                {(bestArrival || bestDeparture) && (
                                                    <p className="text-[10px] mt-1" style={{ color: 'var(--student-pass-text)' }}>
                                                        {bestArrival ? `Best AM ${bestArrival}` : 'No AM trip'}
                                                        {bestArrival && bestDeparture ? ' · ' : ''}
                                                        {bestDeparture ? `Best PM ${bestDeparture}` : ''}
                                                    </p>
                                                )}
                                            </button>
                                        );
                                    })}
                                    {filteredZoneStops.length === 0 && (
                                        <p className="text-[12px] italic" style={{ color: 'var(--student-pass-muted)' }}>
                                            No stops match that filter.
                                        </p>
                                    )}
                                </div>
                            </div>
                        </>
                    )}

                    {/* Trip options */}
                    {(isCalculating || tripOptions) && (
                        <>
                            <SectionDivider />
                            <div className="px-4 py-3 space-y-3">
                                {isCalculating && (
                                    <div className="flex items-center gap-2 text-[12px] text-[#94A3B8]">
                                        <Loader2 size={14} className="animate-spin text-[#637EB8]" />
                                        Calculating...
                                    </div>
                                )}

                                {!isCalculating && tripOptions && tripOptions.morningOptions.length === 0 && (
                                    <div
                                        className="flex items-start gap-2 text-[12px] rounded-lg p-3"
                                        style={{
                                            background: 'rgba(245, 158, 11, 0.08)',
                                            border: '1px solid rgba(245, 158, 11, 0.2)',
                                        }}
                                    >
                                        <AlertTriangle size={14} className="flex-shrink-0 mt-0.5 text-amber-400" />
                                        <div>
                                            <p className="font-semibold text-amber-300">No trip found</p>
                                            <p className="text-[11px] mt-0.5 text-[#94A3B8]">
                                                No school trip was found from {selectedZoneStop?.stopName ?? 'the selected stop'} to{' '}
                                                {selectedSchool.name} on {formatDisplayDate(serviceDate)}. Try another stop or date.
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {!isCalculating && tripOptions && tripOptions.morningOptions.length > 0 && (
                                    <div className="space-y-3">
                                        {/* Morning / Afternoon tabs */}
                                        <div className="flex rounded-lg overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
                                            <button
                                                onClick={() => onJourneyModeChange('am')}
                                                className="flex-1 py-1.5 text-[12px] font-semibold uppercase tracking-wider transition-colors"
                                                style={{
                                                    fontFamily: "'JetBrains Mono', monospace",
                                                    background: journeyMode === 'am' ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                                                    color: journeyMode === 'am' ? '#93C5FD' : '#94A3B8',
                                                }}
                                            >
                                                Morning
                                            </button>
                                            <div style={{ width: 1, background: BORDER }} />
                                            <button
                                                onClick={() => onJourneyModeChange('pm')}
                                                className="flex-1 py-1.5 text-[12px] font-semibold uppercase tracking-wider transition-colors"
                                                style={{
                                                    fontFamily: "'JetBrains Mono', monospace",
                                                    background: journeyMode === 'pm' ? 'rgba(245, 158, 11, 0.15)' : 'transparent',
                                                    color: journeyMode === 'pm' ? '#FCD34D' : '#94A3B8',
                                                    opacity: hasAfternoonOptions ? 1 : 0.4,
                                                    pointerEvents: hasAfternoonOptions ? 'auto' : 'none',
                                                }}
                                                disabled={!hasAfternoonOptions}
                                            >
                                                Afternoon
                                            </button>
                                        </div>

                                        {/* Trip option cards */}
                                        <div className="space-y-2">
                                            {journeyMode === 'am' ? (
                                                // Morning options
                                                tripOptions.morningOptions.map((opt, i) => {
                                                    const isSelected = i === selectedMorningIdx;
                                                    const legs = opt.result.morningLegs;
                                                    const firstLeg = legs[0];
                                                    const lastLeg = legs[legs.length - 1];
                                                    const walkMin = opt.result.walkToStop?.walkMinutes;
                                                    const walkToSchoolMin = opt.result.walkToSchool?.walkMinutes ?? 0;
                                                    const transitMin = firstLeg && lastLeg ? lastLeg.arrivalMinutes - firstLeg.departureMinutes : 0;
                                                    const totalMin = (walkMin ?? 0) + transitMin + walkToSchoolMin;
                                                    const displayWindow = getJourneyDisplayWindow(
                                                        firstLeg,
                                                        lastLeg,
                                                        walkMin ?? 0,
                                                        walkToSchoolMin
                                                    );
                                                    const transferSummary = formatTransferSummary(opt.result, 'am');
                                                    const primaryColor = firstLeg?.routeColor || '#637EB8';
                                                    return (
                                                        <button
                                                            key={opt.id}
                                                            onClick={() => onMorningSelect(i)}
                                                            className={`w-full text-left rounded-lg p-3 transition-all ${
                                                                isSelected ? 'scale-[1.02] shadow-lg' : 'hover:bg-[#1A2540]'
                                                            }`}
                                                            style={{
                                                                background: isSelected ? CARD_SELECTED_BG : CARD_BG,
                                                                borderTop: isSelected ? `1px solid ${primaryColor}` : `1px solid ${BORDER}`,
                                                                borderRight: isSelected ? `1px solid ${primaryColor}` : `1px solid ${BORDER}`,
                                                                borderBottom: isSelected ? `1px solid ${primaryColor}` : `1px solid ${BORDER}`,
                                                                borderLeft: `4px solid ${primaryColor}`,
                                                                boxShadow: isSelected ? `0 0 20px ${primaryColor}33` : undefined,
                                                            }}
                                                        >
                                                            <div className="flex items-center justify-between mb-1.5">
                                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                                    {legs.map((leg, li) => (
                                                                        <React.Fragment key={li}>
                                                                            {li > 0 && (
                                                                                <ArrowRight size={8} className="text-[#94A3B8]" />
                                                                            )}
                                                                            <span
                                                                                className="text-[12px] font-bold px-2 py-0.5 rounded"
                                                                                style={{
                                                                                    fontFamily: "'JetBrains Mono', monospace",
                                                                                    background: leg.routeColor || '#637EB8',
                                                                                    color: getContrastingTextColor(leg.routeColor || '#637EB8'),
                                                                                }}
                                                                            >
                                                                                Rt {leg.routeShortName}
                                                                            </span>
                                                                        </React.Fragment>
                                                                    ))}
                                                                </div>
                                                                {isSelected && (
                                                                    <span
                                                                        className="text-[10px] font-semibold flex-shrink-0"
                                                                        style={{ color: primaryColor }}
                                                                    >
                                                                        Selected
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {firstLeg && lastLeg && (
                                                                <div className="flex items-center justify-between">
                                                                    <p className="text-[12px] text-[#E2E8F0]">
                                                                        {displayWindow
                                                                            ? minutesToDisplayTime(displayWindow.departureMinutes)
                                                                            : minutesToDisplayTime(firstLeg.departureMinutes)}
                                                                        {' → '}
                                                                        {displayWindow
                                                                            ? minutesToDisplayTime(displayWindow.arrivalMinutes)
                                                                            : minutesToDisplayTime(lastLeg.arrivalMinutes)}
                                                                    </p>
                                                                    <span
                                                                        className="text-[11px] font-semibold text-[#CBD5E1]"
                                                                        style={{ fontFamily: "'JetBrains Mono', monospace" }}
                                                                    >
                                                                        {totalMin} min
                                                                    </span>
                                                                </div>
                                                            )}
                                                            <p className="text-[11px] text-[#94A3B8] mt-0.5">
                                                                {opt.result.isDirect ? 'Direct' : 'With transfer'}
                                                                {walkMin != null && ` · ${walkMin} min walk`}
                                                                {transferSummary && ` · ${transferSummary}`}
                                                            </p>
                                                        </button>
                                                    );
                                                })
                                            ) : (
                                                // Afternoon options
                                                tripOptions.afternoonOptions.length > 0 ? (
                                                    tripOptions.afternoonOptions.map((opt, i) => {
                                                        const isSelected = i === selectedAfternoonIdx;
                                                        const legs = opt.result.afternoonLegs;
                                                        const firstLeg = legs[0];
                                                        const lastLeg = legs[legs.length - 1];
                                                        const alightStopName = lastLeg?.toStop;
                                                        const walkMin = opt.result.walkFromSchool?.walkMinutes;
                                                        const walkToZoneMin = opt.result.walkToZone?.walkMinutes ?? 0;
                                                        const transitMin = firstLeg && lastLeg ? lastLeg.arrivalMinutes - firstLeg.departureMinutes : 0;
                                                        const totalMin = (walkMin ?? 0) + transitMin + walkToZoneMin;
                                                        const displayWindow = getJourneyDisplayWindow(
                                                            firstLeg,
                                                            lastLeg,
                                                            walkMin ?? 0,
                                                            walkToZoneMin
                                                        );
                                                        const transferSummary = formatTransferSummary(opt.result, 'pm');
                                                        const primaryColor = firstLeg?.routeColor || '#637EB8';
                                                        return (
                                                            <button
                                                                key={opt.id}
                                                                onClick={() => onAfternoonSelect(i)}
                                                                className={`w-full text-left rounded-lg p-3 transition-all ${
                                                                    isSelected ? 'scale-[1.02] shadow-lg' : 'hover:bg-[#1A2540]'
                                                                }`}
                                                                style={{
                                                                    background: isSelected ? CARD_SELECTED_BG : CARD_BG,
                                                                    borderTop: isSelected ? `1px solid ${primaryColor}` : `1px solid ${BORDER}`,
                                                                    borderRight: isSelected ? `1px solid ${primaryColor}` : `1px solid ${BORDER}`,
                                                                    borderBottom: isSelected ? `1px solid ${primaryColor}` : `1px solid ${BORDER}`,
                                                                    borderLeft: `4px solid ${primaryColor}`,
                                                                    boxShadow: isSelected ? `0 0 20px ${primaryColor}33` : undefined,
                                                                }}
                                                            >
                                                                <div className="flex items-center justify-between mb-1.5">
                                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                                        {legs.map((leg, li) => (
                                                                            <React.Fragment key={li}>
                                                                                {li > 0 && (
                                                                                    <ArrowRight size={8} className="text-[#94A3B8]" />
                                                                                )}
                                                                                <span
                                                                                    className="text-[12px] font-bold px-2 py-0.5 rounded"
                                                                                    style={{
                                                                                        fontFamily: "'JetBrains Mono', monospace",
                                                                                        background: leg.routeColor || '#637EB8',
                                                                                        color: getContrastingTextColor(leg.routeColor || '#637EB8'),
                                                                                    }}
                                                                                >
                                                                                    Rt {leg.routeShortName}
                                                                                </span>
                                                                            </React.Fragment>
                                                                        ))}
                                                                    </div>
                                                                    {isSelected && (
                                                                        <span
                                                                            className="text-[10px] font-semibold flex-shrink-0"
                                                                            style={{ color: primaryColor }}
                                                                        >
                                                                            Selected
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                {firstLeg && lastLeg && (
                                                                    <div className="flex items-center justify-between">
                                                                        <p className="text-[12px] text-[#E2E8F0]">
                                                                            {displayWindow
                                                                                ? minutesToDisplayTime(displayWindow.departureMinutes)
                                                                                : minutesToDisplayTime(firstLeg.departureMinutes)}
                                                                            {' → '}
                                                                            {displayWindow
                                                                                ? minutesToDisplayTime(displayWindow.arrivalMinutes)
                                                                                : minutesToDisplayTime(lastLeg.arrivalMinutes)}
                                                                        </p>
                                                                        <span
                                                                            className="text-[11px] font-semibold text-[#CBD5E1]"
                                                                            style={{ fontFamily: "'JetBrains Mono', monospace" }}
                                                                        >
                                                                            {totalMin} min
                                                                        </span>
                                                                    </div>
                                                                )}
                                                                <p className="text-[11px] text-[#94A3B8] mt-0.5">
                                                                    {legs.length === 1 ? 'Direct' : 'With transfer'}
                                                                    {walkMin != null && ` · ${walkMin} min walk to stop`}
                                                                    {transferSummary && ` · ${transferSummary}`}
                                                                </p>
                                                                {alightStopName && (
                                                                    <p className="text-[11px] text-[#94A3B8] mt-0.5">
                                                                        Get off at{' '}
                                                                        <span className="font-semibold text-[#E2E8F0]">
                                                                            {alightStopName}
                                                                        </span>
                                                                    </p>
                                                                )}
                                                            </button>
                                                        );
                                                    })
                                                ) : (
                                                    <p className="text-[12px] text-[#94A3B8] italic">
                                                        No afternoon options found.
                                                    </p>
                                                )
                                            )}
                                        </div>

                                        {/* Walk + frequency summary */}
                                        {result?.found && (
                                            <div
                                                className="rounded-lg p-3 space-y-1.5"
                                                style={{
                                                    background: CARD_BG,
                                                    border: `1px solid ${BORDER}`,
                                                }}
                                            >
                                                {journeyMode === 'am' && selectedZoneStop && (
                                                    <p className="text-[11px] text-[#94A3B8]">
                                                        Selected stop:{' '}
                                                        <span className="font-semibold text-[#E2E8F0]">
                                                            {selectedZoneStop.stopName}
                                                        </span>
                                                    </p>
                                                )}
                                                {journeyMode === 'pm' && result.afternoonLegs.length > 0 && (
                                                    <p className="text-[11px] text-[#94A3B8]">
                                                        Get off at:{' '}
                                                        <span className="font-semibold text-[#E2E8F0]">
                                                            {result.afternoonLegs[result.afternoonLegs.length - 1].toStop}
                                                        </span>
                                                    </p>
                                                )}
                                                {journeyMode === 'am' && result.walkToStop && (
                                                    <p className="text-[11px] text-[#94A3B8]">
                                                        Walk to stop:{' '}
                                                        <span className="font-semibold text-[#E2E8F0]">
                                                            {result.walkToStop.walkMinutes} min
                                                        </span>{' '}
                                                        ({(result.walkToStop.distanceKm * 1000).toFixed(0)}m)
                                                    </p>
                                                )}
                                                {journeyMode === 'am' && result.walkToSchool && (
                                                    <p className="text-[11px] text-[#94A3B8]">
                                                        Walk to school:{' '}
                                                        <span className="font-semibold text-[#E2E8F0]">
                                                            {result.walkToSchool.walkMinutes} min
                                                        </span>{' '}
                                                        ({(result.walkToSchool.distanceKm * 1000).toFixed(0)}m)
                                                    </p>
                                                )}
                                                {journeyMode === 'pm' && result.walkFromSchool && (
                                                    <p className="text-[11px] text-[#94A3B8]">
                                                        Walk to stop:{' '}
                                                        <span className="font-semibold text-[#E2E8F0]">
                                                            {result.walkFromSchool.walkMinutes} min
                                                        </span>{' '}
                                                        ({(result.walkFromSchool.distanceKm * 1000).toFixed(0)}m)
                                                    </p>
                                                )}
                                                {journeyMode === 'pm' && result.walkToZone && (
                                                    <p className="text-[11px] text-[#94A3B8]">
                                                        Walk home:{' '}
                                                        <span className="font-semibold text-[#E2E8F0]">
                                                            {result.walkToZone.walkMinutes} min
                                                        </span>{' '}
                                                        ({(result.walkToZone.distanceKm * 1000).toFixed(0)}m)
                                                    </p>
                                                )}
                                                {journeyMode === 'am' && result.frequencyPerHour != null && (
                                                    <p className="text-[11px] text-[#94A3B8]">
                                                        AM frequency:{' '}
                                                        <span className="font-semibold text-[#E2E8F0]">
                                                            {result.frequencyPerHour.toFixed(1)} trips/hr
                                                        </span>
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    {!isCalculating && !tripOptions && (
                        <div className="px-4 pb-3">
                            <p className="text-[12px] italic" style={{ color: 'var(--student-pass-muted)' }}>
                                Draw a zone on the map to see transit options.
                            </p>
                        </div>
                    )}

                    {/* Spacer so content doesn't hide under export button */}
                    <div className="h-2" />
                </div>
            )}

            {/* Export button — pinned at bottom, always visible when not collapsed */}
            {!collapsed && (
                <div
                    className="flex-shrink-0 p-3"
                    style={{ borderTop: `1px solid ${BORDER}` }}
                >
                    <button
                        onClick={onExport}
                        disabled={!result?.found || isExporting}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-[13px] text-white transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ fontFamily: "'DM Sans', sans-serif", background: 'var(--student-pass-blue)' }}
                        title={result?.found ? 'Download student transit pass PDF' : 'No trip result to export'}
                    >
                        {isExporting ? (
                            <>
                                <Loader2 size={14} className="animate-spin" />
                                Generating...
                            </>
                        ) : (
                            <>
                                <Download size={14} />
                                Download PDF
                            </>
                        )}
                    </button>
                </div>
            )}
        </div>
    );
};
