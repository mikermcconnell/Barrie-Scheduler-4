import ExcelJS from 'exceljs';
import type { ODMatrixDataSummary, ODPairRecord, ODStation } from './odMatrixTypes';

// ─── Shared Helpers ──────────────────────────────────────────────

function downloadBuffer(buffer: ExcelJS.Buffer, fileName: string): void {
    const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
}

function styleHeader(row: ExcelJS.Row): void {
    row.eachCell(cell => {
        cell.font = { bold: true, size: 11 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FF94A3B8' } } };
    });
}

function autoWidth(sheet: ExcelJS.Worksheet): void {
    sheet.columns.forEach(col => {
        let maxLen = 10;
        col.eachCell?.({ includeEmpty: false }, cell => {
            const len = String(cell.value ?? '').length;
            if (len > maxLen) maxLen = len;
        });
        col.width = Math.min(maxLen + 2, 40);
    });
}

function setHeaderFilterAndFreeze(
    sheet: ExcelJS.Worksheet,
    headerRowNumber: number,
    columnCount: number,
    freezeFirstColumn = false,
): void {
    sheet.autoFilter = {
        from: { row: headerRowNumber, column: 1 },
        to: { row: headerRowNumber, column: columnCount },
    };
    sheet.views = [{
        state: 'frozen',
        ySplit: headerRowNumber,
        xSplit: freezeFirstColumn ? 1 : 0,
    }];
}

function stationKey(name: string): string {
    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

// ─── Excel Export ────────────────────────────────────────────────

export async function exportODExcel(data: ODMatrixDataSummary): Promise<void> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Barrie Transit Scheduler';
    wb.created = new Date();

    const sortedStations = [...data.stations].sort((a, b) => b.totalVolume - a.totalVolume);
    const stationNames = sortedStations.map(s => s.name);
    const allPairsSorted = [...data.pairs].sort((a, b) => b.journeys - a.journeys);

    // Build journey lookup
    const journeyMap = new Map<string, number>();
    data.pairs.forEach(p => journeyMap.set(`${p.origin}|${p.destination}`, p.journeys));

    // Sheet 1: Metadata + assumptions for technical handoff
    const metadataSheet = wb.addWorksheet('Metadata');
    metadataSheet.addRow(['OD Export Metadata']);
    metadataSheet.getRow(1).font = { bold: true, size: 14 };
    metadataSheet.addRow([]);
    const metadataHeader = metadataSheet.addRow(['Field', 'Value']);
    styleHeader(metadataHeader);

    const metadataRows: Array<[string, string | number]> = [
        ['schema_version', String(data.schemaVersion)],
        ['export_generated_at_iso', new Date().toISOString()],
        ['source_file_name', data.metadata.fileName || ''],
        ['imported_at_iso', data.metadata.importedAt || ''],
        ['imported_by', data.metadata.importedBy || ''],
        ['date_range', data.metadata.dateRange || ''],
        ['station_count', data.stationCount],
        ['total_journeys', data.totalJourneys],
        ['non_zero_pairs', data.pairs.length],
        ['top_pairs_count', Math.min(100, allPairsSorted.length)],
        ['all_pairs_included', 'true'],
        ['assumption_matrix_cells', 'Rows=Origins, Columns=Destinations, values=journey counts'],
        ['assumption_station_total_volume', 'Origin Trips + Destination Trips'],
        ['assumption_station_share', 'Total Volume / (2 * Total Journeys)'],
    ];
    metadataRows.forEach(([field, value]) => metadataSheet.addRow([field, value]));
    autoWidth(metadataSheet);
    setHeaderFilterAndFreeze(metadataSheet, 3, 2);

    // Sheet 2: OD Matrix cross-tab
    const matrixSheet = wb.addWorksheet('OD Matrix');
    matrixSheet.addRow(['Origin-Destination Matrix']);
    matrixSheet.getRow(1).font = { bold: true, size: 14 };
    matrixSheet.addRow([`${data.stationCount} stations · ${data.totalJourneys.toLocaleString()} total journeys`]);
    matrixSheet.addRow([]);

    const headerRow = matrixSheet.addRow(['', ...stationNames]);
    styleHeader(headerRow);

    for (const origin of stationNames) {
        const row: (string | number)[] = [origin];
        for (const dest of stationNames) {
            row.push(journeyMap.get(`${origin}|${dest}`) || 0);
        }
        matrixSheet.addRow(row);
    }
    // Fixed column widths for cross-tab readability
    matrixSheet.columns.forEach((col, i) => {
        col.width = i === 0 ? 22 : 12;
    });
    setHeaderFilterAndFreeze(matrixSheet, 4, stationNames.length + 1, true);

    // Sheet 3: Top Pairs
    const pairsSheet = wb.addWorksheet('Top Pairs');
    pairsSheet.addRow(['Top OD Pairs']);
    pairsSheet.getRow(1).font = { bold: true, size: 14 };
    pairsSheet.addRow([]);

    const pairsHeader = pairsSheet.addRow(['Rank', 'Origin', 'Destination', 'Origin Key', 'Destination Key', 'Journeys', '% Total']);
    styleHeader(pairsHeader);

    const topPairs = allPairsSorted.slice(0, 100);
    topPairs.forEach((pair, i) => {
        const pct = data.totalJourneys > 0 ? (pair.journeys / data.totalJourneys) : 0;
        const row = pairsSheet.addRow([
            i + 1,
            pair.origin,
            pair.destination,
            stationKey(pair.origin),
            stationKey(pair.destination),
            pair.journeys,
            pct,
        ]);
        row.getCell(7).numFmt = '0.00%';
    });
    autoWidth(pairsSheet);
    setHeaderFilterAndFreeze(pairsSheet, 3, 7);

    // Sheet 4: All Pairs for full technical analysis coverage
    const allPairsSheet = wb.addWorksheet('All Pairs');
    allPairsSheet.addRow(['All OD Pairs (Non-Zero)']);
    allPairsSheet.getRow(1).font = { bold: true, size: 14 };
    allPairsSheet.addRow([]);

    const allPairsHeader = allPairsSheet.addRow(['Rank', 'Origin', 'Destination', 'Origin Key', 'Destination Key', 'Journeys', '% Total']);
    styleHeader(allPairsHeader);
    allPairsSorted.forEach((pair, i) => {
        const pct = data.totalJourneys > 0 ? (pair.journeys / data.totalJourneys) : 0;
        const row = allPairsSheet.addRow([
            i + 1,
            pair.origin,
            pair.destination,
            stationKey(pair.origin),
            stationKey(pair.destination),
            pair.journeys,
            pct,
        ]);
        row.getCell(7).numFmt = '0.00%';
    });
    autoWidth(allPairsSheet);
    setHeaderFilterAndFreeze(allPairsSheet, 3, 7);

    // Sheet 5: Station Summary
    const stationSheet = wb.addWorksheet('Station Summary');
    stationSheet.addRow(['Station Volume Summary']);
    stationSheet.getRow(1).font = { bold: true, size: 14 };
    stationSheet.addRow([]);

    const stationHeader = stationSheet.addRow([
        'Rank',
        'Station',
        'Station Key',
        'Latitude',
        'Longitude',
        'Geocode Source',
        'Geocode Confidence',
        'Origin Trips',
        'Destination Trips',
        'Total Volume',
        '% Total',
    ]);
    styleHeader(stationHeader);

    sortedStations.forEach((station, i) => {
        const pct = data.totalJourneys > 0
            ? (station.totalVolume / (data.totalJourneys * 2))
            : 0;
        const row = stationSheet.addRow([
            i + 1,
            station.name,
            stationKey(station.name),
            station.geocode?.lat ?? null,
            station.geocode?.lon ?? null,
            station.geocode?.source ?? '',
            station.geocode?.confidence ?? '',
            station.totalOrigin,
            station.totalDestination,
            station.totalVolume,
            pct,
        ]);
        row.getCell(11).numFmt = '0.00%';
    });
    autoWidth(stationSheet);
    setHeaderFilterAndFreeze(stationSheet, 3, 11);

    const dateSlug = data.metadata.dateRange?.replace(/\s+/g, '_') || 'export';
    const buffer = await wb.xlsx.writeBuffer();
    downloadBuffer(buffer, `od_analysis_${dateSlug}.xlsx`);
}

// ─── Stop Focus Excel Export ─────────────────────────────────────

export async function exportStopReportExcel(data: ODMatrixDataSummary, stopName: string): Promise<void> {
    const station = data.stations.find(s => s.name === stopName);
    if (!station) return;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Barrie Transit Scheduler';
    wb.created = new Date();

    const outboundPairs = [...data.pairs]
        .filter(p => p.origin === stopName)
        .sort((a, b) => b.journeys - a.journeys);
    const inboundPairs = [...data.pairs]
        .filter(p => p.destination === stopName)
        .sort((a, b) => b.journeys - a.journeys);

    const totalOutbound = outboundPairs.reduce((s, p) => s + p.journeys, 0);
    const totalInbound = inboundPairs.reduce((s, p) => s + p.journeys, 0);
    const totalStopVolume = totalOutbound + totalInbound;

    const sortedStations = [...data.stations].sort((a, b) => b.totalVolume - a.totalVolume);
    const networkRank = sortedStations.findIndex(s => s.name === stopName) + 1;
    const percentile = Math.round((1 - (networkRank - 1) / data.stationCount) * 100);

    const connectedNames = new Set([
        ...outboundPairs.map(p => p.destination),
        ...inboundPairs.map(p => p.origin),
    ]);

    // Demand concentration: % covered by top 3/5/10 outbound pairs
    const top3 = outboundPairs.slice(0, 3).reduce((s, p) => s + p.journeys, 0);
    const top5 = outboundPairs.slice(0, 5).reduce((s, p) => s + p.journeys, 0);
    const top10 = outboundPairs.slice(0, 10).reduce((s, p) => s + p.journeys, 0);
    const concBase = totalOutbound > 0 ? totalOutbound : 1;
    const concTop3 = top3 / concBase;
    const concTop5 = top5 / concBase;
    const concTop10 = top10 / concBase;

    // Directional balance label
    const originPct = totalStopVolume > 0 ? totalOutbound / totalStopVolume : 0;
    let balanceLabel = 'Balanced';
    if (originPct >= 0.65) balanceLabel = 'Residential Generator (mostly outbound)';
    else if (originPct <= 0.35) balanceLabel = 'Attractor / Destination (mostly inbound)';

    const dateSlug = data.metadata.dateRange?.replace(/\s+/g, '_') || 'export';
    const nameSlug = stopName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

    // ── Sheet 1: Stop Profile ──────────────────────────────────────
    const profileSheet = wb.addWorksheet('Stop Profile');
    profileSheet.addRow([`Stop Report: ${stopName}`]);
    profileSheet.getRow(1).font = { bold: true, size: 14 };
    profileSheet.addRow([`Generated: ${new Date().toLocaleDateString()} · Source: ${data.metadata.fileName || 'unknown'}`]);
    profileSheet.addRow([]);

    const profileHeader = profileSheet.addRow(['Metric', 'Value', 'Notes']);
    styleHeader(profileHeader);

    const profileRows: Array<[string, string | number, string]> = [
        ['Station Name', stopName, ''],
        ['Network Rank', networkRank, `of ${data.stationCount} stations`],
        ['Percentile', `Top ${percentile}%`, 'by total volume'],
        ['Origin Trips (Departures)', station.totalOrigin, 'passengers starting journey here'],
        ['Destination Trips (Arrivals)', station.totalDestination, 'passengers ending journey here'],
        ['Total Volume', station.totalVolume, 'origin + destination'],
        ['% of Network Journeys', `${((station.totalVolume / (data.totalJourneys * 2)) * 100).toFixed(1)}%`, 'share of all network travel'],
        ['Directional Balance', `${Math.round(originPct * 100)}% Origin / ${Math.round((1 - originPct) * 100)}% Destination`, balanceLabel],
        ['Connected Stations', connectedNames.size, 'unique stops with direct O-D pairs'],
        ['', '', ''],
        ['— Demand Concentration (Outbound) —', '', ''],
        ['Top 3 pairs cover', `${(concTop3 * 100).toFixed(0)}%`, 'of this stop\'s outbound trips'],
        ['Top 5 pairs cover', `${(concTop5 * 100).toFixed(0)}%`, 'of this stop\'s outbound trips'],
        ['Top 10 pairs cover', `${(concTop10 * 100).toFixed(0)}%`, 'of this stop\'s outbound trips'],
    ];

    profileRows.forEach(([metric, value, notes]) => profileSheet.addRow([metric, value, notes]));
    autoWidth(profileSheet);

    // ── Sheet 2: Outbound Flows ────────────────────────────────────
    const outSheet = wb.addWorksheet('Outbound Flows');
    outSheet.addRow([`Outbound Flows from: ${stopName}`]);
    outSheet.getRow(1).font = { bold: true, size: 14 };
    outSheet.addRow([`${totalOutbound.toLocaleString()} total outbound trips to ${outboundPairs.length} destinations`]);
    outSheet.addRow([]);

    const outHeader = outSheet.addRow(['Rank', 'Destination', 'Journeys', '% of Outbound', 'Cumulative %', '% of Network']);
    styleHeader(outHeader);

    let cumOut = 0;
    outboundPairs.forEach((pair, i) => {
        cumOut += pair.journeys;
        const row = outSheet.addRow([
            i + 1,
            pair.destination,
            pair.journeys,
            totalOutbound > 0 ? pair.journeys / totalOutbound : 0,
            totalOutbound > 0 ? cumOut / totalOutbound : 0,
            data.totalJourneys > 0 ? pair.journeys / data.totalJourneys : 0,
        ]);
        row.getCell(4).numFmt = '0.0%';
        row.getCell(5).numFmt = '0.0%';
        row.getCell(6).numFmt = '0.0%';
    });
    autoWidth(outSheet);
    setHeaderFilterAndFreeze(outSheet, 4, 6);

    // ── Sheet 3: Inbound Flows ─────────────────────────────────────
    const inSheet = wb.addWorksheet('Inbound Flows');
    inSheet.addRow([`Inbound Flows to: ${stopName}`]);
    inSheet.getRow(1).font = { bold: true, size: 14 };
    inSheet.addRow([`${totalInbound.toLocaleString()} total inbound trips from ${inboundPairs.length} origins`]);
    inSheet.addRow([]);

    const inHeader = inSheet.addRow(['Rank', 'Origin', 'Journeys', '% of Inbound', 'Cumulative %', '% of Network']);
    styleHeader(inHeader);

    let cumIn = 0;
    inboundPairs.forEach((pair, i) => {
        cumIn += pair.journeys;
        const row = inSheet.addRow([
            i + 1,
            pair.origin,
            pair.journeys,
            totalInbound > 0 ? pair.journeys / totalInbound : 0,
            totalInbound > 0 ? cumIn / totalInbound : 0,
            data.totalJourneys > 0 ? pair.journeys / data.totalJourneys : 0,
        ]);
        row.getCell(4).numFmt = '0.0%';
        row.getCell(5).numFmt = '0.0%';
        row.getCell(6).numFmt = '0.0%';
    });
    autoWidth(inSheet);
    setHeaderFilterAndFreeze(inSheet, 4, 6);

    // ── Sheet 4: All Connections ───────────────────────────────────
    // Merge outbound + inbound, dedupe by partner, sum volumes
    const connectionMap = new Map<string, { outbound: number; inbound: number }>();
    outboundPairs.forEach(p => {
        const entry = connectionMap.get(p.destination) ?? { outbound: 0, inbound: 0 };
        entry.outbound += p.journeys;
        connectionMap.set(p.destination, entry);
    });
    inboundPairs.forEach(p => {
        const entry = connectionMap.get(p.origin) ?? { outbound: 0, inbound: 0 };
        entry.inbound += p.journeys;
        connectionMap.set(p.origin, entry);
    });
    const allConnections = [...connectionMap.entries()]
        .map(([partner, { outbound, inbound }]) => ({ partner, outbound, inbound, total: outbound + inbound }))
        .sort((a, b) => b.total - a.total);

    const allSheet = wb.addWorksheet('All Connections');
    allSheet.addRow([`All Connections: ${stopName}`]);
    allSheet.getRow(1).font = { bold: true, size: 14 };
    allSheet.addRow([`${allConnections.length} connected stations · ${totalStopVolume.toLocaleString()} total trips`]);
    allSheet.addRow([]);

    const allHeader = allSheet.addRow(['Rank', 'Partner Station', 'Outbound', 'Inbound', 'Total', '% of Stop Volume', '% of Network']);
    styleHeader(allHeader);

    allConnections.forEach((conn, i) => {
        const row = allSheet.addRow([
            i + 1,
            conn.partner,
            conn.outbound,
            conn.inbound,
            conn.total,
            totalStopVolume > 0 ? conn.total / totalStopVolume : 0,
            data.totalJourneys > 0 ? conn.total / (data.totalJourneys * 2) : 0,
        ]);
        row.getCell(6).numFmt = '0.0%';
        row.getCell(7).numFmt = '0.0%';
    });
    autoWidth(allSheet);
    setHeaderFilterAndFreeze(allSheet, 4, 7);

    // ── Sheet 5: Two-Way Corridors ─────────────────────────────────
    const twoWay = allConnections
        .filter(c => c.outbound > 0 && c.inbound > 0)
        .map(c => ({
            ...c,
            bias: c.total > 0 ? Math.abs(c.outbound - c.inbound) / c.total : 0,
            dominantDir: c.outbound >= c.inbound ? 'Outbound-heavy' : 'Inbound-heavy',
        }))
        .sort((a, b) => b.total - a.total);

    const twoWaySheet = wb.addWorksheet('Two-Way Corridors');
    twoWaySheet.addRow([`Two-Way Corridors: ${stopName}`]);
    twoWaySheet.getRow(1).font = { bold: true, size: 14 };
    twoWaySheet.addRow([`${twoWay.length} corridors with travel in both directions`]);
    twoWaySheet.addRow([]);

    const twoWayHeader = twoWaySheet.addRow(['Rank', 'Partner Station', 'Outbound', 'Inbound', 'Total', 'Directional Bias %', 'Dominant Direction']);
    styleHeader(twoWayHeader);

    twoWay.forEach((c, i) => {
        const row = twoWaySheet.addRow([
            i + 1,
            c.partner,
            c.outbound,
            c.inbound,
            c.total,
            c.bias,
            c.dominantDir,
        ]);
        row.getCell(6).numFmt = '0%';
    });
    autoWidth(twoWaySheet);
    setHeaderFilterAndFreeze(twoWaySheet, 4, 7);

    // ── Sheet 6: Underserved Connections ──────────────────────────
    // Top network stations with no or low direct pairs with this stop
    const LOW_VOLUME_THRESHOLD = 5;
    const underserved = sortedStations
        .filter(s => s.name !== stopName)
        .map(s => {
            const conn = connectionMap.get(s.name);
            return {
                name: s.name,
                networkRank: sortedStations.findIndex(x => x.name === s.name) + 1,
                networkVolume: s.totalVolume,
                directJourneys: conn ? conn.outbound + conn.inbound : 0,
            };
        })
        .filter(s => s.directJourneys <= LOW_VOLUME_THRESHOLD)
        .slice(0, 20);

    const underSheet = wb.addWorksheet('Underserved Connections');
    underSheet.addRow([`Underserved Connections: ${stopName}`]);
    underSheet.getRow(1).font = { bold: true, size: 14 };
    underSheet.addRow([`Top network stations with ≤${LOW_VOLUME_THRESHOLD} direct journeys to/from this stop`]);
    underSheet.addRow([]);

    const underHeader = underSheet.addRow(['Network Rank', 'Station', 'Their Network Volume', 'Direct Journeys', 'Note']);
    styleHeader(underHeader);

    underserved.forEach(s => {
        underSheet.addRow([
            s.networkRank,
            s.name,
            s.networkVolume,
            s.directJourneys,
            s.directJourneys === 0 ? 'No direct O-D pair' : 'Very low — potential latent demand',
        ]);
    });
    autoWidth(underSheet);
    setHeaderFilterAndFreeze(underSheet, 4, 5);

    const buffer = await wb.xlsx.writeBuffer();
    downloadBuffer(buffer, `stop_focus_${nameSlug}_${dateSlug}.xlsx`);
}

// ─── PDF Analysis Helpers ───────────────────────────────────────

interface ConsolidatedCorridor {
    origin: string;
    destination: string;
    journeys: number;
}

interface BidirectionalPair {
    stationA: string;
    stationB: string;
    aToB: number;
    bToA: number;
    total: number;
}

const TORONTO_TERMINAL_NAMES = [
    'toronto - yorkdale',
    'toronto - union station bus terminal',
    'toronto - vaughan - hwy 407 terminal',
];

function consolidateTorontoName(name: string): string {
    if (TORONTO_TERMINAL_NAMES.includes(name.toLowerCase().trim())) {
        return 'Toronto Area';
    }
    return name;
}

function computeCorridorRollups(pairs: ODPairRecord[]): ConsolidatedCorridor[] {
    const corridorMap = new Map<string, number>();
    for (const p of pairs) {
        const origin = consolidateTorontoName(p.origin);
        const dest = consolidateTorontoName(p.destination);
        if (origin === dest) continue;
        const key = `${origin}|${dest}`;
        corridorMap.set(key, (corridorMap.get(key) || 0) + p.journeys);
    }
    return [...corridorMap.entries()]
        .map(([key, journeys]) => {
            const [origin, destination] = key.split('|');
            return { origin, destination, journeys };
        })
        .sort((a, b) => b.journeys - a.journeys);
}

function computeBidirectionalPairs(pairs: ODPairRecord[]): BidirectionalPair[] {
    const map = new Map<string, BidirectionalPair>();
    for (const p of pairs) {
        const [a, b] = [p.origin, p.destination].sort();
        const key = `${a}|${b}`;
        if (!map.has(key)) {
            map.set(key, { stationA: a, stationB: b, aToB: 0, bToA: 0, total: 0 });
        }
        const entry = map.get(key)!;
        if (p.origin === a) {
            entry.aToB += p.journeys;
        } else {
            entry.bToA += p.journeys;
        }
    }
    return [...map.values()]
        .map(e => ({ ...e, total: e.aToB + e.bToA }))
        .sort((a, b) => b.total - a.total);
}

function computeConcentration(pairs: ODPairRecord[], totalJourneys: number): { top10Pct: number; top20Pct: number } {
    const sorted = [...pairs].sort((a, b) => b.journeys - a.journeys);
    const top10 = sorted.slice(0, 10).reduce((sum, p) => sum + p.journeys, 0);
    const top20 = sorted.slice(0, 20).reduce((sum, p) => sum + p.journeys, 0);
    return {
        top10Pct: totalJourneys > 0 ? (top10 / totalJourneys) * 100 : 0,
        top20Pct: totalJourneys > 0 ? (top20 / totalJourneys) * 100 : 0,
    };
}

function computeHubStats(
    stations: ODStation[],
    totalJourneys: number,
): { name: string; pct: number; originPct: number; destPct: number } | null {
    if (stations.length === 0) return null;
    const sorted = [...stations].sort((a, b) => b.totalVolume - a.totalVolume);
    const top = sorted[0];
    const totalActivity = totalJourneys * 2;
    return {
        name: top.name,
        pct: totalActivity > 0 ? (top.totalVolume / totalActivity) * 100 : 0,
        originPct: totalJourneys > 0 ? (top.totalOrigin / totalJourneys) * 100 : 0,
        destPct: totalJourneys > 0 ? (top.totalDestination / totalJourneys) * 100 : 0,
    };
}

// ─── Key Findings Engine ────────────────────────────────────────

function computeKeyFindings(
    data: ODMatrixDataSummary,
    corridors: ConsolidatedCorridor[],
    biPairs: BidirectionalPair[],
    concentration: { top10Pct: number; top20Pct: number },
    hubStats: { name: string; pct: number; originPct: number; destPct: number } | null,
): string[] {
    const findings: string[] = [];

    // 1. Primary hub dominance
    if (hubStats) {
        const top20 = [...data.pairs].sort((a, b) => b.journeys - a.journeys).slice(0, 20);
        const hubWord = hubStats.name.split(/[\s\-–]/)[0].toLowerCase();
        const appearances = top20.filter(
            p => p.origin.toLowerCase().startsWith(hubWord) || p.destination.toLowerCase().startsWith(hubWord),
        ).length;
        if (appearances > 0) {
            findings.push(
                `${hubStats.name} appears in ${appearances} of the top 20 OD pairs, `
                + `handling ${hubStats.pct.toFixed(1)}% of all station activity `
                + `(${hubStats.originPct.toFixed(1)}% as origin, ${hubStats.destPct.toFixed(1)}% as destination).`,
            );
        }
    }

    // 2. Demand concentration
    const level = concentration.top10Pct > 25 ? 'highly concentrated'
        : concentration.top10Pct > 15 ? 'moderately concentrated'
        : 'well distributed';
    findings.push(
        `Demand is ${level}: the top 10 pairs carry ${concentration.top10Pct.toFixed(1)}% `
        + `of all journeys, while the top 20 carry ${concentration.top20Pct.toFixed(1)}%.`,
    );

    // 3. Busiest corridor (consolidated)
    if (corridors.length > 0) {
        const top = corridors[0];
        const pct = ((top.journeys / data.totalJourneys) * 100).toFixed(1);
        findings.push(
            `The ${top.origin} to ${top.destination} corridor is the busiest with `
            + `${top.journeys.toLocaleString()} journeys (${pct}% of total).`,
        );
    }

    // 4. Largest directional imbalance in top 10
    if (biPairs.length > 0) {
        let maxImb = { pair: biPairs[0], pct: 0 };
        for (const pair of biPairs.slice(0, 10)) {
            const hi = Math.max(pair.aToB, pair.bToA);
            const lo = Math.min(pair.aToB, pair.bToA);
            const imbPct = hi > 0 ? ((hi - lo) / hi) * 100 : 0;
            if (imbPct > maxImb.pct) maxImb = { pair, pct: imbPct };
        }
        if (maxImb.pct > 10) {
            const p = maxImb.pair;
            const towardStation = p.aToB > p.bToA ? p.stationB : p.stationA;
            findings.push(
                `Most uneven route in the top 10: ${p.stationA} to ${p.stationB} `
                + `has ${maxImb.pct.toFixed(0)}% more riders traveling toward ${towardStation}.`,
            );
        }
    }

    // 5. Network breadth
    const active = data.stations.filter(s => s.totalVolume >= 1000).length;
    const activePct = data.stationCount > 0 ? ((active / data.stationCount) * 100).toFixed(0) : '0';
    findings.push(
        `${active} of ${data.stationCount} stations (${activePct}%) have more than 1,000 journeys. `
        + `The remaining ${data.stationCount - active} stations have very low ridership.`,
    );

    return findings;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawHorizontalBarChart(
    doc: any,
    items: { label: string; value: number }[],
    x: number,
    y: number,
    width: number,
    barColor: [number, number, number],
): number {
    const barH = 7;
    const gap = 2.5;
    const labelCol = 95;
    const maxVal = Math.max(...items.map(i => i.value));
    const barArea = width - labelCol - 20;

    for (const item of items) {
        // Label
        doc.setFontSize(8);
        doc.setTextColor(31, 41, 55);
        const lbl = item.label.length > 38 ? item.label.slice(0, 37) + '\u2026' : item.label;
        doc.text(lbl, x, y + barH * 0.65);

        // Bar
        const bw = maxVal > 0 ? (item.value / maxVal) * barArea : 0;
        doc.setFillColor(...barColor);
        doc.rect(x + labelCol, y, bw, barH, 'F');

        // Value label
        doc.setFontSize(7);
        doc.setTextColor(107, 114, 128);
        doc.text(item.value.toLocaleString(), x + labelCol + bw + 3, y + barH * 0.65);

        y += barH + gap;
    }

    return y;
}

// ─── PDF Export ──────────────────────────────────────────────────

export async function exportODPdf(
    data: ODMatrixDataSummary,
    mapEl: HTMLDivElement | null,
    _rankingsEl: HTMLDivElement | null,
    heatmapEl: HTMLDivElement | null,
): Promise<void> {
    const [{ default: jsPDF }, { default: autoTable }, { default: html2canvas }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
        import('html2canvas'),
    ]);

    const doc = new jsPDF({ orientation: 'landscape' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 20;

    // Ontario Northland brand palette
    const ON_NAVY: [number, number, number] = [0, 40, 94];       // #00285e
    const ON_GOLD: [number, number, number] = [254, 188, 17];    // #febc11
    const DARK_TEXT: [number, number, number] = [31, 33, 35];     // #1f2123
    const MID_GRAY: [number, number, number] = [107, 114, 128];
    const ALT_ROW: [number, number, number] = [226, 237, 252];   // #e2edfc (ON light blue)
    const VIOLET: [number, number, number] = [79, 70, 229];      // #4f46e5 indigo-600

    // Pre-compute analysis data
    const sortedStations = [...data.stations].sort((a, b) => b.totalVolume - a.totalVolume);
    const topOriginHub = sortedStations[0] ?? null;
    const topDestHub = [...data.stations].sort((a, b) => b.totalDestination - a.totalDestination)[0] ?? null;
    const corridors = computeCorridorRollups(data.pairs);
    const biPairs = computeBidirectionalPairs(data.pairs);
    const concentration = computeConcentration(data.pairs, data.totalJourneys);
    const hubStats = computeHubStats(data.stations, data.totalJourneys);
    const activeStationCount = data.stations.filter(s => s.totalVolume >= 1000).length;

    const tocEntries: { title: string; page: number }[] = [];

    // Helper: draw section header with ON navy accent + gold underline
    function drawSectionHeader(title: string, y: number, lineLen = 80): void {
        doc.setFontSize(18);
        doc.setTextColor(...ON_NAVY);
        doc.text(title, margin, y);
        doc.setDrawColor(...ON_GOLD);
        doc.setLineWidth(1.2);
        doc.line(margin, y + 4, margin + lineLen, y + 4);
    }

    // ─── Page 1: Professional Cover ─────────────────────────────

    doc.setFontSize(28);
    doc.setTextColor(...ON_NAVY);
    doc.text('Origin-Destination', pageW / 2, 50, { align: 'center' });
    doc.text('Analysis Report', pageW / 2, 63, { align: 'center' });

    doc.setFontSize(13);
    doc.setTextColor(...ON_NAVY);
    doc.text('Ontario Northland', pageW / 2, 77, { align: 'center' });

    // Gold accent line
    const accentW = 180;
    doc.setDrawColor(...ON_GOLD);
    doc.setLineWidth(2);
    doc.line((pageW - accentW) / 2, 85, (pageW + accentW) / 2, 85);

    // 4 KPI boxes
    const boxGap = 12;
    const usableW = pageW - 2 * margin;
    const boxW = (usableW - 3 * boxGap) / 4;
    const boxH = 36;
    const boxY = 100;

    const kpis = [
        { label: 'Total Journeys', value: data.totalJourneys.toLocaleString() },
        { label: 'Stations', value: String(data.stationCount) },
        { label: 'Top Origin Hub', value: topOriginHub?.name ?? '-' },
        { label: 'Top Destination Hub', value: topDestHub?.name ?? '-' },
    ];

    kpis.forEach((kpi, i) => {
        const x = margin + i * (boxW + boxGap);

        doc.setDrawColor(...ON_NAVY);
        doc.setLineWidth(0.5);
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(x, boxY, boxW, boxH, 2, 2, 'FD');

        // Value - truncate long names
        doc.setFontSize(16);
        doc.setTextColor(...DARK_TEXT);
        const maxChars = Math.floor(boxW / 3.5);
        const display = kpi.value.length > maxChars ? kpi.value.slice(0, maxChars - 1) + '...' : kpi.value;
        doc.text(display, x + boxW / 2, boxY + 16, { align: 'center' });

        // Label
        doc.setFontSize(8);
        doc.setTextColor(...MID_GRAY);
        doc.text(kpi.label, x + boxW / 2, boxY + 26, { align: 'center' });
    });

    // Cover footer
    doc.setFontSize(9);
    doc.setTextColor(...MID_GRAY);
    const coverFooter = [
        data.metadata.dateRange ? `Date Range: ${data.metadata.dateRange}` : null,
        `Exported: ${new Date().toLocaleDateString()}`,
    ].filter(Boolean).join('  |  ');
    doc.text(coverFooter, pageW / 2, pageH - 20, { align: 'center' });

    // ─── Page 2: Table of Contents (filled in later) ────────────

    doc.addPage();
    const tocPageNum = doc.getNumberOfPages();

    // ─── Page 3: Key Findings ────────────────────────────────────

    doc.addPage();
    tocEntries.push({ title: 'Key Findings', page: doc.getNumberOfPages() });
    drawSectionHeader('Key Findings', 25, 65);

    const findings = computeKeyFindings(data, corridors, biPairs, concentration, hubStats);
    let fy = 38;
    doc.setFontSize(9);
    for (const finding of findings) {
        // Bullet dot
        doc.setFillColor(...ON_NAVY);
        doc.circle(margin + 2, fy - 1, 1.2, 'F');

        // Wrapped text
        doc.setTextColor(...MID_GRAY);
        const lines: string[] = doc.splitTextToSize(finding, pageW - 2 * margin - 12);
        doc.text(lines, margin + 8, fy);
        fy += lines.length * 4.5 + 3;
    }

    // Top 10 Bidirectional Corridors bar chart
    fy += 8;
    doc.setFontSize(12);
    doc.setTextColor(...DARK_TEXT);
    doc.text('Top 10 Bidirectional Corridors', margin, fy);
    fy += 3;
    doc.setDrawColor(...ON_NAVY);
    doc.setLineWidth(0.5);
    doc.line(margin, fy, margin + 105, fy);
    fy += 7;

    const chartItems = biPairs.slice(0, 10).map(b => ({
        label: `${b.stationA} - ${b.stationB}`,
        value: b.total,
    }));
    drawHorizontalBarChart(doc, chartItems, margin, fy, pageW - 2 * margin, VIOLET);

    // ─── Flow Map ───────────────────────────────────────────────

    if (mapEl) {
        try {
            const canvas = await html2canvas(mapEl, { useCORS: true, scale: 1.5 });
            const imgData = canvas.toDataURL('image/png');
            doc.addPage();
            tocEntries.push({ title: 'Flow Map', page: doc.getNumberOfPages() });
            drawSectionHeader('Flow Map', 25, 50);

            // Filter context line
            const filterParts: string[] = [];
            if (data.metadata.dateRange) filterParts.push(`Date range: ${data.metadata.dateRange}`);
            filterParts.push(`${data.totalJourneys.toLocaleString()} total journeys across ${data.stationCount} stations`);
            doc.setFontSize(8);
            doc.setTextColor(...MID_GRAY);
            doc.text(filterParts.join('  |  '), margin, 33);

            const imgW = pageW - 2 * margin;
            const imgH = (canvas.height / canvas.width) * imgW;
            const maxImgH = pageH - 70;
            doc.addImage(imgData, 'PNG', margin, 38, imgW, Math.min(imgH, maxImgH));

            doc.setFontSize(8);
            doc.setTextColor(...MID_GRAY);
            const captionY = Math.min(38 + imgH + 4, pageH - 18);
            doc.text('Line thickness represents trip volume. Green = mostly origin, Red = mostly destination.', margin, captionY);
        } catch {
            // Skip map on capture failure
        }
    }

    // ─── Page 5+: Top OD Pairs ──────────────────────────────────

    doc.addPage();
    tocEntries.push({ title: 'Top OD Pairs', page: doc.getNumberOfPages() });

    // Bidirectional Top 20
    drawSectionHeader('Bidirectional Top 20', 25, 90);

    doc.setFontSize(8);
    doc.setTextColor(...MID_GRAY);
    doc.text('Imbalance column shows dominant travel direction and percentage difference.', margin, 32);

    const biTop20 = biPairs.slice(0, 20);
    autoTable(doc, {
        startY: 36,
        margin: { left: margin, right: margin, bottom: 20 },
        head: [['Rank', 'Station A', 'Station B', 'A to B', 'B to A', 'Combined', '% Total', 'Direction Bias']],
        body: biTop20.map((b, i) => {
            const hi = Math.max(b.aToB, b.bToA);
            const lo = Math.min(b.aToB, b.bToA);
            const imbPct = hi > 0 ? ((hi - lo) / hi) * 100 : 0;
            const toward = b.aToB >= b.bToA ? `Toward ${b.stationB}` : `Toward ${b.stationA}`;
            const imbLabel = imbPct < 2 ? 'Even' : `${toward} (+${imbPct.toFixed(0)}%)`;
            return [
                i + 1,
                b.stationA,
                b.stationB,
                b.aToB.toLocaleString(),
                b.bToA.toLocaleString(),
                b.total.toLocaleString(),
                `${((b.total / data.totalJourneys) * 100).toFixed(1)}%`,
                imbLabel,
            ];
        }),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [...ON_NAVY] },
        alternateRowStyles: { fillColor: [...ALT_ROW] },
        columnStyles: { 7: { halign: 'center', fontStyle: 'bold' } },
    });

    // Top 50 Directional Pairs (new page)
    doc.addPage();
    drawSectionHeader('Top 50 OD Pairs (Directional)', 25, 110);

    const pdfTopPairs = data.topPairs.length > 0
        ? data.topPairs.slice(0, 50)
        : [...data.pairs].sort((a, b) => b.journeys - a.journeys).slice(0, 50);

    autoTable(doc, {
        startY: 35,
        margin: { left: margin, right: margin, bottom: 20 },
        head: [['Rank', 'Origin', 'Destination', 'Journeys', '% Total']],
        body: pdfTopPairs.map((pair, i) => [
            i + 1,
            pair.origin,
            pair.destination,
            pair.journeys.toLocaleString(),
            data.totalJourneys > 0 ? `${((pair.journeys / data.totalJourneys) * 100).toFixed(2)}%` : '0.00%',
        ]),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [...ON_NAVY] },
        alternateRowStyles: { fillColor: [...ALT_ROW] },
    });

    // ─── Station Rankings (autoTable) ───────────────────────────

    doc.addPage();
    tocEntries.push({ title: 'Station Rankings', page: doc.getNumberOfPages() });
    drawSectionHeader('Station Rankings', 25, 75);

    const top30 = sortedStations.slice(0, 30);
    const totalActivity = data.totalJourneys * 2;

    autoTable(doc, {
        startY: 35,
        margin: { left: margin, right: margin, bottom: 20 },
        head: [['Rank', 'Station', 'Origin Trips', 'Dest. Trips', 'Total Volume', '% Share']],
        body: top30.map((s, i) => [
            i + 1,
            s.name,
            s.totalOrigin.toLocaleString(),
            s.totalDestination.toLocaleString(),
            s.totalVolume.toLocaleString(),
            totalActivity > 0 ? `${((s.totalVolume / totalActivity) * 100).toFixed(1)}%` : '0.0%',
        ]),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [...ON_NAVY] },
        alternateRowStyles: { fillColor: [...ALT_ROW] },
    });

    // ─── Heatmap Grid ───────────────────────────────────────────

    if (heatmapEl) {
        try {
            const canvas = await html2canvas(heatmapEl, { scale: 1.5 });
            const imgData = canvas.toDataURL('image/png');
            doc.addPage();
            tocEntries.push({ title: 'Heatmap Grid', page: doc.getNumberOfPages() });
            drawSectionHeader('Heatmap Grid', 25, 60);

            const imgW = pageW - 2 * margin;
            const imgH = (canvas.height / canvas.width) * imgW;
            const maxImgH = pageH - 65;
            doc.addImage(imgData, 'PNG', margin, 35, imgW, Math.min(imgH, maxImgH));

            doc.setFontSize(8);
            doc.setTextColor(...MID_GRAY);
            const captionY = Math.min(35 + imgH + 4, pageH - 18);
            doc.text('Darker cells indicate higher journey volumes between station pairs.', margin, captionY);
        } catch {
            // Skip heatmap on capture failure
        }
    }

    // ─── Fill Table of Contents (page 2) ────────────────────────

    doc.setPage(tocPageNum);
    drawSectionHeader('Table of Contents', 30, 85);

    doc.setFontSize(11);
    let tocY = 48;
    tocEntries.forEach((entry, i) => {
        doc.setTextColor(...DARK_TEXT);
        const label = `${i + 1}.  ${entry.title}`;
        const pageLabel = `Page ${entry.page}`;

        doc.text(label, margin, tocY);

        // Dot leaders
        const labelW = doc.getTextWidth(label);
        const pageLabelW = doc.getTextWidth(pageLabel);
        const dotsStart = margin + labelW + 3;
        const dotsEnd = pageW - margin - pageLabelW - 3;
        doc.setTextColor(...MID_GRAY);
        let dotX = dotsStart;
        while (dotX < dotsEnd) {
            doc.text('.', dotX, tocY);
            dotX += 2.5;
        }

        doc.setTextColor(...DARK_TEXT);
        doc.text(pageLabel, pageW - margin, tocY, { align: 'right' });
        tocY += 9;
    });

    // ─── Page Footers ───────────────────────────────────────────

    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);

        // Thin gray separator
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.3);
        doc.line(margin, pageH - 12, pageW - margin, pageH - 12);

        doc.setFontSize(8);
        doc.setTextColor(...MID_GRAY);
        doc.text('Ontario Northland OD Analysis', margin, pageH - 7);
        doc.text(`Page ${i} of ${totalPages}`, pageW - margin, pageH - 7, { align: 'right' });
    }

    // ─── Save ───────────────────────────────────────────────────

    const dateSlug = data.metadata.dateRange?.replace(/\s+/g, '_') || 'export';
    doc.save(`od_analysis_${dateSlug}.pdf`);
}

