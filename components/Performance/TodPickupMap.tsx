import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layer, Popup, Source } from 'react-map-gl/mapbox';
import type { MapMouseEvent, MapRef } from 'react-map-gl/mapbox';
import { HeatmapDotLayer, MapBase, toGeoJSON } from '../shared';
import type { TodPickupStop } from '../../utils/todPickupTypes';

interface TodPickupMapProps {
  stops: TodPickupStop[];
}

interface RenderedStop extends TodPickupStop {
  bin: number;
  sortKey: number;
}

interface HoverInfo {
  stopId: string;
  latitude: number;
  longitude: number;
}

const BARRIE_CENTER: [number, number] = [44.38, -79.69];
const TOD_PICKUP_LAYER_ID = 'tod-pickup-circles';
const OUTLINE_COLOR = '#374151';
const BINS = [
  { fill: 'transparent', fillOpacity: 0, radius: 3, label: 'Zero' },
  { fill: '#d1d5db', fillOpacity: 0.7, radius: 4, label: 'Minimal' },
  { fill: '#b0b5bc', fillOpacity: 0.75, radius: 5, label: 'Very Low' },
  { fill: '#fef9c3', fillOpacity: 0.8, radius: 6, label: 'Low' },
  { fill: '#fde68a', fillOpacity: 0.82, radius: 7, label: 'Below Avg' },
  { fill: '#fbbf24', fillOpacity: 0.85, radius: 9, label: 'Average' },
  { fill: '#f59e0b', fillOpacity: 0.88, radius: 11, label: 'Above Avg' },
  { fill: '#f97316', fillOpacity: 0.9, radius: 14, label: 'High' },
  { fill: '#ef4444', fillOpacity: 0.93, radius: 17, label: 'Very High' },
  { fill: '#b91c1c', fillOpacity: 0.95, radius: 21, label: 'Peak' },
] as const;

function assignBins(values: number[]): number[] {
  const nonZero = values.filter(value => value > 0);
  if (nonZero.length === 0) return values.map(() => 0);
  const logMax = Math.log(Math.max(...nonZero) + 1);
  if (logMax === 0) return values.map(value => (value > 0 ? 1 : 0));
  return values.map(value => (
    value === 0 ? 0 : Math.max(1, Math.min(9, Math.ceil((Math.log(value + 1) / logMax) * 9)))
  ));
}

function hasValidCoords(stop: TodPickupStop): boolean {
  return Number.isFinite(stop.lat) && Number.isFinite(stop.lon);
}

const Legend = () => (
  <div className="absolute bottom-6 left-2 z-[1000] rounded-lg border border-gray-200 bg-white/95 px-2.5 py-2 text-[10px] shadow-md">
    <div className="mb-1 text-[11px] font-bold text-gray-600">TOD pickups</div>
    {BINS.map((bin, index) => (
      <div key={bin.label} className="flex items-center gap-1.5 py-[1px]">
        <span
          className="inline-block h-3 w-3 rounded-full border"
          style={{
            backgroundColor: bin.fill === 'transparent' ? 'white' : bin.fill,
            borderColor: OUTLINE_COLOR,
            opacity: index === 0 ? 0.5 : bin.fillOpacity,
          }}
        />
        <span className="text-gray-500">{bin.label}</span>
      </div>
    ))}
  </div>
);

