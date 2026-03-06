import React, { useMemo } from 'react';
import type { StudentPassResult } from '../../utils/transit-app/studentPassUtils';
import { minutesToDisplayTime } from '../../utils/transit-app/studentPassUtils';

interface StudentPassTimelineProps {
  result: StudentPassResult;
  journeyMode: 'am' | 'pm';
  onJourneyModeChange: (mode: 'am' | 'pm') => void;
}

interface TimelineSegment {
  type: 'walk' | 'ride' | 'transfer';
  durationMinutes: number;
  label: string;
  startMinutes?: number;
  endMinutes?: number;
  routeColor?: string;
  routeShortName?: string;
  index: number;
}

function buildMorningSegments(result: StudentPassResult): TimelineSegment[] {
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

function buildAfternoonSegments(result: StudentPassResult): TimelineSegment[] {
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

function resolveColor(raw: string | undefined): string {
  if (!raw) return '#3B5BDB';
  return raw.startsWith('#') ? raw : `#${raw}`;
}

export default function StudentPassTimeline({
  result,
  journeyMode,
}: StudentPassTimelineProps) {
  if (!result?.found) return null;

  const morningSegments = useMemo(() => buildMorningSegments(result), [result]);
  const afternoonSegments = useMemo(() => buildAfternoonSegments(result), [result]);

  const segments = journeyMode === 'am' ? morningSegments : afternoonSegments;
  const totalMinutes = segments.reduce((sum, s) => sum + s.durationMinutes, 0);
  const modeLabel = journeyMode === 'am' ? 'Morning Journey' : 'Afternoon Journey';

  return (
    <div
      className="absolute bottom-0 left-0 right-0 mx-4 mb-4 rounded-t-lg z-10 timeline-enter"
      style={{
        background: 'rgba(11, 17, 33, 0.9)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(99, 126, 184, 0.12)',
        borderBottom: 'none',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[rgba(99,126,184,0.12)]">
        <span
          className="text-[12px] font-semibold uppercase tracking-wider text-[#94A3B8]"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          {modeLabel}
        </span>
        <span
          className="text-[12px] text-[#94A3B8]"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          {totalMinutes} min total
        </span>
      </div>

      {/* Segments bar */}
      <div className="flex items-stretch px-3 pt-3 pb-1 gap-0.5" style={{ minHeight: 52 }}>
        {segments.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-[12px] text-[#94A3B8]">
            No {journeyMode === 'pm' ? 'afternoon' : 'morning'} trip data
          </div>
        ) : (
          segments.map((seg, idx) => {
            const flexValue = Math.max(seg.durationMinutes, 1);

            if (seg.type === 'walk') {
              return (
                <div
                  key={idx}
                  className="bg-[#1A2540] rounded flex flex-col items-center justify-center cursor-default"
                  style={{ flex: flexValue, minWidth: 40 }}
                >
                  <span
                    className="text-[12px] font-semibold text-[#94A3B8] leading-none"
                    style={{ fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    Walk
                  </span>
                  <span
                    className="text-[12px] text-[#94A3B8] leading-none mt-0.5"
                    style={{ fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    {seg.durationMinutes}m
                  </span>
                </div>
              );
            }

            if (seg.type === 'ride') {
              return (
                <div
                  key={idx}
                  className="rounded flex flex-col items-center justify-center cursor-default"
                  style={{ flex: flexValue, minWidth: 40, backgroundColor: resolveColor(seg.routeColor) }}
                >
                  <span
                    className="text-[12px] font-bold text-white leading-none"
                    style={{ fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    Rt {seg.routeShortName}
                  </span>
                  <span
                    className="text-[12px] text-white/70 leading-none mt-0.5"
                    style={{ fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    {seg.durationMinutes}m
                  </span>
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
                  className="text-[12px] text-[#F59E0B] leading-none"
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
                    className="text-[12px] text-[#94A3B8]"
                    style={{ fontFamily: "'JetBrains Mono', monospace" }}
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
