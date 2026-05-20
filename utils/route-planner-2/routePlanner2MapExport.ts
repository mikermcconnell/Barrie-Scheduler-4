import { buildRoutePlanner2StopSegmentPaths, buildRoutePlanner2StopVisitSequence } from './routePlanner2Segments';
import { getRoutePlanner2KidsAtStop } from './routePlanner2StopTimes';
import type { RoutePlanner2Scenario, RoutePlanner2Stop } from './routePlanner2Types';

type JsPdfInstance = {
    setProperties: (properties: Record<string, string>) => void;
    setFillColor: (...args: [number, number, number] | [string]) => void;
    setDrawColor: (...args: [number, number, number] | [string]) => void;
    setTextColor: (...args: [number, number, number] | [string]) => void;
    setLineWidth: (width: number) => void;
    setFont: (fontName: string, fontStyle?: string) => void;
    setFontSize: (size: number) => void;
    rect: (x: number, y: number, width: number, height: number, style?: string) => void;
    roundedRect: (x: number, y: number, width: number, height: number, rx: number, ry: number, style?: string) => void;
    line: (x1: number, y1: number, x2: number, y2: number) => void;
    text: (text: string | string[], x: number, y: number, options?: Record<string, unknown>) => void;
    addImage: (imageData: string, format: string, x: number, y: number, width: number, height: number) => void;
    addPage: () => void;
    save: (fileName: string) => void;
    internal: {
        pageSize: {
            getWidth: () => number;
            getHeight: () => number;
        };
    };
};

interface MapboxDirectionsStep {
    name?: string;
    distance?: number;
    duration?: number;
    maneuver?: {
        instruction?: string;
    };
}

interface MapboxDirectionsLeg {
    steps?: MapboxDirectionsStep[];
}

interface MapboxDirectionsRoute {
    legs?: MapboxDirectionsLeg[];
}

interface MapboxDirectionsResponse {
    code?: string;
    routes?: MapboxDirectionsRoute[];
}

export interface RoutePlanner2MapExportStopCallout {
    stopId: string;
    sequence: number;
    label: string;
    badge?: 'Start' | 'End';
    lat: number;
    lng: number;
}

export interface RoutePlanner2MapExportRoadLabel {
    name: string;
    coordinate: { lat: number; lng: number };
}

export interface RoutePlanner2MapExportPlan {
    title: string;
    generatedAt: string;
    routeCoordinates: Array<{ lat: number; lng: number }>;
    stopCallouts: RoutePlanner2MapExportStopCallout[];
    roadLabels: RoutePlanner2MapExportRoadLabel[];
}

export interface RoutePlanner2MapExportImage {
    dataUrl: string;
    width: number;
    height: number;
}

export interface RoutePlanner2MapBookSection {
    id: string;
    title: string;
    subtitle: string;
    coordinates: [number, number][];
}

export interface RoutePlanner2MapBookPage {
    title: string;
    subtitle?: string;
    mapImage: RoutePlanner2MapExportImage;
}

export interface RoutePlanner2MapExportSummaryItem {
    label: string;
    value: string;
}

interface ExportOptions {
    projectName: string;
    routeLabel?: string;
    mapImage?: RoutePlanner2MapExportImage;
    mapPages?: RoutePlanner2MapBookPage[];
    summaryItems?: RoutePlanner2MapExportSummaryItem[];
    token?: string | null;
    fetchImpl?: typeof fetch;
    now?: Date;
}

function getMapboxToken(): string | null {
    return import.meta.env?.VITE_MAPBOX_TOKEN ?? null;
}

function formatDate(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
    }).format(date);
}

function sanitizeFilePart(value: string): string {
    return value
        .trim()
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80)
        || 'route-map';
}

function truncateText(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function drawMiddleText(
    doc: JsPdfInstance,
    text: string,
    x: number,
    y: number,
    options: Record<string, unknown> = {},
): void {
    doc.text(text, x, y, { ...options, baseline: 'middle' });
}

function drawSummaryCard(
    doc: JsPdfInstance,
    item: RoutePlanner2MapExportSummaryItem,
    x: number,
    y: number,
    width: number,
    height: number,
): void {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.35);
    doc.roundedRect(x, y, width, height, 1.8, 1.8, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.8);
    doc.setTextColor(100, 116, 139);
    drawMiddleText(doc, truncateText(item.label.toUpperCase(), 20), x + 3, y + 4.2);

    doc.setFontSize(8.2);
    doc.setTextColor(15, 23, 42);
    drawMiddleText(doc, truncateText(item.value || '-', 26), x + 3, y + 9.5);
}

