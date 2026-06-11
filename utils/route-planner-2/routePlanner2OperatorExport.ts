import { buildRoutePlanner2StopSegmentPaths, buildRoutePlanner2StopVisitSequence } from './routePlanner2Segments';
import { drawRoutePlanner2MapPdfPage } from './routePlanner2MapExport';
import type { RoutePlanner2MapBookPage, RoutePlanner2MapExportImage, RoutePlanner2MapExportSummaryItem } from './routePlanner2MapExport';
import type { RoutePlanner2FeasibilitySummary, RoutePlanner2Scenario, RoutePlanner2SegmentRuntime, RoutePlanner2Stop } from './routePlanner2Types';

import { getClientMapboxToken } from '../mapboxToken';
type JsPdfInstance = {
    setProperties: (properties: Record<string, string>) => void;
    setFillColor: (...args: [number, number, number] | [string]) => void;
    setDrawColor: (...args: [number, number, number] | [string]) => void;
    setTextColor: (...args: [number, number, number] | [string]) => void;
    setFont: (fontName: string, fontStyle?: string) => void;
    setFontSize: (size: number) => void;
    setLineWidth: (width: number) => void;
    rect: (x: number, y: number, width: number, height: number, style?: string) => void;
    roundedRect: (x: number, y: number, width: number, height: number, rx: number, ry: number, style?: string) => void;
    line: (x1: number, y1: number, x2: number, y2: number) => void;
    text: (text: string | string[], x: number, y: number, options?: Record<string, unknown>) => void;
    splitTextToSize: (text: string, maxWidth: number) => string[];
    addImage: (imageData: string, format: string, x: number, y: number, width: number, height: number) => void;
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
    actionLabel: RoutePlanner2OperatorActionLabel;
    distanceMeters?: number;
    durationSeconds?: number;
    streetName?: string;
}

export type RoutePlanner2OperatorActionLabel =
    | 'LEFT'
    | 'RIGHT'
    | 'STRAIGHT'
    | 'TURNAROUND'
    | 'ARRIVE'
    | 'DEPART'
    | 'CONTINUE';

export interface RoutePlanner2OperatorStopChecklistEntry {
    visitNumber: number;
    stopNumber: number;
    stopName: string;
    roleLabel: string;
    nextStopName?: string;
    runtimeToNextMinutes: number | null;
    distanceToNextKm?: number;
}

export interface RoutePlanner2OperatorDirectionSegment {
    segmentNumber: number;
    phaseLabel: string;
    fromStopName: string;
    toStopName: string;
    runtimeMinutes: number | null;
    distanceKm?: number;
    source: 'mapbox-turn-by-turn' | 'planning-alignment';
    steps: RoutePlanner2OperatorDirectionStep[];
}

export interface RoutePlanner2OperatorDirectionPlan {
    routeCardTitle: string;
    routeName: string;
    routeShapeLabel: string;
    generatedAt: string;
    stopSequenceLabel: string;
    directionSourceLabel: string;
    stopChecklist: RoutePlanner2OperatorStopChecklistEntry[];
    fieldReviewWarnings: string[];
    segments: RoutePlanner2OperatorDirectionSegment[];
}

export interface RoutePlanner2OperatorSegmentMapPage extends RoutePlanner2MapBookPage {
    segmentNumber: number;
}

interface ExportOptions {
    projectName: string;
    feasibility: RoutePlanner2FeasibilitySummary | null;
    mapImage?: RoutePlanner2MapExportImage;
    segmentMapPages?: RoutePlanner2OperatorSegmentMapPage[];
    token?: string | null;
    fetchImpl?: typeof fetch;
    now?: Date;
}

