import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpecializedTransitDatasetV1, SpecializedTransitParsedCommonLocations } from '../utils/specialized-transit/types';

const mocks = vi.hoisted(() => ({
  accessReports: vi.fn(),
  extractPdf: vi.fn(),
  findSpecializedTransitLocationCandidates: vi.fn(),
  resolveSpecializedTransitLocations: vi.fn(),
  clearLocalSpecializedTransitDataset: vi.fn(),
  saveSpecializedTransitDataset: vi.fn(),
  removeQueries: vi.fn(),
  setQueryData: vi.fn(),
  sourceFileFromExtract: vi.fn(),
  writeClipboard: vi.fn(),
  metadata: null as Record<string, unknown> | null,
  dataset: null as Record<string, unknown> | null,
}));

vi.mock('../utils/specialized-transit/localStore', () => ({
  accessLocalSpecializedTransitReports: mocks.accessReports,
}));

vi.mock('../components/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'manager-1' } }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ removeQueries: mocks.removeQueries, setQueryData: mocks.setQueryData }),
}));

vi.mock('../hooks/useSpecializedTransitData', () => ({
  useSpecializedTransitMetadataQuery: () => ({ data: mocks.metadata, isLoading: false, isError: false }),
  useSpecializedTransitDatasetQuery: () => ({ data: mocks.dataset, isLoading: false, isError: false }),
}));

vi.mock('../utils/specialized-transit/parser', () => ({
  extractPdf: mocks.extractPdf,
  normalizeSpecializedLocationName: (value: string) => value.trim(),
  parseMonthlySpecializedLines: () => ({
    reportMonth: '2026-08',
    reportedTrips: 2_840,
    priorYearPercent: 96,
  }),
  parseCommonLocationLines: (): SpecializedTransitParsedCommonLocations => ({
    reportMonth: '2026-08',
    serviceDateRange: { start: '2026-08-01', end: '2026-08-31' },
    commonLocationBookings: 2_588,
    dailyTotals: { '2026-08-01': 2_588 },
    hourlyTotals: { 8: 2_588 },
    activityBuckets: [{ date: '2026-08-01', hour: 8, locationId: 'city-hall', pickups: 2_588, dropoffs: 0 }],
    locations: {
      'city-hall': {
        id: 'city-hall',
        displayName: 'City Hall',
        normalizedName: 'CITY HALL',
        aliases: ['City Hall'],
        latitude: null,
        longitude: null,
        status: 'unmapped',
        coordinateSource: null,
        relevance: null,
      },
    },
    recurringDemand: {
      distinctClientIds: 300,
      medianBookingsPerClient: 6,
      thresholds: [],
    },
  }),
  sourceFileFromExtract: mocks.sourceFileFromExtract,
}));

vi.mock('../utils/specialized-transit/service', () => ({
  clearLocalSpecializedTransitDataset: mocks.clearLocalSpecializedTransitDataset,
  isLocalSpecializedTransitMode: () => true,
  saveSpecializedTransitDataset: mocks.saveSpecializedTransitDataset,
}));

vi.mock('../utils/specialized-transit/locationResolver', () => ({
  findSpecializedTransitLocationCandidates: mocks.findSpecializedTransitLocationCandidates,
  getSpecializedTransitCoordinateCollisionIds: () => new Set<string>(),
  resolveSpecializedTransitLocations: mocks.resolveSpecializedTransitLocations,
}));

vi.mock('../components/Performance/SpecializedTransitMap', () => ({
  SpecializedTransitMap: () => <div data-testid="specialized-transit-map" />,
}));

import { SpecializedTransitModule } from '../components/Performance/SpecializedTransitModule';

