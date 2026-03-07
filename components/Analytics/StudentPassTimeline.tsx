import React, { useMemo } from 'react';
import type { StudentPassResult } from '../../utils/transit-app/studentPassUtils';
import { minutesToDisplayTime } from '../../utils/transit-app/studentPassUtils';
import { getContrastingTextColor } from '../../utils/config/routeColors';
import type {
  StudentPassRouteLoadLookup,
  StudentPassRouteLoadMetric,
} from '../../utils/transit-app/studentPassLoadMetrics';
import {
  getStudentPassRouteLoadMetric,
  isStudentPassLoadMetricSmallSample,
} from '../../utils/transit-app/studentPassLoadMetrics';

interface StudentPassTimelineProps {
  result: StudentPassResult;
  journeyMode: 'am' | 'pm';
  onJourneyModeChange: (mode: 'am' | 'pm') => void;
  routeLoadLookup?: StudentPassRouteLoadLookup | null;
}

const TIMELINE_LEFT_OFFSET = 344;
const TIMELINE_SIDE_MARGIN = 16;
const TIMELINE_RIGHT_GUTTER = 24;

export interface TimelineSegment {
  type: 'walk' | 'ride' | 'transfer';
  durationMinutes: number;
  label: string;
  startMinutes?: number;
  endMinutes?: number;
  routeColor?: string;
  routeShortName?: string;
  index: number;
  loadMetric?: StudentPassRouteLoadMetric | null;
}

function applyBoundaryTimes(segments: TimelineSegment[]): TimelineSegment[] {
  const timedSegments = segments.map((segment) => ({ ...segment }));

  for (let i = 0; i < timedSegments.length; i++) {
    const segment = timedSegments[i];

    if (segment.startMinutes !== undefined && segment.endMinutes === undefined) {
      segment.endMinutes = segment.startMinutes + segment.durationMinutes;
    }

    if (segment.endMinutes !== undefined && segment.startMinutes === undefined) {
      segment.startMinutes = segment.endMinutes - segment.durationMinutes;
    }
  }

  for (let i = 1; i < timedSegments.length; i++) {
    const previous = timedSegments[i - 1];
    const segment = timedSegments[i];
    if (segment.startMinutes === undefined && previous.endMinutes !== undefined) {
      segment.startMinutes = previous.endMinutes;
      segment.endMinutes = previous.endMinutes + segment.durationMinutes;
    }
  }

  for (let i = timedSegments.length - 2; i >= 0; i--) {
    const next = timedSegments[i + 1];
    const segment = timedSegments[i];
    if (segment.endMinutes === undefined && next.startMinutes !== undefined) {
      segment.endMinutes = next.startMinutes;
      segment.startMinutes = next.startMinutes - segment.durationMinutes;
    }
  }

  return timedSegments;
}

export function buildMorningSegments(
  result: StudentPassResult,
  routeLoadLookup?: StudentPassRouteLoadLookup | null
): TimelineSegment[] {
  const segments: TimelineSegment[] = [];

  if (result.walkToStop) {
    const firstDepartureMinutes = result.morningLegs[0]?.departureMinutes;
    segments.push({
      type: 'walk',
      durationMinutes: result.walkToStop.walkMinutes,
      label: 'Walk',
      startMinutes: firstDepartureMinutes !== undefined
        ? firstDepartureMinutes - result.walkToStop.walkMinutes
        : undefined,
      endMinutes: firstDepartureMinutes,
      index: 0,
    });
  }

  result.morningLegs.forEach((leg, i) => {
    segments.push({
      type: 'ride',
      durationMinutes: leg.arrivalMinutes - leg.departureMinutes,
      label: leg.routeShortName,
      startMinutes: leg.departureMinutes,
      endMinutes: leg.arrivalMinutes,
      routeColor: leg.routeColor,
      routeShortName: leg.routeShortName,
      index: i,
      loadMetric: getStudentPassRouteLoadMetric(routeLoadLookup, leg.routeShortName, leg.departureMinutes),
    });

    if (i < result.morningLegs.length - 1) {
      const transferInfo = result.transfers?.[i] ?? result.transfer;
      if (transferInfo) {
        segments.push({
          type: 'transfer',
          durationMinutes: transferInfo.waitMinutes,
          label: `${transferInfo.waitMinutes}m wait`,
          startMinutes: leg.arrivalMinutes,
          endMinutes: leg.arrivalMinutes + transferInfo.waitMinutes,
          index: i,
        });
      }
    }
  });

  if (result.walkToSchool) {
    const finalArrivalMinutes = result.morningLegs[result.morningLegs.length - 1]?.arrivalMinutes;
    segments.push({
      type: 'walk',
      durationMinutes: result.walkToSchool.walkMinutes,
      label: 'Walk',
      startMinutes: finalArrivalMinutes,
      endMinutes: finalArrivalMinutes !== undefined
        ? finalArrivalMinutes + result.walkToSchool.walkMinutes
        : undefined,
      index: segments.length,
    });
  }

  return applyBoundaryTimes(segments);
}

