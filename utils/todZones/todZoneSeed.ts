import type { TodZoneDraft } from './todZoneTypes';

export const DEFAULT_TOD_ZONE_DEFINITIONS = [
    { code: 'A', label: 'Zone A', color: '#7c3aed', kind: 'permanent', active: true },
    { code: 'B', label: 'Zone B', color: '#2563eb', kind: 'permanent', active: true },
    { code: 'C', label: 'Zone C', color: '#0891b2', kind: 'permanent', active: true },
    { code: 'D', label: 'Zone D', color: '#059669', kind: 'permanent', active: true },
    { code: 'E', label: 'Zone E', color: '#65a30d', kind: 'permanent', active: true },
    { code: 'F', label: 'Zone F', color: '#d97706', kind: 'permanent', active: true },
    { code: 'H', label: 'Zone H', color: '#dc2626', kind: 'permanent', active: true },
    { code: 'T', label: 'Temporary Zone T', color: '#db2777', kind: 'temporary', active: true },
] as const;

export const ZONE_A_REFERENCE_STOP_IDS = [
    '202', '203', '207', '208', '309', '311', '315', '316', '317', '318', '320',
    '334', '336', '356', '357', '358', '359', '360', '361', '362', '363', '792', '793', '794', '795',
];

export function createTodZoneASeedDraft(): TodZoneDraft {
    return {
        schemaVersion: 1,
        revision: 0,
        definitions: DEFAULT_TOD_ZONE_DEFINITIONS.map(zone => ({ ...zone })),
        polygons: [
            { id: 'a-north', zoneCode: 'A', pocketName: 'A North', coordinates: [[-79.705939,44.413608],[-79.708734,44.417232],[-79.712819,44.416011],[-79.713776,44.416329],[-79.714061,44.417057],[-79.7137,44.417691],[-79.713274,44.417982],[-79.712306,44.41807],[-79.707739,44.419483],[-79.699378,44.423342],[-79.698418,44.423396],[-79.697458,44.422842],[-79.69736,44.422206],[-79.697839,44.421699],[-79.698637,44.42153],[-79.706415,44.417943],[-79.704247,44.415007],[-79.703681,44.414518],[-79.703669,44.413959],[-79.703982,44.413585],[-79.704871,44.41332],[-79.705939,44.413608]] },
            { id: 'a-ferris', zoneCode: 'A', pocketName: 'A Ferris', coordinates: [[-79.696446,44.403705],[-79.697214,44.403617],[-79.698006,44.403918],[-79.698359,44.404416],[-79.698237,44.404968],[-79.697856,44.405289],[-79.695343,44.40634],[-79.690295,44.40982],[-79.689215,44.409924],[-79.688484,44.409475],[-79.688372,44.408881],[-79.688838,44.408189],[-79.693652,44.404977],[-79.696446,44.403705]] },
            { id: 'a-lakeside', zoneCode: 'A', pocketName: 'A Lakeside', coordinates: [[-79.667245,44.415802],[-79.667756,44.415131],[-79.668859,44.414997],[-79.673762,44.416075],[-79.674299,44.416453],[-79.674437,44.417004],[-79.67393,44.417613],[-79.672828,44.417747],[-79.667949,44.416678],[-79.667388,44.416291],[-79.667245,44.415802]] },
            { id: 'a-coulter', zoneCode: 'A', pocketName: 'A Coulter', coordinates: [[-79.702159,44.397842],[-79.702911,44.397583],[-79.703788,44.39775],[-79.704293,44.398362],[-79.70669,44.399217],[-79.707018,44.399629],[-79.706996,44.400136],[-79.706477,44.400619],[-79.705415,44.400809],[-79.701984,44.399506],[-79.701582,44.399155],[-79.701467,44.398737],[-79.70163,44.398327],[-79.702159,44.397842]] },
        ],
        overrides: [],
        effectiveFrom: '2025-09-21',
        source: 'Transit ON Demand Zone A - Sept21.pdf; Codex first draft from official stop locations',
        reviewNote: 'Draft geometry for planner review. Four disconnected Zone A pockets; not an official GIS boundary.',
    };
}
