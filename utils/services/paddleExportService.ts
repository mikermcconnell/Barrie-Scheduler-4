import ExcelJS from 'exceljs';
import { BREAK_THRESHOLD_HOURS } from '../demandConstants';
import { Shift, Zone } from '../demandTypes';

type PaddleActivityRow = {
    activity: string;
    startPlace: string;
    startTime: string;
    endTime: string;
    endPlace: string;
    highlight?: boolean;
};

type PaddleTimeline = {
    serviceLocation: string;
    reportTime: number;
    signOnEnd: number;
    yardDeparture: number;
    driveStart: number;
    driveEnd: number;
    yardArrival: number;
    postTripEnd: number;
    paidMinutes: number;
    driveMinutes: number;
    breakMinutes: number;
};

type BlockSeriesMeta = {
    familyNumber: number;
    pieceIndex: number;
    pieceCount: number;
    reportCode: 'AM' | 'PM';
    blockLabel: string;
};

type PaddleSheetModel = {
    title: string;
    subtitle: string;
    busLabel: string;
    zone: Zone;
    dayLabel: string;
    reportCode: 'AM' | 'PM';
    blockLabel: string;
    paidTime: string;
    breakPenalty: string;
    startPlace: string;
    reportTime: string;
    startTime: string;
    endTime: string;
    endPlace: string;
    pullOutTime: string;
    serviceStartTime: string;
    pullInTime: string;
    yardArrivalTime: string;
    notes: string[];
    activities: PaddleActivityRow[];
};

interface PaddleExportConfig {
    agencyName: string;
    yardName: string;
    zoneServiceLocation: Record<Zone, string>;
    reportLeadMinutes: number;
    signOnWindowMinutes: number;
    postTripMinutes: number;
    assignedBreakMinutes: number;
    breakPenaltyMinutes: number;
    familyGapToleranceMinutes: number;
    deadheadMinutesByZone: Record<Zone, number>;
    footerNote: string;
    highlightNote: string;
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
    postTripMinutes: 5,
    assignedBreakMinutes: 45,
    breakPenaltyMinutes: 30,
    familyGapToleranceMinutes: 75,
    deadheadMinutesByZone: {
        [Zone.NORTH]: 15,
        [Zone.SOUTH]: 8,
        [Zone.FLOATER]: 6,
    },
    footerNote: 'Shift rules are based on actual drive time. Report, pre-trip, and deadhead are outside drive time.',
    highlightNote: 'The information highlighted in yellow is used while signing in to RideCo.',
};

