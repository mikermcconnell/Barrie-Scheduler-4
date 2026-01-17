import type { MasterRouteTable } from './masterScheduleParser';
import type { DayType, MasterScheduleContent } from './masterScheduleTypes';
import { extractDayType, extractRouteNumber } from './masterScheduleTypes';
import { extractDirectionFromName } from './routeDirectionConfig';

export interface DraftContentBuildResult {
    content: MasterScheduleContent;
    routeNumber: string;
    dayType: DayType;
}

const buildEmptyTable = (routeNumber: string, dayType: DayType, direction: 'North' | 'South'): MasterRouteTable => ({
    routeName: `${routeNumber} (${dayType}) (${direction})`,
    stops: [],
    stopIds: {},
    trips: []
});

export const buildMasterContentFromTables = (
    tables: MasterRouteTable[]
): DraftContentBuildResult | null => {
    if (!tables.length) return null;

    const routeNumbers = new Set(tables.map(t => extractRouteNumber(t.routeName)));
    const dayTypes = new Set(tables.map(t => extractDayType(t.routeName)));

    if (routeNumbers.size !== 1 || dayTypes.size !== 1) {
        return null;
    }

    const routeNumber = Array.from(routeNumbers)[0];
    const dayType = Array.from(dayTypes)[0];

    let northTable: MasterRouteTable | undefined;
    let southTable: MasterRouteTable | undefined;

    tables.forEach(table => {
        const direction = extractDirectionFromName(table.routeName);
        if (direction === 'North' && !northTable) {
            northTable = table;
        } else if (direction === 'South' && !southTable) {
            southTable = table;
        } else if (!northTable) {
            northTable = table;
        } else if (!southTable) {
            southTable = table;
        }
    });

    const content: MasterScheduleContent = {
        northTable: northTable || buildEmptyTable(routeNumber, dayType, 'North'),
        southTable: southTable || buildEmptyTable(routeNumber, dayType, 'South'),
        metadata: {
            routeNumber,
            dayType,
            uploadedAt: new Date().toISOString()
        }
    };

    return { content, routeNumber, dayType };
};

export const buildTablesFromContent = (content: MasterScheduleContent): MasterRouteTable[] => {
    const tables: MasterRouteTable[] = [];

    if (content.northTable && (content.northTable.trips.length > 0 || content.northTable.stops.length > 0)) {
        tables.push(content.northTable);
    }

    if (content.southTable && (content.southTable.trips.length > 0 || content.southTable.stops.length > 0)) {
        tables.push(content.southTable);
    }

    if (tables.length === 0) {
        tables.push(content.northTable || content.southTable);
    }

    return tables;
};
