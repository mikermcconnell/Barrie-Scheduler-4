
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

// File Paths
const OPTIMAL_FILE = 'Optimal Weekday RideCo_Shifts_2025-12-08.xlsx';
const TEMPLATE_FILE = 'RideCo - Template ToD Shifts November 16 2025 (Active).csv';

// Helper to transpose and parse the specific "Shift as Column" format
function parseTransposedData(data: any[], type: 'excel' | 'csv'): any[] {
    const shifts: any[] = [];

    // Find key rows based on the "Keys" in the first column
    const getRow = (keySnippet: string) => data.find((row: any) => {
        const val = row[type === 'excel' ? 'EMPTY' : '0'] || row[''] || Object.values(row)[0];
        return val && String(val).includes(keySnippet);
    });

    const shiftLabelRow = getRow("Shift Label") || getRow("Shift Number");
    const startTimeRow = getRow("Service Start Time") || getRow("Start Time");
    const endTimeRow = getRow("Service End Time") || getRow("End Time");
    const zoneRow = getRow("Driver (optional)") || getRow("Zone"); // "Zone" in Excel, "Driver" (contains North/South) in CSV

    if (!startTimeRow) {
        console.warn("⚠️ Could not find Start Time row");
        return [];
    }

    // Iterate through keys (columns)
    Object.keys(startTimeRow).forEach(key => {
        // Skip the label column itself
        const val = startTimeRow[key];
        if (!val || String(val).includes("Start Time")) return;

        // Extract values
        const start = val;
        const end = endTimeRow ? endTimeRow[key] : "?";
        const label = shiftLabelRow ? shiftLabelRow[key] : `Shift-${key}`;

        let zone = "Floater"; // Default
        const rawZone = zoneRow ? zoneRow[key] : "";
        if (rawZone) {
            const z = String(rawZone).toLowerCase();
            if (z.includes("north")) zone = "North";
            else if (z.includes("south")) zone = "South";
        }

        shifts.push({
            id: label,
            zone,
            start,
            end,
            rawZone
        });
    });

    return shifts;
}

async function run() {
    try {
        console.log("📊 Analyzing Optimization Files (Transposed Logic)...");

        // 1. Parse Optimal Weekday Excel
        console.log(`\nReading ${OPTIMAL_FILE}...`);
        const optimalBuffer = fs.readFileSync(path.resolve(process.cwd(), OPTIMAL_FILE));
        const workbook = XLSX.read(optimalBuffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const optimalRaw = XLSX.utils.sheet_to_json(sheet, { defval: "" }); // Use default value to keep keys

        const optimalShifts = parseTransposedData(optimalRaw, 'excel');
        console.log(`✅ Extracted ${optimalShifts.length} shifts from Optimal File.`);

        // 2. Parse Template CSV
        console.log(`\nReading ${TEMPLATE_FILE}...`);
        const templateContent = fs.readFileSync(path.resolve(process.cwd(), TEMPLATE_FILE), 'utf-8');
        // Parse CSV manually to JSON (since it's transposed and complex)
        const lines = templateContent.split('\n').map(line => line.split(','));
        const templateRaw = lines.map(line => {
            const obj: any = {};
            line.forEach((val, idx) => obj[idx] = val.trim());
            return obj;
        });

        const templateShifts = parseTransposedData(templateRaw, 'csv');
        console.log(`✅ Extracted ${templateShifts.length} shifts from Template File.`);

        // 3. Comparison
        console.log("\n🔍 COMPARING One-to-One Matches...");
        let exactMatches = 0;
        let modifiedTime = 0;
        let unknown = 0;

        optimalShifts.forEach(opt => {
            // Try to find a match in template by Start/End/Zone
            const match = templateShifts.find(t =>
                t.start === opt.start &&
                t.end === opt.end &&
                t.zone === opt.zone
            );

            if (match) {
                exactMatches++;
                // console.log(`  MATCH: ${opt.zone} ${opt.start}-${opt.end}`);
            } else {
                // Check if same Zone but different time
                const similar = templateShifts.find(t => t.zone === opt.zone);
                if (similar) {
                    modifiedTime++;
                    console.log(`  MODIFIED: ${opt.zone} ${opt.start}-${opt.end} (No exact template match)`);
                } else {
                    unknown++;
                    console.log(`  UNKNOWN: ${opt.zone} ${opt.start}-${opt.end}`);
                }
            }
        });

        console.log("\n📈 Statistics:");
        console.log(`  Total Optimal Shifts: ${optimalShifts.length}`);
        console.log(`  Exact Matches in Template: ${exactMatches}`);
        console.log(`  Modified/New Times: ${modifiedTime + unknown}`);

        // Save detailed JSON
        fs.writeFileSync('optimal_shifts_parsed.json', JSON.stringify(optimalShifts, null, 2));
        fs.writeFileSync('template_shifts_parsed.json', JSON.stringify(templateShifts, null, 2));

    } catch (error) {
        console.error("❌ Error analyzing files:", error);
    }
}

run();