function getMapboxToken(): string | null {
    return getClientMapboxToken();
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

function formatRuntimeMinutes(value: number | null | undefined): string {
    return value == null ? 'Runtime not ready' : `${value} min`;
}

function formatDistanceMeters(value: number | null | undefined): string {
    if (value == null) return '';
    if (value >= 1000) return `${(value / 1000).toFixed(1)} km`;
    return `${Math.round(value)} m`;
}

function shapeLabel(scenario: RoutePlanner2Scenario): string {
    if (scenario.routeShape === 'closed-loop') return 'Closed loop';
    if (scenario.routeShape === 'out-and-back') return 'Out and back';
    return 'One-way';
}

function stopRoleLabel(stop: RoutePlanner2Stop): string {
    switch (stop.role) {
        case 'start-terminal':
            return 'Start terminal';
        case 'end-terminal':
            return 'End terminal';
        case 'turnaround':
            return 'Turnaround';
        case 'timed':
            return 'Timed stop';
        default:
            return 'Regular stop';
    }
}

function stopVisitRoleLabel(
    scenario: RoutePlanner2Scenario,
    stop: RoutePlanner2Stop,
    visitIndex: number,
    stopVisits: RoutePlanner2Stop[],
): string {
    const isFinalRepeatOfFirst = visitIndex === stopVisits.length - 1
        && stopVisits.length > 1
        && stop.id === stopVisits[0]?.id;

    if (scenario.routeShape === 'closed-loop' && isFinalRepeatOfFirst) return 'Loop completion';
    if (scenario.routeShape === 'out-and-back' && isFinalRepeatOfFirst) return `${stopRoleLabel(stop)} / finish`;
    return stopRoleLabel(stop);
}

function deriveOperatorActionLabel(instruction: string): RoutePlanner2OperatorActionLabel {
    const normalized = instruction.toLowerCase();
    if (normalized.includes('u-turn') || normalized.includes('turnaround') || normalized.includes('turn around')) return 'TURNAROUND';
    if (normalized.includes('turn left') || normalized.includes('slight left') || normalized.includes('bear left')) return 'LEFT';
    if (normalized.includes('turn right') || normalized.includes('slight right') || normalized.includes('bear right')) return 'RIGHT';
    if (normalized.includes('arrive')) return 'ARRIVE';
    if (normalized.includes('depart')) return 'DEPART';
    if (normalized.includes('continue') || normalized.includes('straight') || normalized.includes('head ')) return 'STRAIGHT';
    return 'CONTINUE';
}

function getSegmentPhaseLabel(
    scenario: RoutePlanner2Scenario,
    fromStop: RoutePlanner2Stop,
    toStop: RoutePlanner2Stop,
): string {
    if (scenario.routeShape === 'closed-loop') {
        const startStopId = scenario.stops.find((stop) => stop.role === 'start-terminal')?.id ?? scenario.stops[0]?.id;
        return toStop.id === startStopId ? 'Loop return to start' : 'Loop';
    }

    if (scenario.routeShape === 'out-and-back') {
        return toStop.sequence > fromStop.sequence ? 'Outbound to turnaround' : 'Return to start';
    }

    return 'Outbound';
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
                    actionLabel: deriveOperatorActionLabel(instruction),
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

function buildStopChecklist(
    scenario: RoutePlanner2Scenario,
    feasibility: RoutePlanner2FeasibilitySummary | null,
): RoutePlanner2OperatorStopChecklistEntry[] {
    const stopVisits = buildRoutePlanner2StopVisitSequence(scenario);

    return stopVisits.map((stop, index): RoutePlanner2OperatorStopChecklistEntry => {
        const nextStop = stopVisits[index + 1];
        const segmentRuntime = nextStop ? getSegmentRuntime(feasibility, stop.id, nextStop.id) : null;

        return {
            visitNumber: index + 1,
            stopNumber: stop.sequence,
            stopName: stop.name,
            roleLabel: stopVisitRoleLabel(scenario, stop, index, stopVisits),
            nextStopName: nextStop?.name,
            runtimeToNextMinutes: segmentRuntime?.runtimeMinutes ?? null,
            distanceToNextKm: segmentRuntime?.distanceKm,
        };
    });
}

function buildFieldReviewWarnings(
    scenario: RoutePlanner2Scenario,
    segments: RoutePlanner2OperatorDirectionSegment[],
): string[] {
    const warnings: string[] = [];

    if (segments.some((segment) => segment.source === 'planning-alignment')) {
        warnings.push('Planning alignment fallback: exact turn-by-turn directions are not confirmed.');
    }

    if (scenario.routeShape === 'out-and-back') {
        warnings.push('Confirm the turnaround is bus-safe and approved before issuing to operators.');
    }

    if (segments.some((segment) => segment.runtimeMinutes == null)) {
        warnings.push('Some segment runtimes are not ready; use field judgement and supervisor guidance.');
    }

    warnings.push('Confirm stop placement, safe turns, road restrictions, construction, and supervisor approval.');
    return warnings;
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
            phaseLabel: getSegmentPhaseLabel(scenario, fromStop, toStop),
            fromStopName: `${fromStop.sequence}. ${fromStop.name}`,
            toStopName: `${toStop.sequence}. ${toStop.name}`,
            runtimeMinutes: segmentRuntime?.runtimeMinutes ?? null,
            distanceKm: mapboxResult?.distanceKm ?? segmentRuntime?.distanceKm,
            source: mapboxResult?.steps.length ? 'mapbox-turn-by-turn' : 'planning-alignment',
            steps: mapboxResult?.steps.length
                ? mapboxResult.steps
                : [{
                    instruction: `Proceed from ${fromStop.name} to ${toStop.name} using the approved route alignment shown in Route Planner 2.`,
                    actionLabel: 'CONTINUE',
                    distanceMeters: segmentRuntime?.distanceKm == null ? undefined : segmentRuntime.distanceKm * 1000,
                }],
        });
    }

    return {
        routeCardTitle: 'Operator route card',
        routeName: scenario.name,
        routeShapeLabel: shapeLabel(scenario),
        generatedAt,
        stopSequenceLabel: stopVisits.map((stop) => `${stop.sequence}`).join(' - '),
        directionSourceLabel: hasMapboxDirections
            ? 'Mapbox turn-by-turn directions'
            : 'Planning alignment fallback - verify turns before issuing',
        stopChecklist: buildStopChecklist(scenario, options.feasibility),
        fieldReviewWarnings: buildFieldReviewWarnings(scenario, segments),
        segments,
    };
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

