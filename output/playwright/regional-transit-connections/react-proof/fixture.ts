// Browser-only fixture master reads. The component and public GTFS worker are real.
export const schedules = ['8A', '8B', '4', '7', '9'].flatMap(routeNumber => ['Weekday', 'Saturday', 'Sunday'].map(dayType => ({
    id: `${routeNumber}-${dayType}`, routeNumber, dayType, currentVersion: 3, storagePath: 'browser-fixture',
    tripCount: 48, northStopCount: 2, southStopCount: 0, updatedAt: new Date(), updatedBy: 'fixture', uploaderName: 'Fixture', source: 'wizard',
})));
export async function getMasterSchedule(_team: string, identity: string) {
    const entry = schedules.find(item => item.id === identity)!;
    if (entry.routeNumber === '7') throw new Error('Browser fixture: unavailable master source');
    const times = entry.routeNumber === '9' ? [100] : Array.from({length: 48}, (_, index) => 280 + index * 25);
    return { entry, content: {
        northTable: {routeName: entry.routeNumber, stops: ['Origin', 'Allandale', 'South', 'Destination'], stopIds: {Origin: '1', Allandale: '9003', South: '725', Destination: '2'},
            trips: times.map((time, index) => ({id: `fixture-${index}`, blockId: `${entry.routeNumber}-1`, direction: 'North', tripNumber: index + 1,
                rowId: index + 1, startTime: time - 10, endTime: time + 20, recoveryTime: 0, travelTime: 30, cycleTime: 30,
                stops: {}, stopMinutes: {Allandale: time, South: time + 10}}))},
        southTable: {routeName: entry.routeNumber, stops: [] as string[], stopIds: {}, trips: [] as unknown[]},
        metadata: {routeNumber: entry.routeNumber, dayType: entry.dayType, uploadedAt: new Date().toISOString()},
    }};
}