function drawLegendArrow(doc: JsPdfInstance, x: number, y: number): void {
    doc.setDrawColor(8, 116, 144);
    doc.setLineWidth(0.45);
    doc.line(x, y, x + 4, y);
    doc.line(x + 4, y, x + 2.75, y - 0.85);
    doc.line(x + 4, y, x + 2.75, y + 0.85);
}

function drawLegend(doc: JsPdfInstance, x: number, y: number): void {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.4);
    doc.setTextColor(71, 85, 105);
    drawMiddleText(doc, 'Legend', x, y);

    doc.setFillColor(8, 145, 178);
    doc.rect(x + 16, y - 1.1, 4, 2.2, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.2);
    doc.setTextColor(71, 85, 105);
    drawMiddleText(doc, 'route path', x + 22, y);

    doc.setFillColor(8, 145, 178);
    doc.roundedRect(x + 54, y - 2, 4, 4, 2, 2, 'F');
    drawMiddleText(doc, 'numbered stop', x + 60, y);

    drawLegendArrow(doc, x + 98, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.2);
    doc.setTextColor(71, 85, 105);
    drawMiddleText(doc, 'travel direction', x + 104, y);
}

function drawHeader(
    doc: JsPdfInstance,
    title: string,
    generatedAt: string,
    summaryItems: RoutePlanner2MapExportSummaryItem[],
    box: { x: number; y: number; width: number; height: number },
): void {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(15, 23, 42);
    drawMiddleText(doc, truncateText(title, 96), box.x, box.y + 5.2);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(100, 116, 139);
    drawMiddleText(doc, `Route Planner 2 map export - Generated ${generatedAt}`, box.x, box.y + 10.9);

    if (summaryItems.length > 0) {
        const gap = 2;
        const cardWidth = (box.width - (gap * (summaryItems.length - 1))) / summaryItems.length;
        summaryItems.forEach((item, index) => {
            drawSummaryCard(doc, item, box.x + (index * (cardWidth + gap)), box.y + 16, cardWidth, 12.5);
        });
    }

    drawLegend(doc, box.x, box.y + (summaryItems.length > 0 ? 39.5 : 24));
}

function getPrimaryAddressLine(stop: RoutePlanner2Stop): string {
    return (stop.address?.split(',')[0] ?? stop.name).trim();
}

function formatKids(count: number | undefined): string | null {
    if (!Number.isFinite(count) || !count || count <= 0) return null;
    return `${count} ${count === 1 ? 'Kid' : 'Kids'}`;
}

function formatStopCalloutLabel(stop: RoutePlanner2Stop): string {
    const kids = formatKids(getRoutePlanner2KidsAtStop(stop));
    return kids ? `${getPrimaryAddressLine(stop)} - ${kids}` : getPrimaryAddressLine(stop);
}

function getStopBadge(stop: RoutePlanner2Stop): 'Start' | 'End' | undefined {
    if (stop.role === 'start-terminal') return 'Start';
    if (stop.role === 'end-terminal') return 'End';
    return undefined;
}

function stitchRouteCoordinates(scenario: RoutePlanner2Scenario): Array<{ lat: number; lng: number }> {
    const coordinates: Array<{ lat: number; lng: number }> = [];

    buildRoutePlanner2StopSegmentPaths(scenario).forEach((segmentPath) => {
        segmentPath.coordinates.forEach(([lng, lat], index) => {
            const last = coordinates[coordinates.length - 1];
            if (index > 0 || !last || Math.abs(last.lat - lat) > 0.000001 || Math.abs(last.lng - lng) > 0.000001) {
                coordinates.push({ lat, lng });
            }
        });
    });

    return coordinates;
}

function getMidpointCoordinate(coordinates: Array<{ lat: number; lng: number }>, ratio: number): { lat: number; lng: number } {
    if (coordinates.length === 0) return { lat: 0, lng: 0 };
    if (coordinates.length === 1) return coordinates[0]!;
    const boundedRatio = Math.max(0, Math.min(1, ratio));
    const scaledIndex = boundedRatio * (coordinates.length - 1);
    const index = Math.min(coordinates.length - 2, Math.floor(scaledIndex));
    const localRatio = scaledIndex - index;
    const from = coordinates[index]!;
    const to = coordinates[index + 1]!;
    return {
        lat: from.lat + ((to.lat - from.lat) * localRatio),
        lng: from.lng + ((to.lng - from.lng) * localRatio),
    };
}

