import { describe, it, expect } from 'vitest';
import { gtfsDirectionToDirection } from '../utils/gtfs/gtfsTypes';

describe('GTFS Direction Inference', () => {
    describe('headsign-based direction for Route 8A/8B', () => {
        it('should infer North for 8A Georgian College headsign', () => {
            const result = gtfsDirectionToDirection(
                0, // direction_id (would default to wrong South)
                'fake-route-id',
                undefined,
                'RVH/YONGE to Georgian College',
                '8A'
            );
            expect(result).toBe('North');
        });

        it('should infer South for 8A Park Place headsign', () => {
            const result = gtfsDirectionToDirection(
                1, // direction_id (would default to wrong North)
                'fake-route-id',
                undefined,
                'RVH/YONGE to Park Place',
                '8A'
            );
            expect(result).toBe('South');
        });

        it('should infer North for 8B Georgian College headsign', () => {
            const result = gtfsDirectionToDirection(
                0,
                'fake-route-id',
                undefined,
                'Crosstown/Essa to Georgian College',
                '8B'
            );
            expect(result).toBe('North');
        });

        it('should infer South for 8B Park Place headsign', () => {
            const result = gtfsDirectionToDirection(
                1,
                'fake-route-id',
                undefined,
                'Crosstown/Essa to Park Place',
                '8B'
            );
            expect(result).toBe('South');
        });
    });

    describe('fallback to direction_id for unknown routes', () => {
        it('should use default mapping when no headsign match', () => {
            const result = gtfsDirectionToDirection(
                0,
                'unknown-route-id',
                undefined,
                'Some Random Headsign',
                'UNKNOWN'
            );
            // Default: 0 = South
            expect(result).toBe('South');
        });
    });
});
