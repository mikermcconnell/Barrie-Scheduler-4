import ExcelJS from 'exceljs';
import { Shift, Zone } from '../demandTypes';

type PaddleActivityRow = {
    activity: string;
    start: string;
    end: string;
    location: string;
    note?: string;
};

type PaddleTimeline = {
    serviceLocation: string;
    reportTime: number;
    shiftStart: number;
    yardDeparture: number;
    driveStart: number;
    driveEnd: number;
    shiftEnd: number;
    paidMinutes: number;
    driveMinutes: number;
    breakMinutes: number;
    rows: PaddleActivityRow[];
};

interface PaddleExportConfig {
    agencyName: string;
    yardName: string;
    zoneServiceLocation: Record<Zone, string>;
    reportLeadMinutes: number;
    signOnWindowMinutes: number;
    deadheadMinutesByZone: Record<Zone, number>;
    footerNote: string;
}

const DEFAULT_CONFIG: PaddleExportConfig = {
    agencyName: 'Transit On Demand',
    yardName: 'Welham Facility',
    zoneServiceLocation: {
        [Zone.NORTH]: 'Downtown Hub',
        [Zone.SOUTH]: 'BSGO',
        [Zone.FLOATER]: 'Park Place',
    },
    reportLeadMinutes: 15,
    signOnWindowMinutes: 5,
    deadheadMinutesByZone: {
        [Zone.NORTH]: 15,
        [Zone.SOUTH]: 8,
        [Zone.FLOATER]: 6,
    },
    footerNote: 'Shift rules are based on actual drive time. Report, pre-trip, and deadhead are outside drive time.',
};

const slotToMinutes = (slot: number): number => Math.max(0, Math.round(slot * 15));

const formatMinutes = (totalMinutes: number): string => {
    const safe = Number.isFinite(totalMinutes) ? Math.max(0, Math.round(totalMinutes)) : 0;
    const hours = Math.floor(safe / 60);
    const minutes = safe % 60;
    return `${hours}:${minutes.toString().padStart(2, '0')}`;
};

const formatDuration = (minutes: number): string => {
    const safe = Math.max(0, Math.round(minutes));
    const hours = Math.floor(safe / 60);
    const mins = safe % 60;
    return `${hours}:${mins.toString().padStart(2, '0')}`;
};

const shiftDayLabel = (shift: Shift): string => {
    if (shift.dayType === 'Saturday') return 'Saturday';
    if (shift.dayType === 'Sunday') return 'Sunday';
    return 'Mon-Fri';
};

const sortShifts = (shifts: Shift[]): Shift[] => {
    return [...shifts].sort((a, b) => {
        if (a.dayType !== b.dayType) return (a.dayType || 'Weekday').localeCompare(b.dayType || 'Weekday');
        if (a.startSlot !== b.startSlot) return a.startSlot - b.startSlot;
        return a.driverName.localeCompare(b.driverName, undefined, { numeric: true, sensitivity: 'base' });
    });
};

const downloadWorkbook = (buffer: ExcelJS.Buffer, fileName: string): void => {
    const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
};

