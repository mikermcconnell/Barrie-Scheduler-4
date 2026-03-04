import React, { useMemo, useState, useRef } from 'react';
import type { CascadeAffectedTrip } from '../../utils/performanceDataTypes';
import {
    buildTimelinePoints,
    buildTripSegments,
    TRIP_FILL_COLORS,
    type TimelinePoint,
    type TripSegment,
    type StopLoadData,
} from '../../utils/schedule/cascadeStoryUtils';

interface CascadeTimelineChartProps {
    trips: CascadeAffectedTrip[];
    routeId: string;
    selectedTripIndex: number | null;
    onSelectPoint: (pointIndex: number | null) => void;
    stopLoadLookup: Map<string, StopLoadData>;
    dwellOriginStopId?: string;
    dwellExcessMinutes?: number;
}

interface TooltipState {
    x: number;
    y: number;
    point: TimelinePoint;
}

const OTP_LATE_MINUTES = 5;

const CascadeTimelineChart: React.FC<CascadeTimelineChartProps> = ({
    trips,
    routeId,
    selectedTripIndex,
    onSelectPoint,
    stopLoadLookup,
    dwellOriginStopId,
    dwellExcessMinutes,
}) => {
    const [tooltip, setTooltip] = useState<TooltipState | null>(null);
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const prevSelectedRef = useRef<number | null>(null);

    const rawPoints = useMemo(() => buildTimelinePoints(trips), [trips]);

    // Override dwell origin point: if recorded deviation is lower than the excess dwell,
    // the AVL didn't capture departure delay at the origin — use the dwell excess instead.
    // Only override the FIRST occurrence (trip 0) to avoid affecting the same stop on later trips.
    const points = useMemo(() => {
        if (!dwellOriginStopId || dwellExcessMinutes == null) return rawPoints;
        let applied = false;
        return rawPoints.map(p => {
            if (applied || p.stopId !== dwellOriginStopId || p.tripIndex !== 0) return p;
            const recorded = p.deviationMinutes ?? 0;
            if (recorded >= dwellExcessMinutes) return p;
            applied = true;
            return { ...p, deviationMinutes: dwellExcessMinutes, isLate: dwellExcessMinutes > OTP_LATE_MINUTES };
        });
    }, [rawPoints, dwellOriginStopId, dwellExcessMinutes]);

    const segments = useMemo(() => buildTripSegments(trips, points), [trips, points]);

    if (points.length === 0) {
        return (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
                No timepoint data
            </div>
        );
    }

    const marginTop = 28;
    const marginRight = 20;
    const marginBottom = 50;
    const marginLeft = 45;

    const svgWidth = Math.max(600, points.length * 60);
    const svgHeight = 200;

    const innerWidth = svgWidth - marginLeft - marginRight;
    const innerHeight = svgHeight - marginTop - marginBottom;

    // Compute deviation scale
    const deviations = points.map(p => p.deviationMinutes ?? 0).filter(d => d > 0);
    const maxDeviation = deviations.length > 0 ? Math.max(...deviations) : OTP_LATE_MINUTES + 2;
    const yMax = Math.max(maxDeviation * 1.1, OTP_LATE_MINUTES + 2);

    const xStep = innerWidth / Math.max(points.length - 1, 1);

    const xOf = (i: number): number => marginLeft + i * xStep;
    const yOf = (devMin: number): number =>
        marginTop + innerHeight - (devMin / yMax) * innerHeight;

    const yBaseline = yOf(0);
    const yThreshold = yOf(OTP_LATE_MINUTES);

    // Build per-segment area polygons and line paths
    const segmentAreas = segments.map((seg) => {
        const pts: string[] = [];
        pts.push(`${xOf(seg.startPointIndex)},${yBaseline}`);
        for (let i = seg.startPointIndex; i <= seg.endPointIndex; i++) {
            const dev = points[i].deviationMinutes ?? 0;
            pts.push(`${xOf(i)},${yOf(Math.max(dev, 0))}`);
        }
        pts.push(`${xOf(seg.endPointIndex)},${yBaseline}`);
        return pts.join(' ');
    });

    const segmentLines = segments.map((seg) => {
        const parts: string[] = [];
        for (let i = seg.startPointIndex; i <= seg.endPointIndex; i++) {
            const dev = points[i].deviationMinutes ?? 0;
            const cmd = i === seg.startPointIndex ? 'M' : 'L';
            parts.push(`${cmd}${xOf(i)},${yOf(Math.max(dev, 0))}`);
        }
        return parts.join(' ');
    });

    // Connecting lines between segments for visual continuity
    const segmentConnectors: { path: string; stroke: string }[] = [];
    for (let si = 0; si < segments.length - 1; si++) {
        const endIdx = segments[si].endPointIndex;
        const startIdx = segments[si + 1].startPointIndex;
        const endDev = points[endIdx].deviationMinutes ?? 0;
        const startDev = points[startIdx].deviationMinutes ?? 0;
        segmentConnectors.push({
            path: `M${xOf(endIdx)},${yOf(Math.max(endDev, 0))} L${xOf(startIdx)},${yOf(Math.max(startDev, 0))}`,
            stroke: TRIP_FILL_COLORS[segments[si + 1].color].stroke,
        });
    }

    // Recovery markers: first non-late point after a late point
    const recoveryIndices = new Set<number>();
    let wasLate = false;
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (p.deviationMinutes !== null) {
            if (wasLate && !p.isLate) {
                recoveryIndices.add(i);
            }
            wasLate = p.isLate;
        }
    }

    // Y-axis ticks
    const midDeviation = yMax / 2;
    const yTicks = [0, midDeviation, yMax];

    // Find segment for a point index (for dot coloring)
    const segmentForPoint = (ptIdx: number): TripSegment | undefined =>
        segments.find(s => ptIdx >= s.startPointIndex && ptIdx <= s.endPointIndex);

    // Max boardings for dot radius scaling
    const maxBoardings = useMemo(() => {
        if (stopLoadLookup.size === 0) return 0;
        let max = 0;
        for (const p of points) {
            const data = stopLoadLookup.get(`${routeId}_${p.stopId}`);
            if (data && data.avgBoardings > max) max = data.avgBoardings;
        }
        return max;
    }, [points, routeId, stopLoadLookup]);

    // Mouse tracking
    const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        let nearest: TimelinePoint | null = null;
        let nearestDist = Infinity;
        let nearestIdx = -1;
        for (let i = 0; i < points.length; i++) {
            const px = xOf(i);
            const dist = Math.abs(mouseX - px);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearest = points[i];
                nearestIdx = i;
            }
        }

        if (nearest && nearestDist <= 30) {
            setTooltip({ x: mouseX, y: mouseY, point: nearest });
            if (nearestIdx !== hoveredIndex) {
                setHoveredIndex(nearestIdx);
                onSelectPoint(nearestIdx);
                prevSelectedRef.current = nearestIdx;
            }
        } else if (prevSelectedRef.current !== null) {
            setTooltip(null);
            setHoveredIndex(null);
            onSelectPoint(null);
            prevSelectedRef.current = null;
        }
    };

    const handleMouseLeave = () => {
        setTooltip(null);
        setHoveredIndex(null);
        onSelectPoint(null);
    };

    return (
        <div className="relative overflow-x-auto">
            <svg
                width={svgWidth}
                height={svgHeight}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                style={{ cursor: 'crosshair', display: 'block' }}
            >
                {/* Green on-time zone background */}
                <rect
                    x={marginLeft}
                    y={yThreshold}
                    width={innerWidth}
                    height={yBaseline - yThreshold}
                    fill="#dcfce7"
                    opacity={0.5}
                />

                {/* OTP threshold dashed line at 5 min */}
                <line
                    x1={marginLeft}
                    y1={yThreshold}
                    x2={marginLeft + innerWidth}
                    y2={yThreshold}
                    stroke="#ef4444"
                    strokeWidth={1}
                    strokeDasharray="4 3"
                />
                <text
                    x={marginLeft - 4}
                    y={yThreshold + 4}
                    textAnchor="end"
                    fontSize={9}
                    fill="#ef4444"
                >
                    5m
                </text>

                {/* === LAYER 1: Per-trip area fills === */}
                {segments.map((seg, si) => {
                    const dimmed = selectedTripIndex !== null && seg.tripIndex !== selectedTripIndex;
                    return (
                        <polygon
                            key={`area-${si}`}
                            points={segmentAreas[si]}
                            fill={TRIP_FILL_COLORS[seg.color].fill}
                            opacity={dimmed ? 0.12 : 0.4}
                        />
                    );
                })}

                {/* === LAYER 2: Trip boundary lines and labels === */}
                {segments.map((seg, si) => {
                    const ptIdx = seg.startPointIndex;
                    const colors = TRIP_FILL_COLORS[seg.color];
                    if (si === 0) {
                        return (
                            <text
                                key={`trip-label-${si}`}
                                x={xOf(ptIdx)}
                                y={marginTop - 10}
                                textAnchor="middle"
                                fontSize={10}
                                fill={colors.stroke}
                                fontWeight={600}
                            >
                                {seg.tripName} · {seg.lateCount}/{seg.totalCount}
                            </text>
                        );
                    }
                    return (
                        <g key={`trip-boundary-${si}`}>
                            <line
                                x1={xOf(ptIdx)}
                                y1={marginTop}
                                x2={xOf(ptIdx)}
                                y2={yBaseline}
                                stroke="#6b7280"
                                strokeWidth={1.5}
                                strokeDasharray="6 3"
                            />
                            <text
                                x={xOf(ptIdx)}
                                y={marginTop - 10}
                                textAnchor="middle"
                                fontSize={10}
                                fill={colors.stroke}
                                fontWeight={600}
                            >
                                {seg.tripName} · {seg.lateCount}/{seg.totalCount}
                            </text>
                        </g>
                    );
                })}

                {/* === LAYER 3: Axes === */}
                {/* Y-axis */}
                <line
                    x1={marginLeft}
                    y1={marginTop}
                    x2={marginLeft}
                    y2={yBaseline}
                    stroke="#d1d5db"
                    strokeWidth={1}
                />
                {yTicks.map((tick, i) => (
                    <g key={`ytick-${i}`}>
                        <line
                            x1={marginLeft - 4}
                            y1={yOf(tick)}
                            x2={marginLeft}
                            y2={yOf(tick)}
                            stroke="#9ca3af"
                            strokeWidth={1}
                        />
                        <text
                            x={marginLeft - 7}
                            y={yOf(tick) + 4}
                            textAnchor="end"
                            fontSize={9}
                            fill="#9ca3af"
                        >
                            {tick.toFixed(0)}m
                        </text>
                    </g>
                ))}

                {/* X-axis baseline */}
                <line
                    x1={marginLeft}
                    y1={yBaseline}
                    x2={marginLeft + innerWidth}
                    y2={yBaseline}
                    stroke="#d1d5db"
                    strokeWidth={1}
                />

                {/* X-axis stop name labels */}
                {points.map((p, i) => (
                    <text
                        key={`xlabel-${i}`}
                        x={xOf(i)}
                        y={yBaseline + 8}
                        textAnchor="end"
                        fontSize={9}
                        fill="#9ca3af"
                        transform={`rotate(-45, ${xOf(i)}, ${yBaseline + 8})`}
                    >
                        {p.stopName.length > 14 ? p.stopName.slice(0, 13) + '…' : p.stopName}
                    </text>
                ))}

                {/* === LAYER 4: Per-trip line paths === */}
                {segments.map((seg, si) => {
                    const dimmed = selectedTripIndex !== null && seg.tripIndex !== selectedTripIndex;
                    return (
                        <path
                            key={`line-${si}`}
                            d={segmentLines[si]}
                            fill="none"
                            stroke={TRIP_FILL_COLORS[seg.color].stroke}
                            strokeWidth={2}
                            strokeLinejoin="round"
                            opacity={dimmed ? 0.25 : 1}
                        />
                    );
                })}

                {/* Connecting lines between segments */}
                {segmentConnectors.map((conn, ci) => (
                    <path
                        key={`conn-${ci}`}
                        d={conn.path}
                        fill="none"
                        stroke={conn.stroke}
                        strokeWidth={1.5}
                        strokeDasharray="3 2"
                        opacity={0.5}
                    />
                ))}

                {/* === LAYER 5: Data point dots (scaled by boardings when available) === */}
                {points.map((p, i) => {
                    const cx = xOf(i);
                    const dev = p.deviationMinutes;
                    const isDimmed = selectedTripIndex !== null && p.tripIndex !== selectedTripIndex;
                    const isHovered = hoveredIndex === i;
                    const loadData = stopLoadLookup.get(`${routeId}_${p.stopId}`);
                    const baseR = maxBoardings > 0 && loadData
                        ? Math.max(3.5, Math.min(8, (loadData.avgBoardings / maxBoardings) * 7))
                        : 3.5;
                    const r = isHovered ? baseR + 1.5 : baseR;
                    const seg = segmentForPoint(i);

                    if (dev === null) {
                        return (
                            <circle
                                key={`dot-${i}`}
                                cx={cx}
                                cy={yBaseline}
                                r={r}
                                fill="#9ca3af"
                                opacity={isDimmed ? 0.3 : 0.6}
                            />
                        );
                    }

                    const cy = yOf(Math.max(dev, 0));
                    const fill = p.isLate
                        ? (seg ? TRIP_FILL_COLORS[seg.color].stroke : '#ef4444')
                        : '#22c55e';

                    return (
                        <circle
                            key={`dot-${i}`}
                            cx={cx}
                            cy={cy}
                            r={r}
                            fill={fill}
                            opacity={isDimmed ? 0.3 : 1}
                        />
                    );
                })}

                {/* === LAYER 6: Recovery markers === */}
                {points.map((p, i) => {
                    if (!recoveryIndices.has(i)) return null;
                    const cx = xOf(i);
                    const dev = p.deviationMinutes ?? 0;
                    const cy = yOf(Math.max(dev, 0));
                    return (
                        <g key={`recovery-${i}`}>
                            <circle
                                cx={cx}
                                cy={cy - 10}
                                r={7}
                                fill="#22c55e"
                                opacity={0.9}
                            />
                            <path
                                d={`M${cx - 3},${cy - 10} L${cx - 0.5},${cy - 7.5} L${cx + 3.5},${cy - 13}`}
                                fill="none"
                                stroke="white"
                                strokeWidth={1.5}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        </g>
                    );
                })}

                {/* === LAYER 7: Dwell origin marker (bolt icon + excess label) === */}
                {/* Only on the FIRST occurrence (trip 0) — later occurrences may be recovery */}
                {dwellOriginStopId && points.map((p, i) => {
                    if (p.stopId !== dwellOriginStopId || p.tripIndex !== 0) return null;
                    const cx = xOf(i);
                    const dev = p.deviationMinutes ?? 0;
                    const cy = yOf(Math.max(dev, 0));
                    const badgeY = cy - 14;
                    return (
                        <g key={`dwell-origin-${i}`}>
                            {/* Red pulsing ring behind the dot */}
                            <circle
                                cx={cx}
                                cy={cy}
                                r={10}
                                fill="none"
                                stroke="#dc2626"
                                strokeWidth={1.5}
                                opacity={0.4}
                            />
                            {/* Bolt badge above the point */}
                            <rect
                                x={cx - 20}
                                y={badgeY - 9}
                                width={40}
                                height={18}
                                rx={4}
                                fill="#dc2626"
                                opacity={0.9}
                            />
                            {/* Bolt icon */}
                            <text
                                x={cx - 13}
                                y={badgeY + 4}
                                fontSize={10}
                                fill="white"
                            >
                                ⚡
                            </text>
                            {/* Excess dwell label */}
                            <text
                                x={cx + 1}
                                y={badgeY + 3}
                                fontSize={9}
                                fill="white"
                                fontWeight={600}
                            >
                                {dwellExcessMinutes != null ? `+${dwellExcessMinutes.toFixed(0)}m` : 'dwell'}
                            </text>
                        </g>
                    );
                })}
            </svg>

            {/* Tooltip */}
            {tooltip && (
                <div
                    className="absolute z-10 pointer-events-none bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs text-gray-700"
                    style={{
                        left: tooltip.x + 12,
                        top: tooltip.y - 10,
                        maxWidth: 200,
                        transform: tooltip.x > svgWidth - 200 ? 'translateX(-110%)' : undefined,
                    }}
                >
                    <div className="font-semibold text-gray-900 mb-1 truncate max-w-[180px]">
                        {tooltip.point.stopName}
                    </div>
                    <div className="text-gray-500 text-[10px] mb-1">{tooltip.point.tripName}</div>
                    <div className="flex gap-2">
                        <span className="text-gray-400">Sched</span>
                        <span className="font-mono">{tooltip.point.scheduledDeparture}</span>
                    </div>
                    {tooltip.point.observedDeparture !== null && (
                        <div className="flex gap-2">
                            <span className="text-gray-400">Obs</span>
                            <span className="font-mono">{tooltip.point.observedDeparture}</span>
                        </div>
                    )}
                    {tooltip.point.deviationMinutes !== null && (
                        <div className="flex gap-2 mt-1">
                            <span className="text-gray-400">Dev</span>
                            <span className={`font-semibold ${tooltip.point.isLate ? 'text-red-600' : 'text-green-600'}`}>
                                {tooltip.point.deviationMinutes > 0 ? '+' : ''}{tooltip.point.deviationMinutes.toFixed(1)} min
                            </span>
                        </div>
                    )}
                    {(() => {
                        const ld = stopLoadLookup.get(`${routeId}_${tooltip.point.stopId}`);
                        if (!ld) return null;
                        return (
                            <div className="flex gap-2 mt-1 border-t border-gray-100 pt-1">
                                <span className="text-gray-400">Load</span>
                                <span>{ld.avgBoardings.toFixed(0)} boarding · {ld.avgLoad.toFixed(0)} on bus</span>
                            </div>
                        );
                    })()}
                </div>
            )}
        </div>
    );
};

export default CascadeTimelineChart;
