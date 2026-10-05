// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { STREETSRecord } from '../utils/performanceDataTypes';

const mocks = vi.hoisted(() => ({
  onDrop: null as null | ((files: File[]) => void),
  parseSTREETSFile: vi.fn(),
  getIdToken: vi.fn(),
}));

vi.mock('react-dropzone', () => ({
  useDropzone: ({ onDrop }: { onDrop: (files: File[]) => void }) => {
    mocks.onDrop = onDrop;
    return {
      getRootProps: () => ({}),
      getInputProps: () => ({}),
      isDragActive: false,
    };
  },
}));

vi.mock('../utils/performanceDataParser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/performanceDataParser')>()),
  parseSTREETSFile: mocks.parseSTREETSFile,
}));

vi.mock('../utils/firebase', () => ({
  auth: {
    currentUser: {
      getIdToken: mocks.getIdToken,
    },
  },
}));

import { PerformanceImport } from '../components/Performance/PerformanceImport';
import { parseSTREETSCSV } from '../functions/src/parser';

const record: STREETSRecord = {
  vehicleLocationTPKey: 1,
  vehicleId: 'Bus 1',
  inBetween: false,
  isTripper: false,
  date: '2026-01-01',
  month: '2026-01',
  day: 'THURSDAY',
  arrivalTime: '08:00',
  observedArrivalTime: '08:01:00',
  stopTime: '08:00',
  observedDepartureTime: '08:01:30',
  wheelchairUsageCount: 0,
  departureLoad: 12,
  boardings: 2,
  alightings: 1,
  apcSource: 1,
  block: '10-1',
  operatorId: 'operator-1',
  tripName: 'Trip 1',
  stopName: 'Main, at First',
  routeName: 'NORTH LOOP',
  branch: '10 FULL',
  routeId: '10',
  routeStopIndex: 1,
  stopId: '1001',
  direction: 'N',
  isDetour: false,
  stopLat: 44.38,
  stopLon: -79.69,
  timePoint: true,
  distance: 1.25,
  previousStopName: null,
  tripId: 'trip-1',
  internalTripId: 101,
  terminalDepartureTime: '08:00',
};

describe('PerformanceImport server publication boundary', () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    mocks.onDrop = null;
    mocks.parseSTREETSFile.mockReset();
    mocks.parseSTREETSFile.mockResolvedValue({ records: [record], warnings: [] });
    mocks.getIdToken.mockReset();
    mocks.getIdToken.mockResolvedValue('test-token');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));

    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  it('converts an Excel preview to CSV and submits it to the authenticated server importer', async () => {
    const onImportComplete = vi.fn();
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <PerformanceImport
            teamId="team-1"
            userId="user-1"
            onImportComplete={onImportComplete}
            onCancel={vi.fn()}
          />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      mocks.onDrop?.([new File(['workbook'], 'streets.xlsx')]);
      await Promise.resolve();
    });

    const importButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Import & Aggregate'));
    expect(importButton).toBeDefined();

    await act(async () => {
      importButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('teamId=team-1');
    expect(options?.headers).toEqual({
      Authorization: 'Bearer test-token',
      'Content-Type': 'text/csv',
    });

    const csv = options?.body as string;
    expect(parseSTREETSCSV(csv).records).toEqual([record]);
    expect(onImportComplete).toHaveBeenCalledTimes(1);
  });

  it('submits the normalized CSV preview instead of reparsing different raw date values on the server', async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <PerformanceImport
            teamId="team-1"
            userId="user-1"
            onImportComplete={vi.fn()}
            onCancel={vi.fn()}
          />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      mocks.onDrop?.([new File(['raw,csv,date,that,must,not,be,uploaded'], 'streets.csv')]);
      await Promise.resolve();
    });

    const importButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Import & Aggregate'));
    await act(async () => {
      importButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const [, options] = vi.mocked(fetch).mock.calls[0];
    const csv = options?.body as string;
    expect(csv).not.toContain('raw,csv,date,that,must,not,be,uploaded');
    expect(parseSTREETSCSV(csv).records).toEqual([record]);
  });
});
