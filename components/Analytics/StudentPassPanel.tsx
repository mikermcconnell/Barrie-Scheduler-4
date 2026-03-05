import React, { useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Download, Loader2, ArrowRight } from 'lucide-react';
import { BARRIE_SCHOOLS, minutesToDisplayTime } from '../../utils/transit-app/studentPassUtils';
import type {
    SchoolConfig,
    StudentPassResult,
    TripOptions,
} from '../../utils/transit-app/studentPassUtils';

interface StudentPassPanelProps {
    selectedSchoolId: string;
    onSchoolChange: (id: string) => void;
    bellStart: string;
    bellEnd: string;
    onBellStartChange: (v: string) => void;
    onBellEndChange: (v: string) => void;
    effectiveBellStart: string;
    effectiveBellEnd: string;
    polygon: [number, number][] | null;
    isCalculating: boolean;
    tripOptions: TripOptions | null;
    result: StudentPassResult | null;
    selectedMorningIdx: number;
    selectedAfternoonIdx: number;
    onMorningSelect: (i: number) => void;
    onAfternoonSelect: (i: number) => void;
    onExport: () => void;
    isExporting: boolean;
    selectedSchool: SchoolConfig;
}

const BORDER = 'rgba(99, 126, 184, 0.12)';
const BORDER_SUBTLE = 'rgba(99, 126, 184, 0.08)';
const CARD_BG = '#131B2E';
const CARD_SELECTED_BG = '#1A2540';
const PANEL_BG = 'rgba(11, 17, 33, 0.85)';

const SectionDivider: React.FC = () => (
    <div style={{ height: '1px', background: BORDER_SUBTLE, margin: '0' }} />
);

const SectionHeader: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <h3
        className="text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
    >
        {children}
    </h3>
);

