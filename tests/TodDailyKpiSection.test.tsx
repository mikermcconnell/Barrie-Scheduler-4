import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

vi.mock('../components/Analytics/AnalyticsShared', () => ({
  ChartCard: ({ title, children }: { title: string; children?: React.ReactNode }) => <section><h3>{title}</h3>{children}</section>,
}));
vi.mock('../components/contexts/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'user-1' } }) }));
vi.mock('../components/contexts/TeamContext', () => ({ useTeam: () => ({ team: { id: 'team-1' }, canManageTeam: true }) }));
vi.mock('../hooks/useTodPickupData', () => ({
  useTodPickupMetadataQuery: () => ({ data: { storagePath: 'test.json' }, isLoading: false }),
  useTodPickupDataQuery: () => ({
    isLoading: false,
    data: {
      dailyReports: [
        {
          date: '2026-08-22', totalCompletedTrips: 100, totalDropoffs: 100,
          locations: [{ id: 'stop-1', name: 'Stop 1', lat: 44.38, lon: -79.69, pickups: 100, dropoffs: 100 }],
        },
        {
          date: '2026-08-23', totalCompletedTrips: 126, totalDropoffs: 126,
          locations: [{ id: 'stop-1', name: 'Stop 1', lat: 44.38, lon: -79.69, pickups: 126, dropoffs: 126 }],
        },
      ],
    },
  }),
  useSaveTodDailyKpi: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock('recharts', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Empty = (): null => null;
  return { ResponsiveContainer: Pass, LineChart: Pass, Line: Empty, XAxis: Empty, YAxis: Empty, Tooltip: Empty };
});

import { TodDailyKpiSection } from '../components/Performance/TodDailyKpiSection';

describe('TodDailyKpiSection', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
  });

  it('uses only reports included by the Ridership period', () => {
    flushSync(() => root.render(<TodDailyKpiSection includedDates={['2026-08-23']} />));

    expect(container.textContent).toContain('Transit On Demand Ridership');
    expect(container.textContent).toContain('126');
    expect(container.textContent).toContain('1 imported day');
    expect(container.textContent).not.toContain('226');
  });
});
