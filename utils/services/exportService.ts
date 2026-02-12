import { Shift } from '../demandTypes';
import { formatSlotToTime } from '../dataGenerator';

export const generateRideCoCSV = (shifts: Shift[]): string => {
    if (!shifts || shifts.length === 0) return '';

    // Determine the number of columns required (Shift 1 to Shift N)
    // We'll assume the first two columns (0 and 1) are labels/empty as per the parser logic (startColIndex = 2)
    const numShifts = shifts.length;
    const numRows = 20; // Up to Row 19 (Break Duration)
    const numCols = 2 + numShifts;

    // Initialize matrix with empty strings
    const matrix: string[][] = Array.from({ length: numRows }, () => Array(numCols).fill(''));

    // Set Row Labels (Optional, but good for context based on Parser)
    matrix[9][0] = 'Shift Number';
    matrix[10][0] = 'Day Type';
    matrix[13][0] = 'Zone';
    matrix[14][0] = 'Bus #';
    matrix[15][0] = 'Start Time';
    matrix[16][0] = 'End Time';
    matrix[17][0] = 'Break Start';
    matrix[18][0] = 'Break End';
    matrix[19][0] = 'Break Duration';

    shifts.forEach((shift, index) => {
        const colDiff = 2; // Start data at column 2 (C)
        const col = index + colDiff;

        // Row 10: Shift Number
        matrix[9][col] = `Shift ${index + 1}`;

        // Row 11: Day Type (Default to Weekday if missing)
        matrix[10][col] = shift.dayType || 'Weekday';

        // Row 14: Zone Area
        matrix[13][col] = shift.zone;

        // Row 15: Bus Number / Driver Name
        matrix[14][col] = shift.driverName;

        // Row 16: Service Start Time
        matrix[15][col] = formatSlotToTime(shift.startSlot);

        // Row 17: Service End Time
        // Handle overnight wrap for display if needed, but formatSlotToTime handles strict modulo. 
        // Ideally we might want "25:00" format? 
        // For now, formatSlotToTime (00:00-23:45) is standard.
        // If endSlot > 96, formatSlotToTime wraps.
        matrix[16][col] = formatSlotToTime(shift.endSlot);

        // Row 18: Break Start Time
        if (shift.breakDurationSlots > 0) {
            matrix[17][col] = formatSlotToTime(shift.breakStartSlot);

            // Row 19: Break End Time
            const breakEndSlot = shift.breakStartSlot + shift.breakDurationSlots;
            matrix[18][col] = formatSlotToTime(breakEndSlot);

            // Row 20: Break Duration (Minutes)
            matrix[19][col] = (shift.breakDurationSlots * 15).toString();
        } else {
            matrix[17][col] = 'N/B';
            matrix[18][col] = 'N/B';
            matrix[19][col] = '0';
        }
    });

    // Convert matrix to CSV string
    return matrix.map(row => row.join(',')).join('\n');
};

export const downloadCSV = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
};
