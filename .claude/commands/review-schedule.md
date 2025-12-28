Review the schedule generation logic in scheduleGenerator.ts and check for:
1. Proper segment rounding (before summing)
2. Correct trip pairing (N+S pairs)
3. Accurate cycle time calculation (last end - first start)
4. No violations of locked logic