export const TodPickupMap: React.FC<TodPickupMapProps> = ({ stops }) => {
  const mapRef = useRef<MapRef | null>(null);
  const hasFittedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [selectedStop, setSelectedStop] = useState<TodPickupStop | null>(null);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);

  const renderedStops = useMemo(() => {
    const mappable = stops.filter(hasValidCoords);
    const bins = assignBins(mappable.map(stop => stop.pickups));
    return mappable
      .map((stop, index) => ({ ...stop, bin: bins[index], sortKey: index }))
      .sort((a, b) => a.bin - b.bin) as RenderedStop[];
  }, [stops]);

  const renderedStopMap = useMemo(
    () => new Map(renderedStops.map(stop => [stop.id, stop])),
    [renderedStops],
  );

  const labelGeoJSON = useMemo((): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: renderedStops.map(stop => ({
      type: 'Feature',
      properties: { id: stop.id, name: stop.name, bin: stop.bin, sortKey: stop.sortKey },
      geometry: { type: 'Point', coordinates: toGeoJSON([stop.lat, stop.lon]) },
    })),
  }), [renderedStops]);

  const hoveredStop = hoverInfo ? renderedStopMap.get(hoverInfo.stopId) ?? null : null;

  const handleMapMouseMove = useCallback((event: MapMouseEvent) => {
    const rawId = event.features?.[0]?.properties?.id;
    const stopId = rawId == null || Array.isArray(rawId) ? null : String(rawId);
    if (!stopId || !renderedStopMap.has(stopId)) {
      setHoverInfo(null);
      mapRef.current?.getMap().getCanvas().style.setProperty('cursor', '');
      return;
    }

    const stop = renderedStopMap.get(stopId)!;
    setHoverInfo({ stopId, latitude: stop.lat, longitude: stop.lon });
    mapRef.current?.getMap().getCanvas().style.setProperty('cursor', 'pointer');
  }, [renderedStopMap]);

  const handleMapMouseLeave = useCallback(() => {
    setHoverInfo(null);
    mapRef.current?.getMap().getCanvas().style.setProperty('cursor', '');
  }, []);

  const handleMapClick = useCallback((event: MapMouseEvent) => {
    const rawId = event.features?.[0]?.properties?.id;
    const stopId = rawId == null || Array.isArray(rawId) ? null : String(rawId);
    if (!stopId) return;
    const stop = renderedStopMap.get(stopId);
    if (stop) setSelectedStop(stop);
  }, [renderedStopMap]);

  useEffect(() => {
    hasFittedRef.current = false;
    setSelectedStop(null);
    setHoverInfo(null);
  }, [stops]);

  useEffect(() => {
    if (!mapReady || renderedStops.length === 0 || hasFittedRef.current) return;
    mapRef.current?.fitBounds(
      [
        [Math.min(...renderedStops.map(stop => stop.lon)), Math.min(...renderedStops.map(stop => stop.lat))],
        [Math.max(...renderedStops.map(stop => stop.lon)), Math.max(...renderedStops.map(stop => stop.lat))],
      ],
      { padding: 40, duration: 0 },
    );
    hasFittedRef.current = true;
  }, [mapReady, renderedStops]);

  if (renderedStops.length === 0) {
    return (
      <div className="grid h-[520px] place-items-center rounded-lg border border-dashed border-amber-300 bg-amber-50 p-6 text-center">
        <div>
          <div className="text-sm font-bold text-amber-900">No mappable TOD pickups</div>
          <p className="mt-1 text-sm text-amber-800">Upload data with pickup latitude and longitude to show the map.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-[620px] w-full overflow-hidden rounded-lg">
      <Legend />
      <div className="absolute right-2 top-2 z-[1000] max-w-xs rounded-lg border border-purple-200 bg-white/95 px-3 py-2 text-xs shadow-md">
        <div className="font-extrabold uppercase tracking-wide text-purple-700">Transit On Demand only</div>
        <div className="mt-0.5 text-[11px] leading-snug text-gray-500">
          Pickup demand map; fixed-route ridership is not included.
        </div>
      </div>
      {selectedStop && (
        <div className="absolute left-2 top-2 z-[1000] w-72 rounded-lg border border-gray-200 bg-white/95 p-3 shadow-lg">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-bold leading-tight text-gray-900">{selectedStop.name}</div>
              <div className="mt-1 text-[10px] uppercase tracking-wide text-gray-400">Transit On Demand pickups</div>
            </div>
            <button type="button" onClick={() => setSelectedStop(null)} className="text-gray-400 hover:text-gray-600">×</button>
          </div>
          <div className="mt-3 rounded-lg bg-amber-50 p-3 text-center">
            <div className="text-2xl font-extrabold text-amber-700">{selectedStop.pickups.toLocaleString()}</div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-amber-600">TOD pickups only</div>
          </div>
        </div>
      )}
      <MapBase
        mapRef={mapRef}
        latitude={BARRIE_CENTER[0]}
        longitude={BARRIE_CENTER[1]}
        zoom={12}
        showNavigation
        onLoad={() => setMapReady(true)}
        interactiveLayerIds={[TOD_PICKUP_LAYER_ID]}
        onMouseMove={handleMapMouseMove}
        onMouseLeave={handleMapMouseLeave}
        onClick={handleMapClick}
        style={{ borderRadius: '0.5rem' }}
      >
        <HeatmapDotLayer
          idPrefix="tod-pickup"
          points={renderedStops.map(stop => ({
            id: stop.id,
            lat: stop.lat,
            lon: stop.lon,
            value: stop.pickups,
          }))}
          bins={BINS}
          outlineColor={OUTLINE_COLOR}
        />
        <Source id="tod-pickup-labels-src" type="geojson" data={labelGeoJSON}>
          <Layer
            id="tod-pickup-labels-major"
            type="symbol"
            minzoom={14}
            filter={['>=', ['get', 'bin'], 4] as unknown as mapboxgl.FilterSpecification}
            layout={{
              'text-field': ['get', 'name'] as mapboxgl.Expression,
              'text-size': 10,
              'text-anchor': 'left',
              'text-offset': [0.9, 0.35],
              'text-allow-overlap': false,
              'symbol-sort-key': ['get', 'sortKey'] as mapboxgl.Expression,
            }}
            paint={{
              'text-color': '#374151',
              'text-halo-color': '#ffffff',
              'text-halo-width': 1.8,
              'text-halo-blur': 0.6,
            }}
          />
        </Source>
        {hoveredStop && (
          <Popup
            longitude={hoverInfo?.longitude ?? hoveredStop.lon}
            latitude={hoverInfo?.latitude ?? hoveredStop.lat}
            closeButton={false}
            closeOnClick={false}
            anchor="bottom"
            offset={8}
          >
            <div style={{ fontSize: 12, lineHeight: 1.4 }}>
              <strong>{hoveredStop.name}</strong>
              <br />
              Pickups: {hoveredStop.pickups.toLocaleString()}
            </div>
          </Popup>
        )}
      </MapBase>
    </div>
  );
};
