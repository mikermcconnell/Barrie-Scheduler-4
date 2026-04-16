import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { ConnectionIndicator } from '../components/schedule/ConnectionIndicator';

describe('ConnectionIndicator', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

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

  it('shows per-connection tokens with short route labels, GO text, and a clock icon', () => {
    flushSync(() => {
      root?.render(
        <ConnectionIndicator
          popoverAlign="right"
          connections={[
            {
              targetId: 'route-1',
              targetName: 'Route 2B (South)',
              targetShortLabel: '2B',
              targetTime: 377,
              targetTimeLabel: '6:17a',
              tripTime: 378,
              eventType: 'departure',
              busAnchor: 'arrival',
              gapMinutes: -1,
              meetsConnection: false,
              quality: 'bad',
              icon: 'bus'
            },
            {
              targetId: 'route-2',
              targetName: 'Route 400 (North)',
              targetShortLabel: '400N',
              targetTime: 377,
              targetTimeLabel: '6:17a',
              tripTime: 370,
              eventType: 'departure',
              busAnchor: 'arrival',
              gapMinutes: 7,
              meetsConnection: true,
              quality: 'excellent',
              icon: 'bus'
            },
            {
              targetId: 'route-3',
              targetName: 'Route 8A (North)',
              targetShortLabel: '8A',
              targetTime: 377,
              targetTimeLabel: '6:17a',
              tripTime: 370,
              eventType: 'departure',
              busAnchor: 'arrival',
              gapMinutes: 7,
              meetsConnection: true,
              quality: 'excellent',
              icon: 'bus'
            },
            {
              targetId: 'go-1',
              targetName: 'Barrie South GO Departures',
              targetShortLabel: 'GO',
              targetTime: 381,
              targetTimeLabel: '6:21a',
              tripTime: 378,
              eventType: 'departure',
              busAnchor: 'arrival',
              gapMinutes: 3,
              meetsConnection: true,
              quality: 'good',
              icon: 'train'
            },
            {
              targetId: 'bell-1',
              targetName: 'Georgian Bell',
              targetTime: 383,
              targetTimeLabel: '6:23a',
              tripTime: 378,
              eventType: 'departure',
              busAnchor: 'arrival',
              gapMinutes: 5,
              meetsConnection: true,
              quality: 'excellent',
              icon: 'clock'
            }
          ]}
        />
      );
    });

    const triggerButton = container?.querySelector('button[aria-label*="5 connections"]');
    expect(triggerButton).not.toBeNull();
    expect(triggerButton?.textContent).toContain('2B');
    expect(triggerButton?.textContent).toContain('400N');
    expect(triggerButton?.textContent).toContain('8A');
    expect(triggerButton?.textContent).toContain('GO');
    expect(triggerButton?.getAttribute('title')).toContain('Route 2B (South)');
    expect(triggerButton?.getAttribute('title')).toContain('Route 400 (North)');
    expect(triggerButton?.getAttribute('title')).toContain('Route 8A (North)');
    expect(triggerButton?.getAttribute('title')).toContain('Barrie South GO Departures');
    expect(triggerButton?.getAttribute('title')).toContain('Georgian Bell');

    const tooltip = container?.querySelector('[role="tooltip"]');
    expect(tooltip?.textContent).toContain('5 connections');
    expect(tooltip?.className).toContain('right-0');
    expect(tooltip?.textContent).toContain('Route 2B (South)');
    expect(tooltip?.textContent).toContain('Route 400 (North)');
    expect(tooltip?.textContent).toContain('Route 8A (North)');
    expect(tooltip?.textContent).toContain('Georgian Bell');
    expect(tooltip?.textContent).toContain('Barrie South GO Departures');
    expect(tooltip?.textContent).toContain('Route departure');
    expect(tooltip?.textContent).toContain('Train departure');
    expect(tooltip?.textContent).toContain('Bell departure');
    expect(tooltip?.textContent).toContain('Shown on ARR');
    expect(tooltip?.textContent).toContain('1 missed');
    expect(tooltip?.textContent).toContain('4 met');
    expect(tooltip?.textContent).toContain('Missed');
    expect(tooltip?.textContent).toContain('Excellent');
    expect(tooltip?.textContent).toContain('-1m');
    expect(tooltip?.textContent).toContain('+7m');
    expect(tooltip?.textContent).toContain('+3m');
    expect(tooltip?.textContent).toContain('+5m');
    expect(container?.querySelectorAll('svg').length).toBeGreaterThan(0);
  });
});
