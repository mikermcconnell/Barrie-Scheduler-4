import { BARRIE_ANALYSIS_BOUNDS, isInBarrieAnalysisArea } from '../transit-app/transitAppGeo';
import { getClientMapboxToken, normalizeMapboxToken } from '../mapboxToken';
import { APPROVED_SPECIALIZED_TRANSIT_ADDRESSES, SPECIALIZED_TRANSIT_MANUAL_REVIEW_LABELS } from './reviewedAddresses';
import {
  claimSpecializedTransitPermanentGeocodingRequest,
  SpecializedTransitGeocodingBudgetError,
} from './permanentGeocodingBudget';

const GEOCODE_CONCURRENCY = 6;
const MAPBOX_LIMIT = 5;
const COLLISION_LIMIT = 3;

export type SpecializedTransitResolutionSource = 'known-place' | 'mapbox-permanent';

export interface SpecializedTransitLocationResolutionInput {
  id: string;
  label: string;
  geocodeQuery?: string;
}

export interface SpecializedTransitLocationCandidate {
  originId: string;
  displayName: string;
  latitude: number;
  longitude: number;
  relevance: number;
  semanticScore: number;
  source: SpecializedTransitResolutionSource;
  trusted: boolean;
  reason: string;
}

export interface SpecializedTransitLocationResolution {
  originId: string;
  latitude: number;
  longitude: number;
  relevance: number;
  source: SpecializedTransitResolutionSource;
}

export interface SpecializedTransitLocationResolutionFailure {
  originId: string;
  reason: 'no-candidate' | 'low-confidence' | 'coordinate-collision' | 'request-failed' | 'budget-exhausted';
}

interface MapboxFeature {
  id?: string;
  text?: string;
  place_name?: string;
  address?: string;
  place_type?: string[];
  center?: [number, number];
  relevance?: number;
}

interface MapboxResponse {
  features?: MapboxFeature[];
}

interface KnownPlace {
  name: string;
  latitude: number;
  longitude: number;
  matches: (normalizedLabel: string) => boolean;
}

interface KnownAddress {
  address: string;
  matches: (normalizedLabel: string) => boolean;
}

const startsWithAny = (label: string, prefixes: string[]): boolean =>
  prefixes.some(prefix => label.startsWith(prefix));

