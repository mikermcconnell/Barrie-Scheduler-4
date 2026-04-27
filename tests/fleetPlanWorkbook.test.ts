import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { parseFleetPlanWorkbook } from '../utils/fleet-plan/fleetPlanParser';
import { buildFleetPlanWorkbookBuffer } from '../utils/fleet-plan/fleetPlanExport';
import type { FleetPlanWorkbook } from '../utils/fleet-plan/types';

function getFillArgb(cell: ExcelJS.Cell): string | undefined {
    const fill = cell.fill;
    if (fill?.type !== 'pattern') return undefined;
    return fill.fgColor?.argb;
}

function getFormula(cell: ExcelJS.Cell): string | undefined {
    const value = cell.value;
    if (typeof value === 'object' && value !== null && 'formula' in value) {
        return value.formula;
    }
    return undefined;
}

async function buildImportWorkbookBuffer(): Promise<ArrayBuffer> {
    const workbook = new ExcelJS.Workbook();

    const diesel = workbook.addWorksheet('12m Buses');
    diesel.getCell('B2').value = '12m Diesel Buses';
    diesel.getCell('B3').value = 'TOTAL FLEET';
    diesel.getCell('B4').value = 'Unit Number';
    diesel.getCell('C4').value = 'Make/Model';
    diesel.getCell('D4').value = 'Year';
    ['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S'].forEach((column, index) => {
        diesel.getCell(`${column}4`).value = 2023 + index;
    });
    diesel.getCell('B5').value = 1101;
    diesel.getCell('C5').value = 'NF - Xcelsior';
    diesel.getCell('D5').value = 2012;
    diesel.getCell('E5').value = 1101;
    diesel.getCell('I5').value = 'RETIRE';
    diesel.getCell('B6').value = 3501;
    diesel.getCell('O6').value = 'PURCHASE';
    diesel.getCell('B7').value = 'Replacement';

    const small = workbook.addWorksheet('8m & 6m Buses');
    small.getCell('B2').value = 'Small Buses (8m or 6m)';
    small.getCell('B3').value = 'TOTAL FLEET';
    small.getCell('B4').value = 'Unit Number';
    small.getCell('C4').value = 'Size of Bus';
    small.getCell('D4').value = 'Make/Model';
    small.getCell('E4').value = 'Comment';
    const smallTimelineHeaders: Array<[string, string | number]> = [
        ['F', 2023],
        ['G', 2024],
        ['H', 2025],
        ['J', 2026],
        ['K', 2027],
        ['L', 2028],
        ['M', 2029],
        ['N', 2030],
        ['O', 2031],
        ['P', 2032],
        ['Q', 2033],
        ['R', 2034],
        ['S', 2035],
        ['T', 2036],
    ];
    smallTimelineHeaders.forEach(([column, value]) => {
        small.getCell(`${column}4`).value = value;
    });
    small.getCell('B5').value = 2020;
    small.getCell('C5').value = '8m';
    small.getCell('D5').value = 'Chev - 4500';
    small.getCell('E5').value = 'growth bus';
    small.getCell('I5').value = '2 units';
    small.getCell('F5').value = 2020;
    small.getCell('J5').value = 'PURCHASE';
    small.getCell('B6').value = 'Total Cutaways';

    const electric = workbook.addWorksheet('12m Electric Buses');
    electric.getCell('B2').value = 'Electric 40 Foot Buses';
    electric.getCell('B3').value = 'TOTAL FLEET';
    electric.getCell('B4').value = 'Unit Number';
    electric.getCell('C4').value = 'Make/Model';
    electric.getCell('D4').value = 'Year';
    electric.getCell('E4').value = 'Electric "E"';
    ['F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q'].forEach((column, index) => {
        electric.getCell(`${column}4`).value = 2024 + index;
    });
    electric.getCell('B5').value = '2501-E';
    electric.getCell('C5').value = 'NF - Xcelsior (Electric)';
    electric.getCell('E5').value = 'E';
    electric.getCell('F5').value = '2501-E';
    electric.getCell('Q5').value = 'RETIRE';
    electric.getCell('D6').value = 'Total';

    return workbook.xlsx.writeBuffer();
}

