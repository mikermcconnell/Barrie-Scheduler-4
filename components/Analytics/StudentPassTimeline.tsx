import React from 'react';
import type { StudentPassResult } from '../../utils/transit-app/studentPassUtils';
import { minutesToDisplayTime } from '../../utils/transit-app/studentPassUtils';

interface StudentPassTimelineProps {
  result: StudentPassResult;
  onSegmentHover?: (segmentType: 'walk' | 'ride' | 'transfer' | null, index?: number) => void;
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

export default function StudentPassTimeline({ result, onSegmentHover }: StudentPassTimelineProps) {
  if (!result?.found) return null;

  const segments: TimelineSegment[] = [];

  // 1. Walk to stop
  if (result.walkToStop) {
    segments.push({
      type: 'walk',
      durationMinutes: result.walkToStop.walkMinutes,
      label: 'Walk',
      index: 0,
    });
  }

  // 2. Morning legs with transfers between them
  result.morningLegs.forEach((leg, i) => {
    const rideDuration = leg.arrivalMinutes - leg.departureMinutes;
    segments.push({
      type: 'ride',
      durationMinutes: rideDuration,
      label: leg.routeShortName,
      startMinutes: leg.departureMinutes,
      endMinutes: leg.arrivalMinutes,
      routeColor: leg.routeColor,
      routeShortName: leg.routeShortName,
      index: i,
    });

    // Insert transfer after each leg except the last
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

  // 3. Walk to school
  if (result.walkToSchool) {
    segments.push({
      type: 'walk',
      durationMinutes: result.walkToSchool.walkMinutes,
      label: 'Walk',
      index: segments.length,
    });
  }

  const totalMinutes = segments.reduce((sum, s) => sum + s.durationMinutes, 0);

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
          className="text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          Morning Journey
        </span>
        <span
          className="text-[12px] text-[#64748B]"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          Total: {totalMinutes} min
        </span>
      </div>

      {/* Segments bar */}
      <div className="flex items-stretch px-3 pt-3 pb-1 gap-0.5" style={{ minHeight: 52 }}>
        {segments.map((seg, idx) => {
          const flexValue = Math.max(seg.durationMinutes, 1);

          if (seg.type === 'walk') {
            return (
              <div
                key={idx}
                className="bg-[#1A2540] rounded flex flex-col items-center justify-center cursor-default"
                style={{ flex: flexValue, minWidth: 40 }}
                onMouseEnter={() => onSegmentHover?.('walk', seg.index)}
                onMouseLeave={() => onSegmentHover?.(null)}
              >
                <span className="text-[11px] text-[#64748B] leading-none">🚶</span>
                <span
                  className="text-[10px] text-[#64748B] leading-none mt-0.5"
                  style={{ fontFamily: "'JetBrains Mono', monospace" }}
                >
                  {seg.durationMinutes}m
                </span>
              </div>
            );
          }

          if (seg.type === 'ride') {
            const bgColor = seg.routeColor
              ? seg.routeColor.startsWith('#')
                ? seg.routeColor
                : `#${seg.routeColor}`
              : '#3B5BDB';
            return (
              <div
                key={idx}
                className="rounded flex flex-col items-center justify-center cursor-default"
                style={{ flex: flexValue, minWidth: 40, backgroundColor: bgColor }}
                onMouseEnter={() => onSegmentHover?.('ride', seg.index)}
                onMouseLeave={() => onSegmentHover?.(null)}
              >
                <span
                  className="text-[11px] font-bold text-white leading-none"
                  style={{ fontFamily: "'JetBrains Mono', monospace" }}
                >
                  {seg.routeShortName}
                </span>
                <span
                  className="text-[10px] text-white/70 leading-none mt-0.5"
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
              onMouseEnter={() => onSegmentHover?.('transfer', seg.index)}
              onMouseLeave={() => onSegmentHover?.(null)}
            >
              <span
                className="text-[10px] text-[#F59E0B] leading-none"
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
              >
                {seg.durationMinutes}m
              </span>
            </div>
          );
        })}
      </div>

      {/* Time labels below segments */}
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
                  className="text-[10px] text-[#64748B]"
                  style={{ fontFamily: "'JetBrains Mono', monospace" }}
                >
                  {timeLabel}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
