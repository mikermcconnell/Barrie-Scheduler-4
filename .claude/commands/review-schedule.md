Read `docs/rules/LOCKED_LOGIC.md`, then review
`utils/schedule/scheduleGenerator.ts` and its focused tests. Report findings
without editing unless implementation is separately requested. Check for:
1. Proper segment rounding (before summing)
2. Correct trip pairing (N+S pairs)
3. Accurate cycle time calculation (first departure through occupied end, with terminal recovery counted exactly once)
4. Gap-based merged-route block assignment
5. Preserved next-day fixed-route times
6. Planner-controlled AI optimization paths
7. Exact-or-nearest eligible approved runtime from the same direction/start orientation, with fail-closed missing data