// Public, recurring destinations whose report aliases are too abbreviated for
// reliable text geocoding. Coordinates are address-level reference points.
const KNOWN_PLACES: KnownPlace[] = [
  {
    name: 'Parkview Centre · 189 Blake Street',
    latitude: 44.394843,
    longitude: -79.665582,
    matches: label => label.startsWith('parkview senior centre') || label === 'parkview centre',
  },
  {
    name: 'Allandale Recreation Centre · 190 Bayview Drive',
    latitude: 44.361494,
    longitude: -79.684165,
    matches: label => label.startsWith('allandale recreation centre'),
  },
  {
    name: 'General John Hayter Southshore Community Centre · 205 Lakeshore Drive',
    latitude: 44.374053,
    longitude: -79.680393,
    matches: label => label.startsWith('southshore community centre'),
  },
  {
    name: 'Kozlov Centre · 400 Bayfield Street',
    latitude: 44.406187,
    longitude: -79.70654,
    matches: label => label.includes('kozlov centre'),
  },
  {
    name: 'RVH Community Dialysis Clinic · 66 Wellington Street West',
    latitude: 44.392367,
    longitude: -79.69913,
    matches: label => label === 'barrie dialysis clinic',
  },
  {
    name: 'Walmart Barrie North · 450 Bayfield Street',
    latitude: 44.4099,
    longitude: -79.711528,
    matches: label => label.startsWith('walmart north'),
  },
  {
    name: 'Walmart Barrie South · 35 Mapleview Drive West',
    latitude: 44.332517,
    longitude: -79.687024,
    matches: label => label.startsWith('walmart south'),
  },
  {
    name: 'Royal Victoria Regional Health Centre · 201 Georgian Drive',
    latitude: 44.414145,
    longitude: -79.661147,
    matches: label => label.startsWith('rvh ') || label === 'royal victoria regional health centre rvh',
  },
  {
    name: 'Georgian Mall · 509 Bayfield Street',
    latitude: 44.413488,
    longitude: -79.708945,
    matches: label => label.startsWith('georgian mall'),
  },
  {
    name: 'Georgian College · 1 Georgian Drive',
    latitude: 44.412738,
    longitude: -79.66987,
    matches: label => label.startsWith('georgian college'),
  },
  {
    name: 'Barrie Medical Arts · Wellington Street West',
    latitude: 44.389447,
    longitude: -79.703583,
    matches: label => label.startsWith('medical arts'),
  },
  {
    name: 'Simcoe Terrace · 44 Donald Street',
    latitude: 44.387689,
    longitude: -79.702908,
    matches: label => label.startsWith('simcoe terrace'),
  },
  {
    name: 'Woods Park Community & Retirement Living · 110 Lillian Crescent',
    latitude: 44.402673,
    longitude: -79.716834,
    matches: label => label.startsWith('woods park care centre'),
  },
  {
    name: 'East Bayfield Community Centre · 80 Livingstone Street East',
    latitude: 44.41507,
    longitude: -79.703962,
    matches: label => label.startsWith('east bayfield arena'),
  },
  {
    name: 'Hospice Simcoe Residence · 336 Penetanguishene Road',
    latitude: 44.413999,
    longitude: -79.647177,
    matches: label => label.startsWith('hospice simcoe'),
  },
  {
    name: 'VON Adult Day Program · 14 Cedar Pointe Drive',
    latitude: 44.38012,
    longitude: -79.715257,
    matches: label => label.startsWith('von canada cedar point'),
  },
  {
    name: 'Wellington Plaza · Barrie Medical Arts area',
    latitude: 44.387693,
    longitude: -79.706264,
    matches: label => label.startsWith('no frills wellington plaza'),
  },
  {
    name: "St. Mary's Seniors Residence · 75 Amelia Street",
    latitude: 44.393944,
    longitude: -79.677128,
    matches: label => startsWithAny(label, ['st marys senior', 'street marys senior']),
  },
  {
    name: 'Royal Canadian Legion Branch 147 · 410 St. Vincent Street',
    latitude: 44.410495,
    longitude: -79.688759,
    matches: label => label === 'legion hall' || label.startsWith('royal canadian legion branch 1'),
  },
  {
    name: 'Zehrs Cundles · 607 Cundles Road East',
    latitude: 44.414311,
    longitude: -79.676457,
    matches: label => label.startsWith('zehrs market cundles'),
  },
  {
    name: 'Barrie Community Health Centre · 490 Huronia Road',
    latitude: 44.347157,
    longitude: -79.664225,
    matches: label => label.startsWith('barrie community health centre'),
  },
  {
    name: 'Barrie Public Library Downtown · 60 Worsley Street',
    latitude: 44.391768,
    longitude: -79.688342,
    matches: label => label.startsWith('barrie public library downtown'),
  },
  {
    name: 'Mulcaster Mews · 130 Mulcaster Street',
    latitude: 44.394726,
    longitude: -79.686531,
    matches: label => label === 'mulcaster mews',
  },
  {
    name: 'Heritage Place Supportive Housing · 20 Brooks Street',
    latitude: 44.368955,
    longitude: -79.686712,
    matches: label => label === 'heritage place',
  },
];

