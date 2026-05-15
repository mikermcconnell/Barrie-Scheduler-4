import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

import {
  geocodeRoutePlanner2ParsedAddresses,
  orderRoutePlanner2StopsGeographically,
  parseRoutePlanner2AddressWorkbook,
  parseRoutePlanner2AddressText,
} from '../utils/route-planner-2/routePlanner2AddressImport';

function workbookBuffer(rows: unknown[][]): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Table 1');
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('routePlanner2AddressImport', () => {
  it('parses messy roster-style workbook cells and merges duplicate addresses', () => {
    const result = parseRoutePlanner2AddressWorkbook(workbookBuffer([
      ['ROSTER - not an address'],
      ['Dates: 06/16/2025', 'Time: 9:00 AM'],
      ['1 Enrollment By\nTransfer                 3-3 Gunn Street\nY\nBarrie, ON L4M 2H2\n1st'],
      ['2 Enrollment', '', '', '', 'Person Name\n3-3 Gunn Street\nBarrie, ON L4M 2H2'],
      ['3 Enrollment', '', '', '', 'Person Name\n100 Mapleview Drive East\nBarrie, ON L4N 9H5'],
    ]));

    expect(result.addresses).toHaveLength(2);
    expect(result.duplicateCount).toBe(1);
    expect(result.addresses[0]).toMatchObject({
      streetLine: '3-3 Gunn Street',
      city: 'Barrie',
      province: 'ON',
      postalCode: 'L4M 2H2',
      occurrenceCount: 2,
    });
    expect(result.addresses[1]?.address).toBe('100 Mapleview Drive East, Barrie, ON L4N 9H5');
  });

  it('trims trailing roster and fee text from extracted street lines', () => {
    const result = parseRoutePlanner2AddressWorkbook(workbookBuffer([
      ['309-339 Essa Rd BARRIE $0.00 $0.00\nBarrie, ON L4N 7K1'],
    ]));

    expect(result.addresses).toHaveLength(1);
    expect(result.addresses[0]).toMatchObject({
      streetLine: '309-339 Essa Rd',
      address: '309-339 Essa Rd, Barrie, ON L4N 7K1',
    });
  });

  it('counts every address occurrence even when duplicates are on the same spreadsheet row', () => {
    const result = parseRoutePlanner2AddressWorkbook(workbookBuffer([
      ['Kid 1\n3 Gunn Street\nBarrie, ON L4M 2H2', 'Kid 2\n3 Gunn Street\nBarrie, ON L4M 2H2'],
    ]));

    expect(result.addresses).toHaveLength(1);
    expect(result.duplicateCount).toBe(1);
    expect(result.addresses[0]).toMatchObject({
      streetLine: '3 Gunn Street',
      occurrenceCount: 2,
      sourceRows: [1],
    });
  });

  it('parses manually corrected one-line addresses for review fixes', () => {
    const parsed = parseRoutePlanner2AddressText('37 Johnson St, Barrie, ON L4M 5C3', {
      id: 'review-1',
      sourceRow: 12,
    });

    expect(parsed).toMatchObject({
      id: 'review-1',
      streetLine: '37 Johnson St',
      address: '37 Johnson St, Barrie, ON L4M 5C3',
      sourceRows: [12],
    });
  });

  it('orders mapped stops geographically with a deterministic nearest-neighbour path', () => {
    const ordered = orderRoutePlanner2StopsGeographically([
      { name: 'South stop', lat: 44.31, lng: -79.72 },
      { name: 'Near north stop', lat: 44.42, lng: -79.70 },
      { name: 'North-west stop', lat: 44.43, lng: -79.76 },
    ]);

    expect(ordered.map((stop) => stop.name)).toEqual([
      'North-west stop',
      'Near north stop',
      'South stop',
    ]);
  });

  it('geocodes confident matches, skips weak matches, and returns stops in geographic order', async () => {
    const parsed = parseRoutePlanner2AddressWorkbook(workbookBuffer([
      ['10 North Street\nBarrie, ON L4M 1A1'],
      ['20 East Street\nBarrie, ON L4M 2B2'],
      ['30 Weak Street\nBarrie, ON L4M 3C3'],
    ]));

    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const query = decodeURIComponent(url.match(/places\/(.+?)\.json/)?.[1] ?? '');
      const feature = query.includes('10 North')
        ? { id: 'north', text: '10 North Street', place_name: '10 North Street, Barrie, Ontario, Canada', center: [-79.76, 44.43] }
        : query.includes('20 East')
          ? { id: 'east', text: '20 East Street', place_name: '20 East Street, Barrie, Ontario, Canada', center: [-79.70, 44.42] }
          : { id: 'weak', text: '999 Other Road', place_name: '999 Other Road, Barrie, Ontario, Canada', center: [-79.60, 44.41] };

      return {
        ok: true,
        json: async () => ({ features: [feature] }),
      };
    }) as unknown as typeof fetch;

    const result = await geocodeRoutePlanner2ParsedAddresses(parsed.addresses, {
      token: 'token-123',
      fetcher,
    });

    expect(result.mappedStops.map((stop) => stop.name)).toEqual(['10 North Street', '20 East Street']);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]?.candidate.streetLine).toBe('30 Weak Street');
    expect(result.unresolved[0]?.reason).toContain('not confident');
    expect(result.unresolved[0]?.attempts?.[0]).toEqual(expect.objectContaining({
      query: expect.stringContaining('30 Weak Street'),
      resultCount: 1,
      topResultLabel: expect.stringContaining('999 Other Road'),
      rejectedReason: expect.stringContaining('civic number 30'),
    }));
  });

  it('geocodes imports with bounded parallel progress', async () => {
    const parsed = parseRoutePlanner2AddressWorkbook(workbookBuffer([
      ['10 Alpha Street\nBarrie, ON L4M 1A1'],
      ['20 Beta Street\nBarrie, ON L4M 2B2'],
      ['30 Gamma Street\nBarrie, ON L4M 3C3'],
      ['40 Delta Street\nBarrie, ON L4M 4D4'],
    ]));
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const progress: number[] = [];

    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeRequests -= 1;

      const url = String(input);
      const query = decodeURIComponent(url.match(/places\/(.+?)\.json/)?.[1] ?? '');
      const street = query.split(',')[0] ?? query;

      return {
        ok: true,
        json: async () => ({
          features: [{ id: street, text: street, place_name: `${street}, Barrie, Ontario, Canada`, center: [-79.70, 44.40] }],
        }),
      };
    }) as unknown as typeof fetch;

    const result = await geocodeRoutePlanner2ParsedAddresses(parsed.addresses, {
      token: 'token-123',
      fetcher,
      concurrency: 2,
      onProgress: ({ completed }) => progress.push(completed),
    });

    expect(result.mappedStops).toHaveLength(4);
    expect(maxActiveRequests).toBe(2);
    expect(progress).toEqual([0, 1, 2, 3, 4]);
  });

  it('reuses cached Mapbox queries during one import', async () => {
    const parsed = parseRoutePlanner2AddressWorkbook(workbookBuffer([
      ['10 Cache Street\nBarrie, ON L4M 1A1'],
    ]));
    const candidate = parsed.addresses[0]!;

    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        features: [{ id: 'cache', text: '10 Cache Street', place_name: '10 Cache Street, Barrie, Ontario, Canada', center: [-79.70, 44.40] }],
      }),
    })) as unknown as typeof fetch;

    const result = await geocodeRoutePlanner2ParsedAddresses([
      candidate,
      { ...candidate, id: 'address-copy' },
    ], {
      token: 'token-123',
      fetcher,
      concurrency: 2,
    });

    expect(result.mappedStops).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('geocodes unit-street imports against the base civic address before manual review', async () => {
    const parsed = parseRoutePlanner2AddressWorkbook(workbookBuffer([
      ['Camper Name\n4-3 Gunn Street\nBarrie, ON L4M 2H2'],
    ]));

    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const query = decodeURIComponent(url.match(/places\/(.+?)\.json/)?.[1] ?? '');

      return {
        ok: true,
        json: async () => ({
          features: query.includes('3 Gunn Street')
            ? [
              { id: 'wrong', text: '4 Other Street', place_name: '4 Other Street, Barrie, Ontario, Canada', center: [-79.68, 44.39] },
              { id: 'gunn', text: '3 Gunn Street', place_name: '3 Gunn Street, Barrie, Ontario, Canada', center: [-79.70, 44.40] },
            ]
            : [],
        }),
      };
    }) as unknown as typeof fetch;

    const result = await geocodeRoutePlanner2ParsedAddresses(parsed.addresses, {
      token: 'token-123',
      fetcher,
    });

    expect(result.unresolved).toHaveLength(0);
    expect(result.mappedStops).toHaveLength(1);
    expect(result.mappedStops[0]).toMatchObject({
      name: '4-3 Gunn Street',
      address: '4-3 Gunn Street, Barrie, ON L4M 2H2',
      lat: 44.40,
      lng: -79.70,
    });
    expect(result.mappedStops[0]?.notes).toContain('geocoded as base address "3 Gunn Street"');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('geocodes high-rise unit-street imports against the base civic address', async () => {
    const parsed = parseRoutePlanner2AddressWorkbook(workbookBuffer([
      ['1012-37 Johnson St\nBarrie, ON L4M 5C3'],
    ]));

    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const query = decodeURIComponent(url.match(/places\/(.+?)\.json/)?.[1] ?? '');

      return {
        ok: true,
        json: async () => ({
          features: query.includes('37 Johnson St')
            ? [{ id: 'johnson', text: '37 Johnson Street', place_name: '37 Johnson Street, Barrie, Ontario, Canada', center: [-79.66, 44.41] }]
            : [],
        }),
      };
    }) as unknown as typeof fetch;

    const result = await geocodeRoutePlanner2ParsedAddresses(parsed.addresses, {
      token: 'token-123',
      fetcher,
    });

    expect(result.unresolved).toHaveLength(0);
    expect(result.mappedStops[0]).toMatchObject({
      name: '1012-37 Johnson St',
      address: '1012-37 Johnson St, Barrie, ON L4M 5C3',
      lat: 44.41,
      lng: -79.66,
    });
    expect(result.mappedStops[0]?.notes).toContain('geocoded as base address "37 Johnson St"');
  });

  it('geocodes range-style addresses using civic endpoints', async () => {
    const parsed = parseRoutePlanner2AddressWorkbook(workbookBuffer([
      ['309-339 Essa Rd BARRIE $0.00 $0.00\nBarrie, ON L4N 7K1'],
    ]));

    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const query = decodeURIComponent(url.match(/places\/(.+?)\.json/)?.[1] ?? '');

      return {
        ok: true,
        json: async () => ({
          features: query.includes('339 Essa Rd')
            ? [{ id: 'essa', text: '339 Essa Road', place_name: '339 Essa Road, Barrie, Ontario, Canada', center: [-79.71, 44.36] }]
            : [],
        }),
      };
    }) as unknown as typeof fetch;

    const result = await geocodeRoutePlanner2ParsedAddresses(parsed.addresses, {
      token: 'token-123',
      fetcher,
    });

    expect(result.unresolved).toHaveLength(0);
    expect(result.mappedStops[0]).toMatchObject({
      name: '309-339 Essa Rd',
      address: '309-339 Essa Rd, Barrie, ON L4N 7K1',
      lat: 44.36,
      lng: -79.71,
    });
    expect(result.mappedStops[0]?.notes).toContain('Range-style address "309-339 Essa Rd"');
  });
});
