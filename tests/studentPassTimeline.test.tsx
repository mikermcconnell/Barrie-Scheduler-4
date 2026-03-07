import React from 'react';
import { describe, expect, it, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import StudentPassTimeline from '../components/Analytics/StudentPassTimeline';
import type { StudentPassResult } from '../utils/transit-app/studentPassUtils';
import type { StudentPassRouteLoadLookup } from '../utils/transit-app/studentPassLoadMetrics';

describe('StudentPassTimeline', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) {
      flushSync(() => {
        root?.unmount();
      });
    }
    container?.remove();
    root = null;
    container = null;
  });

  it('renders ride segments in a compact two-line layout with load stats', () => {
    const result: StudentPassResult = {
      found: true,
      isDirect: true,
      morningLegs: [
        {
          routeShortName: '7A',
          routeColor: '#F97316',
          tripId: 'trip-am-7a',
          fromStopId: 'from-stop',
          toStopId: 'to-stop',
          departureMinutes: 15 * 60 + 19,
          arrivalMinutes: 15 * 60 + 28,
          fromStop: 'Downtown Terminal',
          toStop: 'School Stop',
        },
      ],
      afternoonLegs: [],
    };

    const routeLoadLookup: StudentPassRouteLoadLookup = {
      dayType: 'weekday',
      byRouteHour: new Map([
        ['7A|15', { routeId: '7A', avgLoad: 12.4, observationDays: 8, source: 'route-hour', hour: 15 }],
      ]),
      byRoute: new Map(),
    };

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <StudentPassTimeline
          result={result}
          journeyMode="am"
          onJourneyModeChange={() => {}}
          routeLoadLookup={routeLoadLookup}
        />
      );
    });

    const text = container.textContent || '';
    expect(text).toContain('Rt 7A');
    expect(text).toContain('9m');
    expect(text).toContain('Load 12');
    expect(text).toContain('8d obs');
  });

  it('shows leave and arrive times including the final walk-home arrival in the afternoon timeline', () => {
    const result: StudentPassResult = {
      found: true,
      isDirect: false,
      morningLegs: [],
      afternoonLegs: [
        {
          routeShortName: '100',
          routeColor: '#FF0000',
          tripId: 'trip-pm-100',
          fromStopId: 'school-stop',
          toStopId: 'transfer-stop',
          departureMinutes: 14 * 60 + 34,
          arrivalMinutes: 14 * 60 + 46,
          fromStop: 'School Stop',
          toStop: 'Transfer Stop',
        },
        {
          routeShortName: '11',
          routeColor: '#A3C82D',
          tripId: 'trip-pm-11',
          fromStopId: 'transfer-stop',
          toStopId: 'ford-stop',
          departureMinutes: 14 * 60 + 52,
          arrivalMinutes: 15 * 60,
          fromStop: 'Transfer Stop',
          toStop: 'Ford Street',
        },
      ],
      afternoonTransfer: {
        quality: 'good',
        color: '#22C55E',
        label: 'Good connection',
        waitMinutes: 6,
      },
      walkFromSchool: {
        fromLat: 44.40,
        fromLon: -79.69,
        toLat: 44.401,
        toLon: -79.691,
        distanceKm: 0.3,
        walkMinutes: 11,
        label: 'Walk to stop',
      },
      walkToZone: {
        fromLat: 44.406,
        fromLon: -79.719,
        toLat: 44.405,
        toLon: -79.718,
        distanceKm: 0.45,
        walkMinutes: 6,
        label: 'Walk home',
      },
    };

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <StudentPassTimeline
          result={result}
          journeyMode="pm"
          onJourneyModeChange={() => {}}
        />
      );
    });

    const text = container.textContent || '';
    expect(text).toContain('Leave 2:23 PM');
    expect(text).toContain('Arrive 3:06 PM');
  });
});
