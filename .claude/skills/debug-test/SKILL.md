---
name: debug-test
description: Use when debugging issues or writing tests. Leverages existing debug scripts and test infrastructure.
---

## Debug & Test Infrastructure

### Existing Debug Scripts

Located in project root:

| Script | Purpose |
|--------|---------|
| `debug_parser_fixture.ts` | Test parser with fixture data |
| `debug_route12.ts` / `debug_route12_deep.ts` | Route 12 specific debugging |
| `debug_interlines.ts` | Interline connection debugging |
| `debug_8a_8b_times.ts` | Time band debugging |
| `reproduce_block_link.ts` | Reproduce block linking issues |
| `reproduce_block_numbering.ts` | Reproduce block numbering issues |
| `verify_*.ts` | Various verification scripts |

### Running Debug Scripts

```bash
npx ts-node debug_parser_fixture.ts
npx ts-node verify_bidirectional_link.ts
```

### Test Files

Located in `tests/`:

| File | Coverage |
|------|----------|
| `parser.test.ts` | CSV/Excel parsing |
| `interline_recovery.test.ts` | Interline recovery logic |
| `verifyBlockFix.ts` | Block assignment verification |
| `verifyRoute12Fix.ts` | Route 12 specific fixes |

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
