import * as XLSX from 'xlsx';

import {
    searchRoutePlanner2Addresses,
    type RoutePlanner2AddressSearchOptions,
    type RoutePlanner2AddressSearchDiagnostic,
    type RoutePlanner2AddressSuggestion,
} from './routePlanner2AddressSearch';
import type { RoutePlanner2StopRole } from './routePlanner2Types';

const CANADIAN_POSTAL_CODE = /\b([A-Z]\d[A-Z])[\s-]?(\d[A-Z]\d)\b/i;
const CITY_PROVINCE_POSTAL = /\b([A-Z][A-Za-z .'-]+),?\s+(ON|ONTARIO)\s+([A-Z]\d[A-Z])[\s-]?(\d[A-Z]\d)\b/i;
const STREET_TYPE = /\b(street|st\.?|road|rd\.?|avenue|ave\.?|drive|dr\.?|crescent|cres\.?|court|ct\.?|boulevard|blvd\.?|lane|ln\.?|way|place|pl\.?|trail|terrace|terr\.?|circle|cir\.?|parkway|pkwy|highway|hwy|line|sideroad|gate|grove|garden|gardens|square|sq\.?|bay|close|mews)\b/i;
const CIVIC_NUMBER = /^\s*(?:[A-Z]?\d+[A-Z]?\s*[-/]\s*)?\d+[A-Z]?\b/;
const STREET_ADDRESS_FRAGMENT = /((?:[A-Z]?\d+[A-Z]?\s*[-/]\s*)?\d+[A-Z]?\s+[A-Za-z0-9 .'’-]+?\b(?:street|st\.?|road|rd\.?|avenue|ave\.?|drive|dr\.?|crescent|cres\.?|court|ct\.?|boulevard|blvd\.?|lane|ln\.?|way|place|pl\.?|trail|terrace|terr\.?|circle|cir\.?|parkway|pkwy|highway|hwy|line|sideroad|gate|grove|garden|gardens|square|sq\.?|bay|close|mews)\b(?:\s+(?:north|south|east|west|n|s|e|w)\b)?)/i;

const NOISE_LINE = /\b(roster|report|date|time|program|enrollment|enrollee|receipt|payment|guardian|emergency|phone|gender|gndr|birth|grade|qty|total|fee|resident|waitlist|transfer|page|location|course|status)\b/i;

export interface RoutePlanner2ParsedAddress {
    id: string;
    address: string;
    streetLine: string;
    city: string;
    province: string;
    postalCode: string;
    normalizedKey: string;
    sourceRows: number[];
    sourceCells: string[];
    occurrenceCount: number;
}

export interface RoutePlanner2AddressParseResult {
    addresses: RoutePlanner2ParsedAddress[];
    duplicateCount: number;
    warningCount: number;
}

export interface RoutePlanner2GeocodedAddressStop {
    id: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
    occurrenceCount: number;
    notes: string;
    sourceRows: number[];
    role?: RoutePlanner2StopRole;
}

export interface RoutePlanner2UnresolvedAddress {
    candidate: RoutePlanner2ParsedAddress;
    reason: string;
    diagnostics?: RoutePlanner2AddressSearchDiagnostic[];
    attempts?: RoutePlanner2AddressGeocodeAttempt[];
}

export interface RoutePlanner2AddressGeocodeResult {
    mappedStops: RoutePlanner2GeocodedAddressStop[];
    unresolved: RoutePlanner2UnresolvedAddress[];
}

export interface RoutePlanner2AddressGeocodeProgress {
    completed: number;
    total: number;
    currentAddress?: string;
}

export interface RoutePlanner2AddressGeocodeOptions extends RoutePlanner2AddressSearchOptions {
    concurrency?: number;
    onProgress?: (progress: RoutePlanner2AddressGeocodeProgress) => void;
}

interface ExtractedAddress {
    streetLine: string;
    city: string;
    province: string;
    postalCode: string;
}

interface UnitStreetParts {
    unit: string;
    baseStreetLine: string;
}

interface CivicRangeParts {
    startStreetLine: string;
    endStreetLine: string;
}

interface AddressGeocodeVariant {
    query: string;
    streetLineForMatch: string;
    note?: string;
}

export interface RoutePlanner2AddressGeocodeAttempt {
    query: string;
    matchAgainst: string;
    resultCount: number;
    topResultLabel?: string;
    rejectedReason: string;
}

function toCellText(value: unknown): string {
    if (value == null) return '';
    return String(value).replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').trim();
}

function normalizeLines(text: string): string[] {
    return text
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
}

function isNoiseLine(line: string): boolean {
    return NOISE_LINE.test(line) && !CANADIAN_POSTAL_CODE.test(line) && !STREET_TYPE.test(line);
}

function isStreetLine(line: string): boolean {
    if (isNoiseLine(line)) return false;
    return CIVIC_NUMBER.test(line) && STREET_TYPE.test(line);
}

function extractStreetLine(line: string): string | null {
    const trimmed = line.trim();
    const fragment = trimmed.match(STREET_ADDRESS_FRAGMENT)?.[1]?.trim();
    if (fragment && isStreetLine(fragment)) return fragment;
    return isStreetLine(trimmed) ? trimmed : null;
}

function normalizePostalCode(value: string): string {
    const match = value.match(CANADIAN_POSTAL_CODE);
    return match ? `${match[1].toUpperCase()} ${match[2].toUpperCase()}` : value.toUpperCase();
}

function normalizeAddressKey(streetLine: string, city: string, province: string, postalCode: string): string {
    return `${streetLine} ${city} ${province} ${postalCode}`
        .toUpperCase()
        .replace(/\bONTARIO\b/g, 'ON')
        .replace(/\bSTREET\b/g, 'ST')
        .replace(/\bROAD\b/g, 'RD')
        .replace(/\bAVENUE\b/g, 'AVE')
        .replace(/\bDRIVE\b/g, 'DR')
        .replace(/\bCRESCENT\b/g, 'CRES')
        .replace(/\bCOURT\b/g, 'CT')
        .replace(/\bBOULEVARD\b/g, 'BLVD')
        .replace(/\bLANE\b/g, 'LN')
        .replace(/\bPLACE\b/g, 'PL')
        .replace(/\bPARKWAY\b/g, 'PKWY')
        .replace(/[^A-Z0-9]+/g, ' ')
        .trim();
}

function getUnitStreetParts(streetLine: string): UnitStreetParts | null {
    const trimmed = streetLine.trim();
    const explicitUnitMatch = trimmed.match(/^\s*(?:unit|apt|apartment|suite|ste|#)\s*([A-Z]?\d+[A-Z]?)\s*[-/]\s*(\d+[A-Z]?\s+.+)$/i);
    const compactUnitMatch = trimmed.match(/^\s*([A-Z]?\d+[A-Z]?)\s*[-/]\s*(\d+[A-Z]?\s+.+)$/i);
    const match = explicitUnitMatch ?? compactUnitMatch;
    if (!match) return null;

    const unit = match[1]?.trim();
    const baseStreetLine = match[2]?.replace(/\s+/g, ' ').trim();
    if (!unit || !baseStreetLine || !isStreetLine(baseStreetLine)) return null;

    if (explicitUnitMatch) return { unit, baseStreetLine };

    const unitNumber = Number.parseInt(unit.replace(/^\D+/, ''), 10);
    const civicNumber = Number.parseInt(baseStreetLine, 10);
    if (!Number.isFinite(unitNumber) || !Number.isFinite(civicNumber)) return null;

    // Treat small leading numbers, and larger high-rise style values like
    // "1012-37 Johnson St", as unit/suite prefixes. Avoid normal civic ranges
    // such as "309-339 Essa Rd", where both numbers are similar street numbers.
    if ((unitNumber <= 99 || unitNumber > civicNumber) && civicNumber <= 9999) {
        return { unit, baseStreetLine };
    }

    return null;
}

function getCivicRangeParts(streetLine: string): CivicRangeParts | null {
    if (getUnitStreetParts(streetLine)) return null;

    const match = streetLine.trim().match(/^\s*(\d+[A-Z]?)\s*[-/]\s*(\d+[A-Z]?)(\s+.+)$/i);
    if (!match) return null;

    const startNumber = match[1]?.trim();
    const endNumber = match[2]?.trim();
    const streetName = match[3]?.replace(/\s+/g, ' ').trim();
    if (!startNumber || !endNumber || !streetName) return null;

    const startStreetLine = `${startNumber} ${streetName}`;
    const endStreetLine = `${endNumber} ${streetName}`;
    if (!isStreetLine(startStreetLine) || !isStreetLine(endStreetLine)) return null;

    return { startStreetLine, endStreetLine };
}

function formatAddress(streetLine: string, city: string, province: string, postalCode?: string): string {
    return [
        streetLine,
        city,
        postalCode ? `${province} ${postalCode}` : province,
    ].filter(Boolean).join(', ');
}

function buildAddressGeocodeVariants(candidate: RoutePlanner2ParsedAddress): AddressGeocodeVariant[] {
    const unitParts = getUnitStreetParts(candidate.streetLine);
    const rangeParts = unitParts ? null : getCivicRangeParts(candidate.streetLine);
    const variants: AddressGeocodeVariant[] = [];
    const pushVariant = (query: string, streetLineForMatch: string, note?: string) => {
        if (variants.some((variant) => variant.query.toUpperCase() === query.toUpperCase())) return;
        variants.push({ query, streetLineForMatch, note });
    };

    if (unitParts) {
        const baseAddress = formatAddress(unitParts.baseStreetLine, candidate.city, candidate.province, candidate.postalCode);
        pushVariant(
            baseAddress,
            unitParts.baseStreetLine,
            `Unit-style address "${candidate.streetLine}" was geocoded as base address "${unitParts.baseStreetLine}".`,
        );
        pushVariant(
            `Unit ${unitParts.unit}, ${baseAddress}`,
            unitParts.baseStreetLine,
            `Unit-style address "${candidate.streetLine}" was geocoded as base address "${unitParts.baseStreetLine}".`,
        );
    }

    if (rangeParts) {
        const note = `Range-style address "${candidate.streetLine}" was geocoded using a civic endpoint.`;
        pushVariant(formatAddress(rangeParts.endStreetLine, candidate.city, candidate.province, candidate.postalCode), rangeParts.endStreetLine, note);
        pushVariant(formatAddress(rangeParts.startStreetLine, candidate.city, candidate.province, candidate.postalCode), rangeParts.startStreetLine, note);
    }

    pushVariant(candidate.address, unitParts?.baseStreetLine ?? candidate.streetLine);

    const streetLineForMatch = unitParts?.baseStreetLine ?? rangeParts?.endStreetLine ?? candidate.streetLine;
    pushVariant(formatAddress(streetLineForMatch, candidate.city, candidate.province), streetLineForMatch);
    pushVariant(`${streetLineForMatch}, ${candidate.city}, ${candidate.postalCode}`, streetLineForMatch);

    return variants;
}

function extractAddressFromText(text: string): ExtractedAddress | null {
    const lines = normalizeLines(text);
    if (lines.length < 1) return null;

    for (let postalIndex = 0; postalIndex < lines.length; postalIndex += 1) {
        const postalLine = lines[postalIndex];
        const cityMatch = postalLine.match(CITY_PROVINCE_POSTAL);
        if (!cityMatch) continue;

        const sameLinePrefix = postalLine.slice(0, cityMatch.index ?? 0);
        const sameLineStreet = extractStreetLine(sameLinePrefix);
        if (sameLineStreet) {
            return {
                streetLine: sameLineStreet,
                city: cityMatch[1].trim(),
                province: cityMatch[2].toUpperCase() === 'ONTARIO' ? 'ON' : cityMatch[2].toUpperCase(),
                postalCode: normalizePostalCode(`${cityMatch[3]} ${cityMatch[4]}`),
            };
        }

        for (let streetIndex = postalIndex - 1; streetIndex >= 0; streetIndex -= 1) {
            const streetLine = extractStreetLine(lines[streetIndex]);
            if (!streetLine) continue;

            return {
                streetLine,
                city: cityMatch[1].trim(),
                province: cityMatch[2].toUpperCase() === 'ONTARIO' ? 'ON' : cityMatch[2].toUpperCase(),
                postalCode: normalizePostalCode(`${cityMatch[3]} ${cityMatch[4]}`),
            };
        }
    }

    return null;
}

export function parseRoutePlanner2AddressText(
    text: string,
    options: { id?: string; sourceRow?: number; sourceCell?: string } = {},
): RoutePlanner2ParsedAddress | null {
    const extracted = extractAddressFromText(text);
    if (!extracted) return null;

    const normalizedKey = normalizeAddressKey(extracted.streetLine, extracted.city, extracted.province, extracted.postalCode);
    const address = `${extracted.streetLine}, ${extracted.city}, ${extracted.province} ${extracted.postalCode}`;

    return {
        id: options.id ?? 'address-manual-review',
        address,
        streetLine: extracted.streetLine,
        city: extracted.city,
        province: extracted.province,
        postalCode: extracted.postalCode,
        normalizedKey,
        sourceRows: [options.sourceRow ?? 1],
        sourceCells: [options.sourceCell ?? 'manual-review'],
        occurrenceCount: 1,
    };
}

function makeCellRef(rowIndex: number, columnIndex: number): string {
    return `${XLSX.utils.encode_col(columnIndex)}${rowIndex + 1}`;
}

function pushExtractedAddress(
    byKey: Map<string, RoutePlanner2ParsedAddress>,
    extracted: ExtractedAddress,
    sourceRow: number,
    sourceCell: string,
    countOccurrence = true,
): void {
    const normalizedKey = normalizeAddressKey(extracted.streetLine, extracted.city, extracted.province, extracted.postalCode);
    const address = `${extracted.streetLine}, ${extracted.city}, ${extracted.province} ${extracted.postalCode}`;
    const current = byKey.get(normalizedKey);

    if (current) {
        const isNewSourceCell = !current.sourceCells.includes(sourceCell);
        if (countOccurrence && isNewSourceCell) {
            current.occurrenceCount += 1;
        }
        if (!current.sourceRows.includes(sourceRow)) {
            current.sourceRows.push(sourceRow);
        }
        if (isNewSourceCell) current.sourceCells.push(sourceCell);
        return;
    }

    byKey.set(normalizedKey, {
        id: `address-${byKey.size + 1}`,
        address,
        streetLine: extracted.streetLine,
        city: extracted.city,
        province: extracted.province,
        postalCode: extracted.postalCode,
        normalizedKey,
        sourceRows: [sourceRow],
        sourceCells: [sourceCell],
        occurrenceCount: 1,
    });
}

export function parseRoutePlanner2AddressWorkbook(buffer: ArrayBuffer, _fileName = 'addresses.xlsx'): RoutePlanner2AddressParseResult {
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
    const byKey = new Map<string, RoutePlanner2ParsedAddress>();
    let warningCount = 0;

    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;

        const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false, blankrows: false });
        const previousRowTexts: string[] = [];
        rows.forEach((row, rowIndex) => {
            const rowTextParts: string[] = [];
            let rowHadExtraction = false;

            row.forEach((cell, columnIndex) => {
                const text = toCellText(cell);
                if (!text) return;
                rowTextParts.push(text);

                const extracted = extractAddressFromText(text);
                if (extracted) {
                    pushExtractedAddress(byKey, extracted, rowIndex + 1, `${sheetName}!${makeCellRef(rowIndex, columnIndex)}`);
                    rowHadExtraction = true;
                }
            });

            const rowText = rowTextParts.join('\n');
            const extracted = extractAddressFromText(rowText);
            if (extracted) {
                pushExtractedAddress(byKey, extracted, rowIndex + 1, `${sheetName}!row-${rowIndex + 1}`, false);
                rowHadExtraction = true;
            }

            if (!rowHadExtraction && CANADIAN_POSTAL_CODE.test(rowText) && previousRowTexts.length > 0) {
                const combinedText = [...previousRowTexts, rowText].join('\n');
                const combinedExtracted = extractAddressFromText(combinedText);
                if (combinedExtracted) {
                    pushExtractedAddress(byKey, combinedExtracted, rowIndex + 1, `${sheetName}!rows-${Math.max(1, rowIndex + 1 - previousRowTexts.length)}-${rowIndex + 1}`, false);
                    rowHadExtraction = true;
                }
            }

            if (!rowHadExtraction && CANADIAN_POSTAL_CODE.test(rowText) && !isNoiseLine(rowText)) {
                warningCount += 1;
            }

            if (rowText) {
                previousRowTexts.push(rowText);
                if (previousRowTexts.length > 2) previousRowTexts.shift();
            }
        });
    }

    const addresses = [...byKey.values()].sort((a, b) => {
        const rowCompare = Math.min(...a.sourceRows) - Math.min(...b.sourceRows);
        return rowCompare !== 0 ? rowCompare : a.address.localeCompare(b.address);
    });

    return {
        addresses,
        duplicateCount: addresses.reduce((sum, address) => sum + Math.max(0, address.occurrenceCount - 1), 0),
        warningCount,
    };
}

function getStreetMatchParts(streetLine: string): { civicNumber: string | null; streetToken: string | null } {
    const civicMatch = streetLine.match(/^\s*(?:[A-Z]?\d+[A-Z]?\s*[-/]\s*)?(\d+[A-Z]?)\b/i);
    const streetName = streetLine
        .replace(/^\s*(?:[A-Z]?\d+[A-Z]?\s*[-/]\s*)?\d+[A-Z]?\b/i, '')
        .trim()
        .split(/\s+/)
        .find((token) => token.length > 2 && !STREET_TYPE.test(token));

    return {
        civicNumber: civicMatch?.[1]?.toLowerCase() ?? null,
        streetToken: streetName?.toLowerCase() ?? null,
    };
}

function isWithinBarrieArea(suggestion: RoutePlanner2AddressSuggestion): boolean {
    return suggestion.lat >= 44.25 && suggestion.lat <= 44.55 && suggestion.lng >= -79.9 && suggestion.lng <= -79.45;
}

function containsToken(text: string, token: string): boolean {
    const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escapedToken}([^a-z0-9]|$)`, 'i').test(text);
}

function isConfidentAddressMatch(
    candidate: RoutePlanner2ParsedAddress,
    suggestion: RoutePlanner2AddressSuggestion,
    streetLineForMatch = candidate.streetLine,
): boolean {
    if (!isWithinBarrieArea(suggestion)) return false;
    const label = `${suggestion.name} ${suggestion.label}`.toLowerCase();
    const { civicNumber, streetToken } = getStreetMatchParts(streetLineForMatch);

    if (civicNumber && !containsToken(label, civicNumber)) return false;
    if (streetToken && !containsToken(label, streetToken)) return false;
    return true;
}

function getSuggestionRejectionReason(
    candidate: RoutePlanner2ParsedAddress,
    suggestion: RoutePlanner2AddressSuggestion | undefined,
    streetLineForMatch: string,
): string {
    if (!suggestion) return 'No Mapbox results for this query.';
    if (!isWithinBarrieArea(suggestion)) return 'Top Mapbox result is outside the Barrie area.';

    const label = `${suggestion.name} ${suggestion.label}`.toLowerCase();
    const { civicNumber, streetToken } = getStreetMatchParts(streetLineForMatch);
    if (civicNumber && !containsToken(label, civicNumber)) {
        return `Top Mapbox result did not include civic number ${civicNumber}.`;
    }
    if (streetToken && !containsToken(label, streetToken)) {
        return `Top Mapbox result did not include street token "${streetToken}".`;
    }
    if (!containsToken(label, candidate.city.toLowerCase())) {
        return `Top Mapbox result did not clearly include ${candidate.city}.`;
    }
    return 'Top Mapbox result did not pass confidence checks.';
}

function scoreAddressSuggestion(
    candidate: RoutePlanner2ParsedAddress,
    suggestion: RoutePlanner2AddressSuggestion,
    streetLineForMatch: string,
): number {
    if (!isWithinBarrieArea(suggestion)) return Number.NEGATIVE_INFINITY;

    const label = `${suggestion.name} ${suggestion.label}`.toLowerCase();
    const { civicNumber, streetToken } = getStreetMatchParts(streetLineForMatch);
    let score = 0;

    if (civicNumber) {
        if (!containsToken(label, civicNumber)) return Number.NEGATIVE_INFINITY;
        score += 5;
    }

    if (streetToken) {
        if (!containsToken(label, streetToken)) return Number.NEGATIVE_INFINITY;
        score += 5;
    }

    if (containsToken(label, candidate.city.toLowerCase())) score += 2;
    if (containsToken(label, candidate.province.toLowerCase()) || containsToken(label, 'ontario')) score += 1;
    if (candidate.postalCode && label.includes(candidate.postalCode.toLowerCase())) score += 1;

    return score;
}

function selectBestConfidentSuggestion(
    candidate: RoutePlanner2ParsedAddress,
    suggestions: RoutePlanner2AddressSuggestion[],
    streetLineForMatch: string,
): RoutePlanner2AddressSuggestion | null {
    let bestSuggestion: RoutePlanner2AddressSuggestion | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    suggestions.forEach((suggestion) => {
        const score = scoreAddressSuggestion(candidate, suggestion, streetLineForMatch);
        if (score > bestScore) {
            bestSuggestion = suggestion;
            bestScore = score;
        }
    });

    return bestSuggestion && isConfidentAddressMatch(candidate, bestSuggestion, streetLineForMatch)
        ? bestSuggestion
        : null;
}

function distanceSquared(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const lngScale = Math.cos((a.lat * Math.PI) / 180);
    const latDelta = a.lat - b.lat;
    const lngDelta = (a.lng - b.lng) * lngScale;
    return (latDelta * latDelta) + (lngDelta * lngDelta);
}

export function orderRoutePlanner2StopsGeographically<T extends { lat: number; lng: number; name?: string }>(stops: T[]): T[] {
    if (stops.length <= 2) {
        return [...stops].sort((a, b) => (b.lat - a.lat) || (a.lng - b.lng) || (a.name ?? '').localeCompare(b.name ?? ''));
    }

    const remaining = [...stops].sort((a, b) => (b.lat - a.lat) || (a.lng - b.lng) || (a.name ?? '').localeCompare(b.name ?? ''));
    const ordered: T[] = [remaining.shift()!];

    while (remaining.length > 0) {
        const current = ordered[ordered.length - 1]!;
        let nextIndex = 0;
        let nextDistance = Number.POSITIVE_INFINITY;

        remaining.forEach((candidate, index) => {
            const distance = distanceSquared(current, candidate);
            if (distance < nextDistance) {
                nextDistance = distance;
                nextIndex = index;
            }
        });

        ordered.push(remaining.splice(nextIndex, 1)[0]!);
    }

    return ordered;
}

export async function geocodeRoutePlanner2ParsedAddresses(
    candidates: RoutePlanner2ParsedAddress[],
    options: RoutePlanner2AddressGeocodeOptions = {},
): Promise<RoutePlanner2AddressGeocodeResult> {
    const total = candidates.length;
    const { concurrency = 4, onProgress, ...searchOptions } = options;
    const safeConcurrency = Math.max(1, Math.min(Math.floor(concurrency), 6, total || 1));
    const suggestionCache = new Map<string, Promise<RoutePlanner2AddressSuggestion[]>>();
    const results: Array<{
        mappedStop?: RoutePlanner2GeocodedAddressStop;
        unresolved?: RoutePlanner2UnresolvedAddress;
    }> = new Array(total);
    let nextIndex = 0;
    let completed = 0;

    function cachedSearchVariant(
        variant: AddressGeocodeVariant,
        diagnostics: RoutePlanner2AddressSearchDiagnostic[],
    ): Promise<RoutePlanner2AddressSuggestion[]> {
        const cacheKey = `${variant.query.trim().toUpperCase()}|5`;
        const cached = suggestionCache.get(cacheKey);
        if (cached) return cached;

        const promise = searchRoutePlanner2Addresses(variant.query, {
            ...searchOptions,
            limit: 5,
            onDiagnostic: (diagnostic) => {
                diagnostics.push(diagnostic);
                searchOptions.onDiagnostic?.(diagnostic);
            },
        });
        suggestionCache.set(cacheKey, promise);
        return promise;
    }

    async function geocodeCandidate(candidate: RoutePlanner2ParsedAddress): Promise<{
        mappedStop?: RoutePlanner2GeocodedAddressStop;
        unresolved?: RoutePlanner2UnresolvedAddress;
    }> {
        try {
            const variants = buildAddressGeocodeVariants(candidate);
            let selectedSuggestion: RoutePlanner2AddressSuggestion | null = null;
            let selectedVariant: AddressGeocodeVariant | null = null;
            let sawMapboxSuggestion = false;
            const diagnostics: RoutePlanner2AddressSearchDiagnostic[] = [];
            const attempts: RoutePlanner2AddressGeocodeAttempt[] = [];

            for (const variant of variants) {
                const suggestions = await cachedSearchVariant(variant, diagnostics);
                if (suggestions.length > 0) sawMapboxSuggestion = true;

                const bestSuggestion = selectBestConfidentSuggestion(candidate, suggestions, variant.streetLineForMatch);
                if (bestSuggestion) {
                    selectedSuggestion = bestSuggestion;
                    selectedVariant = variant;
                    break;
                }

                attempts.push({
                    query: variant.query,
                    matchAgainst: variant.streetLineForMatch,
                    resultCount: suggestions.length,
                    topResultLabel: suggestions[0]?.label,
                    rejectedReason: getSuggestionRejectionReason(candidate, suggestions[0], variant.streetLineForMatch),
                });
            }

            if (!selectedSuggestion || !selectedVariant) {
                return {
                    unresolved: {
                        candidate,
                        reason: sawMapboxSuggestion
                            ? 'Mapbox match was not confident enough.'
                            : 'No Mapbox match found.',
                        diagnostics,
                        attempts,
                    },
                };
            }

            return {
                mappedStop: {
                    id: candidate.id,
                    name: candidate.streetLine,
                    address: candidate.address,
                    lat: selectedSuggestion.lat,
                    lng: selectedSuggestion.lng,
                    occurrenceCount: candidate.occurrenceCount,
                    sourceRows: candidate.sourceRows,
                    notes: [
                        `Imported from address file: ${candidate.address}.`,
                        selectedVariant.note,
                        candidate.occurrenceCount > 1 ? `${candidate.occurrenceCount} source rows were merged into this stop.` : null,
                        `Source rows: ${candidate.sourceRows.join(', ')}.`,
                        `Mapbox match: ${selectedSuggestion.label}.`,
                    ].filter(Boolean).join(' '),
                },
            };
        } catch (error) {
            return {
                unresolved: {
                    candidate,
                    reason: error instanceof Error ? error.message : 'Address could not be geocoded.',
                    diagnostics: [],
                    attempts: [],
                },
            };
        }
    }

    onProgress?.({ completed: 0, total });

    async function worker(): Promise<void> {
        while (nextIndex < total) {
            const index = nextIndex;
            nextIndex += 1;

            const candidate = candidates[index];
            if (!candidate) continue;

            results[index] = await geocodeCandidate(candidate);
            completed += 1;
            onProgress?.({ completed, total, currentAddress: candidate.address });
        }
    }

    await Promise.all(Array.from({ length: safeConcurrency }, () => worker()));

    const mappedStops = results
        .map((result) => result?.mappedStop)
        .filter((stop): stop is RoutePlanner2GeocodedAddressStop => Boolean(stop));
    const unresolved = results
        .map((result) => result?.unresolved)
        .filter((item): item is RoutePlanner2UnresolvedAddress => Boolean(item));

    return {
        mappedStops: orderRoutePlanner2StopsGeographically(mappedStops),
        unresolved,
    };
}
