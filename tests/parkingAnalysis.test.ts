import { describe, expect, it } from 'vitest';
import { buildParkingPlannerAnalysis, buildParkingTrendOverview } from '../utils/parking/parkingAnalysis';
import type {
  ParkingRevenueAnalytics,
  ParkingRevenueLocationSummary,
  ParkingRevenueRawRow,
  ParkingRevenueTrendPoint,
} from '../utils/parking/parkingTypes';

function row(patch: Partial<ParkingRevenueRawRow>): ParkingRevenueRawRow {
  return {
    id: patch.id || 'row',
    source: patch.source || 'hotspot',
    sourceId: patch.sourceId ?? '100',
    sourceLabel: patch.sourceLabel ?? 'Lot',
    physicalLocationId: patch.physicalLocationId ?? null,
    physicalLocationName: patch.physicalLocationName ?? patch.sourceLabel ?? 'Lot',
    plate: patch.plate ?? 'ABC123',
    hasMissingPlate: patch.hasMissingPlate || false,
    startRaw: patch.startRaw ?? '2026-01-01 09:00:00',
    startDate: patch.startDate ?? '2026-01-01',
    startMonth: patch.startMonth ?? '2026-01',
    startMinutes: patch.startMinutes ?? 540,
    endMinutes: patch.endMinutes ?? ((patch.startMinutes ?? 540) + (patch.durationMinutes ?? 60)),
    weekday: patch.weekday ?? 4,
    isWeekend: patch.isWeekend || false,
    durationMinutes: patch.durationMinutes ?? 60,
    amount: patch.amount ?? 10,
    tax: patch.tax ?? 1.3,
    total: patch.total ?? 11.3,
    paymentType: patch.paymentType ?? 'visa',
  };
}

function location(patch: Partial<ParkingRevenueLocationSummary>): ParkingRevenueLocationSummary {
  return {
    key: patch.key || 'lot-a',
    displayName: patch.displayName || 'Lot A',
    sourceIds: patch.sourceIds || [{ source: 'hotspot', sourceId: '100', label: 'Lot A' }],
    latitude: patch.latitude ?? null,
    longitude: patch.longitude ?? null,
    categoryId: patch.categoryId ?? null,
    categoryLabel: patch.categoryLabel,
    categoryColorHex: patch.categoryColorHex,
    isMapped: patch.isMapped || false,
    rowCount: patch.rowCount ?? 1,
    totalRevenue: patch.totalRevenue ?? 10,
    totalPaid: patch.totalPaid ?? 11.3,
    paidMinutes: patch.paidMinutes,
    averageStayMinutes: patch.averageStayMinutes ?? 60,
    uniquePlateCount: patch.uniquePlateCount ?? 1,
    hotspotRevenue: patch.hotspotRevenue ?? 10,
    qrRevenue: patch.qrRevenue ?? 0,
    peakHour: patch.peakHour ?? 9,
    peakDay: patch.peakDay || '2026-01-01',
  };
}

function trend(patch: Partial<ParkingRevenueTrendPoint>): ParkingRevenueTrendPoint {
  return {
    key: patch.key || '2026-01',
    label: patch.label || patch.key || '2026-01',
    rowCount: patch.rowCount ?? 1,
    totalRevenue: patch.totalRevenue ?? 10,
    averageStayMinutes: patch.averageStayMinutes ?? 60,
  };
}

function analytics(patch: Partial<ParkingRevenueAnalytics>): ParkingRevenueAnalytics {
  return {
    rows: patch.rows || [],
    locationSummaries: patch.locationSummaries || [],
    mappedLocationSummaries: patch.mappedLocationSummaries || [],
    unmappedLocationSummaries: patch.unmappedLocationSummaries || [],
    totalRevenue: patch.totalRevenue ?? 0,
    totalPaid: patch.totalPaid ?? 0,
    rowCount: patch.rowCount ?? 0,
    paidMinutes: patch.paidMinutes,
    activeDayCount: patch.activeDayCount,
    hourWindowMinutes: patch.hourWindowMinutes,
    averageStayMinutes: patch.averageStayMinutes ?? 0,
    uniquePlateCount: patch.uniquePlateCount ?? 0,
    peakHour: patch.peakHour ?? null,
    peakDay: patch.peakDay || '',
    revenueByDay: patch.revenueByDay || [],
    revenueByHour: patch.revenueByHour || [],
    revenueByMonth: patch.revenueByMonth || [],
  };
}

