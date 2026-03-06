import { Shift, Zone } from '../demandTypes';

type PaddleRow = {
    activity: string;
    start: string;
    end: string;
    location: string;
};

interface PaddleExportConfig {
    agencyName: string;
    yardName: string;
    zoneServiceLocation: Record<Zone, string>;
    signOnLeadMinutes: number;
    signOnWindowMinutes: number;
    preTripLeadMinutes: number;
    postTripMinutes: number;
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
    signOnLeadMinutes: 20,
    signOnWindowMinutes: 5,
    preTripLeadMinutes: 6,
    postTripMinutes: 12,
    deadheadMinutesByZone: {
        [Zone.NORTH]: 15,
        [Zone.SOUTH]: 8,
        [Zone.FLOATER]: 6,
    },
    footerNote: 'The highlighted information is used to select shifts while signing in to RideCo.',
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

const buildPaddleRows = (shift: Shift, config: PaddleExportConfig): PaddleRow[] => {
    const shiftStart = slotToMinutes(shift.startSlot);
    const shiftEnd = slotToMinutes(shift.endSlot);
    const serviceLocation = config.zoneServiceLocation[shift.zone];
    const deadheadEnd = shiftEnd + config.deadheadMinutesByZone[shift.zone];

    const signOnStart = Math.max(0, shiftStart - config.signOnLeadMinutes);
    const signOnEnd = Math.max(signOnStart, signOnStart + config.signOnWindowMinutes);
    const preTrip = Math.max(signOnEnd, shiftStart - config.preTripLeadMinutes);

    const rows: PaddleRow[] = [
        {
            activity: 'Sign-On',
            start: formatMinutes(signOnStart),
            end: formatMinutes(signOnEnd),
            location: config.yardName,
        },
        {
            activity: 'Pre-Trip',
            start: formatMinutes(preTrip),
            end: '',
            location: config.yardName,
        },
        {
            activity: `Board Block ${shift.zone}`,
            start: formatMinutes(shiftStart),
            end: '',
            location: serviceLocation,
        },
        {
            activity: `Transit On Demand ${shift.zone}`,
            start: formatMinutes(shiftStart),
            end: formatMinutes(shiftEnd),
            location: serviceLocation,
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
        });
    }

    rows.push(
        {
            activity: 'Deadhead',
            start: formatMinutes(shiftEnd),
            end: formatMinutes(deadheadEnd),
            location: config.yardName,
        },
        {
            activity: 'Post Trip Inspection / Sign-Off',
            start: formatMinutes(deadheadEnd),
            end: formatMinutes(deadheadEnd + config.postTripMinutes),
            location: config.yardName,
        }
    );

    return rows;
};

export const exportTODPaddlesPDF = async (
    shifts: Shift[],
    configOverrides: Partial<PaddleExportConfig> = {}
): Promise<void> => {
    if (!shifts || shifts.length === 0) return;

    const config: PaddleExportConfig = {
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
    };

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
        const paidMinutes = slotToMinutes(shift.endSlot) - slotToMinutes(shift.startSlot) - (shift.breakDurationSlots * 15);
        const rows = buildPaddleRows(shift, config);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.text(`${busLabel} ${shift.zone} ${shiftDayLabel(shift)}  Block Report`, 40, 48);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.text(config.agencyName, 40, 66);
        doc.text(`Block: ${blockLabel}`, 40, 82);
        doc.text(`Paid Time (est.): ${formatDuration(paidMinutes)}`, 170, 82);
        doc.text(`Start Place: ${config.yardName}`, 330, 82);
        doc.text(`End Place: ${config.zoneServiceLocation[shift.zone]}`, 470, 82);

        autoTable(doc, {
            startY: 96,
            head: [['Activity', 'Start', 'End', 'Location']],
            body: rows.map(row => [row.activity, row.start, row.end, row.location]),
            theme: 'grid',
            styles: { fontSize: 10, cellPadding: 5, lineColor: [203, 213, 225], lineWidth: 0.5 },
            headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
            columnStyles: {
                0: { cellWidth: 260 },
                1: { cellWidth: 85 },
                2: { cellWidth: 85 },
                3: { cellWidth: 130 },
            },
            margin: { left: 40, right: 40 },
        });

        const lastY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 130;
        doc.setFontSize(9);
        doc.setTextColor(71, 85, 105);
        doc.text(config.footerNote, 40, Math.min(pageHeight - 40, lastY + 28), { maxWidth: pageWidth - 80 });
        doc.setTextColor(0, 0, 0);
    });

    const fileDate = new Date().toISOString().split('T')[0];
    doc.save(`TOD_Paddles_${fileDate}.pdf`);
};