// Manager-reviewed civic addresses for recurring report labels. These entries
// correct the search query; Mapbox Permanent Geocoding still supplies and saves
// the address-level coordinate. Shared civic addresses are intentional for this
// management map and are therefore treated as known-place matches.
const KNOWN_ADDRESSES: KnownAddress[] = [
  { address: '370 Bayview Drive, Barrie, Ontario', matches: label => label.startsWith('barrie primary care') },
  { address: '140 Cundles Road West, Barrie, Ontario', matches: label => label.startsWith('colemans health care') },
  { address: '54 St Pauls Crescent, Barrie, Ontario', matches: label => startsWithAny(label, ['st pauls anglican church', 'street pauls anglican church']) },
  { address: '320 Yonge Street, Barrie, Ontario', matches: label => label.startsWith('south barrie walk in clinic') },
  { address: '320 Bayfield Street, Barrie, Ontario', matches: label => startsWithAny(label, ['bayfield mall planet fitness', 'bayfield mall bowling', 'bayfield mall north door', 'bayfield mall centra', 'bowlerama barrie']) },
  { address: '165 Wellington Street West, Barrie, Ontario', matches: label => label.startsWith('shoppers drug mart wellingto') },
  { address: '65 Lakeshore Drive, Barrie, Ontario', matches: label => label.startsWith('centennial beach flags') },
  { address: '340 Blake Street, Barrie, Ontario', matches: label => label.startsWith('barrie manor') },
  { address: '10 Quarry Ridge Road, Barrie, Ontario', matches: label => label.startsWith('gildas club') },
  { address: '550 Grove Street East, Barrie, Ontario', matches: label => label.startsWith('first baptist church') },
  { address: '125 Bell Farm Road, Barrie, Ontario', matches: label => label.startsWith('georgian professional') },
  { address: '11 Lakeside Terrace, Barrie, Ontario', matches: label => label.startsWith('little lake health centre') },
  { address: '190 Cundles Road East, Barrie, Ontario', matches: label => label.startsWith('atrium b') },
  { address: '78 Ross Street, Barrie, Ontario', matches: label => label.startsWith('victoria village manor') },
  { address: '20 Essa Road, Barrie, Ontario', matches: label => label.startsWith('batt barrie allandale transi') },
  { address: '33 Collier Street, Barrie, Ontario', matches: label => label.startsWith('td canada trust collier') },
  { address: '34 Mary Street, Barrie, Ontario', matches: label => label === 'hope church' },
  { address: '7 George Street, Barrie, Ontario', matches: label => label.startsWith('harvest bible chapel') },
  { address: '650 Essa Road, Barrie, Ontario', matches: label => label === 'holy spirit' },
  { address: '65 Amelia Street, Barrie, Ontario', matches: label => label === 'st marys church' || label === 'street marys church' },
  { address: '649 Yonge Street, Barrie, Ontario', matches: label => label.startsWith('shoppers drug mart yonge street') },
  { address: '1 Royal Parkside Drive, Barrie, Ontario', matches: label => label.startsWith('bobrumball centre for the deaf') || label.startsWith('bob rumball centre for the deaf') },
  { address: '90 Collier Street Unit 5, Barrie, Ontario', matches: label => label.startsWith('cnib collier street') },
  { address: '132 Edgehill Drive, Barrie, Ontario', matches: label => label.startsWith('waterford retirement community') },
  { address: '201 Cundles Road East, Barrie, Ontario', matches: label => label.startsWith('giant tiger north') },
  { address: '409 Bayfield Street, Barrie, Ontario', matches: label => label === 'freshco' || label.startsWith('freshco bayfield') },
  { address: '140 Letitia Street, Barrie, Ontario', matches: label => label.startsWith('whispering pines') },
  { address: '42 Anne Street South Unit 2, Barrie, Ontario', matches: label => label.startsWith('barrie food bank') },
  { address: '300 Mapleview Drive West, Barrie, Ontario', matches: label => label.startsWith('mapleview community church') },
  { address: '352 Huronia Road, Barrie, Ontario', matches: label => label.startsWith('debs rest') },
  { address: '112 Collier Street, Barrie, Ontario', matches: label => label.startsWith('collier united church') },
  { address: '286 Hurst Drive, Barrie, Ontario', matches: label => label.startsWith('mill creek care center') || label.startsWith('mill creek care centre') },
  { address: '30 North Village Way Unit 5, Barrie, Ontario', matches: label => label.startsWith('xplay amusements') },
  { address: '624 Yonge Street, Barrie, Ontario', matches: label => label.startsWith('td canada trust yonge') },
  { address: '5 Simcoe Street, Barrie, Ontario', matches: label => label === 'heritage park' },
  { address: '49 Ferris Lane, Barrie, Ontario', matches: label => label.startsWith('ferris lane community church') },
  { address: '555 Essa Road, Barrie, Ontario', matches: label => label === 'food basics' },
  { address: '96 Victoria Street, Barrie, Ontario', matches: label => label.startsWith('foxs bakery') },
  { address: '48 Dean Avenue, Barrie, Ontario', matches: label => label.startsWith('barrie public library painswic') },
  { address: '80 Park Place Boulevard, Barrie, Ontario', matches: label => label.startsWith('michaels arts and crafts') },
  { address: '44 Collier Street, Barrie, Ontario', matches: label => label.startsWith('scotiabank collier') },
  { address: '363 Bayfield Street, Barrie, Ontario', matches: label => label.startsWith('cibc bayfield cundles') },
  { address: '259 Dunlop Street West, Barrie, Ontario', matches: label => label.startsWith('barrie anne gardens') },
  { address: '319 Blake Street, Barrie, Ontario', matches: label => label.startsWith('no frills blake street') },
  { address: '411 Huronia Road, Barrie, Ontario', matches: label => label.startsWith('dannys fish and chips') },
  { address: '225 Ferndale Drive South Unit 8, Barrie, Ontario', matches: label => label.startsWith('bloom bistro and bar') },
  { address: '108 Collier Street, Barrie, Ontario', matches: label => label.startsWith('collier place seniors residenc') },
  { address: '58 Collier Street, Barrie, Ontario', matches: label => label.startsWith('rinaldi salon') },
  { address: '200 Wellington Street West, Barrie, Ontario', matches: label => label === 'italian bakery' },
  { address: '600 Yonge Street, Barrie, Ontario', matches: label => label.startsWith('cibc yonge') },
  { address: '501 Bryne Drive, Barrie, Ontario', matches: label => label.startsWith('williams fresh cafe') },
  { address: '450 Yonge Street, Barrie, Ontario', matches: label => label.startsWith('barrington retirement home') },
  { address: '510 Ferndale Drive North, Barrie, Ontario', matches: label => label === 'westside church' },
  { address: '460 Yonge Street, Barrie, Ontario', matches: label => label.startsWith('celebration church') },
  { address: '350 Grove Street East, Barrie, Ontario', matches: label => label.startsWith('grace united church') },
  { address: '50 Anne Street North, Barrie, Ontario', matches: label => label.startsWith('hi way church') },
  { address: '547 Cundles Road East Unit 6, Barrie, Ontario', matches: label => label.startsWith('great clips north crossing') },
  { address: '227 Sunnidale Road, Barrie, Ontario', matches: label => label.startsWith('sunnidale park') },
  { address: '41 Mapleview Drive East, Barrie, Ontario', matches: label => label === 'costco' },
  { address: '34 Simcoe Street Unit 102, Barrie, Ontario', matches: label => label.startsWith('service ontario simcoe') },
  { address: '400 Bayfield Street, Barrie, Ontario', matches: label => label.startsWith('talize thrift store') },
  { address: '472 Bayfield Street, Barrie, Ontario', matches: label => label.startsWith('zehrs bayfield') },
  { address: '320 Yonge Street, Barrie, Ontario', matches: label => label.startsWith('giant tiger south') },
  { address: '53 Bayfield Street, Barrie, Ontario', matches: label => label.startsWith('royal bank bayfield collier') },
  { address: '52 Bayfield Street, Barrie, Ontario', matches: label => label === 'bingo' },
  { address: '201 Cundles Road East, Barrie, Ontario', matches: label => label.startsWith('tim hortons cundles at street v') },
  { address: '405 Bayfield Street, Barrie, Ontario', matches: label => label === 'royal bank bayfield' },
  { address: '24 Essa Road, Barrie, Ontario', matches: label => label.startsWith('allandale waterfront go statio') },
  { address: '28 Dunlop Street East, Barrie, Ontario', matches: label => label.startsWith('donaleighs irish public house') },
];

