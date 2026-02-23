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

// ─── Excel Export ────────────────────────────────────────────────

export async function exportODExcel(data: ODMatrixDataSummary): Promise<void> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Barrie Transit Scheduler';

    const sortedStations = [...data.stations].sort((a, b) => b.totalVolume - a.totalVolume);
    const stationNames = sortedStations.map(s => s.name);

    // Build journey lookup
    const journeyMap = new Map<string, number>();
    data.pairs.forEach(p => journeyMap.set(`${p.origin}|${p.destination}`, p.journeys));

    // Sheet 1: OD Matrix cross-tab
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

    // Sheet 2: Top Pairs
    const pairsSheet = wb.addWorksheet('Top Pairs');
    pairsSheet.addRow(['Top OD Pairs']);
    pairsSheet.getRow(1).font = { bold: true, size: 14 };
    pairsSheet.addRow([]);

    const pairsHeader = pairsSheet.addRow(['Rank', 'Origin', 'Destination', 'Journeys', '% Total']);
    styleHeader(pairsHeader);

    const topPairs = data.topPairs.length > 0 ? data.topPairs : [...data.pairs].sort((a, b) => b.journeys - a.journeys).slice(0, 100);
    topPairs.forEach((pair, i) => {
        const pct = data.totalJourneys > 0 ? ((pair.journeys / data.totalJourneys) * 100).toFixed(2) : '0.00';
        pairsSheet.addRow([i + 1, pair.origin, pair.destination, pair.journeys, `${pct}%`]);
    });
    autoWidth(pairsSheet);

    // Sheet 3: Station Summary
    const stationSheet = wb.addWorksheet('Station Summary');
    stationSheet.addRow(['Station Volume Summary']);
    stationSheet.getRow(1).font = { bold: true, size: 14 };
    stationSheet.addRow([]);

    const stationHeader = stationSheet.addRow(['Rank', 'Station', 'Origin Trips', 'Destination Trips', 'Total Volume', '% Total']);
    styleHeader(stationHeader);

    sortedStations.forEach((station, i) => {
        const pct = data.totalJourneys > 0
            ? ((station.totalVolume / (data.totalJourneys * 2)) * 100).toFixed(2)
            : '0.00';
        stationSheet.addRow([i + 1, station.name, station.totalOrigin, station.totalDestination, station.totalVolume, `${pct}%`]);
    });
    autoWidth(stationSheet);

    const dateSlug = data.metadata.dateRange?.replace(/\s+/g, '_') || 'export';
    const buffer = await wb.xlsx.writeBuffer();
    downloadBuffer(buffer, `od_analysis_${dateSlug}.xlsx`);
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
            `The ${top.origin} \u2013 ${top.destination} corridor is the busiest with `
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
                `Largest directional imbalance in the top 10: ${p.stationA} \u2013 ${p.stationB} `
                + `shows ${maxImb.pct.toFixed(0)}% more traffic toward ${towardStation}.`,
            );
        }
    }

    // 5. Network breadth
    const active = data.stations.filter(s => s.totalVolume >= 1000).length;
    const activePct = data.stationCount > 0 ? ((active / data.stationCount) * 100).toFixed(0) : '0';
    findings.push(
        `${active} of ${data.stationCount} stations (${activePct}%) carry meaningful traffic `
        + `(>1,000 journeys); ${data.stationCount - active} stations are in the long tail.`,
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
    doc.text('Ontario Northland Transportation Commission', pageW / 2, 77, { align: 'center' });

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
        label: `${b.stationA} \u2013 ${b.stationB}`,
        value: b.total,
    }));
    drawHorizontalBarChart(doc, chartItems, margin, fy, pageW - 2 * margin, VIOLET);

    // ─── Page 4: Executive Summary ──────────────────────────────

    doc.addPage();
    tocEntries.push({ title: 'Executive Summary', page: doc.getNumberOfPages() });
    drawSectionHeader('Executive Summary', 25, 90);

    let sy = 40; // summary Y cursor

    // 1. Top Consolidated Corridors
    doc.setFontSize(11);
    doc.setTextColor(...DARK_TEXT);
    doc.text('Top Consolidated Corridors', margin, sy);
    sy += 3;

    const topCorridors = corridors.slice(0, 5);
    if (topCorridors.length > 0) {
        autoTable(doc, {
            startY: sy,
            margin: { left: margin, right: margin },
            head: [['Rank', 'Origin', 'Destination', 'Journeys', '% Total']],
            body: topCorridors.map((c, i) => [
                i + 1,
                c.origin,
                c.destination,
                c.journeys.toLocaleString(),
                `${((c.journeys / data.totalJourneys) * 100).toFixed(1)}%`,
            ]),
            styles: { fontSize: 8, cellPadding: 2 },
            headStyles: { fillColor: [...ON_NAVY] },
            alternateRowStyles: { fillColor: [...ALT_ROW] },
        });
        sy = ((doc as any).lastAutoTable?.finalY ?? sy + 40) + 4;
    }

    doc.setFontSize(7);
    doc.setTextColor(...MID_GRAY);
    doc.text('* Toronto terminals (Yorkdale, Union Station, Vaughan HWY 407) consolidated as "Toronto Area"', margin, sy);
    sy += 8;

    // 2. Traffic Concentration
    doc.setFontSize(11);
    doc.setTextColor(...DARK_TEXT);
    doc.text('Traffic Concentration', margin, sy);
    sy += 5;
    doc.setFontSize(9);
    doc.setTextColor(...MID_GRAY);
    doc.text(`Top 10 OD pairs account for ${concentration.top10Pct.toFixed(1)}% of all journeys`, margin + 4, sy);
    sy += 4.5;
    doc.text(`Top 20 OD pairs account for ${concentration.top20Pct.toFixed(1)}% of all journeys`, margin + 4, sy);
    sy += 8;

    // 3. Top Bidirectional Corridors
    doc.setFontSize(11);
    doc.setTextColor(...DARK_TEXT);
    doc.text('Top Bidirectional Corridors', margin, sy);
    sy += 3;

    const topBi = biPairs.slice(0, 5);
    if (topBi.length > 0) {
        autoTable(doc, {
            startY: sy,
            margin: { left: margin, right: margin },
            head: [['Corridor', 'A to B', 'B to A', 'Combined', '% Total']],
            body: topBi.map(b => [
                `${b.stationA}  -  ${b.stationB}`,
                b.aToB.toLocaleString(),
                b.bToA.toLocaleString(),
                b.total.toLocaleString(),
                `${((b.total / data.totalJourneys) * 100).toFixed(1)}%`,
            ]),
            styles: { fontSize: 8, cellPadding: 2 },
            headStyles: { fillColor: [...ON_NAVY] },
            alternateRowStyles: { fillColor: [...ALT_ROW] },
            columnStyles: { 0: { cellWidth: 100 } },
        });
        sy = ((doc as any).lastAutoTable?.finalY ?? sy + 40) + 6;
    }

    // 4. Hub Dominance
    if (hubStats) {
        doc.setFontSize(11);
        doc.setTextColor(...DARK_TEXT);
        doc.text('Hub Dominance', margin, sy);
        sy += 5;
        doc.setFontSize(9);
        doc.setTextColor(...MID_GRAY);
        doc.text(
            `${hubStats.name} handles ${hubStats.pct.toFixed(1)}% of all station activity `
            + `(${hubStats.originPct.toFixed(1)}% origins, ${hubStats.destPct.toFixed(1)}% destinations)`,
            margin + 4, sy,
        );
        sy += 8;
    }

    // 5. Geographic Spread
    doc.setFontSize(11);
    doc.setTextColor(...DARK_TEXT);
    doc.text('Geographic Spread', margin, sy);
    sy += 5;
    doc.setFontSize(9);
    doc.setTextColor(...MID_GRAY);
    doc.text(
        `${activeStationCount} of ${data.stationCount} stations have >1,000 journeys; `
        + `${data.stationCount - activeStationCount} stations in the long tail`,
        margin + 4, sy,
    );

    // ─── Page 4: Flow Map ───────────────────────────────────────

    if (mapEl) {
        try {
            const canvas = await html2canvas(mapEl, { useCORS: true, scale: 1.5 });
            const imgData = canvas.toDataURL('image/png');
            doc.addPage();
            tocEntries.push({ title: 'Flow Map', page: doc.getNumberOfPages() });
            drawSectionHeader('Flow Map', 25, 50);

            const imgW = pageW - 2 * margin;
            const imgH = (canvas.height / canvas.width) * imgW;
            const maxImgH = pageH - 65;
            doc.addImage(imgData, 'PNG', margin, 35, imgW, Math.min(imgH, maxImgH));

            doc.setFontSize(8);
            doc.setTextColor(...MID_GRAY);
            const captionY = Math.min(35 + imgH + 4, pageH - 18);
            doc.text('Line thickness represents relative journey volume between station pairs.', margin, captionY);
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
        head: [['Rank', 'Station A', 'Station B', 'A \u2192 B', 'B \u2192 A', 'Combined', '% Total', 'Imbalance']],
        body: biTop20.map((b, i) => {
            const hi = Math.max(b.aToB, b.bToA);
            const lo = Math.min(b.aToB, b.bToA);
            const imbPct = hi > 0 ? ((hi - lo) / hi) * 100 : 0;
            const arrow = b.aToB >= b.bToA ? '\u2192' : '\u2190';
            const imbLabel = imbPct < 2 ? 'Balanced' : `${arrow} ${imbPct.toFixed(0)}%`;
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