function drawStopChecklist(
    doc: JsPdfInstance,
    stops: RoutePlanner2OperatorStopChecklistEntry[],
    x: number,
    y: number,
    width: number,
): number {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text('Stop checklist', x, y);
    y += 6;

    const rowHeight = 9;
    const headerHeight = 8;
    doc.setFillColor(15, 23, 42);
    doc.roundedRect(x, y, width, headerHeight, 2, 2, 'F');
    doc.setFontSize(7);
    doc.setTextColor(255, 255, 255);
    doc.text('#', x + 3, y + 5.2);
    doc.text('Stop / role', x + 14, y + 5.2);
    doc.text('Next', x + width - 74, y + 5.2);
    doc.text('Time', x + width - 18, y + 5.2, { align: 'right' });
    y += headerHeight;

    stops.forEach((stop, index) => {
        y = ensurePageSpace(doc, y, rowHeight + 4);
        const fill = index % 2 === 0 ? 248 : 255;
        doc.setFillColor(fill, fill === 248 ? 250 : 255, fill === 248 ? 252 : 255);
        doc.rect(x, y, width, rowHeight, 'F');
        doc.setDrawColor(226, 232, 240);
        doc.line(x, y + rowHeight, x + width, y + rowHeight);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(8, 145, 178);
        doc.text(String(stop.visitNumber), x + 4, y + 5.8);

        doc.setTextColor(15, 23, 42);
        doc.text(`${stop.stopNumber}. ${stop.stopName}`, x + 14, y + 4.3);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.8);
        doc.setTextColor(100, 116, 139);
        doc.text(stop.roleLabel, x + 14, y + 7.5);

        doc.setFontSize(7.5);
        doc.setTextColor(15, 23, 42);
        doc.text(stop.nextStopName ?? 'End of route', x + width - 74, y + 5.8);
        doc.setFont('helvetica', 'bold');
        doc.text(formatRuntimeMinutes(stop.runtimeToNextMinutes), x + width - 4, y + 5.8, { align: 'right' });
        y += rowHeight;
    });

    return y + 6;
}