const daySortWeight: Record<string, number> = {
    Weekday: 0,
    Saturday: 1,
    Sunday: 2,
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
        const dayCompare = (daySortWeight[a.dayType || 'Weekday'] ?? 0) - (daySortWeight[b.dayType || 'Weekday'] ?? 0);
        if (dayCompare !== 0) return dayCompare;
        if (a.startSlot !== b.startSlot) return a.startSlot - b.startSlot;
        if (a.zone !== b.zone) return a.zone.localeCompare(b.zone);
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

const buildPaddleTimeline = (shift: Shift, config: PaddleExportConfig): PaddleTimeline => {
    const driveStart = slotToMinutes(shift.startSlot);
    const driveEnd = slotToMinutes(shift.endSlot);
    const breakMinutes = (shift.breakDurationSlots || 0) * 15;
    const deadheadMinutes = config.deadheadMinutesByZone[shift.zone];
    const serviceLocation = config.zoneServiceLocation[shift.zone];
    const yardDeparture = Math.max(0, driveStart - deadheadMinutes);
    const reportTime = Math.max(0, yardDeparture - config.reportLeadMinutes);
    const signOnEnd = reportTime + config.signOnWindowMinutes;
    const yardArrival = driveEnd + deadheadMinutes;
    const postTripEnd = yardArrival + config.postTripMinutes;
    const paidMinutes = Math.max(0, yardArrival - reportTime - breakMinutes);
    const driveMinutes = Math.max(0, driveEnd - driveStart - breakMinutes);

    return {
        serviceLocation,
        reportTime,
        signOnEnd,
        yardDeparture,
        driveStart,
        driveEnd,
        yardArrival,
        postTripEnd,
        paidMinutes,
        driveMinutes,
        breakMinutes,
    };
};

const assignBlockSeries = (
    shifts: Shift[],
    timelines: PaddleTimeline[],
    config: PaddleExportConfig,
): BlockSeriesMeta[] => {
    const families: Array<{
        familyNumber: number;
        zone: Zone;
        dayType: Shift['dayType'];
        lastDriveEnd: number;
        pieceCount: number;
    }> = [];

    const assignments = shifts.map((shift, index) => {
        const timeline = timelines[index];
        const candidates = families
            .filter(family => family.zone === shift.zone && family.dayType === shift.dayType)
            .map(family => ({
                family,
                gap: Math.abs(family.lastDriveEnd - timeline.driveStart),
            }))
            .filter(candidate => candidate.gap <= config.familyGapToleranceMinutes)
            .sort((a, b) => a.gap - b.gap || a.family.familyNumber - b.family.familyNumber);

        const family = candidates[0]?.family ?? (() => {
            const newFamily = {
                familyNumber: families.length + 1,
                zone: shift.zone,
                dayType: shift.dayType,
                lastDriveEnd: timeline.driveEnd,
                pieceCount: 0,
            };
            families.push(newFamily);
            return newFamily;
        })();

        family.pieceCount += 1;
        family.lastDriveEnd = timeline.driveEnd;

        return {
            familyNumber: family.familyNumber,
            pieceIndex: family.pieceCount,
        };
    });

    const pieceCountByFamily = new Map<number, number>();
    assignments.forEach(assignment => {
        pieceCountByFamily.set(assignment.familyNumber, assignment.pieceIndex);
    });

    return assignments.map(assignment => {
        const pieceLetter = String.fromCharCode(64 + assignment.pieceIndex);
        return {
            familyNumber: assignment.familyNumber,
            pieceIndex: assignment.pieceIndex,
            pieceCount: pieceCountByFamily.get(assignment.familyNumber) ?? assignment.pieceIndex,
            reportCode: assignment.familyNumber % 2 === 1 ? 'AM' : 'PM',
            blockLabel: `BLK${assignment.familyNumber}${pieceLetter}`,
        };
    });
};

const buildPaddleNotes = (
    shift: Shift,
    meta: BlockSeriesMeta,
    config: PaddleExportConfig,
): string[] => {
    const notes = [config.highlightNote];
    const shiftDurationHours = (shift.endSlot - shift.startSlot) / 4;

    if (shift.breakDurationSlots > 0) {
        notes.unshift('Meal break shown inside the paid piece.');
    } else if (shiftDurationHours > BREAK_THRESHOLD_HOURS) {
        notes.unshift(`${config.assignedBreakMinutes} minute break will be assigned within the shift.`);
    }

    if (meta.pieceCount > 1) {
        notes.push(`Block family ${meta.familyNumber} includes ${meta.pieceCount} linked pieces.`);
    }

    notes.push(config.footerNote);
    return notes;
};

const buildActivityRows = (
    shift: Shift,
    timeline: PaddleTimeline,
    meta: BlockSeriesMeta,
    config: PaddleExportConfig,
): PaddleActivityRow[] => {
    const rows: PaddleActivityRow[] = [
        {
            activity: 'Sign-On',
            startPlace: config.yardName,
            startTime: formatMinutes(timeline.reportTime),
            endTime: formatMinutes(timeline.signOnEnd),
            endPlace: config.yardName,
        },
        {
            activity: meta.pieceIndex > 1 ? 'Take Over / Board Block' : 'Pre-Trip / Board Block',
            startPlace: config.yardName,
            startTime: formatMinutes(timeline.signOnEnd),
            endTime: formatMinutes(timeline.yardDeparture),
            endPlace: config.yardName,
        },
        {
            activity: meta.pieceIndex > 1 ? 'Take Over' : 'Depot Pull-Out',
            startPlace: config.yardName,
            startTime: formatMinutes(timeline.yardDeparture),
            endTime: formatMinutes(timeline.driveStart),
            endPlace: timeline.serviceLocation,
        },
        {
            activity: `Transit On Demand ${shift.zone}`,
            startPlace: timeline.serviceLocation,
            startTime: formatMinutes(timeline.driveStart),
            endTime: formatMinutes(timeline.driveEnd),
            endPlace: timeline.serviceLocation,
            highlight: true,
        },
    ];

    if (shift.breakDurationSlots > 0) {
        const breakStart = slotToMinutes(shift.breakStartSlot);
        const breakEnd = slotToMinutes(shift.breakStartSlot + shift.breakDurationSlots);
        rows.push({
            activity: 'Meal Break',
            startPlace: 'As Assigned',
            startTime: formatMinutes(breakStart),
            endTime: formatMinutes(breakEnd),
            endPlace: 'As Assigned',
        });
    }

    rows.push({
        activity: 'Depot Pull-In',
        startPlace: timeline.serviceLocation,
        startTime: formatMinutes(timeline.driveEnd),
        endTime: formatMinutes(timeline.yardArrival),
        endPlace: config.yardName,
    });

    rows.push({
        activity: 'Post Trip Inspection / Sign-Off',
        startPlace: config.yardName,
        startTime: formatMinutes(timeline.yardArrival),
        endTime: formatMinutes(timeline.postTripEnd),
        endPlace: config.yardName,
    });

    return rows;
};

const buildPaddleModels = (
    shifts: Shift[],
    config: PaddleExportConfig,
): PaddleSheetModel[] => {
    const ordered = sortShifts(shifts);
    const timelines = ordered.map(shift => buildPaddleTimeline(shift, config));
    const blockSeries = assignBlockSeries(ordered, timelines, config);

    return ordered.map((shift, index) => {
        const timeline = timelines[index];
        const meta = blockSeries[index];
        const busLabel = shift.driverName?.trim() || `Bus ${index + 1}`;
        const notes = buildPaddleNotes(shift, meta, config);
        const breakPenalty = shift.breakDurationSlots === 0 && (shift.endSlot - shift.startSlot) / 4 > BREAK_THRESHOLD_HOURS
            ? formatDuration(config.breakPenaltyMinutes)
            : '';

        return {
            title: `${busLabel} ${shift.zone} ${shiftDayLabel(shift)} Block Report`,
            subtitle: `${config.agencyName} | ${meta.blockLabel}`,
            busLabel,
            zone: shift.zone,
            dayLabel: shiftDayLabel(shift),
            reportCode: meta.reportCode,
            blockLabel: meta.blockLabel,
            paidTime: formatDuration(timeline.paidMinutes),
            breakPenalty,
            startPlace: 'Yard',
            reportTime: formatMinutes(timeline.reportTime),
            startTime: formatMinutes(timeline.signOnEnd),
            endTime: formatMinutes(timeline.driveEnd),
            endPlace: shift.zone,
            pullOutTime: formatMinutes(timeline.yardDeparture),
            serviceStartTime: formatMinutes(timeline.driveStart),
            pullInTime: formatMinutes(timeline.driveEnd),
            yardArrivalTime: formatMinutes(timeline.yardArrival),
            notes,
            activities: buildActivityRows(shift, timeline, meta, config),
        };
    });
};

const setAllBorders = (cell: ExcelJS.Cell): void => {
    cell.border = {
        top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    };
};

const styleLabeledValueBlock = (
    sheet: ExcelJS.Worksheet,
    rowNumber: number,
    values: string[],
    highlightColumns: number[] = [],
): void => {
    const row = sheet.getRow(rowNumber);
    values.forEach((value, index) => {
        const cell = row.getCell(index + 1);
        cell.value = value;
        cell.font = { size: 10, bold: highlightColumns.includes(index + 1) };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        if (highlightColumns.includes(index + 1)) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE68A' } };
        }
        setAllBorders(cell);
    });
};

