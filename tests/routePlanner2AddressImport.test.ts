import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

import {
  geocodeRoutePlanner2ParsedAddresses,
  orderRoutePlanner2StopsGeographically,
  parseRoutePlanner2AddressWorkbook,
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
  });
});