const MANUAL_REVIEW_MATCHERS: Array<(normalizedLabel: string) => boolean> = [
  label => label.startsWith('eagle ridge medical'),
  label => label === 'von canada',
  label => label === 'great clips hair salon',
  label => label.startsWith('scotiabank bayfield'),
  label => label.startsWith('royal court medical'),
  label => label.startsWith('budhist temple') || label.startsWith('buddhist temple'),
  label => label.startsWith('cineplex odeon'),
  label => label.startsWith('bibles for missions'),
  label => label.startsWith('will dwyer park'),
  label => label.startsWith('simcoe cnty dist health unit'),
  label => label.startsWith('tim hortons cundles north'),
  label => label.startsWith('shoppers drug mart bayfield'),
  label => label.startsWith('tim hortons yonge at maplevi'),
  label => label === 'camphill',
  label => label.startsWith('brain injury services'),
  label => label.startsWith('european fine food and deli'),
  label => label === 'staples',
  label => label.startsWith('cmha mental health'),
  label => label.startsWith('christian horizons group home'),
  label => label === 'the ups store',
  label => label === 'old navy',
  label => label === 'life labs' || label === 'lifelabs',
  label => label === 'kingdom hall',
];

const NON_DISTINCTIVE_TOKENS = new Set([
  'and', 'at', 'back', 'barrie', 'building', 'canada', 'centre', 'community', 'door',
  'drop', 'dropoff', 'east', 'entrance', 'for', 'front', 'health', 'in', 'level',
  'loc', 'location', 'lower', 'main', 'medical', 'north', 'of', 'ontario', 'pickup',
  'south', 'the', 'west',
]);

