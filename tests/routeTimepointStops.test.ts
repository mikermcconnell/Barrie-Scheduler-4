import { describe, expect, it } from 'vitest';
import { buildRouteTimepointStopOptions } from '../utils/connections/routeTimepointStops';

describe('buildRouteTimepointStopOptions', () => {
  it('reduces route 2-style merged directions to the major route timepoints', () => {
    const stops = buildRouteTimepointStopOptions([
      {
        stops: ['Park Pl', "Veteran's at Essa", 'Cuthbert Street', 'Sproule at Kraus', 'Dunlop at Ferndale', 'Downtown Hub'],
        stopIds: {
          'Park Pl': '777',
          "Veteran's at Essa": '662',
          'Cuthbert Street': '829',
          'Sproule at Kraus': '627',
          'Dunlop at Ferndale': '271',
          'Downtown Hub': '1'
        }
      },
      {
        stops: ['Downtown Hub', 'Ferndale Drive', 'Sproule at Kraus', 'Ferndale Woods Public School', "Veteran's at Essa", 'Park Pl'],
        stopIds: {
          'Downtown Hub': '1',
          'Ferndale Drive': '893',
          'Sproule at Kraus': '626',
          'Ferndale Woods Public School': '841',
          "Veteran's at Essa": '847',
          'Park Pl': '777'
        }
      }
    ]);

    expect(stops).toEqual([
      { code: '777', name: 'Park Pl' },
      { code: '1', name: 'Downtown Hub' }
    ]);
  });
});
