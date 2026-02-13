import { describe, expect, it } from 'vitest';
import { aggregateTransitAppData } from '../utils/transit-app/transitAppAggregator';
import { detectTransitAppFiles, parseAllFiles } from '../utils/transit-app/transitAppParsers';

function makeCsvFile(name: string, csv: string, webkitRelativePath: string): File {
    const fileLike = {
        name,
        webkitRelativePath,
        async text() {
            return csv;
        },
    };
    return fileLike as unknown as File;
}

describe('transit app pipeline e2e', () => {
    it('parses detected files and aggregates critical outputs consistently', async () => {
        const files: File[] = [
            makeCsvFile(
                'lines_2025-01-08.csv',
                [
                    'route_short_name,nearby_views,nearby_taps,tapped_routing_suggestions,go_trips',
                    '101,120,60,30,6',
                    '400,90,40,18,4',
                ].join('\n'),
                'barron/lines_2025-01-08.csv'
            ),
            makeCsvFile(
                'trips_2025-01-08.csv',
                [
                    'user_id,start_longitude,start_latitude,end_longitude,end_latitude,timestamp,arrive_by,leave_at',
                    'u1,-79.6900,44.3800,-79.6700,44.4000,2025-01-08 13:05:00 UTC,,',
                    'u2,-79.6900,44.3800,-79.6700,44.4000,2025-01-08 22:10:00 UTC,,',
                    'u3,-79.6700,44.4000,-79.6900,44.3800,2025-11-02 14:00:00 UTC,,',
                ].join('\n'),
                'barron/trips_2025-01-08.csv'
            ),
            makeCsvFile(
                'locations_2025-01-08.csv',
                [
                    'user_id,longitude,latitude,timestamp',
                    'u1,-79.6900,44.3800,2025-01-08 13:00:00 UTC',
                    'u1,-79.6901,44.3801,2025-01-08 13:05:00 UTC',
                    'u2,-79.6700,44.4000,2025-01-08 22:00:00 UTC',
                    'u3,-79.6600,44.4100,2025-11-02 14:00:00 UTC',
                ].join('\n'),
                'barron/locations_2025-01-08.csv'
            ),
            makeCsvFile(
                'go_trip_legs_2025-01-08.csv',
                [
                    'user_trip_id,start_time,end_time,start_longitude,start_latitude,end_longitude,end_latitude,distance,progression,users_helped,service_name,route_short_name,mode,start_stop_name,end_stop_name',
                    'trip-1,2025-01-08 13:00:00 UTC,2025-01-08 13:10:00 UTC,-79.6900,44.3800,-79.6902,44.3877,2.1,0,0,Barrie Transit,101,Transit,\"Barrie, Georgian College\",Downtown Hub',
                    'trip-1,2025-01-08 13:14:00 UTC,2025-01-08 13:32:00 UTC,-79.6902,44.3877,-79.6700,44.4000,4.2,0,0,Barrie Transit,400,Transit,Downtown Hub,Georgian Mall',
                ].join('\n'),
                'barron/go_trip_legs_2025-01-08.csv'
            ),
            makeCsvFile(
                'tapped_trip_view_legs_2025-01-08.csv',
                [
                    'user_trip_id,start_time,end_time,start_longitude,start_latitude,end_longitude,end_latitude,service_name,route_short_name,mode,start_stop_name,end_stop_name',
                    'trip-1,2025-01-08 13:00:00 UTC,2025-01-08 13:10:00 UTC,-79.6900,44.3800,-79.6902,44.3877,Barrie Transit,101,Transit,\"Barrie, Georgian College\",Downtown Hub',
                    'trip-1,2025-01-08 13:14:00 UTC,2025-01-08 13:32:00 UTC,-79.6902,44.3877,-79.6700,44.4000,Barrie Transit,400,Transit,Downtown Hub,Georgian Mall',
                ].join('\n'),
                'barron/tapped_trip_view_legs_2025-01-08.csv'
            ),
            makeCsvFile(
                'planned_go_trip_legs_2025-01-08.csv',
                [
                    'user_trip_id,start_time,end_time,start_longitude,start_latitude,end_longitude,end_latitude,service_name,route_short_name,mode,start_stop_name,end_stop_name',
                    'trip-2,2025-01-08 22:45:00 UTC,2025-01-08 23:00:00 UTC,-79.6700,44.4000,-79.6200,44.3500,GO Transit,BR,Transit,Barrie South GO Station,Union Station Bus Terminal',
                ].join('\n'),
                'barron/planned_go_trip_legs_2025-01-08.csv'
            ),
            makeCsvFile(
                'users.csv',
                [
                    'date,users,sessions,downloads',
                    '2025-01-08,50,80,6',
                    '2025-11-02,40,60,4',
                ].join('\n'),
                'barron/users.csv'
            ),
        ];

        const { detected, unrecognized } = detectTransitAppFiles(files);
        expect(unrecognized).toHaveLength(0);
        expect(detected).toHaveLength(7);

        const { data, stats } = await parseAllFiles(detected);
        const summary = aggregateTransitAppData(data, stats, 'tester');

        const critical = {
            fileStats: summary.metadata.fileStats,
            parsedRows: {
                lines: data.lines.length,
                trips: data.trips.length,
                locations: data.locations.length,
                goTripLegs: data.goTripLegs.length,
                plannedTripLegs: data.plannedTripLegs.length,
                tappedTripLegs: data.tappedTripLegs.length,
                users: data.users.length,
            },
            parsedQuotedStop: data.goTripLegs[0]?.start_stop_name,
            transferTotals: summary.transferAnalysis?.totals,
            routeSummary: summary.routeMetrics.summary.map(row => ({
                route: row.route,
                views: row.totalViews,
                taps: row.totalTaps,
            })),
            odPairs: summary.odPairs.pairs.map(pair => ({
                count: pair.count,
                jan: pair.seasonBins?.jan || 0,
                other: pair.seasonBins?.other || 0,
                filterBinCount: pair.odFilterBins ? Object.keys(pair.odFilterBins).length : 0,
            })),
            heatmap: {
                raw: summary.heatmapAnalysis?.debiasing.rawPoints,
                debiased: summary.heatmapAnalysis?.debiasing.debiasedPoints,
                seasons: Array.from(new Set((summary.heatmapAnalysis?.atlas || []).map(slice => slice.season))).sort(),
            },
        };

        expect(critical).toMatchInlineSnapshot(`
          {
            "fileStats": {
              "dateRange": {
                "end": "2025-01-08",
                "start": "2025-01-08",
              },
              "filesByType": {
                "go_trip_legs": 1,
                "lines": 1,
                "locations": 1,
                "planned_go_trip_legs": 1,
                "tapped_trip_view_legs": 1,
                "trips": 1,
                "users": 1,
              },
              "rowsParsed": 16,
              "rowsSkipped": 0,
              "totalFiles": 7,
            },
            "heatmap": {
              "debiased": 3,
              "raw": 4,
              "seasons": [
                "jan",
                "jul",
                "other",
                "sep",
              ],
            },
            "odPairs": [
              {
                "count": 2,
                "filterBinCount": 2,
                "jan": 2,
                "other": 0,
              },
              {
                "count": 1,
                "filterBinCount": 1,
                "jan": 0,
                "other": 1,
              },
            ],
            "parsedQuotedStop": "Barrie, Georgian College",
            "parsedRows": {
              "goTripLegs": 2,
              "lines": 2,
              "locations": 4,
              "plannedTripLegs": 1,
              "tappedTripLegs": 2,
              "trips": 3,
              "users": 2,
            },
            "routeSummary": [
              {
                "route": "101",
                "taps": 60,
                "views": 120,
              },
              {
                "route": "400",
                "taps": 40,
                "views": 90,
              },
            ],
            "transferTotals": {
              "goLinkedTransferEvents": 0,
              "transferEvents": 1,
              "tripChainsDeduplicated": 0,
              "tripChainsProcessed": 1,
              "uniqueRoutePairs": 1,
              "uniqueTransferStops": 1,
            },
          }
        `);
    });
});