const AMBIGUOUS_PUBLIC_LABELS = new Set([
  '150', 'best buy', 'bingo', 'costco', 'farm boy', 'food basics', 'freshco',
  'home depot', 'life labs', 'national bank', 'rexall', 'rogers', 'sobeys',
  'staples', 'starbucks', 'value village',
]);

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-CA')
    .replace(/&/g, ' and ')
    .replace(/\bctr\b/g, ' centre ')
    .replace(/\bcenter\b/g, ' centre ')
    .replace(/\brec\b/g, ' recreation ')
    .replace(/\bbldg\b/g, ' building ')
    .replace(/\bst\b/g, ' street ')
    .replace(/\brd\b/g, ' road ')
    .replace(/\bdr\b/g, ' drive ')
    .replace(/\bave\b/g, ' avenue ')
    .replace(/\bpkwy\b/g, ' parkway ')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function distinctiveTokens(value: string): string[] {
  return normalizeText(value).split(' ').filter(token => token && !NON_DISTINCTIVE_TOKENS.has(token));
}

function semanticScore(query: string, result: string): number {
  const queryTokens = [...new Set(distinctiveTokens(query))];
  const resultTokens = new Set(distinctiveTokens(result));
  if (queryTokens.length === 0 || resultTokens.size === 0) return 0;
  const matched = queryTokens.filter(token => resultTokens.has(token)).length;
  return matched / queryTokens.length;
}

function numericTokens(value: string): string[] {
  return normalizeText(value).split(' ').filter(token => /^\d+$/.test(token));
}

