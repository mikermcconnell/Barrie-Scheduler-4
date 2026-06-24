import type { ParkingCodeFamilyMapping, ParkingYearCodeFormat } from './parkingTypes';

export function normalizeParkingCode(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

export function getParkingCodeFamilyKey(code: string): string {
  const normalized = normalizeParkingCode(code);
  if (!normalized) return '';
  const fourDigitYear = normalized.replace(/20\d{2}$/, '');
  if (fourDigitYear && fourDigitYear !== normalized) return fourDigitYear;
  const twoDigitYear = normalized.replace(/\d{2}$/, '');
  return twoDigitYear || normalized;
}

export function getParkingCodeYear(code: string): number | null {
  const normalized = normalizeParkingCode(code);
  const fourDigit = normalized.match(/20\d{2}$/)?.[0];
  if (fourDigit) return Number(fourDigit);
  const twoDigit = normalized.match(/(\d{2})$/)?.[1];
  return twoDigit ? Number(`20${twoDigit}`) : null;
}

export function parseParkingYearsInput(value: string): number[] {
  return [...new Set(value.split(/[,;\s]+/).map(part => {
    const parsed = Number(part.trim());
    if (!Number.isFinite(parsed)) return null;
    return parsed < 100 ? 2000 + parsed : parsed;
  }).filter((year): year is number => year != null && year >= 2000 && year <= 2099))].sort((a, b) => a - b);
}

export function parseParkingCodesInput(value: string): string[] {
  return [...new Set(value.split(/[,;\s]+/).map(normalizeParkingCode).filter(Boolean))];
}

export function parseParkingActiveYearsFromCodes(codes: string[] | undefined): number[] {
  return [...new Set((codes || [])
    .map(getParkingCodeYear)
    .filter((year): year is number => year != null && year >= 2000 && year <= 2099))]
    .sort((a, b) => a - b);
}

export function getParkingActiveYears(mapping: ParkingCodeFamilyMapping): number[] {
  if (Array.isArray(mapping.activeYears) && mapping.activeYears.length > 0) {
    return [...new Set(mapping.activeYears.filter(year => Number.isFinite(year)))].sort((a, b) => a - b);
  }
  return parseParkingActiveYearsFromCodes(mapping.codes);
}

export function inferParkingYearCodeFormat(mapping: ParkingCodeFamilyMapping): ParkingYearCodeFormat {
  if (mapping.yearCodeFormat === 'yy' || mapping.yearCodeFormat === 'yyyy') return mapping.yearCodeFormat;
  const key = getParkingCodeFamilyKey(mapping.familyKey);
  const sample = (mapping.codes || []).find(code => getParkingCodeFamilyKey(code) === key);
  return sample && /20\d{2}$/.test(normalizeParkingCode(sample)) ? 'yyyy' : 'yy';
}

export function buildParkingGeneratedCode(familyKey: string, year: number, format: ParkingYearCodeFormat): string {
  const key = getParkingCodeFamilyKey(familyKey);
  if (!key || !Number.isFinite(year)) return '';
  return `${key}${format === 'yyyy' ? year : String(year).slice(-2)}`;
}

export function getParkingCodeOverridesForYear(mapping: ParkingCodeFamilyMapping, year: number): string[] {
  const explicit = mapping.codeOverrides?.[String(year)];
  if (Array.isArray(explicit)) return explicit.map(normalizeParkingCode).filter(Boolean);

  const generated = buildParkingGeneratedCode(
    mapping.familyKey,
    year,
    inferParkingYearCodeFormat(mapping),
  );
  return (mapping.codes || [])
    .map(normalizeParkingCode)
    .filter(code => getParkingCodeYear(code) === year && code !== generated);
}

export function getParkingCodesForYear(mapping: ParkingCodeFamilyMapping, year: number): string[] {
  const format = inferParkingYearCodeFormat(mapping);
  const generated = buildParkingGeneratedCode(mapping.familyKey, year, format);
  return [...new Set([
    generated,
    ...getParkingCodeOverridesForYear(mapping, year),
  ].filter(Boolean))];
}

export function getParkingAllKnownCodesForMapping(mapping: ParkingCodeFamilyMapping): string[] {
  const years = getParkingActiveYears(mapping);
  const generated = years.flatMap(year => getParkingCodesForYear(mapping, year));
  const legacy = (mapping.codes || []).map(normalizeParkingCode).filter(Boolean);
  const overrides = Object.values(mapping.codeOverrides || {}).flat().map(normalizeParkingCode).filter(Boolean);
  return [...new Set([...generated, ...legacy, ...overrides])];
}