// ─── Stop Focus PDF Export ────────────────────────────────────────

export async function exportStopReportPdf(
    data: ODMatrixDataSummary,
    stopName: string,
    mapEl?: HTMLDivElement | null,
): Promise<void> {
    const station = data.stations.find(s => s.name === stopName);
    if (!station) return;

    const [{ default: jsPDF }, { default: autoTable }, { default: html2canvas }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
        import('html2canvas'),
    ]);

    const doc = new jsPDF({ orientation: 'landscape' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 20;

    // Same Ontario Northland brand palette as network report
    const ON_NAVY: [number, number, number] = [0, 40, 94];
    const ON_GOLD: [number, number, number] = [254, 188, 17];
    const DARK_TEXT: [number, number, number] = [31, 33, 35];
    const MID_GRAY: [number, number, number] = [107, 114, 128];
    const ALT_ROW: [number, number, number] = [226, 237, 252];
    const VIOLET: [number, number, number] = [79, 70, 229];

    // Pre-compute stop data
    const outboundPairs = [...data.pairs]
        .filter(p => p.origin === stopName)
        .sort((a, b) => b.journeys - a.journeys);
    const inboundPairs = [...data.pairs]
        .filter(p => p.destination === stopName)
        .sort((a, b) => b.journeys - a.journeys);

    const totalOutbound = outboundPairs.reduce((s, p) => s + p.journeys, 0);
    const totalInbound = inboundPairs.reduce((s, p) => s + p.journeys, 0);
    const totalStopVolume = totalOutbound + totalInbound;

    const sortedStations = [...data.stations].sort((a, b) => b.totalVolume - a.totalVolume);
    const networkRank = sortedStations.findIndex(s => s.name === stopName) + 1;
    const percentile = Math.round((1 - (networkRank - 1) / data.stationCount) * 100);

    // Bidirectional connections for this stop
    const connectionMap = new Map<string, { outbound: number; inbound: number }>();
    outboundPairs.forEach(p => {
        const e = connectionMap.get(p.destination) ?? { outbound: 0, inbound: 0 };
        e.outbound += p.journeys;
        connectionMap.set(p.destination, e);
    });
    inboundPairs.forEach(p => {
        const e = connectionMap.get(p.origin) ?? { outbound: 0, inbound: 0 };
        e.inbound += p.journeys;
        connectionMap.set(p.origin, e);
    });
    const allConnections = [...connectionMap.entries()]
        .map(([partner, { outbound, inbound }]) => ({ partner, outbound, inbound, total: outbound + inbound }))
        .sort((a, b) => b.total - a.total);
    const twoWayConnections = allConnections.filter(c => c.outbound > 0 && c.inbound > 0);

    const originPct = totalStopVolume > 0 ? totalOutbound / totalStopVolume : 0;
    let balanceLabel = 'Balanced — similar origin and destination usage';
    if (originPct >= 0.65) balanceLabel = 'Residential Generator — most trips start here';
    else if (originPct <= 0.35) balanceLabel = 'Attractor / Destination — most trips end here';

    const concBase = totalOutbound > 0 ? totalOutbound : 1;
    const top3Pct = outboundPairs.slice(0, 3).reduce((s, p) => s + p.journeys, 0) / concBase;
    const top5Pct = outboundPairs.slice(0, 5).reduce((s, p) => s + p.journeys, 0) / concBase;

    const tocEntries: { title: string; page: number }[] = [];

    function drawSectionHeader(title: string, y: number, lineLen = 80): void {
        doc.setFontSize(18);
        doc.setTextColor(...ON_NAVY);
        doc.text(title, margin, y);
        doc.setDrawColor(...ON_GOLD);
        doc.setLineWidth(1.2);
        doc.line(margin, y + 4, margin + lineLen, y + 4);
    }

    function drawFooterTag(y: number): void {
        doc.setFontSize(8);
        doc.setTextColor(...MID_GRAY);
        doc.text(`Stop Focus: ${stopName}`, margin, y);
    }

    // ─── Page 1: Cover ─────────────────────────────────────────

    doc.setFontSize(13);
    doc.setTextColor(...MID_GRAY);
    doc.text('Stop Focus Report', pageW / 2, 38, { align: 'center' });

    doc.setFontSize(28);
    doc.setTextColor(...ON_NAVY);
    doc.text(stopName, pageW / 2, 55, { align: 'center' });

    doc.setFontSize(11);
    doc.setTextColor(...ON_NAVY);
    doc.text('Ontario Northland', pageW / 2, 66, { align: 'center' });

    const accentW = 180;
    doc.setDrawColor(...ON_GOLD);
    doc.setLineWidth(2);
    doc.line((pageW - accentW) / 2, 74, (pageW + accentW) / 2, 74);

    // Directional balance tag
    doc.setFontSize(9);
    doc.setTextColor(...MID_GRAY);
    doc.text(balanceLabel, pageW / 2, 82, { align: 'center' });

    // 4 KPI boxes
    const boxGap = 12;
    const usableW = pageW - 2 * margin;
    const boxW = (usableW - 3 * boxGap) / 4;
    const boxH = 36;
    const boxY = 92;

    const kpis = [
        { label: 'Network Rank', value: `#${networkRank} of ${data.stationCount}` },
        { label: 'Total Volume', value: totalStopVolume.toLocaleString() },
        { label: 'Origin Trips', value: totalOutbound.toLocaleString() },
        { label: 'Destination Trips', value: totalInbound.toLocaleString() },
    ];

    kpis.forEach((kpi, i) => {
        const x = margin + i * (boxW + boxGap);
        doc.setDrawColor(...ON_NAVY);
        doc.setLineWidth(0.5);
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(x, boxY, boxW, boxH, 2, 2, 'FD');

        doc.setFontSize(16);
        doc.setTextColor(...DARK_TEXT);
        const maxChars = Math.floor(boxW / 3.5);
        const display = kpi.value.length > maxChars ? kpi.value.slice(0, maxChars - 1) + '...' : kpi.value;
        doc.text(display, x + boxW / 2, boxY + 16, { align: 'center' });

        doc.setFontSize(8);
        doc.setTextColor(...MID_GRAY);
        doc.text(kpi.label, x + boxW / 2, boxY + 26, { align: 'center' });
    });

    // Cover footer
    doc.setFontSize(9);
    doc.setTextColor(...MID_GRAY);
    const coverFooter = [
        data.metadata.dateRange ? `Date Range: ${data.metadata.dateRange}` : null,
        `Exported: ${new Date().toLocaleDateString()}`,
        `Top ${percentile}% of network by volume`,
    ].filter(Boolean).join('  |  ');
    doc.text(coverFooter, pageW / 2, pageH - 20, { align: 'center' });

    // ─── Page 2: Table of Contents ──────────────────────────────

    doc.addPage();
    const tocPageNum = doc.getNumberOfPages();

    // ─── Page 3: Stop Profile ────────────────────────────────────

    doc.addPage();
    tocEntries.push({ title: 'Stop Profile', page: doc.getNumberOfPages() });
    drawSectionHeader('Stop Profile', 25, 65);

    const insights: string[] = [];

    insights.push(
        `${stopName} ranks #${networkRank} of ${data.stationCount} stations (top ${percentile}%), `
        + `with ${totalStopVolume.toLocaleString()} total trips (${totalOutbound.toLocaleString()} departures, `
        + `${totalInbound.toLocaleString()} arrivals).`,
    );

    insights.push(
        `Directional split: ${Math.round(originPct * 100)}% origin / ${Math.round((1 - originPct) * 100)}% destination. `
        + balanceLabel + '.',
    );

    if (outboundPairs.length > 0) {
        const conc = top3Pct >= 0.7 ? 'highly concentrated'
            : top3Pct >= 0.5 ? 'moderately concentrated'
            : 'well distributed';
        insights.push(
            `Outbound demand is ${conc}: top 3 destinations account for ${(top3Pct * 100).toFixed(0)}% `
            + `of outbound trips, top 5 account for ${(top5Pct * 100).toFixed(0)}%.`,
        );
    }

    insights.push(
        `${twoWayConnections.length} of ${allConnections.length} connections have significant travel in both directions, `
        + `indicating ${twoWayConnections.length >= 3 ? 'strong bidirectional corridor potential' : 'primarily one-directional demand patterns'}.`,
    );

    if (allConnections.length > 0) {
        const top = allConnections[0];
        const topPct = totalStopVolume > 0 ? ((top.total / totalStopVolume) * 100).toFixed(0) : '0';
        insights.push(
            `Strongest connection: ${top.partner} with ${top.total.toLocaleString()} combined trips `
            + `(${topPct}% of this stop's total volume).`,
        );
    }

    let fy = 38;
    doc.setFontSize(9);
    for (const insight of insights) {
        doc.setFillColor(...ON_NAVY);
        doc.circle(margin + 2, fy - 1, 1.2, 'F');
        doc.setTextColor(...MID_GRAY);
        const lines: string[] = doc.splitTextToSize(insight, pageW - 2 * margin - 12);
        doc.text(lines, margin + 8, fy);
        fy += lines.length * 4.5 + 3;
    }

    // Top 10 Connections bar chart
    fy += 8;
    doc.setFontSize(12);
    doc.setTextColor(...DARK_TEXT);
    doc.text('Top 10 Connections (Bidirectional Volume)', margin, fy);
    fy += 3;
    doc.setDrawColor(...ON_NAVY);
    doc.setLineWidth(0.5);
    doc.line(margin, fy, margin + 130, fy);
    fy += 7;

    const chartItems = allConnections.slice(0, 10).map(c => ({
        label: c.partner,
        value: c.total,
    }));
    drawHorizontalBarChart(doc, chartItems, margin, fy, pageW - 2 * margin, VIOLET);
    drawFooterTag(pageH - 7);

    // ─── Page 4: Outbound Flows ──────────────────────────────────

    doc.addPage();
    tocEntries.push({ title: 'Outbound Flows', page: doc.getNumberOfPages() });
    drawSectionHeader(`Outbound Flows from ${stopName}`, 25, 130);

    doc.setFontSize(8);
    doc.setTextColor(...MID_GRAY);
    doc.text(`${totalOutbound.toLocaleString()} trips departing to ${outboundPairs.length} destinations.`, margin, 33);

    let cumOut = 0;
    autoTable(doc, {
        startY: 37,
        margin: { left: margin, right: margin, bottom: 20 },
        head: [['Rank', 'Destination', 'Journeys', '% of Outbound', 'Cumulative %', '% of Network']],
        body: outboundPairs.map((pair, i) => {
            cumOut += pair.journeys;
            return [
                i + 1,
                pair.destination,
                pair.journeys.toLocaleString(),
                totalOutbound > 0 ? `${((pair.journeys / totalOutbound) * 100).toFixed(1)}%` : '0.0%',
                totalOutbound > 0 ? `${((cumOut / totalOutbound) * 100).toFixed(0)}%` : '0%',
                data.totalJourneys > 0 ? `${((pair.journeys / data.totalJourneys) * 100).toFixed(2)}%` : '0.00%',
            ];
        }),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [...ON_NAVY] },
        alternateRowStyles: { fillColor: [...ALT_ROW] },
        columnStyles: { 4: { fontStyle: 'bold' } },
    });
    drawFooterTag(pageH - 7);

    // ─── Page 5: Inbound Flows ───────────────────────────────────

    doc.addPage();
    tocEntries.push({ title: 'Inbound Flows', page: doc.getNumberOfPages() });
    drawSectionHeader(`Inbound Flows to ${stopName}`, 25, 125);

    doc.setFontSize(8);
    doc.setTextColor(...MID_GRAY);
    doc.text(`${totalInbound.toLocaleString()} trips arriving from ${inboundPairs.length} origins.`, margin, 33);

    let cumIn = 0;
    autoTable(doc, {
        startY: 37,
        margin: { left: margin, right: margin, bottom: 20 },
        head: [['Rank', 'Origin', 'Journeys', '% of Inbound', 'Cumulative %', '% of Network']],
        body: inboundPairs.map((pair, i) => {
            cumIn += pair.journeys;
            return [
                i + 1,
                pair.origin,
                pair.journeys.toLocaleString(),
                totalInbound > 0 ? `${((pair.journeys / totalInbound) * 100).toFixed(1)}%` : '0.0%',
                totalInbound > 0 ? `${((cumIn / totalInbound) * 100).toFixed(0)}%` : '0%',
                data.totalJourneys > 0 ? `${((pair.journeys / data.totalJourneys) * 100).toFixed(2)}%` : '0.00%',
            ];
        }),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [...ON_NAVY] },
        alternateRowStyles: { fillColor: [...ALT_ROW] },
        columnStyles: { 4: { fontStyle: 'bold' } },
    });
    drawFooterTag(pageH - 7);

    // ─── Page 6: Two-Way Corridors ───────────────────────────────

    if (twoWayConnections.length > 0) {
        doc.addPage();
        tocEntries.push({ title: 'Two-Way Corridors', page: doc.getNumberOfPages() });
        drawSectionHeader(`Two-Way Corridors: ${stopName}`, 25, 115);

        doc.setFontSize(8);
        doc.setTextColor(...MID_GRAY);
        doc.text(`${twoWayConnections.length} corridors with travel in both directions. Direction bias = |outbound − inbound| / total.`, margin, 33);

        autoTable(doc, {
            startY: 37,
            margin: { left: margin, right: margin, bottom: 20 },
            head: [['Rank', 'Partner Station', 'Outbound', 'Inbound', 'Total', 'Direction Bias', 'Dominant Direction']],
            body: twoWayConnections.map((c, i) => {
                const bias = c.total > 0 ? Math.abs(c.outbound - c.inbound) / c.total : 0;
                const dominant = c.outbound >= c.inbound
                    ? `Outbound (+${(bias * 100).toFixed(0)}%)`
                    : `Inbound (+${(bias * 100).toFixed(0)}%)`;
                return [
                    i + 1,
                    c.partner,
                    c.outbound.toLocaleString(),
                    c.inbound.toLocaleString(),
                    c.total.toLocaleString(),
                    `${(bias * 100).toFixed(0)}%`,
                    dominant,
                ];
            }),
            styles: { fontSize: 9 },
            headStyles: { fillColor: [...ON_NAVY] },
            alternateRowStyles: { fillColor: [...ALT_ROW] },
        });
        drawFooterTag(pageH - 7);
    }

    // ─── Page 7: Underserved Connections ────────────────────────

    const LOW_THRESHOLD = 5;
    const underserved = sortedStations
        .filter(s => s.name !== stopName)
        .map(s => {
            const conn = connectionMap.get(s.name);
            return {
                rank: sortedStations.findIndex(x => x.name === s.name) + 1,
                name: s.name,
                networkVolume: s.totalVolume,
                directJourneys: conn ? conn.outbound + conn.inbound : 0,
            };
        })
        .filter(s => s.directJourneys <= LOW_THRESHOLD)
        .slice(0, 20);

    if (underserved.length > 0) {
        doc.addPage();
        tocEntries.push({ title: 'Underserved Connections', page: doc.getNumberOfPages() });
        drawSectionHeader('Underserved Connections', 25, 90);

        doc.setFontSize(8);
        doc.setTextColor(...MID_GRAY);
        doc.text(
            `Top network stations with ≤${LOW_THRESHOLD} direct trips to/from ${stopName}. These may represent latent demand or service gaps.`,
            margin, 33,
        );

        autoTable(doc, {
            startY: 37,
            margin: { left: margin, right: margin, bottom: 20 },
            head: [['Network Rank', 'Station', 'Their Network Volume', 'Direct Journeys', 'Note']],
            body: underserved.map(s => [
                s.rank,
                s.name,
                s.networkVolume.toLocaleString(),
                s.directJourneys,
                s.directJourneys === 0 ? 'No direct O-D pair' : 'Very low — potential latent demand',
            ]),
            styles: { fontSize: 9 },
            headStyles: { fillColor: [...ON_NAVY] },
            alternateRowStyles: { fillColor: [...ALT_ROW] },
            columnStyles: { 4: { fontStyle: 'italic', textColor: [...MID_GRAY] as [number, number, number] } },
        });
        drawFooterTag(pageH - 7);
    }

    // ─── Optional: Flow Map (filtered view) ─────────────────────

    if (mapEl) {
        try {
            const canvas = await html2canvas(mapEl, { useCORS: true, scale: 1.5 });
            const imgData = canvas.toDataURL('image/png');
            doc.addPage();
            tocEntries.push({ title: 'Flow Map', page: doc.getNumberOfPages() });
            drawSectionHeader(`Flow Map — ${stopName}`, 25, 110);

            doc.setFontSize(8);
            doc.setTextColor(...MID_GRAY);
            doc.text(`Connections visible at time of export. Line thickness = journey volume.`, margin, 33);

            const imgW = pageW - 2 * margin;
            const imgH = (canvas.height / canvas.width) * imgW;
            doc.addImage(imgData, 'PNG', margin, 38, imgW, Math.min(imgH, pageH - 70));
            drawFooterTag(pageH - 7);
        } catch {
            // Skip on capture failure
        }
    }

    // ─── Fill Table of Contents ──────────────────────────────────

    doc.setPage(tocPageNum);
    drawSectionHeader('Table of Contents', 30, 85);

    doc.setFontSize(11);
    let tocY = 48;
    tocEntries.forEach((entry, i) => {
        doc.setTextColor(...DARK_TEXT);
        const label = `${i + 1}.  ${entry.title}`;
        const pageLabel = `Page ${entry.page}`;
        doc.text(label, margin, tocY);

        const labelW = doc.getTextWidth(label);
        const pageLabelW = doc.getTextWidth(pageLabel);
        const dotsStart = margin + labelW + 3;
        const dotsEnd = pageW - margin - pageLabelW - 3;
        doc.setTextColor(...MID_GRAY);
        let dotX = dotsStart;
        while (dotX < dotsEnd) {
            doc.text('.', dotX, tocY);
            dotX += 2.5;
        }

        doc.setTextColor(...DARK_TEXT);
        doc.text(pageLabel, pageW - margin, tocY, { align: 'right' });
        tocY += 9;
    });

    // ─── Page Footers ────────────────────────────────────────────

    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.3);
        doc.line(margin, pageH - 12, pageW - margin, pageH - 12);
        doc.setFontSize(8);
        doc.setTextColor(...MID_GRAY);
        doc.text(`Ontario Northland · Stop Focus: ${stopName}`, margin, pageH - 7);
        doc.text(`Page ${i} of ${totalPages}`, pageW - margin, pageH - 7, { align: 'right' });
    }

    // ─── Save ─────────────────────────────────────────────────────

    const nameSlug = stopName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const dateSlug = data.metadata.dateRange?.replace(/\s+/g, '_') || 'export';
    doc.save(`stop_focus_${nameSlug}_${dateSlug}.pdf`);
}