const styleLabelRow = (sheet: ExcelJS.Worksheet, rowNumber: number, values: string[]): void => {
    const row = sheet.getRow(rowNumber);
    values.forEach((value, index) => {
        const cell = row.getCell(index + 1);
        cell.value = value;
        cell.font = { bold: true, size: 9, color: { argb: 'FF374151' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        setAllBorders(cell);
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
        column.width = Math.min(maxLen + 2, 24);
    });
};

const addPaddleWorksheet = (
    workbook: ExcelJS.Workbook,
    model: PaddleSheetModel,
): void => {
    const sheet = workbook.addWorksheet(sanitizeSheetName(`${model.busLabel} ${model.dayLabel}`));
    sheet.properties.defaultRowHeight = 18;
    sheet.columns = [
        { width: 24 },
        { width: 18 },
        { width: 12 },
        { width: 12 },
        { width: 18 },
        { width: 16 },
        { width: 16 },
        { width: 16 },
    ];

    sheet.mergeCells('A1:H1');
    sheet.getCell('A1').value = model.title;
    sheet.getCell('A1').font = { bold: true, size: 15 };

    sheet.mergeCells('A2:H2');
    sheet.getCell('A2').value = model.subtitle;
    sheet.getCell('A2').font = { italic: true, size: 10, color: { argb: 'FF475569' } };

    styleLabelRow(sheet, 4, ['Report', 'Paid Time', 'B.P.', 'Start Place', 'Report Time', 'Start Time', 'End Time', 'End Place']);
    styleLabeledValueBlock(
        sheet,
        5,
        [model.reportCode, model.paidTime, model.breakPenalty, model.startPlace, model.reportTime, model.startTime, model.endTime, model.endPlace],
        [1, 2, 6, 7],
    );

    styleLabelRow(sheet, 7, ['Block', 'Pull-Out', 'Service Start', 'Pull-In', 'Yard Arrival', 'Zone', 'Day', 'Agency']);
    styleLabeledValueBlock(
        sheet,
        8,
        [model.blockLabel, model.pullOutTime, model.serviceStartTime, model.pullInTime, model.yardArrivalTime, model.zone, model.dayLabel, 'Transit On Demand'],
        [1, 3],
    );

    styleLabelRow(sheet, 10, ['Activity', 'Start Place', 'Start Time', 'End Time', 'End Place']);
    model.activities.forEach((activity, index) => {
        const rowNumber = 11 + index;
        const row = sheet.getRow(rowNumber);
        const values = [activity.activity, activity.startPlace, activity.startTime, activity.endTime, activity.endPlace];
        values.forEach((value, columnIndex) => {
            const cell = row.getCell(columnIndex + 1);
            cell.value = value;
            cell.alignment = {
                vertical: 'middle',
                horizontal: columnIndex >= 2 && columnIndex <= 3 ? 'center' : 'left',
                wrapText: true,
            };
            if (activity.highlight) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE68A' } };
                cell.font = { bold: true };
            }
            setAllBorders(cell);
        });
    });

    let nextRow = 12 + model.activities.length;
    model.notes.forEach(note => {
        sheet.mergeCells(`A${nextRow}:H${nextRow}`);
        const cell = sheet.getCell(`A${nextRow}`);
        cell.value = note;
        cell.font = { size: 9, italic: true, color: { argb: 'FF475569' } };
        nextRow += 1;
    });

    sheet.views = [{ state: 'frozen', ySplit: 10 }];
    sheet.pageSetup = {
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 1,
        orientation: 'portrait',
    };

    autoWidth(sheet);
};

export const exportTODPaddlesPDF = async (
    shifts: Shift[],
    configOverrides: Partial<PaddleExportConfig> = {},
): Promise<void> => {
    if (!shifts || shifts.length === 0) return;

    const config = createConfig(configOverrides);
    const models = buildPaddleModels(shifts, config);
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
    ]);

    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    models.forEach((model, index) => {
        if (index > 0) doc.addPage();

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.text(model.title, 34, 42);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(71, 85, 105);
        doc.text(model.subtitle, 34, 58);
        doc.setTextColor(0, 0, 0);

        autoTable(doc, {
            startY: 74,
            head: [['Report', 'Paid Time', 'B.P.', 'Start Place', 'Report Time', 'Start Time', 'End Time', 'End Place']],
            body: [[model.reportCode, model.paidTime, model.breakPenalty, model.startPlace, model.reportTime, model.startTime, model.endTime, model.endPlace]],
            theme: 'grid',
            margin: { left: 34, right: 34 },
            styles: { fontSize: 8.5, cellPadding: 4, lineColor: [209, 213, 219], lineWidth: 0.4 },
            headStyles: { fillColor: [243, 244, 246], textColor: [55, 65, 81], fontStyle: 'bold' },
            didParseCell: hook => {
                if (hook.section === 'body' && [0, 1, 5, 6].includes(hook.column.index)) {
                    hook.cell.styles.fillColor = [253, 230, 138];
                    hook.cell.styles.fontStyle = 'bold';
                }
            },
        });

        autoTable(doc, {
            startY: ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 110) + 10,
            head: [['Block', 'Pull-Out', 'Service Start', 'Pull-In', 'Yard Arrival', 'Zone', 'Day', 'Agency']],
            body: [[model.blockLabel, model.pullOutTime, model.serviceStartTime, model.pullInTime, model.yardArrivalTime, model.zone, model.dayLabel, config.agencyName]],
            theme: 'grid',
            margin: { left: 34, right: 34 },
            styles: { fontSize: 8.5, cellPadding: 4, lineColor: [209, 213, 219], lineWidth: 0.4 },
            headStyles: { fillColor: [243, 244, 246], textColor: [55, 65, 81], fontStyle: 'bold' },
            didParseCell: hook => {
                if (hook.section === 'body' && [0, 2].includes(hook.column.index)) {
                    hook.cell.styles.fillColor = [253, 230, 138];
                    hook.cell.styles.fontStyle = 'bold';
                }
            },
        });

        autoTable(doc, {
            startY: ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 160) + 12,
            head: [['Activity', 'Start Place', 'Start Time', 'End Time', 'End Place']],
            body: model.activities.map(activity => [
                activity.activity,
                activity.startPlace,
                activity.startTime,
                activity.endTime,
                activity.endPlace,
            ]),
            theme: 'grid',
            margin: { left: 34, right: 34 },
            styles: { fontSize: 9, cellPadding: 5, lineColor: [203, 213, 225], lineWidth: 0.45, textColor: [31, 41, 55] },
            headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold' },
            alternateRowStyles: { fillColor: [248, 250, 252] },
            didParseCell: hook => {
                const activity = model.activities[hook.row.index];
                if (hook.section === 'body' && activity?.highlight) {
                    hook.cell.styles.fillColor = [253, 230, 138];
                    hook.cell.styles.fontStyle = 'bold';
                }
            },
            columnStyles: {
                0: { cellWidth: 190 },
                1: { cellWidth: 115 },
                2: { cellWidth: 72, halign: 'center' },
                3: { cellWidth: 72, halign: 'center' },
                4: { cellWidth: 115 },
            },
        });

        const lastY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 260;
        let noteY = lastY + 18;
        doc.setFontSize(9);
        doc.setTextColor(71, 85, 105);
        model.notes.forEach(note => {
            doc.text(note, 34, Math.min(noteY, pageHeight - 34), { maxWidth: pageWidth - 68 });
            noteY += 14;
        });
        doc.setTextColor(0, 0, 0);
    });

    const fileDate = new Date().toISOString().split('T')[0];
    doc.save(`TOD_Paddles_${fileDate}.pdf`);
};

