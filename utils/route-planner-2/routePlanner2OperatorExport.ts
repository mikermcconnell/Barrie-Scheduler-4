import { buildRoutePlanner2StopSegmentPaths, buildRoutePlanner2StopVisitSequence } from './routePlanner2Segments';
import type { RoutePlanner2FeasibilitySummary, RoutePlanner2Scenario, RoutePlanner2SegmentRuntime } from './routePlanner2Types';

type JsPdfInstance = {
    setProperties: (properties: Record<string, string>) => void;
    setFillColor: (...args: [number, number, number] | [string]) => void;
    setDrawColor: (...args: [number, number, number] | [string]) => void;
    setTextColor: (...args: [number, number, number] | [string]) => void;
    setFont: (fontName: string, fontStyle?: string) => void;
    setFontSize: (size: number) => void;
    rect: (x: number, y: number, width: number, height: number, style?: string) => void;
    roundedRect: (x: number, y: number, width: number, height: number, rx: number, ry: number, style?: string) => void;
    line: (x1: number, y1: number, x2: number, y2: number) => void;
    text: (text: string | string[], x: number, y: number, options?: Record<string, unknown>) => void;
    splitTextToSize: (text: string, maxWidth: number) => string[];
    addPage: () => void;
    save: (fileName: string) => void;
    internal: {
        pageSize: {
            getWidth: () => number;
            getHeight: () => number;
        };
        getNumberOfPages: () => number;
    };
    setPage: (pageNumber: number) => void;
};

interface MapboxDirectionsStep {
    distance?: number;
    duration?: number;
    name?: string;
    maneuver?: {
        instruction?: string;
    };
}

interface MapboxDirectionsLeg {
    steps?: MapboxDirectionsStep[];
}

interface MapboxDirectionsRoute {
    legs?: MapboxDirectionsLeg[];
    distance?: number;
    duration?: number;
}

interface MapboxDirectionsResponse {
    code?: string;
    routes?: MapboxDirectionsRoute[];
}

export interface RoutePlanner2OperatorDirectionStep {
    instruction: string;
    distanceMeters?: number;
    durationSeconds?: number;
    streetName?: string;
}

export interface RoutePlanner2OperatorDirectionSegment {
    segmentNumber: number;
    fromStopName: string;
    toStopName: string;
    runtimeMinutes: number | null;
    distanceKm?: number;
    source: 'mapbox-turn-by-turn' | 'planning-alignment';
    steps: RoutePlanner2OperatorDirectionStep[];
}

export interface RoutePlanner2OperatorDirectionPlan {
    routeName: string;
    routeShapeLabel: string;
    generatedAt: string;
    stopSequenceLabel: string;
    directionSourceLabel: string;
    segments: RoutePlanner2OperatorDirectionSegment[];
}

interface ExportOptions {
    projectName: string;
    feasibility: RoutePlanner2FeasibilitySummary | null;
    token?: string | null;
    fetchImpl?: typeof fetch;
    now?: Date;
}

function getMapboxToken(): string | null {
    return import.meta.env?.VITE_MAPBOX_TOKEN ?? null;
}

function formatDateTime(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

function formatMetric(value: number | null | undefined, suffix = 'min'): string {
    return value == null ? 'Not ready' : `${value} ${suffix}`;
}

function formatRecovery(feasibility: RoutePlanner2FeasibilitySummary | null): string {
    if (feasibility?.recoveryTimeMinutes == null) return 'Not ready';
    return feasibility.recoveryPercent == null
        ? `${feasibility.recoveryTimeMinutes} min`
        : `${feasibility.recoveryTimeMinutes} min (${feasibility.recoveryPercent}%)`;
}

function formatBuses(value: number | null | undefined): string {
    return value == null ? 'Not ready' : String(value);
}

function shapeLabel(scenario: RoutePlanner2Scenario): string {
    if (scenario.routeShape === 'closed-loop') return 'Closed loop';
    if (scenario.routeShape === 'out-and-back') return 'Out and back';
    return 'One-way';
}

function sanitizeFilePart(value: string): string {
    return value
        .trim()
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60)
        || 'route';
}

function getSegmentRuntime(
    feasibility: RoutePlanner2FeasibilitySummary | null,
    fromStopId: string,
    toStopId: string,
): RoutePlanner2SegmentRuntime | null {
    return feasibility?.segmentSummaries.find((segment) =>
        segment.fromStopId === fromStopId && segment.toStopId === toStopId,
    ) ?? null;
}

