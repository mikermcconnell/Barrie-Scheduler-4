import { describe, expect, it } from 'vitest';

import {
  selectRoutePlanner2ItemsInBox,
  selectRoutePlanner2ItemsInLasso,
  type RoutePlanner2SelectableMapItem,
} from '../utils/route-planner-2/routePlanner2MapSelection';

const selectableItems: RoutePlanner2SelectableMapItem[] = [
  { id: 'stop-1', type: 'stop', point: { x: 20, y: 20 } },
  { id: 'stop-2', type: 'stop', point: { x: 90, y: 90 } },
  { id: 'bend-1', type: 'waypoint', point: { x: 45, y: 45 } },
  { id: 'bend-2', type: 'waypoint', point: { x: 140, y: 140 } },
];

describe('route planner 2 map selection', () => {
  it('selects stops and bend anchors inside a drag box', () => {
    expect(selectRoutePlanner2ItemsInBox(selectableItems, { x: 10, y: 10 }, { x: 100, y: 100 })).toEqual({
      stopIds: ['stop-1', 'stop-2'],
      waypointIds: ['bend-1'],
    });
  });

  it('selects stops and bend anchors inside a lasso polygon', () => {
    expect(selectRoutePlanner2ItemsInLasso(selectableItems, [
      { x: 10, y: 10 },
      { x: 110, y: 15 },
      { x: 105, y: 110 },
      { x: 10, y: 105 },
    ])).toEqual({
      stopIds: ['stop-1', 'stop-2'],
      waypointIds: ['bend-1'],
    });
  });
});
