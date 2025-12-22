import * as XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';

const debugRoute100 = () => {
    const filePath = path.join(process.cwd(), 'August Master (3).xlsx');

    console.log(`Reading ${filePath}...`);

    try {
        const buf = fs.readFileSync(filePath);
        const workbook = XLSX.read(buf, { type: 'buffer' });

        console.log("Sheets found:", workbook.SheetNames.join(", "));

        // Try to find Route 100 sheet
        const sheetName = workbook.SheetNames.find(s => s === "100" || s === "Route 100" || s.startsWith("100"));

        if (!sheetName) {
            console.error("Could not find sheet for Route 100");
            return;
        }

        console.log(`\nAnalyzing sheet: "${sheetName}"`);
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        console.log(`Loaded ${rows.length} rows.`);

        // Find Stop Name Row
        let stopRowIndex = -1;
        for (let i = 0; i < 20; i++) {
            const row = rows[i];
            if (!row) continue;
            // Check first few columns for "Stop Name"
            if (row.some(c => String(c).trim() === 'Stop Name')) {
                stopRowIndex = i;
                break;
            }
        }

        if (stopRowIndex === -1) {
            console.error("Could not find Stop Name row in first 20 rows.");
            return;
        }

        console.log(`Stop Name Row found at index ${stopRowIndex}`);
        const headerRow = rows[stopRowIndex];
        // console.log("Header Row:", headerRow);

        // Analyze Columns
        console.log("\n--- Column Analysis ---");
        for (let i = 2; i < headerRow.length; i++) {
            const val = String(headerRow[i] || '').trim();
            const isRecovery = val === 'R' || val.toLowerCase() === 'recovery' || val.toLowerCase() === 'layover';
            if (isRecovery) {
                console.log(`[RECOVERY FOUND] Col ${i}: "${val}"`);
            } else if (val) {
                console.log(`Col ${i}: "${val}"`);
            }
        }

        console.log("\n--- Trip Data Check (First Trip) ---");
        // Look for next row with data
        const tripRow = rows[stopRowIndex + 5]; // Skip a few rows to get into data
        if (tripRow) {
            console.log("Sample Data Row:", tripRow);
        }

    } catch (e) {
        console.error("Error:", e);
    }
};

debugRoute100();