function civicNumber(value: string): string | null {
  // Explicit unit prefixes and Canadian unit-civic notation are not civic numbers.
  const address = value.trim().replace(/^(?:unit|suite|apt\.?|#)\s*\d+[a-z]?\s*[,\s]+/i, '');
  const match = address.match(/^(?:\d+[a-z]?\s*-\s*)?(\d+[a-z]?)\b/i);
  return match?.[1].toLowerCase() ?? null;
}

function hasStreetSignal(value: string): boolean {
  return /\b(street|road|drive|avenue|lane|way|court|boulevard|parkway)\b/.test(normalizeText(value));
}

function knownPlaceCandidate(input: SpecializedTransitLocationResolutionInput): SpecializedTransitLocationCandidate | null {
  const normalized = normalizeText(input.geocodeQuery ?? input.label);
  const place = KNOWN_PLACES.find(candidate => candidate.matches(normalized));
  if (!place) return null;
  return {
    originId: input.id,
    displayName: place.name,
    latitude: place.latitude,
    longitude: place.longitude,
    relevance: 1,
    semanticScore: 1,
    source: 'known-place',
    trusted: true,
    reason: 'Matched the Barrie common-location directory.',
  };
}

export function getSpecializedTransitRecommendedAddress(label: string): string | null {
  const normalized = normalizeText(label);
  return approvedAddressesByLabel.get(normalized)
    ?? KNOWN_ADDRESSES.find(candidate => candidate.matches(normalized))?.address ?? null;
}

const approvedAddressesByLabel = new Map(
  APPROVED_SPECIALIZED_TRANSIT_ADDRESSES.map(entry => [normalizeText(entry.label), entry.address]),
);
const manualReviewLabels = new Set(SPECIALIZED_TRANSIT_MANUAL_REVIEW_LABELS.map(normalizeText));

function requiresSpecializedTransitLocationReview(label: string): boolean {
  const normalized = normalizeText(label);
  return manualReviewLabels.has(normalized) || MANUAL_REVIEW_MATCHERS.some(matches => matches(normalized));
}

function buildMapboxUrl(query: string, token: string): string {
  const searchText = `${query}, Barrie, Ontario, Canada`;
  const url = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchText)}.json`);
  url.searchParams.set('access_token', token);
  url.searchParams.set('autocomplete', 'false');
  url.searchParams.set('country', 'ca');
  url.searchParams.set('bbox', [
    BARRIE_ANALYSIS_BOUNDS.minLon,
    BARRIE_ANALYSIS_BOUNDS.minLat,
    BARRIE_ANALYSIS_BOUNDS.maxLon,
    BARRIE_ANALYSIS_BOUNDS.maxLat,
  ].join(','));
  url.searchParams.set('proximity', '-79.69,44.38');
  url.searchParams.set('limit', String(MAPBOX_LIMIT));
  url.searchParams.set('permanent', 'true');
  return url.toString();
}

function mapboxCandidate(
  input: SpecializedTransitLocationResolutionInput,
  feature: MapboxFeature,
): SpecializedTransitLocationCandidate | null {
  const [longitude, latitude] = feature.center ?? [];
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !isInBarrieAnalysisArea(latitude, longitude)) return null;

  const featureType = feature.place_type?.[0] ?? '';
  if (!['poi', 'address'].includes(featureType)) return null;
  const displayName = feature.place_name ?? feature.text ?? '';
  if (!displayName) return null;

  const query = input.geocodeQuery ?? input.label;
  const score = semanticScore(query, displayName);
  const relevance = feature.relevance ?? 0;
  const queryNumbers = numericTokens(query);
  const queryCivicNumber = civicNumber(query);
  const resultCivicNumber = civicNumber(feature.address ?? displayName);
  const exactNumber = queryCivicNumber !== null && queryCivicNumber === resultCivicNumber;
  const addressMatch = featureType === 'address'
    && ((exactNumber && score >= 0.5)
      || (queryCivicNumber === null && queryNumbers.length === 0 && hasStreetSignal(query) && score >= 0.75));
  const poiMatch = featureType === 'poi' && score >= 0.5
    && (queryCivicNumber === null || exactNumber);
  const ambiguousPublicLabel = AMBIGUOUS_PUBLIC_LABELS.has(normalizeText(query));
  const trusted = !ambiguousPublicLabel && relevance >= 0.6 && (addressMatch || poiMatch);
  return {
    originId: input.id,
    displayName,
    latitude,
    longitude,
    relevance,
    semanticScore: score,
    source: 'mapbox-permanent',
    trusted,
    reason: trusted
      ? 'Name and location details agree with the report label.'
      : ambiguousPublicLabel
        ? 'The report label is shared by multiple possible Barrie destinations.'
        : 'Candidate needs manager review before it can be mapped.',
  };
}

export async function findSpecializedTransitLocationCandidates(
  input: SpecializedTransitLocationResolutionInput,
  options: { token?: string | null; fetcher?: typeof fetch } = {},
): Promise<SpecializedTransitLocationCandidate[]> {
  const known = knownPlaceCandidate(input);
  if (known) return [known];
  const recommendedAddress = getSpecializedTransitRecommendedAddress(input.geocodeQuery ?? input.label);
  const lookupInput = recommendedAddress ? { ...input, geocodeQuery: recommendedAddress } : input;
  const manualReviewRequired = requiresSpecializedTransitLocationReview(input.label);
  const token = normalizeMapboxToken(options.token) ?? getClientMapboxToken();
  const candidates: SpecializedTransitLocationCandidate[] = [];
  if (!token) return candidates;

  const fetcher = options.fetcher ?? fetch;
  claimSpecializedTransitPermanentGeocodingRequest();
  const response = await fetcher(buildMapboxUrl(lookupInput.geocodeQuery ?? lookupInput.label, token));
  if (!response.ok) throw new Error(`Mapbox returned ${response.status}.`);
  const data = await response.json() as MapboxResponse;
  for (const feature of data.features ?? []) {
    const candidate = mapboxCandidate(lookupInput, feature);
    if (!candidate) continue;
    if (recommendedAddress && candidate.trusted) {
      candidate.source = 'known-place';
      candidate.reason = 'Matched the manager-reviewed Barrie address directory using Permanent Geocoding.';
    } else if (manualReviewRequired) {
      candidate.trusted = false;
      candidate.reason = 'This label has multiple or time-sensitive Barrie destinations and requires manager review.';
    }
    if (candidates.some(existing => Math.abs(existing.latitude - candidate.latitude) < 0.000001
      && Math.abs(existing.longitude - candidate.longitude) < 0.000001)) continue;
    candidates.push(candidate);
  }
  return candidates.sort((a, b) => Number(b.trusted) - Number(a.trusted)
    || b.semanticScore - a.semanticScore
    || b.relevance - a.relevance);
}

export async function resolveSpecializedTransitLocations(
  inputs: SpecializedTransitLocationResolutionInput[],
  options: {
    token?: string | null;
    fetcher?: typeof fetch;
    onProgress?: (completed: number, total: number, label: string) => void;
  } = {},
): Promise<{
  geocodes: SpecializedTransitLocationResolution[];
  unresolved: SpecializedTransitLocationResolutionFailure[];
}> {
  const geocodes: SpecializedTransitLocationResolution[] = [];
  const unresolved: SpecializedTransitLocationResolutionFailure[] = [];
  let nextIndex = 0;
  let completed = 0;

  async function processNext(): Promise<void> {
    while (nextIndex < inputs.length) {
      const input = inputs[nextIndex];
      nextIndex += 1;
      try {
        // Leave deliberately deferred labels to the user's review workflow without
        // spending another permanent search. Find suggestions still works on demand.
        if (requiresSpecializedTransitLocationReview(input.label)
          && !getSpecializedTransitRecommendedAddress(input.label)
          && !input.geocodeQuery) {
          unresolved.push({ originId: input.id, reason: 'low-confidence' });
          continue;
        }
        const candidates = await findSpecializedTransitLocationCandidates(input, options);
        const trusted = candidates.find(candidate => candidate.trusted);
        if (trusted) {
          geocodes.push({
            originId: input.id,
            latitude: trusted.latitude,
            longitude: trusted.longitude,
            relevance: trusted.relevance,
            source: trusted.source,
          });
        } else {
          unresolved.push({ originId: input.id, reason: candidates.length > 0 ? 'low-confidence' : 'no-candidate' });
        }
      } catch (cause) {
        unresolved.push({
          originId: input.id,
          reason: cause instanceof SpecializedTransitGeocodingBudgetError ? 'budget-exhausted' : 'request-failed',
        });
      } finally {
        completed += 1;
        options.onProgress?.(completed, inputs.length, input.label);
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(GEOCODE_CONCURRENCY, Math.max(1, inputs.length)) },
    () => processNext(),
  ));

  const coordinateGroups = new Map<string, SpecializedTransitLocationResolution[]>();
  for (const geocode of geocodes.filter(result => result.source === 'mapbox-permanent')) {
    const key = `${geocode.latitude.toFixed(6)}|${geocode.longitude.toFixed(6)}`;
    const group = coordinateGroups.get(key) ?? [];
    group.push(geocode);
    coordinateGroups.set(key, group);
  }
  const collisionIds = new Set(
    [...coordinateGroups.values()]
      .filter(group => group.length >= COLLISION_LIMIT)
      .flatMap(group => group.map(result => result.originId)),
  );
  if (collisionIds.size > 0) {
    for (const originId of collisionIds) unresolved.push({ originId, reason: 'coordinate-collision' });
  }

  return {
    geocodes: geocodes.filter(result => !collisionIds.has(result.originId)),
    unresolved,
  };
}

export function getSpecializedTransitCoordinateCollisionIds(
  locations: Array<{ id: string; latitude: number | null; longitude: number | null }>,
): Set<string> {
  const groups = new Map<string, string[]>();
  for (const location of locations) {
    if (location.latitude === null || location.longitude === null) continue;
    const key = `${location.latitude.toFixed(6)}|${location.longitude.toFixed(6)}`;
    const group = groups.get(key) ?? [];
    group.push(location.id);
    groups.set(key, group);
  }
  return new Set([...groups.values()].filter(group => group.length > 1).flat());
}
