import { describe, expect, it } from 'vitest';

import {
  alignTemplateInitialDataToLoadedStops,
  type TemplateInitialDataLike
} from '../utils/connections/templateInitialDataUtils';

describe('templateInitialDataUtils', () => {
  it('filters Georgian College prefilled stops to only loaded stop codes', () => {
    const result = alignTemplateInitialDataToLoadedStops(
      {
        name: 'Georgian College Bells',
        location: 'Georgian College',
        stopCode: '330',
        icon: 'clock',
        autoPopulateStops: true,
        stops: [
          { code: '327', name: 'College A', enabled: true },
          { code: '330', name: 'College Main', enabled: true },
          { code: '331', name: 'College B', enabled: true }
        ]
      },
      [
        { code: '330', name: 'Georgian College / Main Platform' },
        { code: '331', name: 'Georgian College / East Platform' }
      ]
    );

    expect(result.autoPopulateStops).toBe(true);
    expect(result.stopCode).toBe('330');
    expect(result.stops).toEqual([
      { code: '330', name: 'Georgian College / Main Platform', enabled: true },
      { code: '331', name: 'Georgian College / East Platform', enabled: true }
    ]);
  });

  it('clears auto-populate when none of a multi-stop template matches loaded stop codes', () => {
    const result = alignTemplateInitialDataToLoadedStops(
      {
        name: 'Georgian College Bells',
        location: 'Georgian College',
        stopCode: '330',
        icon: 'clock',
        autoPopulateStops: true,
        stops: [
          { code: '327', name: 'College A', enabled: true },
          { code: '330', name: 'College Main', enabled: true }
        ]
      },
      [
        { code: '725', name: 'Barrie South GO' }
      ]
    );

    expect(result.autoPopulateStops).toBe(false);
    expect(result.stopCode).toBe('');
    expect(result.stops).toEqual([]);
  });

  it('maps GO templates to matching loaded GO stops from schedule names', () => {
    const result = alignTemplateInitialDataToLoadedStops(
      {
        name: 'Barrie South GO Departures',
        location: 'Barrie South GO',
        stopCode: '725',
        icon: 'train'
      } as TemplateInitialDataLike,
      [{ code: '725', name: 'Some other stop' }],
      [
        {
          stopIds: {
            'Barrie South GO Terminal': '725',
            'Barrie South GO Platform B': '726'
          }
        } as any
      ]
    );

    expect(result.autoPopulateStops).toBe(true);
    expect(result.stopCode).toBe('725');
    expect(result.stops).toEqual([
      { code: '725', name: 'Barrie South GO Terminal', enabled: true },
      { code: '726', name: 'Barrie South GO Platform B', enabled: true }
    ]);
  });
});
