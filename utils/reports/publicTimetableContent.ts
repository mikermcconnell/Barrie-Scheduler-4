export interface PublicTimetableFareRow {
    label: string;
    adult: string;
    student: string;
    children: string;
    senior: string;
    family: string;
}

export const PUBLIC_TIMETABLE_DISCLAIMER =
    'Times are approximate. Riders should arrive at the bus stop at least 5 minutes before the scheduled time.';

export const PUBLIC_TIMETABLE_FARE_EFFECTIVE_DATE = 'Current fares';

export const PUBLIC_TIMETABLE_FARE_HEADERS = [
    '',
    'Adult (19-64)',
    'Student (13-18)',
    'Children (12 & under)',
    'Senior (65+)',
    'Family',
] as const;

export const PUBLIC_TIMETABLE_FARE_ROWS: PublicTimetableFareRow[] = [
    { label: 'Single Ride', adult: '$3.50', student: '$3.50', children: 'Free', senior: '$3.00', family: '-' },
    { label: '10-Ride Card', adult: '$30', student: '$26', children: '-', senior: '$21', family: '-' },
    { label: 'Day Pass', adult: '$8.50', student: '$8.50', children: '-', senior: '$8.50', family: '$10' },
    { label: 'Monthly Pass', adult: '$93', student: '$71.25', children: '-', senior: '$54', family: '-' },
];

export const PUBLIC_TIMETABLE_FARE_NOTE =
    'Seniors Ride Free on Tuesdays and Thursdays. Single fares are valid, with a transfer, for 90 minutes on any route.';

export const PUBLIC_TIMETABLE_LEGEND_ITEMS = [
    'Timing stop & stop ID listed in schedule',
    'Regular stop & stop ID',
    'Connection to other fixed route',
    'Connection to Transit ON Demand',
] as const;

export const PUBLIC_TIMETABLE_PROMO_TITLE = 'Visit MyRideBarrie.ca';
export const PUBLIC_TIMETABLE_PROMO_TEXT =
    'or download "Transit" for real-time bus information and trip planning.';

export const PUBLIC_TIMETABLE_CONTACTS = [
    '705-726-4242',
    'servicebarrie@barrie.ca',
    'Barrie.ca/Transit',
] as const;
