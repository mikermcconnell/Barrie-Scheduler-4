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
    circle: (x: number, y: number, radius: number, style?: string) => void;
    text: (text: string | string[], x: number, y: number, options?: Record<string, unknown>) => void;
    splitTextToSize: (text: string, maxWidth: number) => string[];
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

interface ExportOptions {
    projectName: string;
    routeLabel?: string;
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

function getBounds(coordinates: Array<{ lat: number; lng: number }>) {
    const lats = coordinates.map((coordinate) => coordinate.lat);
    const lngs = coordinates.map((coordinate) => coordinate.lng);
    return {
        minLat: Math.min(...lats),
        maxLat: Math.max(...lats),
        minLng: Math.min(...lngs),
        maxLng: Math.max(...lngs),
    };
}

function createProjector(plan: RoutePlanner2MapExportPlan, mapBox: { x: number; y: number; width: number; height: number }) {
    const allCoordinates = [
        ...plan.routeCoordinates,
        ...plan.stopCallouts.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
    ];
    const bounds = getBounds(allCoordinates.length ? allCoordinates : [{ lat: 44.38, lng: -79.69 }]);
    const latSpan = Math.max(0.005, bounds.maxLat - bounds.minLat);
    const lngSpan = Math.max(0.005, bounds.maxLng - bounds.minLng);
    const padding = 18;

    return (coordinate: { lat: number; lng: number }) => ({
        x: mapBox.x + padding + ((coordinate.lng - bounds.minLng) / lngSpan) * (mapBox.width - (padding * 2)),
        y: mapBox.y + padding + ((bounds.maxLat - coordinate.lat) / latSpan) * (mapBox.height - (padding * 2)),
    });
}

function drawRouteLine(doc: JsPdfInstance, points: Array<{ x: number; y: number }>): void {
    if (points.length < 2) return;
    doc.setDrawColor(80, 170, 220);
    doc.setLineWidth(2.2);
    for (let index = 1; index < points.length; index += 1) {
        const from = points[index - 1]!;
        const to = points[index]!;
        doc.line(from.x, from.y, to.x, to.y);
    }
}

function drawStopMarker(doc: JsPdfInstance, callout: RoutePlanner2MapExportStopCallout, point: { x: number; y: number }): void {
    doc.setFillColor(31, 85, 139);
    doc.setDrawColor(255, 255, 255);
    doc.circle(point.x, point.y, callout.badge ? 4.6 : 3.4, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(callout.badge ? 6.5 : 7);
    doc.setTextColor(255, 255, 255);
    doc.text(callout.badge ?? String(callout.sequence), point.x, point.y + 1.2, { align: 'center' });
}

function drawCallout(
    doc: JsPdfInstance,
    callout: RoutePlanner2MapExportStopCallout,
    point: { x: number; y: number },
    mapBox: { x: number; y: number; width: number; height: number },
    index: number,
): void {
    const width = 43;
    const height = callout.badge ? 11 : 13;
    const preferRight = point.x < mapBox.x + (mapBox.width / 2);
    const x = Math.max(mapBox.x + 4, Math.min(mapBox.x + mapBox.width - width - 4, point.x + (preferRight ? 7 : -width - 7)));
    const yOffset = (index % 3) * 7;
    const y = Math.max(mapBox.y + 4, Math.min(mapBox.y + mapBox.height - height - 4, point.y - 8 + yOffset));

    doc.setDrawColor(25, 25, 25);
    doc.setFillColor(248, 248, 248);
    doc.setLineWidth(0.6);
    doc.line(point.x, point.y, preferRight ? x : x + width, y + (height / 2));
    doc.rect(x, y, width, height, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.8);
    doc.setTextColor(20, 20, 20);
    const lines = doc.splitTextToSize(callout.label, width - 4).slice(0, 2);
    doc.text(lines, x + 2, y + 4.2);
}

function drawRoadLabel(doc: JsPdfInstance, label: RoutePlanner2MapExportRoadLabel, point: { x: number; y: number }): void {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.setTextColor(20, 20, 20);
    doc.text(label.name, point.x, point.y, { align: 'center', angle: -18 });
}

export async function exportRoutePlanner2MapPdf(
    scenario: RoutePlanner2Scenario,
    options: ExportOptions,
): Promise<void> {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' }) as unknown as JsPdfInstance;
    const plan = await buildRoutePlanner2MapExportPlan(scenario, options);
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const titleHeight = 16;
    const margin = 8;
    const mapBox = {
        x: margin,
        y: titleHeight + 7,
        width: pageWidth - (margin * 2),
        height: pageHeight - titleHeight - 18,
    };
    const project = createProjector(plan, mapBox);

    doc.setProperties({
        title: `${plan.title} Map`,
        subject: 'Route Planner 2 map export',
        author: 'TransitScheduler',
        creator: 'TransitScheduler Route Planner 2',
    });

    doc.setFillColor(31, 85, 139);
    doc.rect(0, 0, pageWidth, titleHeight, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(255, 255, 255);
    doc.text(plan.title, pageWidth / 2, 10.5, { align: 'center' });

    doc.setFillColor(222, 224, 222);
    doc.setDrawColor(25, 25, 25);
    doc.setLineWidth(1.1);
    doc.rect(mapBox.x, mapBox.y, mapBox.width, mapBox.height, 'FD');

    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(0.45);
    for (let index = 0; index < 10; index += 1) {
        const x = mapBox.x + 12 + (index * ((mapBox.width - 24) / 9));
        doc.line(x, mapBox.y + 12, x + 18, mapBox.y + mapBox.height - 14);
    }
    for (let index = 0; index < 8; index += 1) {
        const y = mapBox.y + 14 + (index * ((mapBox.height - 28) / 7));
        doc.line(mapBox.x + 10, y, mapBox.x + mapBox.width - 10, y - 12);
    }

    const routePoints = plan.routeCoordinates.map(project);
    drawRouteLine(doc, routePoints);
    plan.roadLabels.forEach((roadLabel) => drawRoadLabel(doc, roadLabel, project(roadLabel.coordinate)));

    plan.stopCallouts.forEach((callout, index) => {
        const point = project(callout);
        drawStopMarker(doc, callout, point);
        drawCallout(doc, callout, point, mapBox, index);
    });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(80, 80, 80);
    doc.text(`Generated ${plan.generatedAt} · Planning map - verify route and stop placement before issuing.`, margin, pageHeight - 5);

    doc.save(`${sanitizeFilePart(plan.title)}-map.pdf`);
}
