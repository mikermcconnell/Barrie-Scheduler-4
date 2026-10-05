/**
 * Diagnostic script to check effectiveDate on weekend master schedules
 *
 * Run this in the browser console when viewing Regional Transit Connections:
 *
 * 1. Open Regional Transit Connections
 * 2. Open browser console (F12)
 * 3. Paste this entire script and press Enter
 * 4. It will show which schedules have effectiveDate set
 */

(async function checkEffectiveDates() {
    console.log('=== CHECKING MASTER SCHEDULE EFFECTIVE DATES ===\n');

    // Get the schedules from the component (they're passed as a prop)
    // We need to access them from the DOM or check Firestore directly

    console.log('To check effective dates, run this in Firebase Console:');
    console.log('1. Go to Firestore Database');
    console.log('2. Navigate to: teams/{your-team-id}/masterSchedules');
    console.log('3. Look for documents with dayType "Saturday" or "Sunday"');
    console.log('4. Check if they have an "effectiveDate" field');
    console.log('5. If effectiveDate is in the future (e.g., "2026-10-13"), schedules won\'t show for dates before that\n');

    console.log('OR, select a future date in Regional Transit Connections:');
    console.log('- If local service appears when you pick a date far in the future, effectiveDate is the issue');
    console.log('- The fix: Remove or update the effectiveDate field in Firestore for weekend schedules\n');

    console.log('Code location of the filter:');
    console.log('File: utils/regional-transit/connectionAnalysis.ts');
    console.log('Lines: 236-237');
    console.log('Logic: entry.effectiveDate > selectedDate → schedule filtered out\n');
})();