export function buildAfternoonSegments(
  result: StudentPassResult,
  routeLoadLookup?: StudentPassRouteLoadLookup | null
): TimelineSegment[] {
  const segments: TimelineSegment[] = [];
  const transfers = result.afternoonTransfers?.length
    ? result.afternoonTransfers
    : result.afternoonTransfer
      ? [result.afternoonTransfer]
      : [];

  if (result.walkFromSchool) {
    const firstDepartureMinutes = result.afternoonLegs[0]?.departureMinutes;
    segments.push({
      type: 'walk',
      durationMinutes: result.walkFromSchool.walkMinutes,
      label: 'Walk',
      startMinutes: firstDepartureMinutes !== undefined
        ? firstDepartureMinutes - result.walkFromSchool.walkMinutes
        : undefined,
      endMinutes: firstDepartureMinutes,
      index: 0,
    });
  }

  result.afternoonLegs.forEach((leg, i) => {
    segments.push({
      type: 'ride',
      durationMinutes: leg.arrivalMinutes - leg.departureMinutes,
      label: leg.routeShortName,
      startMinutes: leg.departureMinutes,
      endMinutes: leg.arrivalMinutes,
      routeColor: leg.routeColor,
      routeShortName: leg.routeShortName,
      index: i,
      loadMetric: getStudentPassRouteLoadMetric(routeLoadLookup, leg.routeShortName, leg.departureMinutes),
    });

    if (i < result.afternoonLegs.length - 1) {
      const transferInfo = transfers[i];
      if (transferInfo) {
        segments.push({
          type: 'transfer',
          durationMinutes: transferInfo.waitMinutes,
          label: `${transferInfo.waitMinutes}m wait`,
          startMinutes: leg.arrivalMinutes,
          endMinutes: leg.arrivalMinutes + transferInfo.waitMinutes,
          index: i,
        });
      }
    }
  });

  if (result.walkToZone) {
    const finalArrivalMinutes = result.afternoonLegs[result.afternoonLegs.length - 1]?.arrivalMinutes;
    segments.push({
      type: 'walk',
      durationMinutes: result.walkToZone.walkMinutes,
      label: 'Walk',
      startMinutes: finalArrivalMinutes,
      endMinutes: finalArrivalMinutes !== undefined
        ? finalArrivalMinutes + result.walkToZone.walkMinutes
        : undefined,
      index: segments.length,
    });
  }

  return applyBoundaryTimes(segments);
}

export function resolveColor(raw: string | undefined): string {
  if (!raw) return '#3B5BDB';
  return raw.startsWith('#') ? raw : `#${raw}`;
}

