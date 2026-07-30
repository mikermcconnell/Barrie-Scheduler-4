import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import XLSX from 'xlsx';

const EXPECTED_HEADERS = [
  'Id',
  'Route',
  'Transit Pass',
  'Starting Location',
  'Ending Location',
  'Strat Time',
  'End Time',
];

const INCLUDED_PASSES = new Set(['High School Student Pass 25/26']);
const REVIEW_ONLY_PASSES = new Set(['Innisdale Student Pass']);
const UNAVAILABLE_LOCATION = /no data available|geolocation unauthorized/i;
const ORIGIN_MINIMUM_GROUP_USES = 3;
const ORIGIN_TIMEZONE = 'America/Toronto';
const ORIGIN_TIME_BANDS = [
  { id: 'before-6', label: 'Before 6 AM', startHour: 0, endHour: 6 },
  { id: 'morning', label: '6–9 AM', startHour: 6, endHour: 9 },
  { id: 'school-day', label: '9 AM–2 PM', startHour: 9, endHour: 14 },
  { id: 'afternoon', label: '2–7 PM', startHour: 14, endHour: 19 },
  { id: 'evening', label: 'After 7 PM', startHour: 19, endHour: 24 },
];
const TORONTO_DATE_TIME = new Intl.DateTimeFormat('en-CA', {
  timeZone: ORIGIN_TIMEZONE,
  weekday: 'short',
  hour: '2-digit',
  hourCycle: 'h23',
});

const SCHOOL_RULES = [
  {
    id: 'barrie-north',
    name: 'Barrie North CI',
    latitude: 44.4012,
    longitude: -79.6901,
    evidence: 'Endpoint matched Barrie North Collegiate or 110 Grove St. E.',
    patterns: [/barrie north collegiate/i, /\b110 grove st\.? e\b/i],
  },
  {
    id: 'innisdale',
    name: 'Innisdale SS',
    latitude: 44.3594,
    longitude: -79.6854,
    evidence: 'Endpoint matched Innisdale or 95 Little Ave.',
    patterns: [/\binnisdale\b/i, /\b95 little ave\b/i],
  },
  {
    id: 'maple-ridge',
    name: 'Maple Ridge SS',
    latitude: 44.3509,
    longitude: -79.6086,
    evidence: 'Endpoint matched the school or Mapleview / Prince William stop area.',
    patterns: [
      /\b225 prince william way\b/i,
      /mapleview (?:dr(?:ive)? )?(?:at|@) prince william/i,
      /prince william (?:way )?(?:at|@) mapleview/i,
    ],
  },
];

function locationIsUsable(value) {
  const text = String(value ?? '').trim();
  return Boolean(text) && !UNAVAILABLE_LOCATION.test(text);
}