describe('parking planner analysis milestones', () => {
  it('builds friendly empty-state analysis data with full hourly chart coverage', () => {
    const result = buildParkingPlannerAnalysis(analytics({}), null);

    expect(result.monthlyTrend).toEqual([]);
    expect(result.hourlyProfile).toHaveLength(24);
    expect(result.hourlyProfile[0]).toMatchObject({ key: '00', label: '00:00', revenue: 0, sessions: 0 });
    expect(result.sourceMix).toEqual([
      { key: 'hotspot', label: 'HotSpot app', revenue: 0, sessions: 0 },
      { key: 'qr', label: 'QR code', revenue: 0, sessions: 0 },
    ]);
    expect(result.selectedLot).toBeNull();
    expect(result.insights).toEqual(['Upload parking revenue files to start building planner insights.']);
  });

  it('builds chart-first system analysis, source mix, lot comparison, and capacity metrics', () => {
    const collier = location({
      key: 'collier',
      displayName: 'Collier Parkade',
      sourceIds: [
        { source: 'hotspot', sourceId: '1322', label: 'Collier Parkade' },
        { source: 'qr', sourceId: '1322', label: 'Collier Parkade' },
      ],
      rowCount: 3,
      totalRevenue: 60,
      totalPaid: 67.8,
      averageStayMinutes: 150,
      uniquePlateCount: 3,
      hotspotRevenue: 40,
      qrRevenue: 20,
      peakHour: 9,
    });
    const marina = location({
      key: 'marina',
      displayName: 'Marina Lot',
      sourceIds: [{ source: 'hotspot', sourceId: '2000', label: 'Marina Lot' }],
      rowCount: 2,
      totalRevenue: 24,
      averageStayMinutes: 45,
      uniquePlateCount: 2,
      hotspotRevenue: 24,
      peakHour: 12,
    });
    const rows = [
      row({ id: '1', source: 'hotspot', sourceId: '1322', physicalLocationId: 'collier', physicalLocationName: 'Collier Parkade', startMinutes: 540, amount: 40, durationMinutes: 180 }),
      row({ id: '2', source: 'qr', sourceId: '1322', physicalLocationId: null, physicalLocationName: 'QR Collier', sourceLabel: 'Collier Parkade', startMinutes: 600, amount: 15, durationMinutes: 120 }),
      row({ id: '3', source: 'qr', sourceId: '9999', physicalLocationId: null, physicalLocationName: 'Collier Parkade', sourceLabel: 'Other', startMinutes: 600, amount: 5, durationMinutes: 150 }),
      row({ id: '4', source: 'hotspot', sourceId: '2000', physicalLocationId: 'marina', physicalLocationName: 'Marina Lot', startMinutes: 720, amount: 24, durationMinutes: 45 }),
    ];

    const result = buildParkingPlannerAnalysis(analytics({
      rows,
      locationSummaries: [collier, marina],
      totalRevenue: 84,
      totalPaid: 94.92,
      rowCount: 4,
      averageStayMinutes: 124,
      uniquePlateCount: 4,
      peakHour: 10,
      peakDay: '2026-01-01',
      revenueByDay: [trend({ key: '2026-01-01', label: '2026-01-01', rowCount: 4, totalRevenue: 84, averageStayMinutes: 124 })],
      revenueByMonth: [trend({ key: '2026-01', label: '2026-01', rowCount: 4, totalRevenue: 84, averageStayMinutes: 124 })],
    }), collier, {
      collier: { spaces: 32, sourceLabel: 'City parking source' },
      marina: { spaces: null },
    });

    expect(result.monthlyTrend).toEqual([{ key: '2026-01', label: '2026-01', revenue: 84, sessions: 4, averageStayMinutes: 124 }]);
    expect(result.hourlyProfile.find(point => point.key === '09')).toMatchObject({ revenue: 13.33, sessions: 1 });
    expect(result.hourlyProfile.find(point => point.key === '10')).toMatchObject({ revenue: 22.83, sessions: 3 });
    expect(result.sourceMix).toEqual([
      { key: 'hotspot', label: 'HotSpot app', revenue: 64, sessions: 2 },
      { key: 'qr', label: 'QR code', revenue: 20, sessions: 2 },
    ]);
    expect(result.topLotsByRevenue[0]).toMatchObject({
      key: 'collier',
      label: 'Collier Parkade',
      revenuePerSpace: 1.88,
      sessionsPerSpace: 0.09,
    });
    expect(result.capacityRows).toHaveLength(1);
    expect(result.selectedLot).toMatchObject({
      displayName: 'Collier Parkade',
      revenueRank: 1,
      sessionRank: 1,
      revenueSharePercent: 71.4,
      sessionSharePercent: 75,
      systemAverageStayMinutes: 124,
      spaces: 32,
      revenuePerSpace: 1.88,
      sessionsPerSpace: 0.09,
    });
    expect(result.selectedLot?.hourlyProfile.find(point => point.key === '10')).toMatchObject({ revenue: 22.83, sessions: 3 });
    expect(result.selectedLot?.sourceMix).toEqual([
      { key: 'hotspot', label: 'HotSpot app', revenue: 40, sessions: 1 },
      { key: 'qr', label: 'QR code', revenue: 20, sessions: 2 },
    ]);
    expect(result.insights).toEqual(expect.arrayContaining([
      'Collier Parkade represents 71.4% of filtered revenue and ranks #1 by revenue.',
      'The system-wide peak starts around 10:00.',
    ]));
  });

  it('handles selected lot drilldown even when a location is not in the ranked lot list', () => {
    const selected = location({
      key: 'temporary',
      displayName: 'Temporary Lot',
      sourceIds: [{ source: 'qr', sourceId: '77', label: 'Temporary Lot' }],
      rowCount: 1,
      totalRevenue: 9,
      averageStayMinutes: 30,
      hotspotRevenue: 0,
      qrRevenue: 9,
    });
    const result = buildParkingPlannerAnalysis(analytics({
      rows: [row({ source: 'qr', sourceId: '77', physicalLocationName: 'Temporary Lot', amount: 9, durationMinutes: 30 })],
      locationSummaries: [],
      totalRevenue: 9,
      rowCount: 1,
      averageStayMinutes: 30,
      peakHour: null,
    }), selected);

    expect(result.topLotsByRevenue).toEqual([]);
    expect(result.capacityRows).toEqual([]);
    expect(result.selectedLot).toMatchObject({
      revenueRank: 0,
      sessionRank: 0,
      revenueSharePercent: 100,
      sessionSharePercent: 100,
      spaces: null,
      revenuePerSpace: null,
      sessionsPerSpace: null,
    });
    expect(result.insights).toContain('Temporary Lot represents 100% of filtered revenue and ranks #0 by revenue.');
  });

  it('ranks capacity by revenue per space while keeping utilization insight separate', () => {
    const topRevenuePerSpace = location({
      key: 'top-revenue-space',
      displayName: 'Top Revenue Space Lot',
      rowCount: 4,
      totalRevenue: 100,
      paidMinutes: 10,
    });
    const topUtilization = location({
      key: 'top-utilization',
      displayName: 'Top Utilization Lot',
      rowCount: 20,
      totalRevenue: 50,
      paidMinutes: 600,
    });

    const result = buildParkingPlannerAnalysis(analytics({
      rows: [
        row({ sourceId: '100', physicalLocationId: 'top-revenue-space', amount: 100, durationMinutes: 10 }),
        row({ sourceId: '200', physicalLocationId: 'top-utilization', amount: 50, durationMinutes: 600 }),
      ],
      locationSummaries: [topUtilization, topRevenuePerSpace],
      totalRevenue: 150,
      rowCount: 24,
      activeDayCount: 1,
      hourWindowMinutes: 60,
    }), null, {
      'top-revenue-space': { spaces: 1 },
      'top-utilization': { spaces: 10 },
    });

    expect(result.capacityRows.map(point => point.key)).toEqual(['top-revenue-space', 'top-utilization']);
    expect(result.capacityRows[0]).toMatchObject({
      revenuePerSpace: 100,
      utilizationPercent: 16.7,
    });
    expect(result.capacityRows[1]).toMatchObject({
      revenuePerSpace: 5,
      utilizationPercent: 100,
    });
    expect(result.insights).toEqual(expect.arrayContaining([
      'Top Revenue Space Lot generates the most revenue per known space.',
      'Top Utilization Lot has the strongest estimated utilization at 100.0%.',
    ]));
  });

  it('allocates hourly revenue across the paid session duration instead of only the start hour', () => {
    const result = buildParkingPlannerAnalysis(analytics({
      rows: [
        row({
          id: 'spans-hours',
          startMinutes: 11 * 60 + 30,
          endMinutes: 13 * 60 + 30,
          durationMinutes: 120,
          amount: 12,
        }),
      ],
      locationSummaries: [location({ key: 'lot-a', totalRevenue: 12 })],
      totalRevenue: 12,
      rowCount: 1,
    }), null);

    expect(result.hourlyProfile.find(point => point.key === '11')).toMatchObject({ revenue: 3, sessions: 1 });
    expect(result.hourlyProfile.find(point => point.key === '12')).toMatchObject({ revenue: 6, sessions: 1 });
    expect(result.hourlyProfile.find(point => point.key === '13')).toMatchObject({ revenue: 3, sessions: 1 });
  });

  it('wraps overnight hourly revenue into the next day hours', () => {
    const result = buildParkingPlannerAnalysis(analytics({
      rows: [
        row({
          id: 'overnight-session',
          startMinutes: 23 * 60 + 30,
          durationMinutes: 120,
          amount: 12,
        }),
      ],
      locationSummaries: [location({ key: 'lot-a', totalRevenue: 12 })],
      totalRevenue: 12,
      rowCount: 1,
    }), null);

    expect(result.hourlyProfile.find(point => point.key === '23')).toMatchObject({ revenue: 3, sessions: 1 });
    expect(result.hourlyProfile.find(point => point.key === '00')).toMatchObject({ revenue: 6, sessions: 1 });
    expect(result.hourlyProfile.find(point => point.key === '01')).toMatchObject({ revenue: 3, sessions: 1 });
  });

  it('does not inflate category revenue per space with unknown-capacity lots', () => {
    const knownCapacityLot = location({
      key: 'known-capacity',
      displayName: 'Known Capacity Lot',
      categoryId: 'downtown',
      categoryLabel: 'Downtown',
      rowCount: 10,
      totalRevenue: 100,
      paidMinutes: 120,
    });
    const unknownCapacityLot = location({
      key: 'unknown-capacity',
      displayName: 'Unknown Capacity Lot',
      categoryId: 'downtown',
      categoryLabel: 'Downtown',
      rowCount: 90,
      totalRevenue: 900,
      paidMinutes: 900,
    });

    const result = buildParkingPlannerAnalysis(analytics({
      locationSummaries: [knownCapacityLot, unknownCapacityLot],
      totalRevenue: 1000,
      rowCount: 100,
      activeDayCount: 1,
      hourWindowMinutes: 60,
    }), null, {
      'known-capacity': { spaces: 10 },
    });

    expect(result.categoryComparisonRows[0]).toMatchObject({
      key: 'downtown',
      label: 'Downtown',
      revenue: 100,
      sessions: 10,
      spaces: 10,
      revenuePerSpace: 10,
      utilizationPercent: 20,
    });
  });

  it('sorts tied lot and capacity comparisons predictably and handles zero totals', () => {
    const alpha = location({ key: 'alpha', displayName: 'Alpha Lot', rowCount: 2, totalRevenue: 20, averageStayMinutes: 20 });
    const beta = location({ key: 'beta', displayName: 'Beta Lot', rowCount: 3, totalRevenue: 20, averageStayMinutes: 20 });
    const gamma = location({ key: 'gamma', displayName: 'Gamma Lot', rowCount: 3, totalRevenue: 20, averageStayMinutes: 20 });
    const result = buildParkingPlannerAnalysis(analytics({
      rows: [row({ sourceId: '100', amount: 0, durationMinutes: 0 })],
      locationSummaries: [alpha, gamma, beta],
      totalRevenue: 0,
      rowCount: 0,
      averageStayMinutes: 20,
    }), alpha, {
      alpha: { spaces: 0 },
      beta: { spaces: 10 },
      gamma: { spaces: 10 },
    });

    expect(result.topLotsByRevenue.map(point => point.key)).toEqual(['beta', 'gamma', 'alpha']);
    expect(result.capacityRows.map(point => point.key)).toEqual(['gamma', 'beta']);
    expect(result.selectedLot).toMatchObject({
      revenueSharePercent: 0,
      sessionSharePercent: 0,
      spaces: null,
    });
  });

  it('keeps insights useful without a selected lot and handles blank source references', () => {
    const blank = {
      ...location({
        key: 'blank',
        displayName: 'Blank Lot',
        sourceIds: [{ source: 'qr' as const, sourceId: '', label: '' }],
        rowCount: 1,
        totalRevenue: 5,
      }),
      displayName: '',
    };

    const result = buildParkingPlannerAnalysis(analytics({
      rows: [row({ source: 'qr', sourceId: '', sourceLabel: '', physicalLocationName: '', amount: 5, durationMinutes: 0 })],
      locationSummaries: [blank],
      totalRevenue: 5,
      rowCount: 1,
      averageStayMinutes: 0,
      peakHour: 9,
    }), null);

    expect(result.selectedLot).toBeNull();
    expect(result.insights.some(insight => insight.includes('represents'))).toBe(false);
    expect(result.sourceMix.find(point => point.key === 'qr')).toMatchObject({ revenue: 5, sessions: 1 });
  });

  it('tolerates incomplete imported labels while building selected-lot matches', () => {
    const incomplete = {
      ...location({
        key: 'incomplete',
        sourceIds: [{ source: 'hotspot' as const, sourceId: undefined as unknown as string, label: undefined }],
        rowCount: 1,
        totalRevenue: 3,
      }),
      displayName: undefined as unknown as string,
    };

    const incompleteRow = {
      ...row({ source: 'qr', amount: 3 }),
      sourceId: undefined as unknown as string,
      sourceLabel: undefined as unknown as string,
      physicalLocationName: undefined as unknown as string,
    };
    const result = buildParkingPlannerAnalysis(analytics({
      rows: [incompleteRow],
      locationSummaries: [incomplete],
      totalRevenue: 3,
      rowCount: 1,
      averageStayMinutes: 60,
    }), incomplete);

    expect(result.selectedLot?.revenueSharePercent).toBe(100);
    expect(result.sourceMix.find(point => point.key === 'qr')).toMatchObject({ revenue: 3, sessions: 1 });
    expect(result.selectedLot?.sourceMix.find(point => point.key === 'qr')).toMatchObject({ revenue: 0, sessions: 0 });
  });

  it('builds month-over-month, year-over-year, and day-specific trend views', () => {
    const selected = location({
      key: 'collier',
      displayName: 'Collier Parkade',
      sourceIds: [{ source: 'hotspot', sourceId: '100', label: 'Collier Parkade' }],
    });
    const rows = [
      row({ id: 'jan-1', physicalLocationId: 'collier', physicalLocationName: 'Collier Parkade', startDate: '2026-01-05', startMonth: '2026-01', weekday: 1, amount: 10, durationMinutes: 60 }),
      row({ id: 'may-1', physicalLocationId: 'collier', physicalLocationName: 'Collier Parkade', startDate: '2026-05-04', startMonth: '2026-05', weekday: 1, amount: 20, durationMinutes: 60 }),
      row({ id: 'may-2', physicalLocationId: 'collier', physicalLocationName: 'Collier Parkade', startDate: '2026-05-09', startMonth: '2026-05', weekday: 6, isWeekend: true, amount: 30, durationMinutes: 90 }),
      row({ id: 'jun-1', physicalLocationId: 'collier', physicalLocationName: 'Collier Parkade', startDate: '2026-06-01', startMonth: '2026-06', weekday: 1, amount: 40, durationMinutes: 120 }),
      row({ id: 'jun-2', physicalLocationId: 'collier', physicalLocationName: 'Collier Parkade', startDate: '2026-06-06', startMonth: '2026-06', weekday: 6, isWeekend: true, amount: 50, durationMinutes: 150 }),
      row({ id: 'jun-3', physicalLocationId: 'marina', physicalLocationName: 'Marina Lot', sourceId: '200', startDate: '2026-06-07', startMonth: '2026-06', weekday: 0, isWeekend: true, amount: 80, durationMinutes: 45 }),
    ];

    const result = buildParkingTrendOverview(analytics({ rows }), selected, '2026-06');

    expect(result.scopeLabel).toBe('Collier Parkade');
    expect(result.comparisonCards.find(card => card.key === 'revenue-mom')).toMatchObject({
      value: 90,
      previousValue: 50,
      changeValue: 40,
      changePercent: 80,
      direction: 'up',
    });
    expect(result.comparisonCards.find(card => card.key === 'revenue-yoy')).toMatchObject({
      value: 90,
      previousValue: null,
      direction: 'none',
    });
    expect(result.weekdayTrend.map(point => [point.key, point.revenue])).toEqual([
      ['2026-01', 10],
      ['2026-05', 20],
      ['2026-06', 40],
    ]);
    expect(result.saturdayTrend.map(point => [point.key, point.revenue])).toEqual([
      ['2026-05', 30],
      ['2026-06', 50],
    ]);
    expect(result.sundayTrend).toEqual([]);
    expect(result.fastestGrowingLot).toMatchObject({ label: 'Marina Lot', value: 80, changeValue: 80 });
  });
});
