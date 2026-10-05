#!/usr/bin/env node
/** Offline only. Stages new files in a new local folder; never overwrites inputs or publishes. */
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const usage = 'node scripts/prepareRidershipCorrection.mjs --manifest <local.json> --out <new-local-folder>';

export async function runCorrection(manifestPath, outputPath) {
    const manifestText = await readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestText);
    if (manifest.version !== 1 || !Array.isArray(manifest.storedFiles) || !manifest.storedFiles.length
        || !Array.isArray(manifest.sources) || !Array.isArray(manifest.dates) || !manifest.dates.length
        || new Set(manifest.dates).size !== manifest.dates.length
        || manifest.dates.some(d => !/^\d{4}-\d{2}-\d{2}$/.test(d))) throw new Error('Invalid local correction manifest.');
    const base = path.dirname(path.resolve(manifestPath));
    const resolveInput = value => {
        if (typeof value !== 'string' || !value || /^[a-z]+:\/\//i.test(value)) throw new Error('Only local input files are supported.');
        return path.resolve(base, value);
    };
    const storedFiles = [];
    const allDays = [];
    const inputPaths = [await realpath(manifestPath)];
    for (const name of manifest.storedFiles) {
        const file = await realpath(resolveInput(name));
        inputPaths.push(file);
        const bytes = await readFile(file);
        const text = bytes.toString('utf8');
        const summary = JSON.parse(text);
        if (!summary.metadata || !Array.isArray(summary.dailySummaries)) throw new Error('Stored input must be a full performance summary.');
        allDays.push(...summary.dailySummaries);
        storedFiles.push({ file, bytes, summary });
    }
    if (allDays.some(d => typeof d?.date !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d.date)
        || new Date(d.date + 'T12:00:00Z').toISOString().slice(0, 10) !== d.date)) throw new Error('Invalid stored service date.');
    if (new Set(allDays.map(d => d.date)).size !== allDays.length) throw new Error('Overlapping stored dates; choose one canonical stored payload per date.');
    if (manifest.dates.some(d => !allDays.some(day => day.date === d))) throw new Error('A requested date is absent from the stored inputs.');
    const sources = new Map();
    const sourceProblems = new Map();
    const selectedSourceDates = new Set();
    for (const source of manifest.sources) {
        if (!manifest.dates.includes(source.date)) throw new Error('Source date falls outside the approved local preview.');
        if (selectedSourceDates.has(source.date)) throw new Error(`Multiple exports selected for ${source.date}; resolve provenance first.`);
        selectedSourceDates.add(source.date);
        const localFile = resolveInput(source.csvPath);
        try {
            const file = await realpath(localFile);
            inputPaths.push(file);
            sources.set(source.date, { ...source, csv: await readFile(file, 'utf8') });
        } catch (error) {
            sourceProblems.set(source.date, `Original export could not be read (${error.code ?? 'read error'}); existing history preserved.`);
        }
    }
    const bundled = await build({ stdin: { contents: `
        export * from './scripts/lib/ridershipCorrection';
        export {buildPerformanceOverviewSummary,buildPerformanceReportSummary} from './utils/performanceOverviewSummary';
        export {filterPerformanceSummaryByRoute} from './utils/performanceRouteFilter';
        export {buildLoadProfileMonthlyView} from './functions/src/performanceLoadProfileView';
        export {buildReportHtml} from './functions/src/reportHtml';
    `, resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
    const api = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
    // Versioned content fingerprint: cover all archive fields and every ordered day without
    // allocating a second, sorted copy of a potentially hundreds-of-MB archive.
    const summaryHash = summary => {
        const { dailySummaries, ...archiveFields } = summary;
        return api.hashValue({ hashFormat: 'ordered-day-sha256-v1', archiveFields,
            days: dailySummaries.map(day => ({ date: day.date, hash: api.hashValue(day) })) });
    };
    const results = allDays.filter(d => manifest.dates.includes(d.date)).map(day => api.prepareCorrection(day, sources.get(day.date)));
    for (const result of results) if (sourceProblems.has(result.date)) result.reason = sourceProblems.get(result.date);
    const corrected = api.replacePreparedDays(allDays, results);
    const rolledBack = api.rollbackPreparedDays(corrected, allDays, results);
    const sameDays = (a, b) => a.length === b.length && a.every((day, i) => api.hashValue(day) === api.hashValue(b[i]));
    if (!sameDays(rolledBack, allDays)) throw new Error('Rollback did not restore the complete original input.');
    const repeated = api.replacePreparedDays(corrected, results);
    if (!sameDays(repeated, corrected)) throw new Error('Repeat-run safety check failed.');
    for (const result of results.filter(r => r.status === 'ready')) {
        const rerun = api.prepareCorrection(result.corrected, sources.get(result.date));
        if (rerun.status !== 'already-corrected') throw new Error(`Fresh repeat preview failed: ${result.date}`);
    }
    // Before writing anything, validate the output boundary. mkdir without recursive refuses existing folders.
    const out = path.resolve(outputPath);
    const parent = await realpath(path.dirname(out));
    const actualOut = path.join(parent, path.basename(out));
    for (const input of inputPaths) {
        const relative = path.relative(actualOut, input);
        if (!relative || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) {
            throw new Error('Output folder must not contain or replace an input.');
        }
    }
    await mkdir(actualOut);
    const artifactPath = name => {
        const target = path.resolve(actualOut, name);
        if (path.dirname(target) !== actualOut) throw new Error('Artifact path escapes the local output folder.');
        return target;
    };
    const writeRaw = async (name, value) => writeFile(artifactPath(name), value, { flag: 'wx' });
    const write = async (name, value) => writeRaw(name, JSON.stringify(value));
    const artifactFiles = [];
    for (const [i, stored] of storedFiles.entries()) {
        // Keep byte-for-byte originals and metadata; no retention, import/version or schema relabelling.
        await writeRaw(`original-${i}.json`, stored.bytes);
        const next = { ...stored.summary, dailySummaries: api.replacePreparedDays(stored.summary.dailySummaries,
            results.filter(r => stored.summary.dailySummaries.some(d => d.date === r.date))) };
        await write(`corrected-${i}.json`, next);
        artifactFiles.push({ original: `original-${i}.json`, corrected: `corrected-${i}.json`,
            originalBytesHash: createHash('sha256').update(stored.bytes).digest('hex'),
            hashFormat: 'ordered-day-sha256-v1', beforeHash: summaryHash(stored.summary), afterHash: summaryHash(next) });
        // Staged projections, not replacements for live pointers or any older monthly snapshots.
        const months = new Map();
        for (const day of next.dailySummaries) {
            const month = day.date.slice(0, 7);
            months.set(month, [...(months.get(month) ?? []), day]);
        }
        for (const [month, days] of months) {
            const monthly = { ...next, dailySummaries: days,
                metadata: { ...next.metadata, dayCount: days.length,
                    dateRange: { start: days.map(d => d.date).sort()[0], end: days.map(d => d.date).sort().at(-1) },
                    totalRecords: days.reduce((sum, d) => sum + d.dataQuality.totalRecords, 0) } };
            await write(`monthly-${i}-${month}.json`, monthly);
            await write(`load-profiles-${i}-${month}.json`, api.buildLoadProfileMonthlyView(monthly));
            for (const route of new Set(days.flatMap(d => d.byRoute.map(r => r.routeId)))) {
                await write(`route-${i}-${month}-${encodeURIComponent(route)}.json`, api.filterPerformanceSummaryByRoute(monthly, route));
            }
        }
    }
    const sorted = [...corrected].sort((a, b) => a.date.localeCompare(b.date));
    const combined = { ...storedFiles[0].summary, dailySummaries: sorted,
        metadata: { ...storedFiles[0].summary.metadata, dayCount: sorted.length,
            dateRange: { start: sorted[0].date, end: sorted.at(-1).date },
            totalRecords: sorted.reduce((sum, day) => sum + day.dataQuality.totalRecords, 0) } };
    await write('overview.json', api.buildPerformanceOverviewSummary(combined));
    await write('report.json', api.buildPerformanceReportSummary(combined));
    await writeRaw('email-preview.html', api.buildReportHtml({ latestDay: sorted.at(-1),
        trendDays: sorted.slice(-56), teamName: 'Barrie Transit — LOCAL CORRECTION PREVIEW' }));
    const preview = results.map(({ corrected: _day, ...result }) => result);
    await write('preview.json', preview);
    const impact = rows => ({ dateCount: rows.length, readyDates: rows.filter(r => r.status === 'ready').length,
        skippedDates: rows.filter(r => r.status === 'skipped').length,
        beforeBoardings: rows.reduce((s, r) => s + r.beforeBoardings, 0),
        afterBoardings: rows.reduce((s, r) => s + r.afterBoardings, 0),
        addedBoardings: rows.reduce((s, r) => s + r.afterBoardings - r.beforeBoardings, 0),
        beforeAlightings: rows.reduce((s, r) => s + r.beforeAlightings, 0),
        afterAlightings: rows.reduce((s, r) => s + r.afterAlightings, 0),
        addedAlightings: rows.reduce((s, r) => s + r.afterAlightings - r.beforeAlightings, 0) });
    await write('impact.json', { selectedPeriod: { start: [...manifest.dates].sort()[0], end: [...manifest.dates].sort().at(-1), ...impact(preview) },
        byMonth: Object.fromEntries([...new Set(preview.map(r => r.date.slice(0, 7)))].map(month =>
            [month, impact(preview.filter(r => r.date.startsWith(month)))])),
        exceptions: preview.filter(r => r.status === 'skipped').map(r => ({ date: r.date, reason: r.reason })) });
    const header = 'date,status,beforeBoardings,addedBoardings,afterBoardings,beforeAlightings,addedAlightings,afterAlightings,reason';
    const csvRows = preview.map(r => [r.date, r.status, r.beforeBoardings, r.afterBoardings - r.beforeBoardings,
        r.afterBoardings, r.beforeAlightings, r.afterAlightings - r.beforeAlightings, r.afterAlightings, r.reason ?? '']
        .map(v => '"' + String(v).replaceAll('"', '""') + '"').join(','));
    await writeRaw('preview.csv', [header, ...csvRows].join('\n') + '\n');
    await write('ledger.json', { correctionVersion: api.CORRECTION_VERSION, localOnly: true,
        createdAt: new Date().toISOString(), manifestHash: api.hashValue(manifest),
        manifest, artifactFiles, corrections: preview, verified: { repeatRun: true, rollback: true,
            operationalPreservation: true, inputDayCount: allDays.length, outputDayCount: corrected.length },
        publicationBlockedUntil: ['Separate live approval', 'Corrected importer deployed and verified',
            'Fresh live metadata/import revisions and active-rule check',
            'Monthly snapshot coverage reconciled without losing older days', 'Atomic live projection publication and read-back verified'] });
    // COMPLETE is written last; incomplete artifact folders must never be published.
    await write('COMPLETE.json', { localOnly: true, ready: results.filter(r => r.status === 'ready').length,
        alreadyCorrected: results.filter(r => r.status === 'already-corrected').length,
        skipped: results.filter(r => r.status === 'skipped').length });
    return { output: actualOut, ready: results.filter(r => r.status === 'ready').length,
        skipped: results.filter(r => r.status === 'skipped').length,
        addedBoardings: results.reduce((sum, r) => sum + r.afterBoardings - r.beforeBoardings, 0),
        addedAlightings: results.reduce((sum, r) => sum + r.afterAlightings - r.beforeAlightings, 0) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const args = process.argv.slice(2);
        if (args.length === 1 && args[0] === '--help') console.log(usage);
        else {
            if (args.length !== 4 || args[0] !== '--manifest' || args[2] !== '--out') throw new Error(usage);
            console.log(JSON.stringify(await runCorrection(args[1], args[3]), null, 2));
        }
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
