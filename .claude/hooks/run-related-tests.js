#!/usr/bin/env node
/**
 * Post-edit hook: runs the relevant vitest test file when a core module is edited.
 * Reads hook input from stdin, checks the edited file path, runs matching tests.
 * Returns additionalContext so Claude sees test results.
 */
const { execSync } = require('child_process');
const path = require('path');

// Map source files to their test files
const FILE_TEST_MAP = {
  'utils/timeUtils.ts': 'tests/timeUtils.test.ts',
  'utils/schedule/scheduleGenerator.ts': 'tests/scheduleGenerator',
  'utils/blocks/blockAssignmentCore.ts': 'tests/blockAssignmentCore.test.ts',
  'utils/parsers/masterScheduleParser.ts': 'tests/parser.test.ts',
  'utils/parsers/masterScheduleParserV2.ts': 'tests/parser.test.ts',
  'utils/parsers/parserAdapter.ts': 'tests/parser.test.ts',
  'utils/connections/connectionUtils.ts': 'tests/connectionUtils.test.ts',
  'utils/goTransitService.ts': 'tests/goTransitService.test.ts',
  'utils/scheduleDraftAdapter.ts': 'tests/scheduleDraftAdapter.test.ts',
  'utils/platformConflictDetection.ts': 'tests/platformAnalysis.test.ts',
  'utils/routeInference.ts': 'tests/routeInference.test.ts',
  'components/NewSchedule/utils/blockStartDirection.ts': 'tests/blockStartDirection.test.ts',
};

async function main() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let hookData;
  try {
    hookData = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const toolInput = hookData.tool_input || {};
  const filePath = toolInput.file_path || '';

  // Normalize to forward slashes and get relative path
  const normalized = filePath.replace(/\\/g, '/');

  // Find matching test
  let testPattern = null;
  for (const [srcFile, testFile] of Object.entries(FILE_TEST_MAP)) {
    if (normalized.endsWith(srcFile)) {
      testPattern = testFile;
      break;
    }
  }

  if (!testPattern) {
    // No matching test for this file - skip silently
    process.exit(0);
  }

  try {
    const result = execSync(`npx vitest run ${testPattern} --reporter=verbose 2>&1`, {
      cwd: hookData.cwd || process.cwd(),
      timeout: 45000,
      encoding: 'utf-8',
    });

    // Tests passed - provide context
    const lines = result.split('\n');
    const summary = lines.slice(-15).join('\n');
    const output = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: `[Auto-test] Tests for ${testPattern} PASSED:\n${summary}`,
      },
    });
    process.stdout.write(output);
  } catch (err) {
    // Tests failed - block and show errors
    const stderr = (err.stdout || '') + (err.stderr || '');
    const lines = stderr.split('\n');
    const relevant = lines.slice(-30).join('\n');
    const output = JSON.stringify({
      decision: 'block',
      reason: `[Auto-test] Tests FAILED for ${testPattern}. Fix these before continuing:\n${relevant}`,
    });
    process.stdout.write(output);
  }
}

main();
