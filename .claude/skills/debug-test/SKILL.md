---
name: debug-test
description: Use when debugging issues or writing tests. Leverages existing debug scripts and test infrastructure.
---

## Debug & Test Infrastructure

### Test Files

Located in `tests/`:

| File | Coverage |
|------|----------|
| `timeUtils.test.ts` | Time parsing, post-midnight handling |
| `parser.test.ts` | CSV/Excel parsing |
| `scheduleGenerator.goldenPath.test.ts` | Golden path generation |
| `scheduleGenerator.directionStart.test.ts` | Direction start logic |
| `scheduleGenerator.floating.test.ts` | Floating trip generation |
| `blockAssignmentCore.test.ts` | Gap-based block chaining |
| `connectionUtils.test.ts` | Connection matching |
| `scheduleDraftAdapter.test.ts` | Draft adapter |
| `platformAnalysis.test.ts` | Platform conflict detection |
| `performanceDataAggregator.test.ts` | Performance data aggregation |
| `transitApp*.test.ts` | Transit App aggregation, scoring, parsing |

### Running Tests

```bash
npx vitest run                              # All tests
npx vitest run tests/timeUtils.test.ts      # Specific test file
npx vitest run tests/scheduleGenerator      # Glob pattern for multiple
```

### Test Fixtures

- `tests/fixtures/` - Sample data files
- `tests/__snapshots__/` - Jest snapshots

### Debugging Workflow

1. **Reproduce**: Create a minimal reproduction script
2. **Isolate**: Use console.log or debug scripts to narrow down
3. **Verify**: After fix, run related verify_*.ts scripts
4. **Test**: Run tests with `npx vitest run` (if configured)

### Console Debug Patterns

The codebase uses structured console output:

```typescript
console.log(`Trip ${tripNumber} at ${startTime} mins:`, {
    band: 'A',
    pureTravelTime: 23,
    usedBandData: true
});
```

Look for `usedBandData: false` to detect band lookup failures.
