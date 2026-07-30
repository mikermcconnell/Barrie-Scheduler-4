import { beforeEach, describe, expect, it, vi } from 'vitest';

const pdfMocks = vi.hoisted(() => ({
    html2canvas: vi.fn(),
    addImage: vi.fn(),
    line: vi.fn(),
    rect: vi.fn(),
    save: vi.fn(),
    setDrawColor: vi.fn(),
    setFillColor: vi.fn(),
    setFont: vi.fn(),
    setFontSize: vi.fn(),
    setLineWidth: vi.fn(),
    setTextColor: vi.fn(),
    text: vi.fn(),
}));

vi.mock('html2canvas', () => ({
    default: pdfMocks.html2canvas,
}));

vi.mock('jspdf', () => ({
    jsPDF: vi.fn(function JsPdfMock() {
        return {
            internal: {
                pageSize: {
                    getWidth: () => 279.4,
                    getHeight: () => 215.9,
                },
            },
            addImage: pdfMocks.addImage,
            line: pdfMocks.line,
            rect: pdfMocks.rect,
            save: pdfMocks.save,
            setDrawColor: pdfMocks.setDrawColor,
            setFillColor: pdfMocks.setFillColor,
            setFont: pdfMocks.setFont,
            setFontSize: pdfMocks.setFontSize,
            setLineWidth: pdfMocks.setLineWidth,
            setTextColor: pdfMocks.setTextColor,
            text: pdfMocks.text,
        };
    }),
}));

import { exportFareProgramsUsageMapPdf } from '../utils/fare-programs/fareProgramsPdfExport';

describe('Fare Programs PDF export', () => {
    beforeEach(() => {
        Object.values(pdfMocks).forEach((mock) => mock.mockClear());
        pdfMocks.html2canvas.mockResolvedValue({
            width: 1600,
            height: 1000,
            toDataURL: () => 'data:image/png;base64,fare-programs-page',
        });
    });

    it('creates a polished landscape page capture with planning context', async () => {
        const element = document.createElement('div');
        const fileName = await exportFareProgramsUsageMapPdf({
            element,
            filterLabel: 'Weekdays, 9 AM–4 PM',
            sourceFileName: 'Barrie Transit.xlsx',
            totalUses: 2059,
            mappedUses: 1600,
            now: new Date('2026-07-30T16:00:00Z'),
        });

        expect(pdfMocks.html2canvas).toHaveBeenCalledWith(element, expect.objectContaining({
            backgroundColor: '#f9fafb',
            scale: expect.any(Number),
            useCORS: true,
        }));
        expect(pdfMocks.text).toHaveBeenCalledWith(
            'Fare Programs - High School Pass Usage Map',
            expect.any(Number),
            expect.any(Number),
        );
        expect(pdfMocks.text).toHaveBeenCalledWith(
            '2,059 total uses | 1,600 uses shown',
            expect.any(Number),
            expect.any(Number),
        );
        expect(pdfMocks.addImage).toHaveBeenCalledOnce();
        expect(pdfMocks.save).toHaveBeenCalledWith(
            'fare-programs-high-school-usage-map-2026-07-30.pdf',
        );
        expect(fileName).toBe('fare-programs-high-school-usage-map-2026-07-30.pdf');
    });
});