export default function StudentPassTimeline({
  result,
  journeyMode,
  routeLoadLookup,
}: StudentPassTimelineProps) {
  if (!result?.found) return null;

  const morningSegments = useMemo(
    () => buildMorningSegments(result, routeLoadLookup),
    [result, routeLoadLookup]
  );
  const afternoonSegments = useMemo(
    () => buildAfternoonSegments(result, routeLoadLookup),
    [result, routeLoadLookup]
  );

  const segments = journeyMode === 'am' ? morningSegments : afternoonSegments;
  const totalMinutes = segments.reduce((sum, s) => sum + s.durationMinutes, 0);
  const modeLabel = journeyMode === 'am' ? 'Morning Journey' : 'Afternoon Journey';
  const departureMinutes = segments.find((segment) => segment.startMinutes !== undefined)?.startMinutes;
  const arrivalMinutes = [...segments].reverse().find((segment) => segment.endMinutes !== undefined)?.endMinutes;

  return (
    <div
      id="student-pass-timeline"
      className="absolute bottom-0 rounded-t-lg z-10 timeline-enter"
      style={{
        left: TIMELINE_LEFT_OFFSET,
        right: TIMELINE_RIGHT_GUTTER,
        marginLeft: TIMELINE_SIDE_MARGIN,
        marginRight: TIMELINE_SIDE_MARGIN,
        marginBottom: 16,
        background: 'var(--student-pass-panel)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid var(--student-pass-border)',
        borderBottom: 'none',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: '1px solid var(--student-pass-border-subtle)' }}>
        <span
          className="text-[14px] font-semibold uppercase tracking-wider"
          style={{ color: 'var(--student-pass-muted)', fontFamily: "'JetBrains Mono', monospace" }}
        >
          {modeLabel}
        </span>
        <span
          className="text-[14px]"
          style={{ color: 'var(--student-pass-muted)', fontFamily: "'JetBrains Mono', monospace" }}
        >
          {totalMinutes} min total
        </span>
      </div>

      {(departureMinutes !== undefined || arrivalMinutes !== undefined) && (
        <div
          className="flex items-center justify-between px-4 py-2"
          style={{ borderBottom: '1px solid var(--student-pass-border-subtle)' }}
        >
          <span
            className="text-[13px]"
            style={{ color: 'var(--student-pass-text)', fontFamily: "'JetBrains Mono', monospace" }}
          >
            {departureMinutes !== undefined ? `Leave ${minutesToDisplayTime(departureMinutes)}` : ''}
          </span>
          <span
            className="text-[13px]"
            style={{ color: 'var(--student-pass-text)', fontFamily: "'JetBrains Mono', monospace" }}
          >
            {arrivalMinutes !== undefined ? `Arrive ${minutesToDisplayTime(arrivalMinutes)}` : ''}
          </span>
        </div>
      )}

      {/* Segments bar */}
      <div className="flex items-stretch px-3 pt-3 pb-1 gap-0.5" style={{ minHeight: 64 }}>
        {segments.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-[14px]" style={{ color: 'var(--student-pass-muted)' }}>
            No {journeyMode === 'pm' ? 'afternoon' : 'morning'} trip data
          </div>
        ) : (
          segments.map((seg, idx) => {
            const flexValue = Math.max(seg.durationMinutes, 1);

            if (seg.type === 'walk') {
              return (
                <div
                  key={idx}
                  className="rounded flex flex-col items-center justify-center cursor-default"
                  style={{ flex: flexValue, minWidth: 40, background: 'var(--student-pass-blue-card-alt)' }}
                >
                  <span
                    className="text-[14px] font-semibold leading-none"
                    style={{ color: 'var(--student-pass-text)', fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    Walk
                  </span>
                  <span
                    className="text-[14px] leading-none mt-0.5"
                    style={{ color: 'var(--student-pass-muted)', fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    {seg.durationMinutes}m
                  </span>
                </div>
              );
            }

            if (seg.type === 'ride') {
              const hasSmallSample = isStudentPassLoadMetricSmallSample(seg.loadMetric);
              const backgroundColor = resolveColor(seg.routeColor);
              const foregroundColor = getContrastingTextColor(backgroundColor);
              const secondaryColor = foregroundColor === 'black' ? 'rgba(0,0,0,0.72)' : 'rgba(255,255,255,0.8)';
              const loadLabel = seg.loadMetric ? `Load ${Math.round(seg.loadMetric.avgLoad)}` : null;
              const otpLabel = seg.loadMetric?.otpOnTimePercent != null
                ? `OTP ${Math.round(seg.loadMetric.otpOnTimePercent)}%`
                : null;
              const sampleLabel = seg.loadMetric ? `${seg.loadMetric.observationDays}d obs` : null;
              const tooltipLines = [loadLabel, otpLabel, sampleLabel].filter(Boolean).join(' · ');

              return (
                <div
                  key={idx}
                  className="group relative rounded flex flex-col items-center justify-center cursor-default"
                  style={{
                    flex: flexValue,
                    minWidth: 40,
                    backgroundColor,
                    boxShadow: hasSmallSample ? 'inset 0 0 0 1px rgba(245, 158, 11, 0.9)' : undefined,
                  }}
                >
                  <span
                    className="text-[14px] font-bold leading-none"
                    style={{ color: foregroundColor, fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    Rt {seg.routeShortName}
                  </span>
                  <span
                    className="text-[13px] font-semibold leading-none mt-0.5"
                    style={{ color: secondaryColor, fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    {seg.durationMinutes}m
                  </span>
                  {tooltipLines && (
                    <div
                      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 rounded-md whitespace-nowrap
                        opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-150 z-30"
                      style={{
                        background: 'var(--student-pass-panel-strong)',
                        border: '1px solid var(--student-pass-border)',
                        fontFamily: "'JetBrains Mono', monospace",
                        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                      }}
                    >
                      <span className="text-[12px]" style={{ color: hasSmallSample ? '#FBBF24' : 'var(--student-pass-text)' }}>
                        {tooltipLines}
                      </span>
                    </div>
                  )}
                </div>
              );
            }

            // transfer
            return (
              <div
                key={idx}
                className="rounded flex flex-col items-center justify-center cursor-default border-dashed border border-[#F59E0B]"
                style={{ flex: flexValue, minWidth: 40, background: 'rgba(245, 158, 11, 0.06)' }}
              >
                <span
                  className="text-[14px] text-[#F59E0B] leading-none"
                  style={{ fontFamily: "'JetBrains Mono', monospace" }}
                >
                  {seg.durationMinutes}m
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Time labels below segments */}
      {segments.length > 0 && (
        <div className="flex px-3 pb-2 gap-0.5">
          {segments.map((seg, idx) => {
            const flexValue = Math.max(seg.durationMinutes, 1);
            const isLastSegment = idx === segments.length - 1;
            const startLabel =
              seg.startMinutes !== undefined ? minutesToDisplayTime(seg.startMinutes) : '';
            const endLabel =
              isLastSegment && seg.endMinutes !== undefined ? minutesToDisplayTime(seg.endMinutes) : '';
            return (
              <div
                key={idx}
                className="flex justify-between gap-2"
                style={{ flex: flexValue, minWidth: 40 }}
              >
                {startLabel && (
                  <span
                    className="text-[14px]"
                    style={{ color: 'var(--student-pass-muted)', fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    {startLabel}
                  </span>
                )}
                {endLabel && (
                  <span
                    className="text-[14px]"
                    style={{ color: 'var(--student-pass-muted)', fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    {endLabel}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