describe('SpecializedTransitModule report import', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    mocks.accessReports.mockReset().mockResolvedValue(null);
    mocks.extractPdf.mockReset();
    mocks.findSpecializedTransitLocationCandidates.mockReset();
    mocks.resolveSpecializedTransitLocations.mockReset();
    mocks.saveSpecializedTransitDataset.mockReset();
    mocks.setQueryData.mockReset();
    mocks.sourceFileFromExtract.mockReset();
    mocks.writeClipboard.mockReset();
    mocks.metadata = null;
    mocks.dataset = null;
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mocks.writeClipboard },
    });

    mocks.extractPdf
      .mockResolvedValueOnce({ lines: ['monthly'], pageCount: 1, sha256: 'monthly-sha' })
      .mockResolvedValueOnce({ lines: ['common'], pageCount: 393, sha256: 'common-sha' });
    mocks.sourceFileFromExtract
      .mockReturnValueOnce({ sha256: 'monthly-sha', pageCount: 1 })
      .mockReturnValueOnce({ sha256: 'common-sha', pageCount: 393 });
    mocks.resolveSpecializedTransitLocations.mockResolvedValue({
      geocodes: [],
      unresolved: [{ originId: 'city-hall', reason: 'no-candidate' }],
    });
    mocks.saveSpecializedTransitDataset.mockImplementation(async ({ months, locations }) => ({
      dataset: {
        schemaVersion: 1,
        revision: 1,
        updatedAt: '2026-09-01T12:00:00.000Z',
        updatedBy: 'manager-1',
        months,
        locations,
      },
      metadata: {
        schemaVersion: 1,
        activeRevision: 1,
        storagePath: 'teams/team-1/specializedTransitData/revision-1-test.json',
        availableMonths: ['2026-08'],
        latestMonth: '2026-08',
        updatedAt: '2026-09-01T12:00:00.000Z',
        updatedBy: 'manager-1',
      },
    }));
    mocks.setQueryData.mockImplementation((key: string[], value: Record<string, unknown>) => {
      if (key[0] === 'specializedTransitMetadata') mocks.metadata = value;
      if (key[0] === 'specializedTransitDataset') mocks.dataset = value;
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(
      <SpecializedTransitModule teamId="team-1" canManage includedDates={[]} />,
    ));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function importReports() {
    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="file"]');
    for (const [index, name] of ['monthly.pdf', 'common.pdf'].entries()) {
      Object.defineProperty(inputs[index], 'files', { configurable: true, value: [new File(['pdf'], name)] });
      act(() => inputs[index].dispatchEvent(new Event('change', { bubbles: true })));
    }
    const publish = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Parse and view locally')!;
    await act(async () => publish.click());
  }

  it('ignores suggestions from an earlier location after switching the review draft', async () => {
    await importReports();
    const dataset = mocks.dataset as unknown as SpecializedTransitDatasetV1;
    dataset.locations.library = {
      ...dataset.locations['city-hall'], id: 'library', displayName: 'Library', normalizedName: 'LIBRARY', aliases: ['Library'],
    };
    dataset.months['2026-08'].activityBuckets.push({ date: '2026-08-01', hour: 8, locationId: 'library', pickups: 1, dropoffs: 0 });
    mocks.dataset = { ...dataset };
    await act(async () => root.render(<SpecializedTransitModule teamId="team-1" canManage />));
    act(() => container.querySelector('details summary')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const review = (name: string) => Array.from(container.querySelectorAll('tr')).find(row => row.textContent?.includes(name))!.querySelector('button')!;
    let finish!: (candidates: unknown[]) => void;
    mocks.findSpecializedTransitLocationCandidates.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await act(async () => review('City Hall').click());
    const find = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Find suggestions'))!;
    await act(async () => find.click());
    expect(mocks.findSpecializedTransitLocationCandidates).toHaveBeenCalledWith({ id: 'city-hall', label: 'City Hall' });
    await act(async () => review('Library').click());
    await act(async () => finish([{ displayName: 'STALE City Hall candidate', source: 'known-place', latitude: 44.39, longitude: -79.69, semanticScore: 1, trusted: true }]));
    expect(container.textContent).not.toContain('STALE City Hall candidate');
    const editor = (label: string) => Array.from(container.querySelectorAll('label')).find(element => element.textContent?.startsWith(label))!.querySelector('input')!;
    expect(editor('Display name').value).toBe('Library');
    expect(editor('Latitude').value).toBe('');
    expect(editor('Longitude').value).toBe('');
  });

  it('preserves a reviewed merge when a changed report imports the original alias again', async () => {
    await importReports();
    const dataset = mocks.dataset as unknown as SpecializedTransitDatasetV1;
    dataset.locations.canonical = {
      ...dataset.locations['city-hall'], id: 'canonical', displayName: 'Municipal Centre', normalizedName: 'MUNICIPAL CENTRE',
      aliases: ['Municipal Centre'], latitude: 44.39, longitude: -79.69, status: 'reviewed', coordinateSource: 'manual',
    };
    mocks.dataset = { ...dataset };
    await act(async () => root.render(<SpecializedTransitModule teamId="team-1" canManage />));
    act(() => container.querySelector('details summary')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const review = Array.from(container.querySelectorAll('tr')).find(row => row.textContent?.includes('City Hall'))!.querySelector('button')!;
    await act(async () => review.click());
    const merge = Array.from(container.querySelectorAll('label')).find(label => label.textContent?.includes('Merge this alias'))!.querySelector('select')!;
    act(() => { merge.value = 'canonical'; merge.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Merge and save revision')!.click());
    expect((mocks.dataset as unknown as SpecializedTransitDatasetV1).locations['city-hall']).toBeUndefined();
    mocks.resolveSpecializedTransitLocations.mockClear();
    mocks.extractPdf.mockResolvedValueOnce({ lines: ['monthly'] }).mockResolvedValueOnce({ lines: ['common'] });
    mocks.sourceFileFromExtract.mockReturnValueOnce({ sha256: 'changed-monthly', pageCount: 1 }).mockReturnValueOnce({ sha256: 'changed-common', pageCount: 2 });
    await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Import reports'))!.click());
    await importReports();
    const saved = mocks.saveSpecializedTransitDataset.mock.calls.at(-1)![0];
    expect(saved.locations['city-hall']).toBeUndefined();
    expect(saved.locations.canonical).toMatchObject({ status: 'reviewed', latitude: 44.39, longitude: -79.69 });
    expect(saved.months['2026-08'].activityBuckets).toEqual([{ date: '2026-08-01', hour: 8, locationId: 'canonical', pickups: 2588, dropoffs: 0 }]);
    expect(mocks.resolveSpecializedTransitLocations).not.toHaveBeenCalled();
  });

  it('restores saved PDFs on reopening so they can be parsed without selecting files again', async () => {
    act(() => root.unmount());
    const file = (name: string) => ({ name, type: 'application/pdf', lastModified: 123, bytes: new ArrayBuffer(4) });
    mocks.accessReports.mockResolvedValueOnce({ monthly: file('saved-monthly.pdf'), common: file('saved-common.pdf') });
    root = createRoot(container);
    await act(async () => root.render(<SpecializedTransitModule teamId="team-1" canManage includedDates={['2026-09-21']} />));
    expect(container.textContent).toContain('saved-monthly.pdf');
    expect(container.textContent).toContain('saved-common.pdf');
    expect(container.textContent).toContain('Saved report files restored');
    const publish = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Parse and view locally')!;
    expect(publish.disabled).toBe(false);
    await act(async () => publish.click());
    expect(mocks.extractPdf.mock.calls[0][0].name).toBe('saved-monthly.pdf');
    expect(mocks.saveSpecializedTransitDataset).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain('06:00–09:59');
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      const clear = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Clear local data'))!;
      await act(async () => clear.click());
      expect(container.textContent).toContain('Selected: saved-monthly.pdf');
      expect(container.textContent).toContain('Selected: saved-common.pdf');
      expect(mocks.accessReports).not.toHaveBeenCalledWith('team-1', 'manager-1', 'clear');
    } finally {
      confirmation.mockRestore();
    }
  });

  it('saves selected source files and reports a failed save without claiming success', async () => {
    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="file"]');
    const bytes = new ArrayBuffer(8);
    for (const [index, name] of ['monthly.pdf', 'common.pdf'].entries()) {
      const report = new File(['pdf data'], name, { type: 'application/pdf' });
      Object.defineProperty(report, 'arrayBuffer', { value: async () => bytes });
      Object.defineProperty(inputs[index], 'files', { configurable: true, value: [report] });
      act(() => inputs[index].dispatchEvent(new Event('change', { bubbles: true })));
    }
    const save = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Save report files')!;
    await act(async () => save.click());
    expect(mocks.accessReports).toHaveBeenCalledWith('team-1', 'manager-1', 'save', {
      monthly: expect.objectContaining({ name: 'monthly.pdf', bytes }),
      common: expect.objectContaining({ name: 'common.pdf', bytes }),
    });
    expect(container.textContent).toContain('Report files saved in this browser.');
    mocks.accessReports.mockRejectedValueOnce(new Error('Storage quota exceeded'));
    await act(async () => save.click());
    expect(container.textContent).toContain('Storage quota exceeded');
    expect(container.textContent).not.toContain('Report files saved in this browser.');
    const remove = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Remove saved files')!;
    await act(async () => remove.click());
    expect(mocks.accessReports).toHaveBeenLastCalledWith('team-1', 'manager-1', 'clear');
    expect(container.textContent).not.toContain('Selected: monthly.pdf');
  });

  it('treats Parse and view locally as the single approval and saves the aggregate immediately', async () => {
    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="file"]');
    const monthlyReport = new File(['monthly'], 'Monthly Ridership Report - 08.2026.pdf', { type: 'application/pdf' });
    const commonLocations = new File(['common'], 'Ridership by Common locations report.pdf', { type: 'application/pdf' });

    Object.defineProperty(inputs[0], 'files', { configurable: true, value: [monthlyReport] });
    Object.defineProperty(inputs[1], 'files', { configurable: true, value: [commonLocations] });
    act(() => {
      inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
      inputs[1].dispatchEvent(new Event('change', { bubbles: true }));
    });

    const publishButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === 'Parse and view locally') as HTMLButtonElement;
    expect(publishButton).toBeDefined();
    expect(container.textContent).not.toContain('Publish aggregate');

    await act(async () => {
      publishButton.click();
      await new Promise(resolve => setTimeout(resolve, 0));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(mocks.saveSpecializedTransitDataset).toHaveBeenCalledOnce();
    expect(mocks.resolveSpecializedTransitLocations).toHaveBeenCalledOnce();
    expect(mocks.saveSpecializedTransitDataset).toHaveBeenCalledWith(expect.objectContaining({
      teamId: 'team-1',
      userId: 'manager-1',
      expectedRevision: 0,
      months: {
        '2026-08': expect.objectContaining({
          reconciliationGap: 252,
          reconciliationNote: 'Common-location export is a subset of the reported monthly total.',
        }),
      },
    }));
    expect(mocks.setQueryData).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('Privacy-safe report import');
    expect(container.textContent).not.toContain('Publish aggregate');
    expect(container.querySelector('[data-testid="specialized-transit-map"]')).not.toBeNull();
  });

  it('resolves legacy and unmapped locations while preserving reviewed and permanent coordinates', async () => {
    const makeLocation = (id: string, status: 'unmapped' | 'automatic' | 'reviewed') => ({
      id,
      displayName: id === 'auto' ? 'Parkview Senior Ctr.' : id,
      normalizedName: id,
      aliases: [id],
      latitude: status === 'unmapped' ? null : 44.39,
      longitude: status === 'unmapped' ? null : id === 'reviewed' ? -79.69 : -79.68,
      status,
      coordinateSource: status === 'unmapped' ? null : status === 'reviewed' ? 'manual' : 'mapbox',
      relevance: status === 'unmapped' ? null : 1,
    });
    mocks.metadata = {
      schemaVersion: 1,
      activeRevision: 4,
      storagePath: 'local-specialized-transit://team-1/revision-4',
      availableMonths: ['2026-08'],
      latestMonth: '2026-08',
      updatedAt: '2026-09-01T12:00:00.000Z',
      updatedBy: 'manager-1',
    };
    mocks.dataset = {
      schemaVersion: 1,
      revision: 4,
      updatedAt: '2026-09-01T12:00:00.000Z',
      updatedBy: 'manager-1',
      locations: {
        auto: makeLocation('auto', 'automatic'),
        unresolved: makeLocation('unresolved', 'unmapped'),
        reviewed: makeLocation('reviewed', 'reviewed'),
        permanent: {
          ...makeLocation('permanent', 'automatic'),
          coordinateSource: 'mapbox-permanent',
        },
      },
      months: {
        '2026-08': {
          reportMonth: '2026-08',
          reportedTrips: 3,
          priorYearPercent: 100,
          commonLocationBookings: 3,
          commonLocationCoverage: 1,
          reconciliationGap: 0,
          reconciliationStatus: 'reconciled',
          reconciliationNote: '',
          serviceDateRange: { start: '2026-08-01', end: '2026-08-01' },
          dailyTotals: { '2026-08-01': 3 },
          hourlyTotals: { 8: 3 },
          activityBuckets: [
            { date: '2026-08-01', hour: 8, locationId: 'auto', pickups: 1, dropoffs: 0 },
            { date: '2026-08-01', hour: 8, locationId: 'unresolved', pickups: 1, dropoffs: 0 },
            { date: '2026-08-01', hour: 8, locationId: 'reviewed', pickups: 1, dropoffs: 0 },
          ],
          recurringDemand: { distinctClientIds: 1, medianBookingsPerClient: 3, thresholds: [] },
          sources: {
            monthlyReport: { sha256: 'a'.repeat(64), pageCount: 1 },
            commonLocationsReport: { sha256: 'b'.repeat(64), pageCount: 1 },
          },
          importedAt: '2026-09-01T12:00:00.000Z',
          importedBy: 'manager-1',
        },
      },
    };
    mocks.resolveSpecializedTransitLocations.mockResolvedValue({
      geocodes: [{ originId: 'auto', latitude: 44.394843, longitude: -79.665582, relevance: 1, source: 'known-place' }],
      unresolved: [{ originId: 'unresolved', reason: 'no-candidate' }],
    });
    await act(async () => root.render(
      <SpecializedTransitModule teamId="team-1" canManage includedDates={[]} />,
    ));

    const recheckButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Resolve unmapped locations')) as HTMLButtonElement;
    await act(async () => {
      recheckButton.click();
      await new Promise(resolve => setTimeout(resolve, 0));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(mocks.resolveSpecializedTransitLocations).toHaveBeenCalledWith([
      { id: 'auto', label: 'Parkview Senior Ctr.' },
      { id: 'unresolved', label: 'unresolved' },
    ], expect.any(Object));
    expect(mocks.saveSpecializedTransitDataset).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevision: 4,
      locations: expect.objectContaining({
        auto: expect.objectContaining({ coordinateSource: 'known-place', status: 'automatic' }),
        unresolved: expect.objectContaining({ latitude: null, status: 'unmapped' }),
        reviewed: expect.objectContaining({ coordinateSource: 'manual', status: 'reviewed' }),
        permanent: expect.objectContaining({ coordinateSource: 'mapbox-permanent', status: 'automatic' }),
      }),
    }));

    const copyButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Copy unmapped list')) as HTMLButtonElement;
    await act(async () => {
      copyButton.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(mocks.writeClipboard).toHaveBeenCalledOnce();
    expect(mocks.writeClipboard.mock.calls[0][0]).toContain('unresolved | 1 endpoint touches | ID unresolved');
    expect(mocks.writeClipboard.mock.calls[0][0]).not.toContain('reviewed |');
    expect(mocks.writeClipboard.mock.calls[0][0]).not.toContain('permanent |');
  });
});
