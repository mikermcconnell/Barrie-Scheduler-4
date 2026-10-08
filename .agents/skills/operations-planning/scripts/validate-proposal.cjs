#!/usr/bin/env node
// Runs Scheduler 4's own import validator against a proposal before hand-off.
// Usage (from the repo root; the .codex copy is identical):
//   node .claude/skills/operations-planning/scripts/validate-proposal.cjs <input.json> <proposal.json>
// Exit code: 0 = approval-ready, 1 = blockers found, 2 = usage/parse error.
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../../..');
const esbuild = require(require.resolve('esbuild', { paths: [repoRoot] }));
require.extensions['.ts'] = (module, file) =>
    module._compile(esbuild.transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' }).code, file);
const { assessOperationsPlanningProposal } = require(path.join(repoRoot, 'utils/run-cutting/validation.ts'));

const [inputPath, proposalPath] = process.argv.slice(2);
if (!inputPath || !proposalPath) {
    console.error('Usage: validate-proposal.cjs <operations-planning-input.json> <operations-planning-proposal.json>');
    process.exit(2);
}

let input;
try {
    input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
} catch (error) {
    console.error(`Could not read input bundle: ${error.message}`);
    process.exit(2);
}
// Pass the raw string so the validator applies its own size and parse limits.
const assessment = assessOperationsPlanningProposal(input, fs.readFileSync(proposalPath, 'utf8'));

const byCategory = {};
for (const finding of assessment.findings) {
    (byCategory[finding.category] ??= []).push(finding);
}

console.log(`Parsed: ${assessment.proposal ? 'yes' : 'no'}`);
console.log(`Approval ready: ${assessment.approvalReady ? 'yes' : 'no'}`);
console.log(`Daily runs assessed: ${assessment.dailyRunMetrics.length}`);
console.log(`Weekly rosters assessed: ${assessment.weeklyRosterMetrics.length}`);
for (const category of ['integrity', 'contractual', 'exception', 'best-practice', 'informational']) {
    const findings = byCategory[category] ?? [];
    console.log(`\n${category}: ${findings.length}`);
    const byCode = {};
    for (const finding of findings) byCode[finding.code] = (byCode[finding.code] ?? 0) + 1;
    for (const [code, count] of Object.entries(byCode).sort((a, b) => b[1] - a[1])) console.log(`  ${count} x ${code}`);
    // Sample messages, skipping the bulk trip-unassigned noise so rarer codes stay visible.
    const samples = [...findings.filter(f => f.code !== 'trip-unassigned'), ...findings.filter(f => f.code === 'trip-unassigned')];
    for (const finding of samples.slice(0, 50)) {
        const scope = [finding.dayType, finding.runId, finding.crewId, finding.blockId, finding.tripId].filter(Boolean).join(' ');
        console.log(`  [${finding.code}]${scope ? ` (${scope})` : ''} ${finding.message}`);
    }
    if (findings.length > 50) console.log(`  ...and ${findings.length - 50} more`);
}

process.exit(assessment.approvalReady ? 0 : 1);
