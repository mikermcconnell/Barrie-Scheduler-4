export const normalizeSegmentStopKey = (value: string): string => (
    value
        .toLowerCase()
        .replace(/^(arrive|arrival|depart|departure)\s+/i, '')
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
        .trim()
);

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
