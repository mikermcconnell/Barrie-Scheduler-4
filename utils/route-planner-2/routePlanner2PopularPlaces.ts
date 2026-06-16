import type { RoutePlanner2AddressSuggestion } from './routePlanner2AddressSearch';

interface RoutePlanner2PopularPlace extends RoutePlanner2AddressSuggestion {
    aliases: string[];
}

export const ROUTE_PLANNER_2_POPULAR_BARRIE_PLACES: RoutePlanner2PopularPlace[] = [
    {
        id: 'popular-place-sadlon-arena',
        name: 'Sadlon Arena',
        label: 'Sadlon Arena · 555 Bayview Dr, Barrie, ON L4N 8Y2',
        lat: 44.3377,
        lng: -79.6875,
        aliases: ['sadlon', 'sadlon arena', 'barrie colts', 'barrie molson centre', '555 bayview', '555 bayview dr', 'l4n 8y2'],
    },
    {
        id: 'popular-place-peggy-hill-team-community-centre',
        name: 'Peggy Hill Team Community Centre',
        label: 'Peggy Hill Team Community Centre · 171 Mapleton Avenue, Barrie',
        lat: 44.3436,
        lng: -79.7341,
        aliases: ['peggy hill', 'holly rec', 'holly community centre', 'phtcc', '171 mapleton'],
    },
    {
        id: 'popular-place-barrie-community-sports-complex',
        name: 'Barrie Community Sports Complex',
        label: 'Barrie Community Sports Complex · 2100 Nursery Road, Midhurst',
        lat: 44.4421,
        lng: -79.7708,
        aliases: ['barrie sports complex', 'sports complex', 'nursery road', 'baycats', 'athletic kulture stadium'],
    },
    {
        id: 'popular-place-allandale-recreation-centre',
        name: 'Allandale Recreation Centre',
        label: 'Allandale Recreation Centre · 190 Bayview Drive, Barrie',
        lat: 44.3733,
        lng: -79.6874,
        aliases: ['allandale rec', 'allandale recreation', '190 bayview'],
    },
    {
        id: 'popular-place-east-bayfield-community-centre',
        name: 'East Bayfield Community Centre',
        label: 'East Bayfield Community Centre · 80 Livingstone Street East, Barrie',
        lat: 44.4139,
        lng: -79.6878,
        aliases: ['east bayfield', 'east bayfield community centre', '80 livingstone'],
    },
    {
        id: 'popular-place-eastview-arena',
        name: 'Eastview Arena',
        label: 'Eastview Arena · 453 Grove Street East, Barrie',
        lat: 44.4043,
        lng: -79.6603,
        aliases: ['eastview', 'eastview arena', '453 grove'],
    },
    {
        id: 'popular-place-parkview-centre',
        name: 'Parkview Centre',
        label: 'Parkview Centre · 189 Blake Street, Barrie',
        lat: 44.3896,
        lng: -79.6687,
        aliases: ['parkview', 'parkview centre', '189 blake'],
    },
    {
        id: 'popular-place-city-hall',
        name: 'City Hall',
        label: 'City Hall · 70 Collier Street, Barrie',
        lat: 44.3892,
        lng: -79.6904,
        aliases: ['city hall', 'service barrie', '70 collier'],
    },
    {
        id: 'popular-place-barrie-public-library-downtown',
        name: 'Barrie Public Library Downtown',
        label: 'Barrie Public Library Downtown · 60 Worsley Street, Barrie',
        lat: 44.3897,
        lng: -79.6893,
        aliases: ['library downtown', 'barrie library', 'downtown library', '60 worsley'],
    },
    {
        id: 'popular-place-barrie-public-library-painswick',
        name: 'Barrie Public Library Painswick',
        label: 'Barrie Public Library Painswick · 48 Dean Avenue, Barrie',
        lat: 44.3398,
        lng: -79.6368,
        aliases: ['painswick library', 'library painswick', '48 dean'],
    },
    {
        id: 'popular-place-barrie-public-library-holly',
        name: 'Barrie Public Library Holly',
        label: 'Barrie Public Library Holly · 555 Essa Road, Unit 17, Barrie',
        lat: 44.3402,
        lng: -79.7134,
        aliases: ['holly library', 'library holly', '555 essa'],
    },
    {
        id: 'popular-place-georgian-college',
        name: 'Georgian College',
        label: 'Georgian College · 1 Georgian Drive, Barrie',
        lat: 44.4124,
        lng: -79.6689,
        aliases: ['georgian', 'georgian college', 'georgian theatre', '1 georgian'],
    },
    {
        id: 'popular-place-royal-victoria-regional-health-centre',
        name: 'Royal Victoria Regional Health Centre',
        label: 'Royal Victoria Regional Health Centre · 201 Georgian Drive, Barrie',
        lat: 44.4153,
        lng: -79.6647,
        aliases: ['rvh', 'royal victoria', 'hospital', '201 georgian'],
    },
    {
        id: 'popular-place-park-place',
        name: 'Park Place',
        label: 'Park Place · 100 Mapleview Drive East, Barrie',
        lat: 44.3364,
        lng: -79.6816,
        aliases: ['park place', '100 mapleview'],
    },
    {
        id: 'popular-place-georgian-mall',
        name: 'Georgian Mall',
        label: 'Georgian Mall · 509 Bayfield Street, Barrie',
        lat: 44.4147,
        lng: -79.7087,
        aliases: ['georgian mall', '509 bayfield'],
    },
    {
        id: 'popular-place-barrie-south-go',
        name: 'Barrie South GO',
        label: 'Barrie South GO · 833 Yonge Street, Barrie',
        lat: 44.3394,
        lng: -79.6259,
        aliases: ['barrie south go', 'south go', '833 yonge'],
    },
    {
        id: 'popular-place-allandale-waterfront-go',
        name: 'Allandale Waterfront GO',
        label: 'Allandale Waterfront GO · 24 Essa Road, Barrie',
        lat: 44.3756,
        lng: -79.6886,
        aliases: ['allandale go', 'allandale waterfront', 'waterfront go', '24 essa'],
    },
    {
        id: 'popular-place-five-points-theatre',
        name: 'Five Points Theatre',
        label: 'Five Points Theatre · 1 Dunlop Street West, Barrie',
        lat: 44.3896,
        lng: -79.6908,
        aliases: ['five points', 'five points theatre', '1 dunlop'],
    },
    {
        id: 'popular-place-meridian-place',
        name: 'Meridian Place',
        label: 'Meridian Place · 65 Dunlop Street East, Barrie',
        lat: 44.3898,
        lng: -79.6891,
        aliases: ['meridian place', 'memorial square', '65 dunlop'],
    },
    {
        id: 'popular-place-general-john-hayter-southshore-community-centre',
        name: 'General John Hayter Southshore Community Centre',
        label: 'General John Hayter Southshore Community Centre · 205 Lakeshore Drive, Barrie',
        lat: 44.3776,
        lng: -79.6872,
        aliases: ['southshore community centre', 'southshore centre', '205 lakeshore'],
    },
];