function buildMapboxDirectionsUrl(coordinates: Array<{ lat: number; lng: number }>, token: string): string {
    const selectedCoordinates = coordinates.length > 25
        ? Array.from({ length: 25 }, (_, index) => coordinates[Math.round(index * ((coordinates.length - 1) / 24))]!)
            .filter((coordinate, index, sampled) =>
                index === 0 || Math.abs(coordinate.lat - sampled[index - 1]!.lat) > 0.000001 || Math.abs(coordinate.lng - sampled[index - 1]!.lng) > 0.000001,
            )
        : coordinates;
    const coordinateText = selectedCoordinates.map((coordinate) => `${coordinate.lng},${coordinate.lat}`).join(';');
    return `https://api.mapbox.com/directions/v5/mapbox/driving/${coordinateText}?geometries=geojson&overview=false&steps=true&access_token=${token}`;
}

async function getMapboxSteps(
    coordinates: Array<{ lat: number; lng: number }>,
    token: string | null,
    fetchImpl: typeof fetch,
): Promise<MapboxDirectionsStep[]> {
    if (!token || coordinates.length < 2) return [];

    try {
        const response = await fetchImpl(buildMapboxDirectionsUrl(coordinates, token));
        if (!response.ok) return [];
        const data = await response.json() as MapboxDirectionsResponse;
        if (data.code !== 'Ok') return [];
        return data.routes?.[0]?.legs?.flatMap((leg) => leg.steps ?? []) ?? [];
    } catch {
        return [];
    }
}

function buildRoadLabels(steps: MapboxDirectionsStep[], routeCoordinates: Array<{ lat: number; lng: number }>): RoutePlanner2MapExportRoadLabel[] {
    const seen = new Set<string>();
    const roadNames = steps
        .map((step) => step.name?.trim())
        .filter((name): name is string => Boolean(name))
        .filter((name) => {
            const key = name.toLocaleLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, 18);

    return roadNames.map((name, index) => ({
        name,
        coordinate: getMidpointCoordinate(routeCoordinates, (index + 1) / (roadNames.length + 1)),
    }));
}

export async function buildRoutePlanner2MapExportPlan(
    scenario: RoutePlanner2Scenario,
    options: ExportOptions,
): Promise<RoutePlanner2MapExportPlan> {
    const token = Object.prototype.hasOwnProperty.call(options, 'token')
        ? options.token ?? null
        : getMapboxToken();
    const fetchImpl = options.fetchImpl ?? fetch;
    const routeCoordinates = stitchRouteCoordinates(scenario);
    const steps = await getMapboxSteps(routeCoordinates, token, fetchImpl);
    const sortedStops = buildRoutePlanner2StopVisitSequence(scenario);
    const routeLabel = options.routeLabel?.trim() || scenario.name;

    return {
        title: `${options.projectName} - ${routeLabel}`,
        generatedAt: formatDate(options.now ?? new Date()),
        routeCoordinates,
        stopCallouts: sortedStops.map((stop) => ({
            stopId: stop.id,
            sequence: stop.sequence,
            label: formatStopCalloutLabel(stop),
            badge: getStopBadge(stop),
            lat: stop.lat,
            lng: stop.lng,
        })),
        roadLabels: buildRoadLabels(steps, routeCoordinates),
    };
}

export async function exportRoutePlanner2MapPdf(
    scenario: RoutePlanner2Scenario,
    options: ExportOptions,
): Promise<void> {
    if (!options.mapImage?.dataUrl) {
        throw new Error('The route map image could not be captured. Please wait for the map to finish loading and try again.');
    }

    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' }) as unknown as JsPdfInstance;
    const routeLabel = options.routeLabel?.trim() || scenario.name;
    const title = `${options.projectName} - ${routeLabel}`;
    const generatedAt = formatDate(options.now ?? new Date());
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 10;
    const headerHeight = 18;
    const summaryHeight = options.summaryItems?.length ? 15 : 0;
    const legendHeight = 8;
    const footerHeight = 8;
    const mapY = margin + headerHeight + summaryHeight + legendHeight + 2;
    const headerBox = {
        x: margin,
        y: 7,
        width: pageWidth - (margin * 2),
        height: mapY - 10,
    };
    const imageBox = {
        x: margin,
        y: mapY,
        width: pageWidth - (margin * 2),
        height: pageHeight - mapY - footerHeight - 3,
    };
    const imageAspect = options.mapImage.width > 0 && options.mapImage.height > 0
        ? options.mapImage.width / options.mapImage.height
        : 16 / 9;
    const pages: RoutePlanner2MapBookPage[] = [
        {
            title: `${title} · Overview`,
            subtitle: 'Full route overview',
            mapImage: options.mapImage,
        },
        ...(options.mapPages ?? []),
    ];

    doc.setProperties({
        title: `${title} Map`,
        subject: 'Route Planner 2 map export',
        author: 'TransitScheduler',
        creator: 'TransitScheduler Route Planner 2',
    });

    const summaryItems = options.summaryItems?.slice(0, 5) ?? [];

    pages.forEach((page, index) => {
        if (index > 0) doc.addPage();

        const pageImageAspect = page.mapImage.width > 0 && page.mapImage.height > 0
            ? page.mapImage.width / page.mapImage.height
            : imageAspect;
        const fittedHeight = Math.min(imageBox.height, imageBox.width / pageImageAspect);
        const fittedWidth = Math.min(imageBox.width, fittedHeight * pageImageAspect);
        const imageX = imageBox.x + ((imageBox.width - fittedWidth) / 2);
        const imageY = imageBox.y + ((imageBox.height - fittedHeight) / 2);
        const pageTitle = index === 0 ? title : `${title} · ${page.title}`;

        doc.setFillColor(31, 85, 139);
        doc.rect(0, 0, 3.5, pageHeight, 'F');

        drawHeader(doc, pageTitle, generatedAt, index === 0 ? summaryItems : [], headerBox);

        if (page.subtitle) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(7);
            doc.setTextColor(71, 85, 105);
            drawMiddleText(doc, page.subtitle, pageWidth - margin, mapY - 4.5, { align: 'right' });
        }

        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(203, 213, 225);
        doc.setLineWidth(0.6);
        doc.roundedRect(imageX, imageY, fittedWidth, fittedHeight, 2.4, 2.4, 'FD');
        doc.addImage(page.mapImage.dataUrl, 'PNG', imageX, imageY, fittedWidth, fittedHeight);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(80, 80, 80);
        doc.text(
            index === 0
                ? 'Planning map - verify route and stop placement before issuing.'
                : `Detail page ${index} of ${pages.length - 1} - verify turns, road labels, and stop placement.`,
            margin,
            pageHeight - 4.5,
        );
    });

    doc.save(`${sanitizeFilePart(title)}-map.pdf`);
}

