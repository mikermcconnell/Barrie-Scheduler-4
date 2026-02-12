
import { parseRideCo } from '../utils/parsers/csvParsers';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';

const OPTIMAL_DIR = 'data/training_examples';
const OUTPUT_FILE = 'utils/goldenShifts.json';

// Helper to determine day type from filename
const getDayType = (filename: string): 'Weekday' | 'Saturday' | 'Sunday' => {
    const lower = filename.toLowerCase();
    if (lower.includes('saturday')) return 'Saturday';
    if (lower.includes('sunday')) return 'Sunday';
    return 'Weekday';
};

function run() {
    console.log("Compiling Golden Shifts from Excel...");

    if (!fs.existsSync(OPTIMAL_DIR)) {
        console.error("Directory not found:", OPTIMAL_DIR);
        return;
    }

    const allGoldenShifts: any[] = [];
    const files = fs.readdirSync(OPTIMAL_DIR).filter(f => f.endsWith('.xlsx'));

    files.forEach(file => {
        console.log(`Processing ${file}...`);
        const buffer = fs.readFileSync(path.join(OPTIMAL_DIR, file));
        const dayType = getDayType(file);

        try {
            // Parse Excel file using XLSX library
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const data = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' }) as any[][];

            const shifts = parseRideCo(data);
            shifts.forEach(s => {
                // Enrich with metadata
                (s as any).isOptimalTemplate = true;
                (s as any).sourceFile = file;
                (s as any).dayType = dayType;
                // Unique ID for the template
                s.id = `GOLDEN-${dayType}-${s.id}`;
            });
            allGoldenShifts.push(...shifts);
        } catch (e) {
            console.error(`Failed to parse ${file}:`, e);
        }
    });

    console.log(`Total Golden Shifts: ${allGoldenShifts.length}`);

    // Save to utils
    const outPath = path.resolve(process.cwd(), OUTPUT_FILE);
    fs.writeFileSync(outPath, JSON.stringify(allGoldenShifts, null, 2));
    console.log(`Saved to ${OUTPUT_FILE}`);
}

run();