async function getMapboxSteps(
    coordinates: [number, number][],
    token: string | null,
    fetchImpl: typeof fetch,
): Promise<{ steps: RoutePlanner2OperatorDirectionStep[]; distanceKm?: number } | null> {
    if (!token || coordinates.length < 2) return null;

    try {
        const coordinateText = coordinates.map(([lng, lat]) => `${lng},${lat}`).join(';');
        const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordinateText}?geometries=geojson&overview=false&steps=true&access_token=${token}`;
        const response = await fetchImpl(url);
        if (!response.ok) return null;
        const data = await response.json() as MapboxDirectionsResponse;
        const route = data.routes?.[0];
        if (data.code !== 'Ok' || !route?.legs?.length) return null;

        const steps = route.legs.flatMap((leg) => leg.steps ?? [])
            .map((step): RoutePlanner2OperatorDirectionStep | null => {
                const instruction = step.maneuver?.instruction?.trim();
                if (!instruction) return null;
                return {
                    instruction,
                    distanceMeters: step.distance,
                    durationSeconds: step.duration,
                    streetName: step.name,
                };
            })
            .filter((step): step is RoutePlanner2OperatorDirectionStep => step != null);

        return {
            steps,
            distanceKm: typeof route.distance === 'number'
                ? Number((route.distance / 1000).toFixed(2))
                : undefined,
        };
    } catch {
        return null;
    }
}

export async function buildRoutePlanner2OperatorDirectionPlan(
    scenario: RoutePlanner2Scenario,
    options: ExportOptions,
): Promise<RoutePlanner2OperatorDirectionPlan> {
    const token = Object.prototype.hasOwnProperty.call(options, 'token')
        ? options.token ?? null
        : getMapboxToken();
    const fetchImpl = options.fetchImpl ?? fetch;
    const segmentPaths = buildRoutePlanner2StopSegmentPaths(scenario);
    const stopVisits = buildRoutePlanner2StopVisitSequence(scenario);
    const generatedAt = formatDateTime(options.now ?? new Date());
    const segments: RoutePlanner2OperatorDirectionSegment[] = [];
    let hasMapboxDirections = false;

    for (const [index, segmentPath] of segmentPaths.entries()) {
        const fromStop = scenario.stops.find((stop) => stop.id === segmentPath.fromStopId);
        const toStop = scenario.stops.find((stop) => stop.id === segmentPath.toStopId);
        if (!fromStop || !toStop) continue;

        const segmentRuntime = getSegmentRuntime(options.feasibility, segmentPath.fromStopId, segmentPath.toStopId);
        const mapboxResult = await getMapboxSteps(segmentPath.coordinates, token, fetchImpl);
        if (mapboxResult?.steps.length) hasMapboxDirections = true;

        segments.push({
            segmentNumber: index + 1,
            fromStopName: `${fromStop.sequence}. ${fromStop.name}`,
            toStopName: `${toStop.sequence}. ${toStop.name}`,
            runtimeMinutes: segmentRuntime?.runtimeMinutes ?? null,
            distanceKm: mapboxResult?.distanceKm ?? segmentRuntime?.distanceKm,
            source: mapboxResult?.steps.length ? 'mapbox-turn-by-turn' : 'planning-alignment',
            steps: mapboxResult?.steps.length
                ? mapboxResult.steps
                : [{
                    instruction: `Proceed from ${fromStop.name} to ${toStop.name} using the approved route alignment shown in Route Planner 2.`,
                    distanceMeters: segmentRuntime?.distanceKm == null ? undefined : segmentRuntime.distanceKm * 1000,
                }],
        });
    }

    return {
        routeName: scenario.name,
        routeShapeLabel: shapeLabel(scenario),
        generatedAt,
        stopSequenceLabel: stopVisits.map((stop) => `${stop.sequence}`).join(' - '),
        directionSourceLabel: hasMapboxDirections
            ? 'Mapbox turn-by-turn directions'
            : 'Planning alignment fallback - verify turns before issuing',
        segments,
    };
}

function drawWrappedText(
    doc: JsPdfInstance,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight = 4.8,
): number {
    const lines = doc.splitTextToSize(text, maxWidth);
    doc.text(lines, x, y);
    return y + (lines.length * lineHeight);
}

function addFooter(doc: JsPdfInstance, projectName: string): void {
    const pageCount = doc.internal.getNumberOfPages();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    for (let page = 1; page <= pageCount; page += 1) {
        doc.setPage(page);
        doc.setDrawColor(226, 232, 240);
        doc.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text(projectName, 14, pageHeight - 6);
        doc.text(`Page ${page} of ${pageCount}`, pageWidth - 14, pageHeight - 6, { align: 'right' });
    }
}

function ensurePageSpace(doc: JsPdfInstance, y: number, requiredHeight: number): number {
    const pageHeight = doc.internal.pageSize.getHeight();
    if (y + requiredHeight < pageHeight - 18) return y;
    doc.addPage();
    return 18;
}

function drawMetricCard(doc: JsPdfInstance, label: string, value: string, x: number, y: number, width: number): void {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x, y, width, 20, 3, 3, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(label.toUpperCase(), x + 4, y + 7);
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(value, x + 4, y + 15);
}

export async function exportRoutePlanner2OperatorDirectionsPdf(
    scenario: RoutePlanner2Scenario,
    options: ExportOptions,
): Promise<void> {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' }) as JsPdfInstance;
    const plan = await buildRoutePlanner2OperatorDirectionPlan(scenario, options);
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 14;
    const contentWidth = pageWidth - (margin * 2);
    const feasibility = options.feasibility;

    doc.setProperties({
        title: `${scenario.name} Operator Turn-by-Turn`,
        subject: 'Route Planner 2 operator direction sheet',
        author: 'TransitScheduler',
        creator: 'TransitScheduler Route Planner 2',
    });

    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageWidth, 30, 'F');
    doc.setFillColor(8, 145, 178);
    doc.rect(0, 28, pageWidth, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(255, 255, 255);
    doc.text('Operator Turn-by-Turn', margin, 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`${scenario.name} | ${options.projectName}`, margin, 22);
    doc.setFont('helvetica', 'bold');
    doc.text(plan.generatedAt, pageWidth - margin, 13, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.text(plan.directionSourceLabel, pageWidth - margin, 22, { align: 'right' });

    let y = 40;
    const metricWidth = (contentWidth - 30) / 6;
    drawMetricCard(doc, 'Route type', plan.routeShapeLabel, margin, y, metricWidth);
    drawMetricCard(doc, 'Runtime', formatMetric(feasibility?.oneWayRuntimeMinutes), margin + (metricWidth + 6) * 1, y, metricWidth);
    drawMetricCard(doc, 'Cycle', formatMetric(feasibility?.cycleTimeMinutes), margin + (metricWidth + 6) * 2, y, metricWidth);
    drawMetricCard(doc, 'Recovery', formatRecovery(feasibility), margin + (metricWidth + 6) * 3, y, metricWidth);
    drawMetricCard(doc, 'Buses', formatBuses(feasibility?.busesRequired), margin + (metricWidth + 6) * 4, y, metricWidth);
    drawMetricCard(doc, 'Confidence', feasibility?.confidence ?? 'not-ready', margin + (metricWidth + 6) * 5, y, metricWidth);

    y += 30;
    doc.setFillColor(236, 253, 245);
    doc.setDrawColor(167, 243, 208);
    doc.roundedRect(margin, y, contentWidth, 18, 3, 3, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(6, 95, 70);
    doc.text('STOP SEQUENCE', margin + 4, y + 7);
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    drawWrappedText(doc, plan.stopSequenceLabel, margin + 38, y + 7, contentWidth - 44, 4.2);

    y += 28;
    doc.setFillColor(255, 251, 235);
    doc.setDrawColor(253, 230, 138);
    doc.roundedRect(margin, y, contentWidth, 20, 3, 3, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(146, 64, 14);
    doc.text('Operator note', margin + 4, y + 7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 53, 15);
    drawWrappedText(
        doc,
        'Draft planning directions. Confirm stop locations, safe turning movements, road restrictions, construction, and supervisor approval before issuing to operators.',
        margin + 4,
        y + 14,
        contentWidth - 8,
        4.2,
    );

    y += 32;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(15, 23, 42);
    doc.text('Turn-by-turn directions', margin, y);
    y += 8;

    plan.segments.forEach((segment) => {
        const estimatedHeight = 20 + (segment.steps.length * 11);
        y = ensurePageSpace(doc, y, estimatedHeight);

        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(203, 213, 225);
        doc.roundedRect(margin, y, contentWidth, 14, 3, 3, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(15, 23, 42);
        doc.text(`Segment ${segment.segmentNumber}: ${segment.fromStopName} to ${segment.toStopName}`, margin + 4, y + 6);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(71, 85, 105);
        const segmentMeta = [
            segment.runtimeMinutes == null ? 'Runtime not ready' : `${segment.runtimeMinutes} min`,
            segment.distanceKm == null ? null : `${segment.distanceKm.toFixed(2)} km`,
            segment.source === 'mapbox-turn-by-turn' ? 'Turn-by-turn' : 'Planning alignment',
        ].filter(Boolean).join(' | ');
        doc.text(segmentMeta, pageWidth - margin - 4, y + 6, { align: 'right' });
        y += 19;

        segment.steps.forEach((step, stepIndex) => {
            y = ensurePageSpace(doc, y, 12);
            doc.setFillColor(8, 145, 178);
            doc.roundedRect(margin, y - 3.2, 7, 7, 2, 2, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.setTextColor(255, 255, 255);
            doc.text(String(stepIndex + 1), margin + 3.5, y + 1.8, { align: 'center' });

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.setTextColor(15, 23, 42);
            const distanceText = typeof step.distanceMeters === 'number'
                ? ` (${Math.round(step.distanceMeters)} m)`
                : '';
            const nextY = drawWrappedText(doc, `${step.instruction}${distanceText}`, margin + 11, y + 1.5, contentWidth - 14, 4.4);
            y = nextY + 2;
        });

        y += 4;
    });

    addFooter(doc, options.projectName);
    doc.save(`${sanitizeFilePart(scenario.name)}-operator-turn-by-turn.pdf`);
}
