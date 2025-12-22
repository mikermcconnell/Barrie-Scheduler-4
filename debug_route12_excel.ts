/**
 * Debug script to analyze raw Excel data for Route 12
 * to find where phantom trips are coming from
 */
import * as fs from 'fs';
import * as XLSX from 'xlsx';

const main = () => {
    console.log("=== Route 12 Raw Excel Data Analysis ===\n");

    const buffer = fs.readFileSync('August Master (3).xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    // Find Route 12 sheet
    const sheetName = workbook.SheetNames.find(n => n === '12');
    if (!sheetName) {
        console.error('Sheet "12" not found');
        console.log('Available sheets:', workbook.SheetNames.join(', '));
        return;
    }

    const sheet = workbook.Sheets[sheetName];
    const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    // Find the "Stop Name" row
    let stopNameRow = -1;
    for (let i = 0; i < Math.min(20, data.length); i++) {
        const row = data[i];
        const colA = String(row[0] || '').toLowerCase().trim();
        const colB = String(row[1] || '').toLowerCase().trim();
        if (colA.includes('stop name') || colB.includes('stop name')) {
            stopNameRow = i;
            break;
        }
    }

    if (stopNameRow === -1) {
        console.error('Could not find Stop Name row');
        return;
    }

    console.log(`Found "Stop Name" row at index ${stopNameRow}`);
    console.log(`Stop names: ${data[stopNameRow].slice(2, 20).join(' | ')}`);

    // Look at data rows right after the Stop ID row
    const stopIdRow = stopNameRow + 1;
    console.log(`\n=== First 15 data rows (starting after Stop ID row ${stopIdRow}) ===\n`);

    for (let i = stopIdRow + 1; i < Math.min(stopIdRow + 17, data.length); i++) {
        const row = data[i];
        const colA = String(row[0] || '').trim();
        const colB = String(row[1] || '').trim();

        // Show first 10 columns
        const cells = row.slice(0, 15).map((c: any, idx: number) => {
            if (c === '' || c === null || c === undefined) return '-';
            if (typeof c === 'number') {
                // Check if it looks like a time (0-1 range)
                if (c > 0 && c < 1) {
                    const totalMins = Math.round(c * 24 * 60);
                    const h = Math.floor(totalMins / 60);
                    const m = totalMins % 60;
                    return `${c.toFixed(4)} (=${h}:${m.toString().padStart(2, '0')})`;
                }
                return String(c);
            }
            return String(c).substring(0, 15);
        });

        console.log(`Row ${i}: [${colA || '-'}] [${colB || '-'}] | ${cells.slice(2).join(' | ')}`);
    }

    // Specifically look for cells that might contain 1, 2, 3 or very small numbers
    console.log('\n=== Looking for suspicious small numbers (<10) in data rows ===\n');

    for (let i = stopIdRow + 1; i < Math.min(stopIdRow + 50, data.length); i++) {
        const row = data[i];
        for (let j = 2; j < Math.min(35, row.length); j++) {
            const val = row[j];
            if (typeof val === 'number' && val > 0 && val < 10 && !Number.isInteger(val)) {
                // Very small decimal - likely a time
                const totalMins = Math.round(val * 24 * 60);
                if (totalMins < 15) { // Under 15 minutes (12:00 - 12:14 AM)
                    console.log(`Row ${i}, Col ${j}: value=${val}, parsed as ${totalMins} mins (12:${totalMins.toString().padStart(2, '0')} AM)`);
                }
            } else if (val === 1 || val === 2 || val === 3) {
                console.log(`Row ${i}, Col ${j}: INTEGER value=${val} (could be priority/sequence, not time)`);
            }
        }
    }
};

main();