function buildTestFleetPlanWorkbook(): FleetPlanWorkbook {
    return {
        schemaVersion: 1,
        metadata: {
            templateVersion: '2026-04-08-fleet-plan-v1',
            sourceFileName: 'Fleet_Plan.xlsx',
            importedAt: '2026-04-21T10:00:00.000Z',
            importedBy: 'user-1',
            updatedAt: '2026-04-21T10:00:00.000Z',
            updatedBy: 'user-1',
        },
        sheets: [
            {
                key: 'diesel-12m',
                name: '12m Buses',
                title: '12m Diesel Buses',
                rows: [
                    {
                        id: 'd1',
                        unitNumber: '1101',
                        makeModel: 'NF - Xcelsior',
                        year: '2012',
                        busSize: '',
                        comment: '',
                        electricFlag: '',
                        timeline: {
                            '2023': '1101',
                            '2024': '1101',
                            '2025': '',
                            '2026': '',
                            '2027': 'RETIRE',
                            '2028': '',
                            '2029': '',
                            '2030': '',
                            '2031': '',
                            '2032': '',
                            '2033': '',
                            '2034': '',
                            '2035': '',
                            '2036': '',
                            '2037': '',
                        },
                    },
                    {
                        id: 'd2',
                        unitNumber: '3501',
                        makeModel: '',
                        year: '',
                        busSize: '',
                        comment: '',
                        electricFlag: '',
                        timeline: {
                            '2023': '',
                            '2024': '',
                            '2025': '',
                            '2026': '',
                            '2027': '',
                            '2028': '',
                            '2029': '',
                            '2030': '',
                            '2031': '',
                            '2032': '',
                            '2033': 'GROWTH',
                            '2034': '',
                            '2035': 'PURCHASE',
                            '2036': '',
                            '2037': '',
                        },
                    },
                ],
            },
            {
                key: 'small-buses',
                name: '8m & 6m Buses',
                title: 'Small Buses (8m or 6m)',
                rows: [
                    {
                        id: 's1',
                        unitNumber: '2020',
                        busSize: '8m',
                        makeModel: 'Chev - 4500',
                        year: '',
                        comment: 'growth bus',
                        electricFlag: '',
                        onOrder: '2 units',
                        timeline: {
                            '2023': '2020',
                            '2024': '2020',
                            '2025': '2020',
                            '2026': 'PURCHASE',
                            '2027': '',
                            '2028': '',
                            '2029': '',
                            '2030': '',
                            '2031': '',
                            '2032': '',
                            '2033': '',
                            '2034': '',
                            '2035': '',
                            '2036': '',
                        },
                    },
                ],
            },
            {
                key: 'electric-12m',
                name: '12m Electric Buses',
                title: 'Electric 40 Foot Buses',
                rows: [
                    {
                        id: 'e1',
                        unitNumber: '2501-E',
                        busSize: '',
                        makeModel: 'NF - Xcelsior (Electric)',
                        year: '',
                        comment: '',
                        electricFlag: 'E',
                        timeline: {
                            '2024': '2501-E',
                            '2025': '2501-E',
                            '2026': '2501-E',
                            '2027': '2501-E',
                            '2028': '2501-E',
                            '2029': '2501-E',
                            '2030': '2501-E',
                            '2031': '2501-E',
                            '2032': '2501-E',
                            '2033': '2501-E',
                            '2034': '2501-E',
                            '2035': 'RETIRE',
                        },
                    },
                ],
            },
        ],
    };
}

