import { describe, expect, it } from 'vitest';

import {
  buildRouteAttachmentPreview,
  buildRouteConnectionFromTarget,
  getBusConnectionAnchorForConnectionType,
  getConnectionIntentLabel,
  getDefaultConnectionTypeForTarget,
  getConnectionRuleSummary,
  suggestRouteConnectionStopCode
} from '../utils/connections/routeConnectionDefaults';

describe('routeConnectionDefaults', () => {
  const availableStops = [
    { code: '9003', name: 'Allandale Waterfront GO' },
    { code: '330', name: 'Georgian College' }
  ];

  it('defaults arrival targets to after-arrival route connections', () => {
    expect(getDefaultConnectionTypeForTarget({ defaultEventType: 'arrival' })).toBe('feed_arriving');
    expect(getDefaultConnectionTypeForTarget({ defaultEventType: 'departure' })).toBe('meet_departing');
    expect(getBusConnectionAnchorForConnectionType('meet_departing')).toBe('arrival');
    expect(getBusConnectionAnchorForConnectionType('feed_arriving')).toBe('departure');
  });

  it('suggests a route stop by direct stop code or matching location', () => {
    expect(
      suggestRouteConnectionStopCode(
        { stopCode: '9003', stopName: 'Allandale Waterfront GO', location: 'Allandale Waterfront GO Station' },
        availableStops
      )
    ).toBe('9003');

    expect(
      suggestRouteConnectionStopCode(
        { stopCode: '9999', stopName: 'Unknown', location: 'Georgian College' },
        availableStops
      )
    ).toBe('330');
  });

  it('builds a default route connection when a stop can be inferred', () => {
    expect(
      buildRouteConnectionFromTarget(
        {
          id: 'target-1',
          stopCode: '9999',
          stopName: 'Unknown',
          location: 'Georgian College',
          defaultEventType: 'departure'
        },
        availableStops,
        3
      )
    ).toMatchObject({
      targetId: 'target-1',
      connectionType: 'meet_departing',
      bufferMinutes: 5,
      stopCode: '330',
      stopName: 'Georgian College',
      priority: 3,
      enabled: true
    });
  });

  it('builds a route attachment preview with rule and active events', () => {
    expect(getConnectionIntentLabel('meet_departing', 'train')).toBe('To train');
    expect(getConnectionIntentLabel('feed_arriving', 'Route 8')).toBe('From Route 8');
    expect(getConnectionRuleSummary('feed_arriving', 5)).toBe('Bus departure 5 min after arrival');

    expect(
      buildRouteAttachmentPreview(
        {
          stopCode: '9003',
          stopName: 'Allandale Waterfront GO',
          location: 'Allandale Waterfront GO',
          defaultEventType: 'arrival',
          times: [
            { id: 't1', time: 480, daysActive: ['Weekday'], enabled: true },
            { id: 't2', time: 500, daysActive: ['Saturday'], enabled: true }
          ]
        },
        availableStops,
        'Weekday'
      )
    ).toMatchObject({
      canAttach: true,
      connectionType: 'feed_arriving',
      ruleSummary: 'Bus departure 5 min after arrival',
      stopCode: '9003',
      stopName: 'Allandale Waterfront GO',
      activeEventCount: 1,
      activeEventPreview: ['8:00a ARR']
    });
  });
});
