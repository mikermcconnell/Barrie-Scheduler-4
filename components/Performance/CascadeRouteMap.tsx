import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layer, Marker, Popup, Source } from 'react-map-gl/mapbox';
import type { LayerProps, MapRef } from 'react-map-gl/mapbox';
import { MapBase, toGeoJSON } from '../shared';
import { getAllStopsWithCoords } from '../../utils/gtfs/gtfsStopLookup';
import { loadGtfsRouteShapes } from '../../utils/gtfs/gtfsShapesLoader';
import { buildTimelinePoints } from '../../utils/schedule/cascadeStoryUtils';
import type { StopLoadData, TimelinePoint } from '../../utils/schedule/cascadeStoryUtils';
import type { DwellCascade } from '../../utils/performanceDataTypes';

export type CascadeMapPhase = 'whole' | 'same-trip' | 'later-trip';

interface CascadeRouteMapProps {
    cascade: DwellCascade;
    phase: CascadeMapPhase;
    stopLoadLookup: Map<string, StopLoadData>;
}

interface StopEntry {
    key: string;
    timelineIndex: number;
    stopId: string;
    stopName: string;
    tripName: string;
    tripIndex: number;
    phase: 'same-trip' | 'later-trip';
    deviationSeconds: number | null;
    observed: boolean;
    lat: number;
    lon: number;
    isThreshold: boolean;
    isRecovery: boolean;
}

interface PopupInfo { lat: number; lon: number; content: string }

const statusColor = (seconds: number | null): string => {
    if (seconds == null) return '#9ca3af';
    if (seconds > 300) return '#dc2626';
    if (seconds > 0) return '#d97706';
    return '#059669';
};

export function resolveMappedMilestoneIndex(
    points: TimelinePoint[],
    mappedStopIds: ReadonlySet<string>,
    milestone: 'later-transition' | 'end-of-evidence',
): number | null {
    const point = milestone === 'later-transition'
        ? points.find(candidate => candidate.phase === 'later-trip'
            && candidate.observedDeparture !== null
            && (candidate.deviationMinutes ?? 0) > 0)
        : [...points].reverse().find(candidate => candidate.observedDeparture !== null);

    return point && mappedStopIds.has(point.stopId) ? point.index : null;
}