const sanitizeSheetName = (value: string): string => {
    return value.replace(/[\\/*?:[\]]/g, '').slice(0, 31) || 'Paddle';
};

const buildPaddleTimeline = (shift: Shift, config: PaddleExportConfig): PaddleTimeline => {
    const driveStart = slotToMinutes(shift.startSlot);
    const driveEnd = slotToMinutes(shift.endSlot);
    const breakMinutes = (shift.breakDurationSlots || 0) * 15;
    const deadheadMinutes = config.deadheadMinutesByZone[shift.zone];
    const serviceLocation = config.zoneServiceLocation[shift.zone];

    const yardDeparture = Math.max(0, driveStart - deadheadMinutes);
    const reportTime = Math.max(0, yardDeparture - config.reportLeadMinutes);
    const shiftStart = reportTime + config.signOnWindowMinutes;
    const shiftEnd = driveEnd + deadheadMinutes;
    const paidMinutes = Math.max(0, shiftEnd - reportTime - breakMinutes);
    const driveMinutes = Math.max(0, driveEnd - driveStart - breakMinutes);

    const rows: PaddleActivityRow[] = [
        {
            activity: 'Sign-On',
            start: formatMinutes(reportTime),
            end: formatMinutes(shiftStart),
            location: config.yardName,
            note: 'Report and sign-on window',
        },
        {
            activity: 'Pre-Trip / Yard Departure',
            start: formatMinutes(yardDeparture),
            end: '',
            location: config.yardName,
            note: 'Vehicle ready to leave yard',
        },
        {
            activity: 'Deadhead to Service',
            start: formatMinutes(yardDeparture),
            end: formatMinutes(driveStart),
            location: `${config.yardName} -> ${serviceLocation}`,
            note: 'Travel to actual drive start',
        },
        {
            activity: `Transit On Demand ${shift.zone}`,
            start: formatMinutes(driveStart),
            end: formatMinutes(driveEnd),
            location: serviceLocation,
            note: 'Actual drive time',
        },
    ];

    if (shift.breakDurationSlots > 0) {
        const breakStart = slotToMinutes(shift.breakStartSlot);
        const breakEnd = slotToMinutes(shift.breakStartSlot + shift.breakDurationSlots);
        rows.push({
            activity: 'Meal Break',
            start: formatMinutes(breakStart),
            end: formatMinutes(breakEnd),
            location: 'As Assigned',
            note: 'Unpaid break',
        });
    }

    rows.push({
        activity: 'Deadhead to Yard',
        start: formatMinutes(driveEnd),
        end: formatMinutes(shiftEnd),
        location: `${serviceLocation} -> ${config.yardName}`,
        note: 'End shift on yard arrival',
    });

    return {
        serviceLocation,
        reportTime,
        shiftStart,
        yardDeparture,
        driveStart,
        driveEnd,
        shiftEnd,
        paidMinutes,
        driveMinutes,
        breakMinutes,
        rows,
    };
};

const createConfig = (configOverrides: Partial<PaddleExportConfig>): PaddleExportConfig => ({
    ...DEFAULT_CONFIG,
    ...configOverrides,
    zoneServiceLocation: {
        ...DEFAULT_CONFIG.zoneServiceLocation,
        ...(configOverrides.zoneServiceLocation || {}),
    },
    deadheadMinutesByZone: {
        ...DEFAULT_CONFIG.deadheadMinutesByZone,
        ...(configOverrides.deadheadMinutesByZone || {}),
    },
});

const styleHeaderRow = (row: ExcelJS.Row): void => {
    row.eachCell(cell => {
        cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = {
            top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        };
    });
};

const autoWidth = (sheet: ExcelJS.Worksheet): void => {
    sheet.columns.forEach(column => {
        let maxLen = 10;
        column.eachCell?.({ includeEmpty: false }, cell => {
            const cellValue = Array.isArray(cell.value)
                ? cell.value.map(part => String(part)).join(' ')
                : String(cell.value ?? '');
            maxLen = Math.max(maxLen, cellValue.length);
        });
        column.width = Math.min(maxLen + 2, 42);
    });
};

export const exportTODPaddlesPDF = async (
    shifts: Shift[],
    configOverrides: Partial<PaddleExportConfig> = {}
): Promise<void> => {
    if (!shifts || shifts.length === 0) return;

    const config = createConfig(configOverrides);
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
    ]);

    const ordered = sortShifts(shifts);
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    ordered.forEach((shift, index) => {
        if (index > 0) doc.addPage();

        const busLabel = shift.driverName || `Bus ${index + 1}`;
        const blockLabel = `BLK${index + 1}`;
        const timeline = buildPaddleTimeline(shift, config);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.text(`${busLabel} ${shift.zone} ${shiftDayLabel(shift)} Block Report`, 40, 44);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.text(`${config.agencyName} | Block: ${blockLabel}`, 40, 64);
        doc.text(
            `Report: ${formatMinutes(timeline.reportTime)} | Shift Start: ${formatMinutes(timeline.shiftStart)} | Drive Start: ${formatMinutes(timeline.driveStart)}`,
            40,
            80
        );
        doc.text(
            `Drive End: ${formatMinutes(timeline.driveEnd)} | Shift End: ${formatMinutes(timeline.shiftEnd)} | Paid: ${formatDuration(timeline.paidMinutes)} | Drive: ${formatDuration(timeline.driveMinutes)}`,
            40,
            96
        );
        doc.text(
            `Yard: ${config.yardName} | Service Start: ${timeline.serviceLocation} | End Place: ${config.yardName}`,
            40,
            112
        );

        autoTable(doc, {
            startY: 130,
            head: [['Activity', 'Start', 'End', 'Location', 'Note']],
            body: timeline.rows.map(row => [row.activity, row.start, row.end, row.location, row.note || '']),
            theme: 'grid',
            styles: { fontSize: 9, cellPadding: 5, lineColor: [203, 213, 225], lineWidth: 0.5 },
            headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
            bodyStyles: { textColor: [31, 41, 55] },
            alternateRowStyles: { fillColor: [248, 250, 252] },
            columnStyles: {
                0: { cellWidth: 150 },
                1: { cellWidth: 60 },
                2: { cellWidth: 60 },
                3: { cellWidth: 145 },
                4: { cellWidth: 90 },
            },
            margin: { left: 40, right: 40 },
        });

        const lastY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 160;
        doc.setFontSize(9);
        doc.setTextColor(71, 85, 105);
        doc.text(config.footerNote, 40, Math.min(pageHeight - 40, lastY + 24), { maxWidth: pageWidth - 80 });
        doc.setTextColor(0, 0, 0);
    });

    const fileDate = new Date().toISOString().split('T')[0];
    doc.save(`TOD_Paddles_${fileDate}.pdf`);
};

export const exportTODPaddlesExcel = async (
    shifts: Shift[],
    configOverrides: Partial<PaddleExportConfig> = {}
): Promise<void> => {
    if (!shifts || shifts.length === 0) return;

    const config = createConfig(configOverrides);
    const ordered = sortShifts(shifts);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Barrie Transit Scheduler';
    workbook.created = new Date();

    const summary = workbook.addWorksheet('Paddles Summary');
    summary.addRow(['Transit On Demand Paddles']);
    summary.getRow(1).font = { bold: true, size: 16 };
    summary.addRow([config.footerNote]);
    summary.addRow([]);

    const summaryHeader = summary.addRow([
        'Paddle',
        'Day',
        'Zone',
        'Report Time',
        'Shift Start',
        'Drive Start',
        'Drive End',
        'Shift End',
        'Paid Time',
        'Drive Time',
        'Break',
        'Yard',
        'Service Start',
    ]);
    styleHeaderRow(summaryHeader);

    ordered.forEach((shift, index) => {
        const timeline = buildPaddleTimeline(shift, config);
        const busLabel = shift.driverName || `Bus ${index + 1}`;

        summary.addRow([
            busLabel,
            shiftDayLabel(shift),
            shift.zone,
            formatMinutes(timeline.reportTime),
            formatMinutes(timeline.shiftStart),
            formatMinutes(timeline.driveStart),
            formatMinutes(timeline.driveEnd),
            formatMinutes(timeline.shiftEnd),
            formatDuration(timeline.paidMinutes),
            formatDuration(timeline.driveMinutes),
            formatDuration(timeline.breakMinutes),
            config.yardName,
            timeline.serviceLocation,
        ]);

        const sheet = workbook.addWorksheet(sanitizeSheetName(`${busLabel} ${shiftDayLabel(shift)}`));
        sheet.addRow([`${busLabel} ${shift.zone} ${shiftDayLabel(shift)}`]);
        sheet.getRow(1).font = { bold: true, size: 15 };
        sheet.addRow([config.agencyName]);
        sheet.addRow([]);

        const metaHeader = sheet.addRow(['Field', 'Value', 'Field', 'Value']);
        styleHeaderRow(metaHeader);
        sheet.addRow(['Report Time', formatMinutes(timeline.reportTime), 'Shift Start', formatMinutes(timeline.shiftStart)]);
        sheet.addRow(['Drive Start', formatMinutes(timeline.driveStart), 'Drive End', formatMinutes(timeline.driveEnd)]);
        sheet.addRow(['Shift End', formatMinutes(timeline.shiftEnd), 'Paid Time', formatDuration(timeline.paidMinutes)]);
        sheet.addRow(['Drive Time', formatDuration(timeline.driveMinutes), 'Break', formatDuration(timeline.breakMinutes)]);
        sheet.addRow(['Start Place', config.yardName, 'End Place', config.yardName]);
        sheet.addRow(['Service Start', timeline.serviceLocation, 'Zone', shift.zone]);
        sheet.addRow([]);

        const activityHeader = sheet.addRow(['Activity', 'Start', 'End', 'Location', 'Note']);
        styleHeaderRow(activityHeader);
        timeline.rows.forEach(row => {
            const excelRow = sheet.addRow([row.activity, row.start, row.end, row.location, row.note || '']);
            if (row.note === 'Actual drive time') {
                excelRow.eachCell(cell => {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE68A' } };
                });
            }
        });

        sheet.addRow([]);
        sheet.addRow([config.footerNote]);
        autoWidth(sheet);
    });

    autoWidth(summary);

    const fileDate = new Date().toISOString().split('T')[0];
    const buffer = await workbook.xlsx.writeBuffer();
    downloadWorkbook(buffer, `TOD_Paddles_${fileDate}.xlsx`);
};
