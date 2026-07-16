import { describe, expect, it } from 'vitest';
import { checkConnections } from '../utils/connections/connectionOptimizer';
import type { ConnectionLibrary, RouteConnectionConfig } from '../utils/connections/connectionTypes';
import type { MasterRouteTable } from '../utils/parsers/masterScheduleParser';

const buildLibrary = (): ConnectionLibrary => ({
  targets: [
    {
      id: 'go-departure',
      name: 'GO Departures',
      type: 'manual',
      stopCode: '9003',
      defaultEventType: 'departure',
      times: [{ id: 't1', time: 485, daysActive: ['Weekday'], enabled: true }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'go-arrival',
      name: 'GO Arrivals',
      type: 'manual',
      stopCode: '9003',
      defaultEventType: 'arrival',
      times: [{ id: 't2', time: 480, daysActive: ['Weekday'], enabled: true }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ],
  updatedAt: new Date().toISOString(),
  updatedBy: 'test-user'
});

const schedules: MasterRouteTable[] = [
  {
    routeName: '11 (Weekday) (North)',
    stops: ['Allandale Waterfront GO'],
    stopIds: { 'Allandale Waterfront GO': '9003' },
    trips: [
      {
        id: 'trip-1',
        blockId: '11-1',
        direction: 'North',
        tripNumber: 1,
        rowId: 1,
        startTime: 470,
        endTime: 490,
        recoveryTime: 4,
        recoveryTimes: { 'Allandale Waterfront GO': 4 },
        travelTime: 20,
        cycleTime: 24,
        stops: { 'Allandale Waterfront GO': '8:04 AM' },
        stopMinutes: { 'Allandale Waterfront GO': 484 },
        arrivalTimes: { 'Allandale Waterfront GO': '8:00 AM' }
      }
    ]
  }
];

describe('connectionOptimizer stop event semantics', () => {
  it('uses bus arrival time for meet-departing connections', () => {
    const config: RouteConnectionConfig = {
      routeIdentity: '11-Weekday',
      optimizationMode: 'hybrid',
      connections: [
        {
          id: 'c1',
          targetId: 'go-departure',
          connectionType: 'meet_departing',
          bufferMinutes: 3,
          stopCode: '9003',
          priority: 1,
          enabled: true
        }
      ]
    };

    const result = checkConnections(schedules, config, buildLibrary());

    expect(result.totalConnections).toBe(1);
    expect(result.gaps[0]).toMatchObject({
      tripTime: 480,
      targetTime: 485,
      gapMinutes: 5,
      meetsConnection: true
    });
  });

  it('uses bus departure time for feed-arriving connections', () => {
    const config: RouteConnectionConfig = {
      routeIdentity: '11-Weekday',
      optimizationMode: 'hybrid',
      connections: [
        {
          id: 'c2',
          targetId: 'go-arrival',
          connectionType: 'feed_arriving',
          bufferMinutes: 3,
          stopCode: '9003',
          priority: 1,
          enabled: true
        }
      ]
    };

    const result = checkConnections(schedules, config, buildLibrary());

    expect(result.totalConnections).toBe(1);
    expect(result.gaps[0]).toMatchObject({
      tripTime: 484,
      targetTime: 480,
      gapMinutes: 4,
      meetsConnection: true
    });
  });

  it('matches connections before 4:00 AM on the continued operational evening', () => {
    const overnightLibrary: ConnectionLibrary = {
      ...buildLibrary(),
      targets: [{
        id: 'overnight-departure',
        name: 'Overnight departure',
        type: 'manual',
        stopCode: '9003',
        defaultEventType: 'departure',
        times: [{ id: 'overnight', time: 230, daysActive: ['Weekday'], enabled: true }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }]
    };
    const overnightSchedules: MasterRouteTable[] = [{
      ...schedules[0],
      trips: [{
        ...schedules[0].trips[0],
        id: 'overnight-trip',
        startTime: 225,
        endTime: 235,
        recoveryTime: 0,
        recoveryTimes: {},
        stops: { 'Allandale Waterfront GO': '3:45 AM' },
        stopMinutes: undefined,
        arrivalTimes: { 'Allandale Waterfront GO': '3:45 AM' }
      }]
    }];
    const config: RouteConnectionConfig = {
      routeIdentity: '11-Weekday',
      optimizationMode: 'hybrid',
      connections: [{
        id: 'overnight-connection',
        targetId: 'overnight-departure',
        connectionType: 'meet_departing',
        bufferMinutes: 3,
        stopCode: '9003',
        priority: 1,
        enabled: true
      }]
    };

    const result = checkConnections(overnightSchedules, config, overnightLibrary);

    expect(result.gaps[0]).toMatchObject({
      tripTime: 1665,
      targetTime: 1670,
      gapMinutes: 5,
      meetsConnection: true
    });
  });
});