function drawFieldReviewWarnings(
    doc: JsPdfInstance,
    warnings: string[],
    x: number,
    y: number,
    width: number,
): number {
    if (!warnings.length) return y;

    doc.setFillColor(255, 251, 235);
    doc.setDrawColor(253, 230, 138);
    const boxHeight = 12 + warnings.length * 5;
    doc.roundedRect(x, y, width, boxHeight, 3, 3, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(146, 64, 14);
    doc.text('FIELD REVIEW FLAGS', x + 4, y + 6.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(120, 53, 15);
    warnings.forEach((warning, index) => {
        doc.text(`- ${warning}`, x + 4, y + 12 + index * 5);
    });
    return y + boxHeight + 8;
}

function buildOperatorMapSummaryItems(
    plan: RoutePlanner2OperatorDirectionPlan,
    feasibility: RoutePlanner2FeasibilitySummary | null,
): RoutePlanner2MapExportSummaryItem[] {
    return [
        { label: 'Stops', value: String(plan.stopChecklist.length) },
        { label: 'Runtime', value: formatMetric(feasibility?.oneWayRuntimeMinutes) },
        { label: 'Recovery', value: formatRecovery(feasibility) },
        { label: 'Buses', value: formatBuses(feasibility?.busesRequired) },
        { label: 'Confidence', value: feasibility?.confidence ?? 'not-ready' },
    ];
}

function buildSegmentMapPageLookup(
    segmentMapPages: RoutePlanner2OperatorSegmentMapPage[] | undefined,
): Map<number, RoutePlanner2OperatorSegmentMapPage> {
    return new Map((segmentMapPages ?? []).map((page) => [page.segmentNumber, page]));
}

function drawFittedMapImage(
    doc: JsPdfInstance,
    mapImage: RoutePlanner2MapExportImage,
    x: number,
    y: number,
    width: number,
    height: number,
): void {
    const imageAspect = mapImage.width > 0 && mapImage.height > 0
        ? mapImage.width / mapImage.height
        : 16 / 9;
    const fittedHeight = Math.min(height, width / imageAspect);
    const fittedWidth = Math.min(width, fittedHeight * imageAspect);
    const imageX = x + ((width - fittedWidth) / 2);
    const imageY = y + ((height - fittedHeight) / 2);

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.35);
    doc.roundedRect(x, y, width, height, 2.2, 2.2, 'FD');
    doc.addImage(mapImage.dataUrl, 'PNG', imageX, imageY, fittedWidth, fittedHeight);
}

function stripStopSequencePrefix(value: string): string {
    return value.replace(/^\s*\d+\.\s*/, '').trim();
}

function formatSegmentDistance(segment: RoutePlanner2OperatorDirectionSegment): string {
    return segment.distanceKm == null ? 'Distance not ready' : `${segment.distanceKm.toFixed(2)} km`;
}

function drawSegmentSummaryChip(
    doc: JsPdfInstance,
    label: string,
    value: string,
    x: number,
    y: number,
    width: number,
): void {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, width, 12, 2.2, 2.2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.8);
    doc.setTextColor(100, 116, 139);
    doc.text(label.toUpperCase(), x + 3, y + 4.4);
    doc.setFontSize(7.2);
    doc.setTextColor(15, 23, 42);
    doc.text(value, x + 3, y + 9);
}