function utcDate(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H ?? 0, parsed.M ?? 0, parsed.S ?? 0));
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getTime());
  }

  const text = String(value ?? '').trim();
  const utcLike = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?)?/);
  if (utcLike) {
    return new Date(Date.UTC(
      Number(utcLike[1]),
      Number(utcLike[2]) - 1,
      Number(utcLike[3]),
      Number(utcLike[4] ?? 0),
      Number(utcLike[5] ?? 0),
      Number(utcLike[6] ?? 0),
    ));
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function dateParts(value) {
  const parsed = utcDate(value);
  if (!parsed) return null;
  return { year: parsed.getUTCFullYear(), month: parsed.getUTCMonth() + 1, day: parsed.getUTCDate() };
}

function emptyOriginBuckets() {
  return {
    weekday: Object.fromEntries(ORIGIN_TIME_BANDS.map(band => [band.id, 0])),
    weekend: Object.fromEntries(ORIGIN_TIME_BANDS.map(band => [band.id, 0])),
  };
}

function originUsageBucket(value) {
  const parsed = utcDate(value);
  if (!parsed) return null;
  const parts = Object.fromEntries(
    TORONTO_DATE_TIME.formatToParts(parsed).map(part => [part.type, part.value]),
  );
  const hour = Number(parts.hour);
  const timeBand = ORIGIN_TIME_BANDS.find(band => hour >= band.startHour && hour < band.endHour);
  if (!timeBand) return null;
  return {
    dayType: /Sat|Sun/.test(parts.weekday) ? 'weekend' : 'weekday',
    timeBand: timeBand.id,
  };
}

function normalizeStreetSuffixes(value) {
  return value
    .replace(/\bStreet\b|\bSt\.\b/gi, 'St')
    .replace(/\bDrive\b|\bDr\.\b/gi, 'Dr')
    .replace(/\bRoad\b|\bRd\.\b/gi, 'Rd')
    .replace(/\bAvenue\b|\bAve\.\b/gi, 'Ave')
    .replace(/\bBoulevard\b|\bBlvd\.\b/gi, 'Blvd')
    .replace(/\bLane\b|\bLn\.\b/gi, 'Ln')
    .replace(/\bTerrace\b|\bTer\.\b/gi, 'Ter')
    .replace(/\bCourt\b|\bCt\.\b/gi, 'Ct')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeFareProgramOrigin(value) {
  const raw = String(value ?? '').trim();
  if (!locationIsUsable(raw)) return null;

  let label = raw
    .replace(/,?\s*Barrie\s*,?\s*ON\s+[A-Z]\d[A-Z]\s*\d[A-Z]\d\s*,?\s*Canada\s*$/i, '')
    .replace(/,?\s*Barrie\s*,?\s*Ontario\s*,?\s*Canada\s*$/i, '')
    .replace(/,?\s*Barrie\s*,?\s*ON(?:\s+[A-Z]\d[A-Z](?:\s*\d[A-Z]\d)?)?\s*(?:,\s*Canada)?\s*$/i, '')
    .replace(/,\s*Canada\s*$/i, '')
    .replace(/,\s*$/g, '')
    .trim();
  const civicAddress = label.match(/^\d+[A-Za-z]?(?:-\d+[A-Za-z]?)?\s+(.+)$/);
  if (civicAddress) label = civicAddress[1];
  label = normalizeStreetSuffixes(label
    .replace(/\s+(?:unit|apt|apartment|suite)\s*#?\s*\d+\b.*$/i, '')
    .replace(/\s*#\s*\d+\b.*$/i, '')
    .replace(/\s+platform\s+\d+\b.*$/i, ''));
  if (!label) return null;

  return {
    label: civicAddress ? `${label} area` : label,
    geocodeQuery: label.replace(/\s+area$/i, '').replace(/\s+(?:at|@)\s+/i, ' & '),
  };
}

function formatDate(parts) {
  if (!parts) return null;
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function formatLongDate(parts) {
  const month = new Intl.DateTimeFormat('en-CA', { month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)));
  return `${month} ${parts.day}, ${parts.year}`;
}

function monthKey(parts) {
  if (!parts) return 'unknown';
  return `${parts.year}-${String(parts.month).padStart(2, '0')}`;
}

function labelForMonth(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-CA', { month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

function monthRange(start, end) {
  const months = [];
  let year = start.year;
  let month = start.month;
  while (year < end.year || (year === end.year && month <= end.month)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

function compareParts(left, right) {
  return left.year - right.year || left.month - right.month || left.day - right.day;
}

export function analyzeFareProgramRows(rows, source = {}) {
  if (!Array.isArray(rows) || rows.length < 2) {
    throw new Error('Fare Programs source workbook contains no data rows.');
  }

  const headers = rows[0].slice(0, EXPECTED_HEADERS.length).map(value => String(value ?? '').trim());
  if (headers.some((header, index) => header !== EXPECTED_HEADERS[index])) {
    throw new Error(`Unexpected Fare Programs columns: ${headers.join(', ')}`);
  }

  const pilotRows = [];
  const reviewOnlyCounts = new Map();
  const passCounts = new Map();
  const allMonths = new Map();
  let sourceStart = null;
  let sourceEnd = null;

  for (const row of rows.slice(1)) {
    const pass = String(row[2] ?? '').trim();
    const passLabel = pass || '(Blank fare type)';
    passCounts.set(passLabel, (passCounts.get(passLabel) ?? 0) + 1);
    const startParts = dateParts(row[5]);
    if (startParts) {
      if (!sourceStart || compareParts(startParts, sourceStart) < 0) sourceStart = startParts;
      if (!sourceEnd || compareParts(startParts, sourceEnd) > 0) sourceEnd = startParts;
      const month = monthKey(startParts);
      allMonths.set(month, (allMonths.get(month) ?? 0) + 1);
    }

    if (REVIEW_ONLY_PASSES.has(pass)) {
      reviewOnlyCounts.set(pass, (reviewOnlyCounts.get(pass) ?? 0) + 1);
    }
    if (INCLUDED_PASSES.has(pass)) pilotRows.push(row);
  }

  if (!sourceStart || !sourceEnd) throw new Error('Fare Programs source contains no valid start dates.');

  const schoolCounts = new Map(SCHOOL_RULES.map(rule => [rule.id, 0]));
  const pilotMonths = new Map();
  const originGroups = new Map();
  let ambiguousSchoolUses = 0;
  let unattributedUses = 0;
  let authorizedStartLocations = 0;
  let recordedEndLocations = 0;
  let usableEndLocations = 0;

  for (const row of pilotRows) {
    const start = String(row[3] ?? '').trim();
    const end = String(row[4] ?? '').trim();
    const text = `${start} | ${end}`;
    const matchedSchools = SCHOOL_RULES.filter(rule => rule.patterns.some(pattern => pattern.test(text)));

    if (matchedSchools.length === 1) {
      schoolCounts.set(matchedSchools[0].id, (schoolCounts.get(matchedSchools[0].id) ?? 0) + 1);
    } else if (matchedSchools.length > 1) {
      ambiguousSchoolUses += 1;
    } else {
      unattributedUses += 1;
    }

    if (locationIsUsable(start)) {
      authorizedStartLocations += 1;
      const sanitizedOrigin = sanitizeFareProgramOrigin(start);
      const bucket = originUsageBucket(row[5]);
      if (sanitizedOrigin && bucket) {
        const current = originGroups.get(sanitizedOrigin.label) ?? {
          ...sanitizedOrigin,
          uses: 0,
          buckets: emptyOriginBuckets(),
        };
        current.uses += 1;
        current.buckets[bucket.dayType][bucket.timeBand] += 1;
        originGroups.set(sanitizedOrigin.label, current);
      }
    }
    if (end) recordedEndLocations += 1;
    if (locationIsUsable(end)) usableEndLocations += 1;

    const month = monthKey(dateParts(row[5]));
    pilotMonths.set(month, (pilotMonths.get(month) ?? 0) + 1);
  }

  const months = monthRange(sourceStart, sourceEnd);
  const schoolAreas = SCHOOL_RULES.map(({ patterns: _patterns, ...rule }) => ({
    ...rule,
    uses: schoolCounts.get(rule.id) ?? 0,
  }));
  const schoolLinkedUses = schoolAreas.reduce((sum, school) => sum + school.uses, 0);

  if (schoolLinkedUses + ambiguousSchoolUses + unattributedUses !== pilotRows.length) {
    throw new Error('School-area classification does not reconcile to the pilot proxy total.');
  }
  const origins = [...originGroups.values()]
    .filter(origin => origin.uses >= ORIGIN_MINIMUM_GROUP_USES)
    .map(origin => ({
      id: `origin-${createHash('sha256').update(origin.label).digest('hex').slice(0, 12)}`,
      ...origin,
    }))
    .sort((left, right) => right.uses - left.uses || left.label.localeCompare(right.label));
  const displayedOriginUses = origins.reduce((sum, origin) => sum + origin.uses, 0);

  return {
    sourceFileName: source.fileName ?? 'Barrie Transit Sept 2025-June 2026.xlsx',
    sourceRows: rows.length - 1,
    sourceSizeBytes: source.sizeBytes ?? null,
    sourceSha256: source.sha256 ?? null,
    coverageStart: formatDate(sourceStart),
    coverageEnd: formatDate(sourceEnd),
    coverageLabel: `${formatLongDate(sourceStart)} to ${formatLongDate(sourceEnd)}`,
    allSourceMonthlyUses: months.map(month => ({ month, label: labelForMonth(month), uses: allMonths.get(month) ?? 0 })),
    sourcePassCounts: [...passCounts]
      .map(([label, uses]) => ({ label, uses }))
      .sort((left, right) => right.uses - left.uses || left.label.localeCompare(right.label)),
    serviceMirroring: {
      definition: 'Working proxy: High School Student Pass 25/26 only.',
      uses: pilotRows.length,
      passTypes: [{ label: 'High School Student Pass 25/26', uses: pilotRows.length }],
      excludedReviewPasses: [...reviewOnlyCounts].map(([label, uses]) => ({ label, uses, reason: 'Not included without confirmed Service Mirroring user-group mapping.' })),
      monthlyUses: months.map(month => ({ month, label: labelForMonth(month), uses: pilotMonths.get(month) ?? 0 })),
      schoolAreas,
      ambiguousSchoolUses,
      unattributedUses,
      authorizedStartLocations,
      recordedEndLocations,
      usableEndLocations,
      originUsage: {
        sourceField: 'Starting Location',
        minimumGroupUses: ORIGIN_MINIMUM_GROUP_USES,
        locationMethod: 'Civic numbers, postal codes, city, province, and country are removed; repeated street or named-place areas are aggregated.',
        timezone: ORIGIN_TIMEZONE,
        timestampAssumption: 'Workbook timestamps are interpreted as UTC and displayed in Barrie local time.',
        timeBands: ORIGIN_TIME_BANDS.map(({ startHour: _startHour, endHour: _endHour, ...band }) => band),
        usableStartUses: authorizedStartLocations,
        displayedUses: displayedOriginUses,
        suppressedUses: authorizedStartLocations - displayedOriginUses,
        origins,
      },
    },
  };
}

export function generateFareProgramsSnapshot(workbookPath) {
  const resolvedSource = path.resolve(workbookPath);
  if (path.extname(resolvedSource).toLowerCase() !== '.xlsx' || !existsSync(resolvedSource)) {
    throw new Error('Provide an existing .xlsx source workbook.');
  }

  const workbookBuffer = readFileSync(resolvedSource);
  const workbook = XLSX.read(workbookBuffer, { cellDates: false, dense: true, type: 'buffer' });
  if (workbook.SheetNames.length !== 1) {
    throw new Error(`Expected one source sheet, found ${workbook.SheetNames.length}.`);
  }
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: null, raw: true });
  return analyzeFareProgramRows(rows, {
    fileName: path.basename(resolvedSource),
    sizeBytes: statSync(resolvedSource).size,
    sha256: createHash('sha256').update(workbookBuffer).digest('hex'),
  });
}

function parseCli(args) {
  const sourceIndex = args.indexOf('--source');
  const source = sourceIndex >= 0 ? args[sourceIndex + 1] : 'D:\\Barrie Transit Sept 2025-June 2026 (1).xlsx';
  return { source, write: args.includes('--write'), check: args.includes('--check') };
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const options = parseCli(process.argv.slice(2));
  const snapshot = generateFareProgramsSnapshot(options.source);
  const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
  const outputPath = path.resolve('utils/fare-programs/fareProgramsSnapshot.generated.json');

  if (options.check) {
    if (!existsSync(outputPath) || readFileSync(outputPath, 'utf8') !== serialized) {
      throw new Error('Fare Programs snapshot is stale. Run npm run fare-programs:generate.');
    }
    process.stdout.write(`Fare Programs snapshot matches ${snapshot.sourceFileName}.\n`);
  } else if (options.write) {
    writeFileSync(outputPath, serialized, 'utf8');
    process.stdout.write(`Wrote aggregate Fare Programs snapshot to ${outputPath}.\n`);
  } else {
    process.stdout.write(serialized);
  }
}
