import { optimizeImplementation } from '../api/optimize';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Manually load .env.local from the root directory
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    console.log(`Loading .env from ${envPath}`);
    dotenv.config({ path: envPath });
} else {
    console.warn("⚠️ .env.local not found at " + envPath);
}

async function run() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("❌ No GEMINI_API_KEY found in environment variables.");
    }

    console.log("✅ API Key loaded: " + apiKey.substring(0, 5) + "...");

    // Create dummy requirements: 
    // Scenario: High demand in South, Low in North at 8 AM (Slot 32)
    const requirements = Array.from({ length: 96 }, (_, i) => {
        // Simple curve: 1 driver everywhere, peak of 5 at 8 AM
        const isPeak = i >= 32 && i <= 40; // 8:00 AM - 10:00 AM

        const total = isPeak ? 4 : 1;
        const north = isPeak ? 1 : 0; // Peak mostly South
        const south = isPeak ? 3 : 1; // South has high demand

        return {
            slotIndex: i,
            total,
            north,
            south
        };
    });

    console.log("🧪 Starting Local One-Off Test...");
    console.log("Scenario: Peak South Demand at 8 AM");

    try {
        const shifts = await optimizeImplementation(requirements, apiKey);

        console.log("\n✨ OPTIMIZATION SUCCESS ✨");
        console.log(`Generated ${shifts.length} shifts.`);

        // Basic Analysis
        const southShifts = shifts.filter((s: any) => s.zone === 'South');
        const northShifts = shifts.filter((s: any) => s.zone === 'North');
        const floaters = shifts.filter((s: any) => s.zone === 'Floater');

        console.log(`Zone Breakdown:`);
        console.log(`- South: ${southShifts.length}`);
        console.log(`- North: ${northShifts.length}`);
        console.log(`- Floater: ${floaters.length}`);

        console.log("\nFirst 3 shifts:");
        console.log(JSON.stringify(shifts.slice(0, 3), null, 2));

    } catch (error) {
        console.error("\n❌ TEST FAILED:", error);
    }
}

run().catch(console.error);