function normalizeSearchText(value: string): string {
    return value
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

export function searchRoutePlanner2PopularBarriePlaces(query: string, limit = 5): RoutePlanner2AddressSuggestion[] {
    const normalizedQuery = normalizeSearchText(query);
    if (normalizedQuery.length < 3) return [];

    return ROUTE_PLANNER_2_POPULAR_BARRIE_PLACES
        .map((place) => {
            const searchableText = normalizeSearchText([
                place.name,
                place.label,
                ...place.aliases,
            ].join(' '));
            const aliasStartsWithQuery = place.aliases.some((alias) => normalizeSearchText(alias).startsWith(normalizedQuery));
            const nameStartsWithQuery = normalizeSearchText(place.name).startsWith(normalizedQuery);
            const includesQuery = searchableText.includes(normalizedQuery);
            if (!aliasStartsWithQuery && !nameStartsWithQuery && !includesQuery) return null;

            return {
                place,
                score: nameStartsWithQuery ? 0 : aliasStartsWithQuery ? 1 : 2,
            };
        })
        .filter((match): match is { place: RoutePlanner2PopularPlace; score: number } => match !== null)
        .sort((a, b) => a.score - b.score || a.place.name.localeCompare(b.place.name))
        .slice(0, limit)
        .map(({ place }) => ({
            id: place.id,
            name: place.name,
            label: place.label,
            lat: place.lat,
            lng: place.lng,
        }));
}
