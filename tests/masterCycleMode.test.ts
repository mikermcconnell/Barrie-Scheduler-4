import { describe, expect, it } from 'vitest';
import { detectMasterCycleMode } from '../utils/schedule/masterCycleMode';
import type { MasterScheduleContent } from '../utils/masterScheduleTypes';
import type { MasterTrip } from '../utils/parsers/masterScheduleParser';

const buildTrip = (overrides: Partial<MasterTrip>): MasterTrip => ({
    id: overrides.id || 'trip-1',
    blockId: overrides.blockId || 'block-1',
    direction: overrides.direction || 'North',
    tripNumber: overrides.tripNumber || 1,
    rowId: overrides.rowId || 1,
    startTime: overrides.startTime || 360,
    endTime: overrides.endTime || 390,
    recoveryTime: overrides.recoveryTime ?? 8,
    travelTime: overrides.travelTime ?? 30,
    cycleTime: overrides.cycleTime ?? 38,
    stops: overrides.stops || { A: '6:00 AM', B: '6:30 AM' },
    ...overrides,
});

const buildContent = (trips: MasterTrip[], metadata?: Partial<MasterScheduleContent['metadata']>): MasterScheduleContent => ({
    northTable: {
        routeName: '8 (Weekday) (North)',
        stops: ['A', 'B'],
        stopIds: {},
        trips: trips.filter(trip => trip.direction === 'North'),
    },
    southTable: {
        routeName: '8 (Weekday) (South)',
        stops: ['B', 'A'],
        stopIds: {},
        trips: trips.filter(trip => trip.direction === 'South'),
    },
    metadata: {
        routeNumber: '8',
        dayType: 'Weekday',
        uploadedAt: '2026-03-31T12:00:00.000Z',
        ...metadata,
    },
});

describe('detectMasterCycleMode', () => {
    it('uses the saved master cycle mode when present', () => {
        const detection = detectMasterCycleMode(buildContent([], { cycleMode: 'Floating' }));
        expect(detection.cycleMode).toBe('Floating');
        expect(detection.source).toBe('metadata');
        expect(detection.confidence).toBe('high');
    });

    it('detects floating mode from substantial travel-time variation across meaningful bands', () => {
        const detection = detectMasterCycleMode(buildContent([
            buildTrip({ id: 'n-a1', direction: 'North', blockId: '1', assignedBand: 'A', cycleTime: 70, travelTime: 58, recoveryTime: 12 }),
            buildTrip({ id: 's-a1', direction: 'South', blockId: '2', assignedBand: 'A', cycleTime: 72, travelTime: 60, recoveryTime: 12 }),
            buildTrip({ id: 'n-a2', direction: 'North', blockId: '1', assignedBand: 'A', cycleTime: 69, travelTime: 57, recoveryTime: 12 }),
            buildTrip({ id: 's-a2', direction: 'South', blockId: '2', assignedBand: 'A', cycleTime: 71, travelTime: 59, recoveryTime: 12 }),
            buildTrip({ id: 'n-c1', direction: 'North', blockId: '1', assignedBand: 'C', cycleTime: 86, travelTime: 72, recoveryTime: 14 }),
            buildTrip({ id: 's-c1', direction: 'South', blockId: '2', assignedBand: 'C', cycleTime: 88, travelTime: 74, recoveryTime: 14 }),
            buildTrip({ id: 'n-c2', direction: 'North', blockId: '1', assignedBand: 'C', cycleTime: 87, travelTime: 73, recoveryTime: 14 }),
            buildTrip({ id: 's-c2', direction: 'South', blockId: '2', assignedBand: 'C', cycleTime: 89, travelTime: 75, recoveryTime: 14 }),
        ]));

        expect(detection.cycleMode).toBe('Floating');
        expect(detection.source).toBe('heuristic');
        expect(detection.summary).toContain('travel-time variation');
    });

    it('detects strict mode when trips cluster around one cycle time', () => {
        const detection = detectMasterCycleMode(buildContent([
            buildTrip({ id: 'n-1', direction: 'North', cycleTime: 72 }),
            buildTrip({ id: 's-1', direction: 'South', cycleTime: 73 }),
            buildTrip({ id: 'n-2', direction: 'North', cycleTime: 71 }),
            buildTrip({ id: 's-2', direction: 'South', cycleTime: 72 }),
            buildTrip({ id: 'n-3', direction: 'North', cycleTime: 74 }),
        ]));

        expect(detection.cycleMode).toBe('Strict');
        expect(detection.source).toBe('heuristic');
    });

    it('keeps strict mode when evening off-peak bands only add layover after blocks drop out', () => {
        const detection = detectMasterCycleMode(buildContent([
            buildTrip({ id: 'n-a1', direction: 'North', blockId: '1', assignedBand: 'A', cycleTime: 40, travelTime: 31, recoveryTime: 9 }),
            buildTrip({ id: 's-a1', direction: 'South', blockId: '2', assignedBand: 'A', cycleTime: 41, travelTime: 32, recoveryTime: 9 }),
            buildTrip({ id: 'n-b1', direction: 'North', blockId: '1', assignedBand: 'B', cycleTime: 39, travelTime: 30, recoveryTime: 9 }),
            buildTrip({ id: 's-b1', direction: 'South', blockId: '2', assignedBand: 'B', cycleTime: 40, travelTime: 31, recoveryTime: 9 }),
            buildTrip({ id: 'n-d1', direction: 'North', blockId: '1', assignedBand: 'D', cycleTime: 57, travelTime: 31, recoveryTime: 26 }),
            buildTrip({ id: 'n-d2', direction: 'North', blockId: '1', assignedBand: 'D', cycleTime: 56, travelTime: 30, recoveryTime: 26 }),
        ]));

        expect(detection.cycleMode).toBe('Strict');
        expect(detection.source).toBe('heuristic');
        expect(detection.summary).toContain('recovery/off-peak block changes');
    });
});
