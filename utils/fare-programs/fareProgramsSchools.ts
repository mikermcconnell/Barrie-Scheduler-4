export interface FareProgramsHighSchool {
    id: string;
    name: string;
    board: 'SCDSB' | 'SMCDSB' | 'Conseil scolaire Viamonde' | 'CSC MonAvenir';
    latitude: number;
    longitude: number;
}

/**
 * Publicly funded secondary schools within Barrie.
 * Coordinates are map reference points for planning context, not pass-use destinations.
 */
export const BARRIE_HIGH_SCHOOLS: readonly FareProgramsHighSchool[] = [
    { id: 'barrie-north', name: 'Barrie North Collegiate', board: 'SCDSB', latitude: 44.4012, longitude: -79.6901 },
    { id: 'bear-creek', name: 'Bear Creek Secondary School', board: 'SCDSB', latitude: 44.3319, longitude: -79.7337 },
    { id: 'eastview', name: 'Eastview Secondary School', board: 'SCDSB', latitude: 44.4049, longitude: -79.6616 },
    { id: 'innisdale', name: 'Innisdale Secondary School', board: 'SCDSB', latitude: 44.3594, longitude: -79.6854 },
    { id: 'maple-ridge', name: 'Maple Ridge Secondary School', board: 'SCDSB', latitude: 44.3509, longitude: -79.6086 },
    { id: 'st-joan-of-arc', name: 'St. Joan of Arc Catholic High School', board: 'SMCDSB', latitude: 44.349177, longitude: -79.733093 },
    { id: 'st-joseph', name: "St. Joseph's Catholic High School", board: 'SMCDSB', latitude: 44.412758, longitude: -79.684424 },
    { id: 'st-peter', name: "St. Peter's Catholic Secondary School", board: 'SMCDSB', latitude: 44.355015, longitude: -79.64007 },
    { id: 'romeo-dallaire', name: 'École secondaire Roméo-Dallaire', board: 'Conseil scolaire Viamonde', latitude: 44.327103, longitude: -79.714958 },
    { id: 'nouvelle-alliance', name: 'École secondaire catholique Nouvelle-Alliance', board: 'CSC MonAvenir', latitude: 44.39613, longitude: -79.715686 },
] as const;