function drawSegmentDirectionsPanel(
    doc: JsPdfInstance,
    segment: RoutePlanner2OperatorDirectionSegment,
    x: number,
    y: number,
    width: number,
    height: number,
): void {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.35);
    doc.roundedRect(x, y, width, height, 2.6, 2.6, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text('Turn-by-turn', x + 5, y + 7.5);

    const segmentMeta = [
        segment.runtimeMinutes == null ? 'Runtime not ready' : `${segment.runtimeMinutes} min`,
        formatSegmentDistance(segment),
        segment.source === 'mapbox-turn-by-turn' ? 'Turn-by-turn' : 'Planning alignment',
    ].filter(Boolean).join(' | ');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.7);
    doc.setTextColor(71, 85, 105);
    doc.text(segmentMeta, x + 5, y + 13);

    doc.setDrawColor(226, 232, 240);
    doc.line(x + 5, y + 17, x + width - 5, y + 17);

    let stepY = y + 25;
    const maxY = y + height - 7;
    const textX = x + 30;
    const textWidth = width - 36;

    for (const [stepIndex, step] of segment.steps.entries()) {
        const distanceText = typeof step.distanceMeters === 'number'
            ? ` (${formatDistanceMeters(step.distanceMeters)})`
            : '';
        const lines = doc.splitTextToSize(`${stepIndex + 1}. ${step.instruction}${distanceText}`, textWidth);
        const stepHeight = Math.max(10.5, lines.length * 3.8 + 4);

        if (stepY + stepHeight > maxY) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(6.8);
            doc.setTextColor(146, 64, 14);
            doc.text(`+ ${segment.steps.length - stepIndex} more step(s) - review before operating`, x + 5, maxY);
            return;
        }

        if (stepIndex % 2 === 0) {
            doc.setFillColor(248, 250, 252);
        } else {
            doc.setFillColor(255, 255, 255);
        }
        doc.rect(x + 4, stepY - 5.2, width - 8, stepHeight, 'F');
        doc.setDrawColor(241, 245, 249);
        doc.line(x + 4, stepY + stepHeight - 5.2, x + width - 4, stepY + stepHeight - 5.2);
        doc.setFillColor(8, 145, 178);
        doc.roundedRect(x + 7, stepY - 2.8, 18, 6.6, 1.8, 1.8, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(step.actionLabel.length > 8 ? 5.2 : 6.2);
        doc.setTextColor(255, 255, 255);
        doc.text(step.actionLabel, x + 16, stepY + 1.7, { align: 'center' });

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.8);
        doc.setTextColor(15, 23, 42);
        doc.text(lines, textX, stepY + 1.2);
        stepY += stepHeight;
    }
}

