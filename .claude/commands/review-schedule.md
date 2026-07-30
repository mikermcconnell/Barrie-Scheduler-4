Review the schedule generation logic in scheduleGenerator.ts and check for:
1. Proper segment rounding (before summing)
2. Correct trip pairing (N+S pairs)
3. Accurate cycle time calculation (first departure through occupied end, with terminal recovery counted exactly once)
4. No violations of locked logic