function stitchLngLatCoordinates(coordinateGroups: [number, number][][]): [number, number][] {
    const coordinates: [number, number][] = [];

    coordinateGroups.forEach((group) => {
        group.forEach((coordinate, index) => {
            const last = coordinates[coordinates.length - 1];
            if (index > 0 || !last || Math.abs(last[0] - coordinate[0]) > 0.000001 || Math.abs(last[1] - coordinate[1]) > 0.000001) {
                coordinates.push(coordinate);
            }
        });
    });

    return coordinates;
}

export function buildRoutePlanner2MapBookSections(
    scenario: RoutePlanner2Scenario,
    stopsPerPage = 3,
    overlapStops = 1,
): RoutePlanner2MapBookSection[] {
    const stopVisits = buildRoutePlanner2StopVisitSequence(scenario);
    if (stopVisits.length < 2) return [];

    const segmentPaths = buildRoutePlanner2StopSegmentPaths(scenario);
    const pageStopCount = Math.max(3, stopsPerPage);
    const overlap = Math.max(1, Math.min(overlapStops, pageStopCount - 2));
    const sections: RoutePlanner2MapBookSection[] = [];
    let startIndex = 0;

    while (startIndex < stopVisits.length - 1) {
        let endIndex = Math.min(stopVisits.length, startIndex + pageStopCount);

        if (stopVisits.length - endIndex === 1 && endIndex < stopVisits.length) {
            endIndex = stopVisits.length;
        }

        const sectionStops = stopVisits.slice(startIndex, endIndex);
        const sectionSegments = segmentPaths.slice(startIndex, Math.max(startIndex, endIndex - 1));
        const coordinates = stitchLngLatCoordinates([
            ...sectionSegments.map((segment) => segment.coordinates),
            ...sectionStops.map((stop): [number, number][] => [[stop.lng, stop.lat]]),
        ]);
        const firstStop = sectionStops[0]!;
        const lastStop = sectionStops[sectionStops.length - 1]!;
        const stopRange = `Stops ${firstStop.sequence}-${lastStop.sequence}`;

        sections.push({
            id: `section-${sections.length + 1}`,
            title: `Section ${sections.length + 1} of route`,
            subtitle: `${stopRange} · ${sectionStops.length} stops`,
            coordinates,
        });

        if (endIndex >= stopVisits.length) break;
        startIndex = Math.max(startIndex + 1, endIndex - overlap);
    }

    return sections.map((section, index) => ({
        ...section,
        title: `Section ${index + 1} of ${sections.length}`,
    }));
}