const CascadeRouteMap: React.FC<CascadeRouteMapProps> = ({ cascade, phase, stopLoadLookup }) => {
    const mapRef = useRef<MapRef | null>(null);
    const [popup, setPopup] = useState<PopupInfo | null>(null);
    const coords = useMemo(() => new Map(
        getAllStopsWithCoords().map(stop => [stop.stop_id, { lat: stop.lat, lon: stop.lon }]),
    ), []);
    const storyTrips = useMemo(
        () => cascade.sameTripImpact
            ? [{ ...cascade.sameTripImpact, phase: 'same-trip' as const }, ...cascade.cascadedTrips]
            : cascade.cascadedTrips,
        [cascade.cascadedTrips, cascade.sameTripImpact],
    );
    const timelinePoints = useMemo(() => buildTimelinePoints(storyTrips), [storyTrips]);
    const visiblePhase = (pointPhase: 'same-trip' | 'later-trip') => phase === 'whole' || phase === pointPhase;
    const visibleTimelinePoints = useMemo(
        () => timelinePoints.filter(point => visiblePhase(point.phase)),
        // visiblePhase is derived exclusively from phase.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [timelinePoints, phase],
    );
    const routeShape = useMemo(
        () => loadGtfsRouteShapes().find(shape => shape.routeId === cascade.routeId) ?? null,
        [cascade.routeId],
    );
    const originCoords = coords.get(cascade.stopId);

    const entries = useMemo((): StopEntry[] => visibleTimelinePoints
        .map(point => {
            const coordinate = coords.get(point.stopId);
            if (!coordinate) return null;
            return {
                key: `${point.tripIndex}|${point.index}|${point.stopId}`,
                timelineIndex: point.index,
                stopId: point.stopId,
                stopName: point.stopName,
                tripName: point.tripName,
                tripIndex: point.tripIndex,
                phase: point.phase,
                deviationSeconds: point.deviationMinutes == null ? null : point.deviationMinutes * 60,
                observed: point.observedDeparture != null,
                lat: coordinate.lat,
                lon: coordinate.lon,
                isThreshold: cascade.backUnderThresholdAtStopId === point.stopId
                    && cascade.backUnderThresholdAtTrip === point.tripName,
                isRecovery: cascade.recoveredAtStopId === point.stopId
                    && cascade.recoveredAtTrip === point.tripName,
            };
        })
        .filter((entry): entry is StopEntry => entry !== null),
    [visibleTimelinePoints, coords, cascade]);

    useEffect(() => {
        setPopup(null);
    }, [cascade, phase]);

    const lineCollections = useMemo(() => {
        const same: GeoJSON.Feature[] = [];
        const later: GeoJSON.Feature[] = [];
        storyTrips.forEach((trip) => {
            const tripPhase = trip.phase === 'same-trip' ? 'same-trip' : 'later-trip';
            if (!visiblePhase(tripPhase)) return;
            const target = tripPhase === 'same-trip' ? same : later;
            for (let index = 1; index < trip.timepoints.length; index += 1) {
                const upstream = trip.timepoints[index - 1];
                const downstream = trip.timepoints[index];
                const upstreamCoords = coords.get(upstream.stopId);
                const downstreamCoords = coords.get(downstream.stopId);
                if (!upstreamCoords || !downstreamCoords) continue;
                target.push({
                    type: 'Feature',
                    properties: {
                        color: statusColor(
                            upstream.observedDeparture === null || downstream.observedDeparture === null
                                ? null
                                : downstream.deviationSeconds,
                        ),
                    },
                    geometry: {
                        type: 'LineString',
                        coordinates: [
                            toGeoJSON([upstreamCoords.lat, upstreamCoords.lon]),
                            toGeoJSON([downstreamCoords.lat, downstreamCoords.lon]),
                        ],
                    },
                });
            }
        });
        return {
            same: { type: 'FeatureCollection', features: same } as GeoJSON.FeatureCollection,
            later: { type: 'FeatureCollection', features: later } as GeoJSON.FeatureCollection,
        };
    // visiblePhase is derived exclusively from phase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [storyTrips, timelinePoints, coords, phase]);

    const baseGeoJson = useMemo((): GeoJSON.FeatureCollection | null => routeShape && routeShape.points.length > 1 ? ({
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: routeShape.points.map(([lat, lon]) => toGeoJSON([lat, lon])) },
        }],
    }) : null, [routeShape]);

    const baseLayer: LayerProps = { id: 'cascade-route-base', type: 'line', paint: { 'line-color': '#64748b', 'line-width': 3, 'line-opacity': 0.2 } };
    const sameLayer: LayerProps = { id: 'cascade-same-trip', type: 'line', paint: { 'line-color': ['get', 'color'], 'line-width': 5, 'line-opacity': 0.9 } };
    const laterLayer: LayerProps = { id: 'cascade-later-trips', type: 'line', paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': 0.82, 'line-dasharray': [2, 1.5] } };

    const mappedStopIds = useMemo(() => new Set(coords.keys()), [coords]);
    const laterTransitionIndex = resolveMappedMilestoneIndex(visibleTimelinePoints, mappedStopIds, 'later-transition');
    const lastEvidenceIndex = resolveMappedMilestoneIndex(visibleTimelinePoints, mappedStopIds, 'end-of-evidence');
    const laterTransition = entries.find(entry => entry.timelineIndex === laterTransitionIndex);
    const lastEvidence = entries.find(entry => entry.timelineIndex === lastEvidenceIndex);
    const showEndOfEvidence = !cascade.recoveredAtStop && lastEvidence;
    const originColor = cascade.trackedDwellSeconds > 300 ? '#dc2626' : '#d97706';

    const milestoneGroups = useMemo(() => {
        const groups = new Map<string, { entry: StopEntry; labels: Array<{ label: string; detail: string; color: string }> }>();
        const add = (entry: StopEntry | undefined, label: string, detail: string, color: string) => {
            if (!entry) return;
            const key = `${entry.lat}|${entry.lon}`;
            const group = groups.get(key) ?? { entry, labels: [] };
            if (!group.labels.some(item => item.label === label)) group.labels.push({ label, detail, color });
            groups.set(key, group);
        };
        if (phase !== 'same-trip') {
            add(laterTransition, 'Later-trip carryover', laterTransition ? `${laterTransition.tripName} · ${laterTransition.stopName}` : '', '#d97706');
        }
        entries.filter(entry => entry.isThreshold).forEach(entry => add(
            entry,
            cascade.thresholdStatus === 'returned-under' ? 'Back under 5 min' : 'Stayed under 5 min',
            `${entry.tripName} · ${entry.stopName}`,
            '#d97706',
        ));
        entries.filter(entry => entry.isRecovery).forEach(entry => add(entry, 'Recovered to zero', `${entry.tripName} · ${entry.stopName}`, '#059669'));
        if (showEndOfEvidence) add(lastEvidence, 'End of evidence', 'Full recovery not observed', '#6b7280');
        return Array.from(groups.values());
    }, [cascade.thresholdStatus, entries, laterTransition, lastEvidence, phase, showEndOfEvidence]);
    const originMilestoneGroup = originCoords
        ? milestoneGroups.find(group => group.entry.lat === originCoords.lat && group.entry.lon === originCoords.lon)
        : undefined;
    const nonOriginMilestoneGroups = originMilestoneGroup
        ? milestoneGroups.filter(group => group !== originMilestoneGroup)
        : milestoneGroups;
    const originPopupContent = [
        cascade.stopName,
        'Dwell origin',
        `${(cascade.trackedDwellSeconds / 60).toFixed(1)} min effective dwell`,
        ...(originMilestoneGroup?.labels.map(item => `${item.label}: ${item.detail}`) ?? []),
    ].join('\n');

    const handleLoad = useCallback(() => {
        const map = mapRef.current?.getMap();
        if (!map) return;
        const container = map.getContainer();
        const compact = container.clientWidth < 768;
        const short = container.clientHeight < 500;
        const fitPadding = {
            top: short ? 90 : compact ? 125 : 145,
            bottom: short ? 70 : 100,
            left: compact ? 40 : 70,
            right: compact ? 40 : 70,
        };
        const points = entries.map(entry => ({ lat: entry.lat, lon: entry.lon }));
        if (phase !== 'later-trip' && originCoords) points.push(originCoords);
        if (points.length > 1) {
            map.fitBounds([
                [Math.min(...points.map(point => point.lon)), Math.min(...points.map(point => point.lat))],
                [Math.max(...points.map(point => point.lon)), Math.max(...points.map(point => point.lat))],
            ], { padding: fitPadding, maxZoom: 15, duration: 0 });
        } else if (points.length === 1) {
            map.setCenter([points[0].lon, points[0].lat]);
            map.setZoom(14);
        }
    }, [entries, originCoords, phase]);

    useEffect(() => {
        handleLoad();
    }, [handleLoad]);

    const tooltip = (entry: StopEntry): string => {
        const delay = !entry.observed || entry.deviationSeconds == null ? 'Associated delay unavailable' : `${(entry.deviationSeconds / 60).toFixed(1)} min dwell-associated delay`;
        const load = stopLoadLookup.get(`${cascade.routeId}_${entry.stopId}`);
        return `${entry.stopName}\n${entry.tripName} · ${entry.phase === 'same-trip' ? 'incident trip' : 'later trip'}\n${delay}${entry.observed ? '' : '\nObserved departure unavailable'}${load ? `\n${load.avgBoardings.toFixed(0)} average boardings · load ${load.avgLoad.toFixed(0)}` : ''}`;
    };

    const MilestoneLabel = ({ labels }: { labels: Array<{ label: string; detail: string; color: string }> }) => (
        <div className="pointer-events-none max-w-[min(240px,70vw)] translate-y-[-34px] whitespace-normal rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[10px] shadow-md">
            {labels.map(item => (
                <div key={item.label} className="mb-1 last:mb-0">
                    <div className="font-bold text-gray-900"><span style={{ color: item.color }}>●</span> {item.label}</div>
                    <div className="text-gray-500">{item.detail}</div>
                </div>
            ))}
        </div>
    );

    return (
        <div className="h-full w-full">
            <MapBase mapRef={mapRef} mapStyle="mapbox://styles/mapbox/light-v11" showNavigation onLoad={handleLoad} style={{ borderRadius: 0 }}>
                {baseGeoJson ? <Source id="cascade-route-base-source" type="geojson" data={baseGeoJson}><Layer {...baseLayer} /></Source> : null}
                <Source id="cascade-same-source" type="geojson" data={lineCollections.same}><Layer {...sameLayer} /></Source>
                <Source id="cascade-later-source" type="geojson" data={lineCollections.later}><Layer {...laterLayer} /></Source>

                {entries.filter(entry => entry.stopId !== cascade.stopId).map(entry => {
                    const content = tooltip(entry);
                    const isKeyboardMilestone = entry.isThreshold
                        || entry.isRecovery
                        || entry.key === laterTransition?.key
                        || (showEndOfEvidence && entry.key === lastEvidence?.key);
                    return (
                        <Marker key={entry.key} longitude={entry.lon} latitude={entry.lat} anchor="center">
                            <button
                                type="button"
                                aria-label={`View ${entry.stopName} evidence for ${entry.tripName}, ${entry.phase === 'same-trip' ? 'incident trip' : 'later trip'}`}
                                title={content}
                                onClick={() => setPopup({ lat: entry.lat, lon: entry.lon, content })}
                                tabIndex={isKeyboardMilestone ? 0 : -1}
                                className="grid h-11 w-11 place-items-center rounded-full focus:outline-none focus:ring-2 focus:ring-brand-blue focus:ring-offset-1"
                            >
                                <span
                                    aria-hidden="true"
                                    className="block rounded-full border-2 border-white shadow"
                                    style={{
                                        width: entry.isRecovery || entry.isThreshold ? 18 : 11,
                                        height: entry.isRecovery || entry.isThreshold ? 18 : 11,
                                        background: statusColor(entry.observed ? entry.deviationSeconds : null),
                                    }}
                                />
                            </button>
                        </Marker>
                    );
                })}

                {phase !== 'later-trip' && originCoords ? (
                    <Marker longitude={originCoords.lon} latitude={originCoords.lat} anchor="center">
                        <button
                            type="button"
                            aria-label={`View dwell origin at ${cascade.stopName}`}
                            onClick={() => setPopup({ lat: originCoords.lat, lon: originCoords.lon, content: originPopupContent })}
                            className="grid h-11 w-11 place-items-center rounded-full focus:outline-none focus:ring-2 focus:ring-amber-400"
                        >
                            <span aria-hidden="true" className="h-6 w-6 rounded-full border-[3px] border-white shadow-md" style={{ background: originColor }} />
                        </button>
                        <MilestoneLabel labels={[
                            { label: 'Dwell origin', detail: `${(cascade.trackedDwellSeconds / 60).toFixed(1)} min · ${cascade.stopName}`, color: originColor },
                            ...(originMilestoneGroup?.labels ?? []),
                        ]} />
                    </Marker>
                ) : null}

                {nonOriginMilestoneGroups.map(group => (
                    <Marker key={`milestone-${group.entry.key}`} longitude={group.entry.lon} latitude={group.entry.lat} anchor="center">
                        <MilestoneLabel labels={group.labels} />
                    </Marker>
                ))}

                {popup ? (
                    <Popup longitude={popup.lon} latitude={popup.lat} anchor="top" closeButton closeOnClick={false} onClose={() => setPopup(null)}>
                        <div className="max-w-[220px] whitespace-pre-line text-xs leading-5 text-gray-700">{popup.content}</div>
                    </Popup>
                ) : null}
            </MapBase>

            <div className="pointer-events-none absolute bottom-16 left-3 z-10 rounded-xl border border-gray-200 bg-white/95 px-3 py-2 text-[10px] text-gray-600 shadow md:left-4">
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <span><b className="text-red-600">●</b> Above 5 min</span>
                    <span><b className="text-amber-600">●</b> Positive, up to 5 min</span>
                    <span><b className="text-emerald-600">●</b> Zero</span>
                    <span><b className="text-gray-400">●</b> Unknown</span>
                </div>
                <div className="mt-1 text-gray-500">Solid: incident trip · Dashed: later trips</div>
            </div>
        </div>
    );
};

export default CascadeRouteMap;