export const exportTODPaddlesExcel = async (
    shifts: Shift[],
    configOverrides: Partial<PaddleExportConfig> = {},
): Promise<void> => {
    if (!shifts || shifts.length === 0) return;

    const config = createConfig(configOverrides);
    const models = buildPaddleModels(shifts, config);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Barrie Transit Scheduler';
    workbook.created = new Date();

    const summary = workbook.addWorksheet('Paddles Summary');
    summary.properties.defaultRowHeight = 18;
    summary.addRow(['Transit On Demand Paddle Export']);
    summary.getRow(1).font = { bold: true, size: 16 };
    summary.addRow([config.highlightNote]);
    summary.addRow([config.footerNote]);
    summary.addRow([]);

    styleLabelRow(summary, 5, ['Bus', 'Day', 'Report', 'Block', 'Zone', 'Report Time', 'Start Time', 'End Time', 'Paid Time', 'B.P.', 'Service Start', 'Yard Arrival']);

    models.forEach(model => {
        const row = summary.addRow([
            model.busLabel,
            model.dayLabel,
            model.reportCode,
            model.blockLabel,
            model.zone,
            model.reportTime,
            model.startTime,
            model.endTime,
            model.paidTime,
            model.breakPenalty,
            model.serviceStartTime,
            model.yardArrivalTime,
        ]);

        [3, 4, 7, 8].forEach(columnNumber => {
            const cell = row.getCell(columnNumber);
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE68A' } };
            cell.font = { bold: true };
        });

        row.eachCell(cell => {
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            setAllBorders(cell);
        });
    });

    autoWidth(summary);
    models.forEach(model => addPaddleWorksheet(workbook, model));

    const fileDate = new Date().toISOString().split('T')[0];
    const buffer = await workbook.xlsx.writeBuffer();
    downloadWorkbook(buffer, `TOD_Paddles_${fileDate}.xlsx`);
};