export const StudentPassPanel: React.FC<StudentPassPanelProps> = ({
    selectedSchoolId,
    onSchoolChange,
    bellStart,
    bellEnd,
    onBellStartChange,
    onBellEndChange,
    effectiveBellStart,
    effectiveBellEnd,
    polygon,
    isCalculating,
    tripOptions,
    result,
    selectedMorningIdx,
    selectedAfternoonIdx,
    onMorningSelect,
    onAfternoonSelect,
    onExport,
    isExporting,
    selectedSchool,
}) => {
    const [collapsed, setCollapsed] = useState(false);

    return (
        <div
            className="absolute top-4 left-4 w-80 z-10 rounded-xl shadow-2xl overflow-hidden panel-enter flex flex-col"
            style={{
                background: PANEL_BG,
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: `1px solid ${BORDER}`,
                maxHeight: 'calc(100vh - 160px)',
            }}
        >
            {/* Panel header — always visible */}
            <div
                className="flex items-center justify-between px-4 py-3 flex-shrink-0"
                style={{ borderBottom: `1px solid ${BORDER}` }}
            >
                <span
                    className="text-[13px] font-semibold text-[#E2E8F0] truncate flex-1 mr-2"
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                >
                    {selectedSchool.name}
                </span>
                <button
                    onClick={() => setCollapsed((c) => !c)}
                    className="flex-shrink-0 p-1 rounded-md text-[#94A3B8] hover:text-[#E2E8F0] transition-colors"
                    style={{ background: 'rgba(99, 126, 184, 0.08)' }}
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
                        <p className="text-[12px] text-[#94A3B8]">
                            Draw a zone on the map to find transit options.
                        </p>
                    </div>

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
                                    value={bellStart}
                                    onChange={(e) => onBellStartChange(e.target.value)}
                                    className="w-full text-[12px] rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[rgba(99,126,184,0.4)] text-[#E2E8F0]"
                                    style={{
                                        background: CARD_BG,
                                        border: `1px solid ${BORDER}`,
                                        colorScheme: 'dark',
                                        fontFamily: "'DM Sans', sans-serif",
                                    }}
                                />
                                {!bellStart && (
                                    <p className="text-[10px] text-[#94A3B8]">
                                        {selectedSchool.bellStart}
                                    </p>
                                )}
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
                                    value={bellEnd}
                                    onChange={(e) => onBellEndChange(e.target.value)}
                                    className="w-full text-[12px] rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[rgba(99,126,184,0.4)] text-[#E2E8F0]"
                                    style={{
                                        background: CARD_BG,
                                        border: `1px solid ${BORDER}`,
                                        colorScheme: 'dark',
                                        fontFamily: "'DM Sans', sans-serif",
                                    }}
                                />
                                {!bellEnd && (
                                    <p className="text-[10px] text-[#94A3B8]">
                                        {selectedSchool.bellEnd}
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>

                    <SectionDivider />

                    {/* Zone status */}
                    <div className="px-4 py-3 space-y-1.5">
                        <SectionHeader>Zone Status</SectionHeader>
                        {polygon ? (
                            <div className="flex items-center gap-2 text-[12px] text-[#94A3B8]">
                                <span
                                    className="w-2 h-2 rounded-full flex-shrink-0"
                                    style={{ background: '#3B82F6' }}
                                />
                                Zone drawn ({polygon.length} vertices)
                            </div>
                        ) : (
                            <p className="text-[12px] text-[#94A3B8] italic">
                                Use the polygon tool (top-right of map) to draw a zone.
                            </p>
                        )}
                    </div>

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
                                                No weekday service connects this zone to{' '}
                                                {selectedSchool.name} within 30 min of bell time.
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {!isCalculating && tripOptions && tripOptions.morningOptions.length > 0 && (
                                    <div className="space-y-4">
                                        {/* Morning options */}
                                        <div className="space-y-2">
                                            <SectionHeader>Morning Options</SectionHeader>
                                            <div className="space-y-2">
                                                {tripOptions.morningOptions.map((opt, i) => {
                                                    const isSelected = i === selectedMorningIdx;
                                                    const legs = opt.result.morningLegs;
                                                    const firstLeg = legs[0];
                                                    const lastLeg = legs[legs.length - 1];
                                                    const walkMin = opt.result.walkToStop?.walkMinutes;
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
                                                                border: isSelected
                                                                    ? `1px solid ${primaryColor}`
                                                                    : `1px solid ${BORDER}`,
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
                                                                                className="text-[11px] font-bold px-2 py-0.5 rounded"
                                                                                style={{
                                                                                    fontFamily: "'JetBrains Mono', monospace",
                                                                                    background: leg.routeColor || '#637EB8',
                                                                                    color: '#fff',
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
                                                                <p className="text-[12px] text-[#E2E8F0]">
                                                                    {minutesToDisplayTime(firstLeg.departureMinutes)}
                                                                    {' → '}
                                                                    {minutesToDisplayTime(lastLeg.arrivalMinutes)}
                                                                </p>
                                                            )}
                                                            <p className="text-[11px] text-[#94A3B8] mt-0.5">
                                                                {opt.result.isDirect ? 'Direct' : 'Transfer'}
                                                                {walkMin != null && ` · ${walkMin} min walk`}
                                                                {opt.result.transfer && ` · ${opt.result.transfer.waitMinutes} min wait`}
                                                            </p>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        {/* Afternoon options */}
                                        {tripOptions.afternoonOptions.length > 0 && (
                                            <div className="space-y-2">
                                                <SectionHeader>Afternoon Options</SectionHeader>
                                                <div className="space-y-2">
                                                    {tripOptions.afternoonOptions.map((opt, i) => {
                                                        const isSelected = i === selectedAfternoonIdx;
                                                        const leg = opt.result.afternoonLegs[0];
                                                        if (!leg) return null;
                                                        const primaryColor = leg.routeColor || '#637EB8';
                                                        return (
                                                            <button
                                                                key={opt.id}
                                                                onClick={() => onAfternoonSelect(i)}
                                                                className={`w-full text-left rounded-lg p-3 transition-all ${
                                                                    isSelected ? 'scale-[1.02] shadow-lg' : 'hover:bg-[#1A2540]'
                                                                }`}
                                                                style={{
                                                                    background: isSelected ? CARD_SELECTED_BG : CARD_BG,
                                                                    border: isSelected
                                                                        ? `1px solid ${primaryColor}`
                                                                        : `1px solid ${BORDER}`,
                                                                    borderLeft: `4px solid ${primaryColor}`,
                                                                    boxShadow: isSelected ? `0 0 20px ${primaryColor}33` : undefined,
                                                                }}
                                                            >
                                                                <div className="flex items-center justify-between mb-1.5">
                                                                    <span
                                                                        className="text-[11px] font-bold px-2 py-0.5 rounded"
                                                                        style={{
                                                                            fontFamily: "'JetBrains Mono', monospace",
                                                                            background: primaryColor,
                                                                            color: '#fff',
                                                                        }}
                                                                    >
                                                                        Rt {leg.routeShortName}
                                                                    </span>
                                                                    {isSelected && (
                                                                        <span
                                                                            className="text-[10px] font-semibold"
                                                                            style={{ color: primaryColor }}
                                                                        >
                                                                            Selected
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <p className="text-[12px] text-[#E2E8F0]">
                                                                    {minutesToDisplayTime(leg.departureMinutes)}
                                                                    {' → '}
                                                                    {minutesToDisplayTime(leg.arrivalMinutes)}
                                                                </p>
                                                                <p className="text-[11px] text-[#94A3B8] mt-0.5">
                                                                    {leg.fromStop}
                                                                </p>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}

                                        {/* Walk + frequency summary */}
                                        {result?.found && (
                                            <div
                                                className="rounded-lg p-3 space-y-1.5"
                                                style={{
                                                    background: CARD_BG,
                                                    border: `1px solid ${BORDER}`,
                                                }}
                                            >
                                                {result.walkToStop && (
                                                    <p className="text-[11px] text-[#94A3B8]">
                                                        Walk to stop:{' '}
                                                        <span className="font-semibold text-[#E2E8F0]">
                                                            {result.walkToStop.walkMinutes} min
                                                        </span>{' '}
                                                        ({(result.walkToStop.distanceKm * 1000).toFixed(0)}m)
                                                    </p>
                                                )}
                                                {result.walkToSchool && (
                                                    <p className="text-[11px] text-[#94A3B8]">
                                                        Walk to school:{' '}
                                                        <span className="font-semibold text-[#E2E8F0]">
                                                            {result.walkToSchool.walkMinutes} min
                                                        </span>{' '}
                                                        ({(result.walkToSchool.distanceKm * 1000).toFixed(0)}m)
                                                    </p>
                                                )}
                                                {result.frequencyPerHour != null && (
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
                            <p className="text-[12px] text-[#94A3B8] italic">
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
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-[13px] text-white transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed bg-emerald-500 hover:bg-emerald-600"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
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
