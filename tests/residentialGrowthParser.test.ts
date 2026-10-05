// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseIssuanceListing, parseOccupancyCertificate, summarizeResidentialGrowth } from '../utils/residential-growth/parser';
import { parseOccupancyCertificateBuffer } from '../functions/src/residentialGrowth';

function workbookBuffer(rows: unknown[][], sheetName = 'Sheet1'): ArrayBuffer {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function textBuffer(value: string): ArrayBuffer {
    const buffer = Buffer.from(value, 'utf8');
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

const occupancyTable = `
<table class="ReportTable"><tr>
<td><div>File Number</div></td><td><div>Location</div></td><td>Type of Project</td>
<td>Residential Subtype</td><td>Primary Application Purpose</td><td>Inspection Type</td>
<td>Date Scheduled</td><td>Date Inspection</td><td>Status</td><td>Inspector Name</td>
</tr><tr>
<td>PMT26-00777</td><td>10 TESTER ST, BARRIE, ON</td><td>Residential</td>
<td>Rowhouse</td><td>New</td><td>Occupancy Inspection</td>
<td>7/7/2026</td><td>7/7/2026</td><td>Passed</td><td>Inspector</td>
</tr></table>`;

describe('residential growth parser', () => {
    it('parses issuance listings into issued residential unit records', () => {
        const buffer = workbookBuffer([
            ['Issuance Listing'],
            [],
            ['File Number', null, null, 'Property Roll #', null, null, null, 'Date Issued', 'Building Type', 'Work Proposed', '# Units', null, null, 'Floor Area (m2)', 'Floor Area (Sqft)', 'Est. Const. Value'],
            [],
            ['PMT26-00001', null, null, null, null, null, null, new Date('2026-03-12T00:00:00'), 'Building Permit (All Other Types) Residential High Rise Residential', 'New Construction', '122', null, null, '100', '1000', '5000000'],
            [],
            [null, 'Location:', null, null, null, '60 DEAN AVE, BARRIE, ON'],
            [null, 'Project Description:', null, null, null, 'Residential - New - High-rise (7 Storeys)'],
            ['PMT26-00002', null, null, null, null, null, null, new Date('2026-03-13T00:00:00'), 'Building Permit (All Other Types) Commercial General', 'Alterations and improvements', '0'],
            [null, 'Location:', null, null, null, '1 TEST ST, BARRIE, ON'],
        ]);

        const result = parseIssuanceListing(buffer);

        expect(result.period).toBe('2026-03');
        expect(result.records).toHaveLength(1);
        expect(result.records[0]).toMatchObject({
            layer: 'issued',
            fileNumber: 'PMT26-00001',
            address: '60 DEAN AVE, Barrie, ON',
            units: 122,
            workProposed: 'New Construction',
        });
    });

    it('parses passed residential occupancy rows as one occupied unit each', () => {
        const buffer = workbookBuffer([
            [], [],
            ['Certificate of Occupancy Inspections Report'],
            ['Count Distinct(RECORD ID)'],
            [2], [],
            ['File Number', 'Location', 'Type of Project', 'Residential Subtype', 'Primary Application Purpose', 'Inspection Type', 'Date Scheduled', 'Date Inspection', 'Status', 'Inspector Name'],
            ['PMT25-001', '68 FOXLEY HTS, BARRIE, ON', 'Residential', 'Rowhouse', 'New', 'Occupancy Inspection', new Date('2026-03-25T00:00:00'), new Date('2026-03-25T11:00:00'), 'Passed', 'Inspector'],
            ['PMT25-002', '24 NORTH VILLAGE WAY, BARRIE, ON', 'Commercial', null, 'Change of Use', 'Occupancy Inspection', new Date('2026-03-26T00:00:00'), new Date('2026-03-26T11:00:00'), 'Passed', 'Inspector'],
        ], 'Certificate_of_Occupancy_Inspec');

        const result = parseOccupancyCertificate(buffer);

        expect(result.period).toBe('2026-03');
        expect(result.records).toHaveLength(1);
        expect(result.records[0]).toMatchObject({
            layer: 'occupied',
            fileNumber: 'PMT25-001',
            address: '68 FOXLEY HTS, Barrie, ON',
            units: 1,
            subtype: 'Rowhouse',
            status: 'Passed',
        });
        expect(result.records[0].warnings).toEqual([]);
    });

    it('parses occupancy reports exported as raw HTML with an .xls extension', () => {
        const htmlWithExcelSerialDates = occupancyTable
            .replace('<td>7/7/2026</td><td>7/7/2026</td>', '<td><div class="xls-date-ShortDateFormat">46251</div></td><td><div class="xls-date-ShortDateFormat">46251.5</div></td>');
        const result = parseOccupancyCertificate(textBuffer(`<html><body>${htmlWithExcelSerialDates}</body></html>`));

        expect(result.period).toBe('2026-08');
        expect(result.records).toHaveLength(1);
        expect(result.records[0]).toMatchObject({
            fileNumber: 'PMT26-00777',
            address: '10 TESTER ST, Barrie, ON',
            date: '2026-08-17',
        });
    });

    it('parses quoted-printable MHTML occupancy reports in the Cloud Function', () => {
        const encodedTable = occupancyTable.replace(/=/g, '=3D').replace(/File Number/g, 'File Number');
        const archive = `MIME-Version: 1.0\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n<html><body>${encodedTable}</body></html>`;
        const result = parseOccupancyCertificateBuffer(Buffer.from(archive, 'utf8'));

        expect(result.period).toBe('2026-07');
        expect(result.records).toHaveLength(1);
        expect(result.records[0]).toMatchObject({
            fileNumber: 'PMT26-00777',
            address: '10 TESTER ST, Barrie, ON',
            date: '2026-07-07',
        });
    });

    it('summarizes issued and occupied layers separately', () => {
        const issued = parseIssuanceListing(workbookBuffer([
            ['Issuance Listing'], [], [], [],
            ['PMT26-00001', null, null, null, null, null, null, new Date('2026-04-01T00:00:00'), 'Residential Duplex', 'New Construction', '2'],
            [null, 'Location:', null, null, null, '1 MAPLE ST, BARRIE, ON'],
        ])).records;
        const occupied = parseOccupancyCertificate(workbookBuffer([
            [], [], [], [], [], [],
            ['File Number', 'Location', 'Type of Project', 'Residential Subtype', 'Primary Application Purpose', 'Inspection Type', 'Date Scheduled', 'Date Inspection', 'Status', 'Inspector Name'],
            ['PMT25-001', '2 MAPLE ST, BARRIE, ON', 'Residential', 'Single Family Dwelling', 'New', 'Occupancy Inspection', new Date('2026-04-02T00:00:00'), new Date('2026-04-02T00:00:00'), 'Passed', 'Inspector'],
        ])).records;

        expect(summarizeResidentialGrowth(issued, occupied)).toMatchObject({
            issuedRecords: 1,
            issuedUnits: 2,
            occupiedRecords: 1,
            occupiedUnits: 1,
        });
    });
});