function drawSegmentMapAndDirectionsPage(
    doc: JsPdfInstance,
    scenarioName: string,
    plan: RoutePlanner2OperatorDirectionPlan,
    segment: RoutePlanner2OperatorDirectionSegment,
    segmentMapPage: RoutePlanner2OperatorSegmentMapPage | undefined,
): void {
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    const gap = 7;
    const headerY = 12;
    const summaryY = 30;
    const contentY = 49;
    const footerSafeArea = 18;
    const availableHeight = pageHeight - contentY - footerSafeArea;
    const fromStopLabel = stripStopSequencePrefix(segment.fromStopName);
    const toStopLabel = stripStopSequencePrefix(segment.toStopName);
    const title = `Segment ${segment.segmentNumber}`;
    const subtitle = `${segment.fromStopName} to ${segment.toStopName}`;

    doc.addPage();
    doc.setFillColor(31, 85, 139);
    doc.rect(0, 0, 3, pageHeight, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(15, 23, 42);
    doc.text(title, margin, headerY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.2);
    doc.setTextColor(71, 85, 105);
    doc.text(subtitle, margin, headerY + 7);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(plan.generatedAt, pageWidth - margin, headerY, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.text(`${scenarioName} | ${segment.phaseLabel}`, pageWidth - margin, headerY + 7, { align: 'right' });

    const chipGap = 5;
    const chipWidth = (pageWidth - (margin * 2) - (chipGap * 3)) / 4;
    drawSegmentSummaryChip(doc, 'From', fromStopLabel, margin, summaryY, chipWidth);
    drawSegmentSummaryChip(doc, 'To', toStopLabel, margin + (chipWidth + chipGap), summaryY, chipWidth);
    drawSegmentSummaryChip(doc, 'Runtime', segment.runtimeMinutes == null ? 'Not ready' : `${segment.runtimeMinutes} min`, margin + (chipWidth + chipGap) * 2, summaryY, chipWidth);
    drawSegmentSummaryChip(doc, 'Distance', formatSegmentDistance(segment), margin + (chipWidth + chipGap) * 3, summaryY, chipWidth);

    if (segmentMapPage) {
        const mapWidth = 170;
        const directionsWidth = pageWidth - (margin * 2) - gap - mapWidth;
        const mapAspect = segmentMapPage.mapImage.width > 0 && segmentMapPage.mapImage.height > 0
            ? segmentMapPage.mapImage.width / segmentMapPage.mapImage.height
            : 16 / 9;
        const mapImageHeight = Math.min(availableHeight - 18, Math.max(96, mapWidth / mapAspect));
        const stepEstimateHeight = 29 + segment.steps.reduce((total, step) => {
            const distanceText = typeof step.distanceMeters === 'number'
                ? ` (${formatDistanceMeters(step.distanceMeters)})`
                : '';
            const estimatedLineCount = Math.max(1, Math.ceil((`${step.instruction}${distanceText}`.length + 4) / 52));
            return total + Math.max(10.5, estimatedLineCount * 3.8 + 4);
        }, 0);
        const cardHeight = Math.min(availableHeight, Math.max(mapImageHeight + 18, stepEstimateHeight, 118));

        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.35);
        doc.roundedRect(margin, contentY, mapWidth, cardHeight, 2.6, 2.6, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(15, 23, 42);
        doc.text('Segment map', margin + 5, contentY + 7.5);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.7);
        doc.setTextColor(71, 85, 105);
        doc.text(segmentMapPage.subtitle ?? 'Operator travel path', margin + 5, contentY + 13);
        drawFittedMapImage(doc, segmentMapPage.mapImage, margin + 5, contentY + 18, mapWidth - 10, cardHeight - 24);
        drawSegmentDirectionsPanel(doc, segment, margin + mapWidth + gap, contentY, directionsWidth, cardHeight);
        return;
    }

    drawSegmentDirectionsPanel(doc, segment, margin, contentY, pageWidth - (margin * 2), availableHeight);
}

export async function exportRoutePlanner2OperatorDirectionsPdf(
    scenario: RoutePlanner2Scenario,
    options: ExportOptions,
): Promise<void> {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' }) as unknown as JsPdfInstance;
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
    doc.text('Operator Route Card', margin, 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`${scenario.name} | ${options.projectName}`, margin, 22);
    doc.setFont('helvetica', 'bold');
    doc.text(plan.generatedAt, pageWidth - margin, 13, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.text(plan.directionSourceLabel, pageWidth - margin, 22, { align: 'right' });

    let y = 40;
    const metricWidth = (contentWidth - 24) / 5;
    drawMetricCard(doc, 'Route type', plan.routeShapeLabel, margin, y, metricWidth);
    drawMetricCard(doc, 'Stops', String(plan.stopChecklist.length), margin + (metricWidth + 6) * 1, y, metricWidth);
    drawMetricCard(doc, 'Runtime', formatMetric(feasibility?.oneWayRuntimeMinutes), margin + (metricWidth + 6) * 2, y, metricWidth);
    drawMetricCard(doc, 'Direction source', plan.segments.some((segment) => segment.source === 'mapbox-turn-by-turn') ? 'Turn-by-turn' : 'Planning', margin + (metricWidth + 6) * 3, y, metricWidth);
    drawMetricCard(doc, 'Confidence', feasibility?.confidence ?? 'not-ready', margin + (metricWidth + 6) * 4, y, metricWidth);

    y += 30;
    y = ensurePageSpace(doc, y, 42);
    y = drawStopChecklist(doc, plan.stopChecklist, margin, y, contentWidth);
    y = ensurePageSpace(doc, y, 30);
    y = drawFieldReviewWarnings(doc, plan.fieldReviewWarnings, margin, y, contentWidth);

    const mapSummaryItems = buildOperatorMapSummaryItems(plan, feasibility);
    if (options.mapImage) {
        doc.addPage();
        drawRoutePlanner2MapPdfPage(doc, {
            title: `${options.projectName} - ${scenario.name} - Operator overview`,
            generatedAt: plan.generatedAt,
            subtitle: 'Full route overview for field review',
            mapImage: options.mapImage,
            summaryItems: mapSummaryItems,
        });
    }

    const segmentMapPageByNumber = buildSegmentMapPageLookup(options.segmentMapPages);

    plan.segments.forEach((segment) => {
        const segmentMapPage = segmentMapPageByNumber.get(segment.segmentNumber);
        drawSegmentMapAndDirectionsPage(doc, scenario.name, plan, segment, segmentMapPage);
    });

    addFooter(doc, options.projectName);
    doc.save(`${sanitizeFilePart(scenario.name)}-operator-turn-by-turn.pdf`);
}
