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

export function buildMorningSegments(
  result: StudentPassResult,
  routeLoadLookup?: StudentPassRouteLoadLookup | null
): TimelineSegment[] {
  const segments: TimelineSegment[] = [];

  if (result.walkToStop) {
    segments.push({
      type: 'walk',
      durationMinutes: result.walkToStop.walkMinutes,
      label: 'Walk',
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
          index: i,
        });
      }
    }
  });

  if (result.walkToSchool) {
    segments.push({
      type: 'walk',
      durationMinutes: result.walkToSchool.walkMinutes,
      label: 'Walk',
      index: segments.length,
    });
  }

  return segments;
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
    segments.push({
      type: 'walk',
      durationMinutes: result.walkFromSchool.walkMinutes,
      label: 'Walk',
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
          index: i,
        });
      }
    }
  });

  if (result.walkToZone) {
    segments.push({
      type: 'walk',
      durationMinutes: result.walkToZone.walkMinutes,
      label: 'Walk',
      index: segments.length,
    });
  }

  return segments;
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

  return (
    <div
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
              const tertiaryColor = foregroundColor === 'black' ? 'rgba(0,0,0,0.58)' : 'rgba(255,255,255,0.65)';
              const loadLabel = seg.loadMetric ? `Load ${Math.round(seg.loadMetric.avgLoad)}` : 'Load n/a';
              const sampleLabel = seg.loadMetric ? `${seg.loadMetric.observationDays}d obs` : '';

              return (
                <div
                  key={idx}
                  className="rounded flex flex-col items-center justify-center cursor-default"
                  style={{
                    flex: flexValue,
                    minWidth: 40,
                    backgroundColor,
                    boxShadow: hasSmallSample ? 'inset 0 0 0 1px rgba(245, 158, 11, 0.9)' : undefined,
                  }}
                >
                  <div
                    className="flex items-center justify-center gap-1.5 leading-none"
                    style={{ fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    <span className="text-[14px] font-bold" style={{ color: foregroundColor }}>
                      Rt {seg.routeShortName}
                    </span>
                    <span className="text-[13px] font-semibold" style={{ color: secondaryColor }}>
                      {seg.durationMinutes}m
                    </span>
                  </div>
                  <div
                    className="flex items-center justify-center gap-1.5 leading-none mt-1"
                    style={{ fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    <span
                      className="text-[12px]"
                      style={{ color: hasSmallSample ? '#92400E' : secondaryColor }}
                    >
                      {loadLabel}
                    </span>
                    {sampleLabel && (
                      <span
                        className="text-[12px]"
                        style={{ color: hasSmallSample ? '#92400E' : tertiaryColor }}
                      >
                        {sampleLabel}
                      </span>
                    )}
                  </div>
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
            const timeLabel =
              seg.startMinutes !== undefined ? minutesToDisplayTime(seg.startMinutes) : '';
            return (
              <div
                key={idx}
                className="flex justify-start"
                style={{ flex: flexValue, minWidth: 40 }}
              >
                {timeLabel && (
                  <span
                    className="text-[14px]"
                    style={{ color: 'var(--student-pass-muted)', fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    {timeLabel}
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
