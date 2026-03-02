import React, { useMemo, useState, useRef } from 'react';
import type { CascadeAffectedTrip } from '../../utils/performanceDataTypes';
import { buildTimelinePoints, type TimelinePoint } from '../../utils/schedule/cascadeStoryUtils';

interface CascadeTimelineChartProps {
    trips: CascadeAffectedTrip[];
    selectedTripIndex: number | null;
    onSelectPoint: (pointIndex: number | null) => void;
}

interface TooltipState {
    x: number;
    y: number;
    point: TimelinePoint;
}

const OTP_LATE_MINUTES = 5;

const CascadeTimelineChart: React.FC<CascadeTimelineChartProps> = ({
    trips,
    selectedTripIndex,
    onSelectPoint,
}) => {
    const [tooltip, setTooltip] = useState<TooltipState | null>(null);
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const prevSelectedRef = useRef<number | null>(null);

    const points = useMemo(() => buildTimelinePoints(trips), [trips]);

    if (points.length === 0) {
        return (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
                No timepoint data
            </div>
        );
    }

    const marginTop = 20;
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

    // Build area polygon points string
    const areaPoints: string[] = [];
    // Start at baseline of first point
    areaPoints.push(`${xOf(0)},${yBaseline}`);
    for (let i = 0; i < points.length; i++) {
        const dev = points[i].deviationMinutes ?? 0;
        areaPoints.push(`${xOf(i)},${yOf(Math.max(dev, 0))}`);
    }
    // End at baseline of last point
    areaPoints.push(`${xOf(points.length - 1)},${yBaseline}`);

    // Build line path
    const lineParts: string[] = [];
    for (let i = 0; i < points.length; i++) {
        const dev = points[i].deviationMinutes ?? 0;
        const cmd = i === 0 ? 'M' : 'L';
        lineParts.push(`${cmd}${xOf(i)},${yOf(Math.max(dev, 0))}`);
    }
    const linePath = lineParts.join(' ');

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

    // Mouse tracking
    const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Find nearest point by x-distance
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

                {/* Trip boundary lines and labels */}
                {points.map((p, i) => {
                    if (!p.isTripStart) return null;
                    if (i === 0) {
                        // First trip label above first point
                        return (
                            <text
                                key={`trip-label-${i}`}
                                x={xOf(i)}
                                y={marginTop - 6}
                                textAnchor="middle"
                                fontSize={9}
                                fill="#6b7280"
                                fontWeight={500}
                            >
                                {p.tripName}
                            </text>
                        );
                    }
                    return (
                        <g key={`trip-boundary-${i}`}>
                            <line
                                x1={xOf(i)}
                                y1={marginTop}
                                x2={xOf(i)}
                                y2={yBaseline}
                                stroke="#9ca3af"
                                strokeWidth={1}
                                strokeDasharray="3 3"
                            />
                            <text
                                x={xOf(i)}
                                y={marginTop - 6}
                                textAnchor="middle"
                                fontSize={9}
                                fill="#6b7280"
                                fontWeight={500}
                            >
                                {p.tripName}
                            </text>
                        </g>
                    );
                })}

                {/* Red filled area */}
                <polygon
                    points={areaPoints.join(' ')}
                    fill="#fecaca"
                    opacity={0.4}
                />

                {/* Red deviation line */}
                <path
                    d={linePath}
                    fill="none"
                    stroke="#ef4444"
                    strokeWidth={2}
                    strokeLinejoin="round"
                />

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

                {/* Data point circles */}
                {points.map((p, i) => {
                    const cx = xOf(i);
                    const dev = p.deviationMinutes;
                    const isSelected = selectedTripIndex !== null && p.tripIndex !== selectedTripIndex;
                    const isHovered = hoveredIndex === i;
                    const r = isHovered ? 5 : 3.5;

                    if (dev === null) {
                        // Null deviation: gray circle at baseline
                        return (
                            <circle
                                key={`dot-${i}`}
                                cx={cx}
                                cy={yBaseline}
                                r={r}
                                fill="#9ca3af"
                                opacity={isSelected ? 0.3 : 0.6}
                            />
                        );
                    }

                    const cy = yOf(Math.max(dev, 0));
                    const fill = p.isLate ? '#ef4444' : '#22c55e';

                    return (
                        <circle
                            key={`dot-${i}`}
                            cx={cx}
                            cy={cy}
                            r={r}
                            fill={fill}
                            opacity={isSelected ? 0.3 : 1}
                        />
                    );
                })}

                {/* Recovery markers: green checkmark circle */}
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
                            {/* Checkmark path inside circle */}
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
            </svg>

            {/* Tooltip */}
            {tooltip && (
                <div
                    className="absolute z-10 pointer-events-none bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs text-gray-700"
                    style={{
                        left: tooltip.x + 12,
                        top: tooltip.y - 10,
                        maxWidth: 200,
                        // Flip left if near right edge
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
                </div>
            )}
        </div>
    );
};

export default CascadeTimelineChart;
