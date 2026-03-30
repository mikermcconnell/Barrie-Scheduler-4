const BARRIE_STOP_ALIAS_RULES: ReadonlyArray<readonly [RegExp, string]> = [
    [/\bdowntown barrie terminal\b/g, 'downtown'],
    [/\bdowntown terminal\b/g, 'downtown'],
    [/\bdowntown hub\b/g, 'downtown'],
    [/\ballandale waterfront go station\b/g, 'allandale'],
    [/\ballandale waterfront go\b/g, 'allandale'],
    [/\bbarrie allandale transit terminal(?: platform \d+)?\b/g, 'allandale'],
    [/\ballandale go station\b/g, 'allandale'],
    [/\ballandale go\b/g, 'allandale'],
    [/\ballandale terminal\b/g, 'allandale'],
    [/\bbarrie south go station\b/g, 'barrie south go'],
    [/\bpeggy hill community centre\b/g, 'peggy hill'],
    [/\bpeggy hill community center\b/g, 'peggy hill'],
    [/\bpark place terminal\b/g, 'park place'],
    [/\bgeorgian mall north entrance\b/g, 'georgian mall'],
    [/\bgeorgian mall south entrance\b/g, 'georgian mall'],
    [/\bgeorgian college main\b/g, 'georgian college'],
    [/\brvh main entrance\b/g, 'rvh'],
];

const applyBarrieStopAliases = (value: string): string => (
    BARRIE_STOP_ALIAS_RULES.reduce(
        (normalizedValue, [pattern, replacement]) => normalizedValue.replace(pattern, replacement),
        value
    )
);

export const normalizeSegmentStopKey = (value: string): string => {
    const normalized = value
        .toLowerCase()
        .replace(/^(arrive|arrival|depart|departure)\s+/i, '')
        .replace(/\s*\(\d+\)\s*$/g, '')
        .replace(/\(\s*platform\s*\d+\s*\)/g, ' ')
        .replace(/\bplatform\s+\d+\b/g, ' ')
        .replace(/\bpl\b/g, ' place ')
        .replace(/\bcoll\b/g, ' college ')
        .replace(/\bcoll\.\b/g, ' college ')
        .replace(/\bctr\b/g, ' centre ')
        .replace(/\bstn\b/g, ' station ')
        .replace(/\bterm\b/g, ' terminal ')
        .replace(/\bhwy\b/g, ' highway ')
        .replace(/&/g, ' and ')
        .replace(/[()[\]{}'".,#]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return applyBarrieStopAliases(normalized)
        .replace(/\s+/g, ' ')
        .trim();
};

export const normalizeSegmentNameForMatching = (segmentName: string): string => {
    const parts = segmentName.split(' to ');
    if (parts.length !== 2) return normalizeSegmentStopKey(segmentName);
    return `${normalizeSegmentStopKey(parts[0])} to ${normalizeSegmentStopKey(parts[1])}`;
};

export const buildNormalizedSegmentNameLookup = (
    segmentNames: readonly string[]
): Map<string, string> => {
    const lookup = new Map<string, string>();
    segmentNames.forEach((segmentName) => {
        const normalized = normalizeSegmentNameForMatching(segmentName);
        if (!lookup.has(normalized)) {
            lookup.set(normalized, segmentName);
        }
    });
    return lookup;
};

export const resolveCanonicalSegmentName = (
    observedSegmentName: string,
    canonicalSegmentNameLookup: ReadonlyMap<string, string>
): string | undefined => {
    return canonicalSegmentNameLookup.get(normalizeSegmentNameForMatching(observedSegmentName));
};