describe('fleetPlan parser and exporter', () => {
    it('parses the supported 3-sheet fleet template into a structured workbook', async () => {
        const buffer = await buildImportWorkbookBuffer();
        const { workbook } = parseFleetPlanWorkbook(buffer, {
            fileName: 'Fleet_Plan.xlsx',
            userId: 'user-1',
            now: new Date('2026-04-21T10:00:00.000Z'),
        });

        expect(workbook.sheets).toHaveLength(3);
        expect(workbook.sheets[0]?.rows).toHaveLength(2);
        expect(workbook.sheets[0]?.rows[0]?.unitNumber).toBe('1101');
        expect(workbook.sheets[1]?.rows[0]?.busSize).toBe('8m');
        expect(workbook.sheets[1]?.rows[0]?.comment).toBe('growth bus');
        expect(workbook.sheets[1]?.rows[0]?.onOrder).toBe('2 units');
        expect(workbook.sheets[2]?.rows[0]?.electricFlag).toBe('E');
        expect(workbook.metadata.templateVersion).toBe('2026-04-08-fleet-plan-v1');
    });

    it('rejects unsupported workbook layouts that miss a required sheet', async () => {
        const workbook = new ExcelJS.Workbook();
        workbook.addWorksheet('12m Buses');
        workbook.addWorksheet('8m & 6m Buses');
        const buffer = await workbook.xlsx.writeBuffer();

        expect(() => parseFleetPlanWorkbook(buffer, {
            fileName: 'Broken.xlsx',
            userId: 'user-1',
        })).toThrow(/Missing required sheet/);
    });

    it('rejects workbooks whose timeline headers do not match the supported template', async () => {
        const workbook = new ExcelJS.Workbook();
        const diesel = workbook.addWorksheet('12m Buses');
        diesel.getCell('B4').value = 'Unit Number';
        diesel.getCell('C4').value = 'Make/Model';
        diesel.getCell('D4').value = 'Year';
        diesel.getCell('E4').value = 2024;

        const small = workbook.addWorksheet('8m & 6m Buses');
        small.getCell('B4').value = 'Unit Number';
        small.getCell('C4').value = 'Size of Bus';
        small.getCell('D4').value = 'Make/Model';
        small.getCell('E4').value = 'Comment';
        small.getCell('F4').value = 2023;
        small.getCell('G4').value = 2024;
        small.getCell('H4').value = 2025;
        small.getCell('J4').value = 2026;
        small.getCell('K4').value = 2027;
        small.getCell('L4').value = 2028;
        small.getCell('M4').value = 2029;
        small.getCell('N4').value = 2030;
        small.getCell('O4').value = 2031;
        small.getCell('P4').value = 2032;
        small.getCell('Q4').value = 2033;
        small.getCell('R4').value = 2034;
        small.getCell('S4').value = 2035;
        small.getCell('T4').value = 2036;

        const electric = workbook.addWorksheet('12m Electric Buses');
        electric.getCell('B4').value = 'Unit Number';
        electric.getCell('C4').value = 'Make/Model';
        electric.getCell('D4').value = 'Year';
        electric.getCell('E4').value = 'Electric "E"';
        ['F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q'].forEach((column, index) => {
            electric.getCell(`${column}4`).value = 2024 + index;
        });

        const buffer = await workbook.xlsx.writeBuffer();

        expect(() => parseFleetPlanWorkbook(buffer, {
            fileName: 'Broken-Headers.xlsx',
            userId: 'user-1',
        })).toThrow(/timeline header/i);
    });

    it('exports a combined Fleet Plan workbook with bus type and all timeline years', async () => {
        const buffer = await buildFleetPlanWorkbookBuffer(buildTestFleetPlanWorkbook());
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);

        expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Fleet Plan']);
        const sheet = workbook.getWorksheet('Fleet Plan');
        expect(sheet).toBeDefined();
        expect(sheet?.getCell('A1').value).toBe('Fleet Plan');
        expect(sheet?.getCell('A3').value).toBe('Bus Type');
        expect(sheet?.getCell('B3').value).toBe('Unit Number');
        expect(sheet?.getCell('I3').value).toBe('2023');
        expect(sheet?.getCell('W3').value).toBe('2037');

        expect(sheet?.getCell('A4').value).toBe('12m Diesel');
        expect(sheet?.getCell('B4').value).toBe(1101);
        expect(sheet?.getCell('M4').value).toBe('RETIRE');
        expect(sheet?.getCell('A6').value).toBe('8m & 6m');
        expect(sheet?.getCell('A7').value).toBe('12m Electric');
    });

    it('exports a planner-friendly combined workbook with filters, frozen headers, and status styling', async () => {
        const buffer = await buildFleetPlanWorkbookBuffer(buildTestFleetPlanWorkbook());
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);

        const sheet = workbook.getWorksheet('Fleet Plan');
        expect(sheet).toBeDefined();
        expect(workbook.creator).toBe('Barrie Transit Scheduler');
        expect(workbook.subject).toBe('Fleet planning workbook');
        expect(sheet?.autoFilter).toBe('A3:W7');
        expect(sheet?.views[0]).toMatchObject({
            state: 'frozen',
            ySplit: 3,
            topLeftCell: 'A4',
            showGridLines: false,
        });
        expect(sheet?.properties.tabColor?.argb).toBe('FF2563EB');
        expect(sheet?.pageSetup).toMatchObject({
            orientation: 'landscape',
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0,
            printArea: 'A1:W7',
            printTitlesRow: '1:3',
        });
        expect(sheet?.headerFooter.oddFooter).toContain('Generated by Transit Scheduler');
        expect(getFillArgb(sheet!.getCell('I4'))).toBe('FFE0F2FE');
        expect(getFillArgb(sheet!.getCell('M4'))).toBe('FFFEE2E2');
        expect(sheet?.getCell('M4').dataValidation).toMatchObject({
            type: 'list',
            allowBlank: true,
        });
    });

});
