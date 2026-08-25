import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layer, Popup, Source } from 'react-map-gl/mapbox';
import type { MapMouseEvent, MapRef } from 'react-map-gl/mapbox';
import { HeatmapDotLayer, MapBase, toGeoJSON } from '../shared';
import { getTodActivityValue, type TodActivityMetric } from '../../utils/todPickupAggregation';
import type { TodDailyKpiLocation } from '../../utils/todPickupTypes';

interface TodActivityMapProps {
  locations: TodDailyKpiLocation[];
  metric: TodActivityMetric;
}

interface RenderedLocation extends TodDailyKpiLocation {
  bin: number;
  sortKey: number;
  value: number;
}

interface HoverInfo {
  locationId: string;
  latitude: number;
  longitude: number;
}

const BARRIE_CENTER: [number, number] = [44.38, -79.69];
const TOD_ACTIVITY_LAYER_ID = 'tod-activity-circles';
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

function hasValidCoords(location: TodDailyKpiLocation): boolean {
  return Number.isFinite(location.lat) && Number.isFinite(location.lon);
}

function metricLabel(metric: TodActivityMetric): string {
  if (metric === 'pickups') return 'pickups';
  if (metric === 'dropoffs') return 'drop-offs';
  return 'activity';
}

function metricTitle(metric: TodActivityMetric): string {
  if (metric === 'pickups') return 'Pickups';
  if (metric === 'dropoffs') return 'Drop-offs';
  return 'Activity';
}

const Legend: React.FC<{ metric: TodActivityMetric }> = ({ metric }) => (
  <div className="absolute bottom-6 left-2 z-[1000] rounded-lg border border-gray-200 bg-white/95 px-2.5 py-2 text-[10px] shadow-md">
    <div className="mb-1 text-[11px] font-bold text-gray-600">TOD {metricLabel(metric)}</div>
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

export const TodActivityMap: React.FC<TodActivityMapProps> = ({ locations, metric }) => {
  const mapRef = useRef<MapRef | null>(null);
  const hasFittedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<TodDailyKpiLocation | null>(null);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const label = metricLabel(metric);

  const renderedLocations = useMemo(() => {
    const mappable = locations.filter(hasValidCoords);
    const values = mappable.map(location => getTodActivityValue(location, metric));
    const bins = assignBins(values);
    return mappable
      .map((location, index) => ({
        ...location,
        value: values[index],
        bin: bins[index],
        sortKey: index,
      }))
      .sort((a, b) => a.bin - b.bin) as RenderedLocation[];
  }, [locations, metric]);

  const renderedLocationMap = useMemo(
    () => new Map(renderedLocations.map(location => [location.id, location])),
    [renderedLocations],
  );

  const labelGeoJSON = useMemo((): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: renderedLocations.map(location => ({
      type: 'Feature',
      properties: { id: location.id, name: location.name, bin: location.bin, sortKey: location.sortKey },
      geometry: { type: 'Point', coordinates: toGeoJSON([location.lat, location.lon]) },
    })),
  }), [renderedLocations]);

  const hoveredLocation = hoverInfo ? renderedLocationMap.get(hoverInfo.locationId) ?? null : null;

  const handleMapMouseMove = useCallback((event: MapMouseEvent) => {
    const rawId = event.features?.[0]?.properties?.id;
    const locationId = rawId == null || Array.isArray(rawId) ? null : String(rawId);
    if (!locationId || !renderedLocationMap.has(locationId)) {
      setHoverInfo(null);
      mapRef.current?.getMap().getCanvas().style.setProperty('cursor', '');
      return;
    }

    const location = renderedLocationMap.get(locationId)!;
    setHoverInfo({ locationId, latitude: location.lat, longitude: location.lon });
    mapRef.current?.getMap().getCanvas().style.setProperty('cursor', 'pointer');
  }, [renderedLocationMap]);

  const handleMapMouseLeave = useCallback(() => {
    setHoverInfo(null);
    mapRef.current?.getMap().getCanvas().style.setProperty('cursor', '');
  }, []);

  const handleMapClick = useCallback((event: MapMouseEvent) => {
    const rawId = event.features?.[0]?.properties?.id;
    const locationId = rawId == null || Array.isArray(rawId) ? null : String(rawId);
    if (!locationId) return;
    const location = renderedLocationMap.get(locationId);
    if (location) setSelectedLocation(location);
  }, [renderedLocationMap]);

  useEffect(() => {
    hasFittedRef.current = false;
    setSelectedLocation(null);
    setHoverInfo(null);
  }, [locations, metric]);

  useEffect(() => {
    if (!mapReady || renderedLocations.length === 0 || hasFittedRef.current) return;
    mapRef.current?.fitBounds(
      [
        [Math.min(...renderedLocations.map(location => location.lon)), Math.min(...renderedLocations.map(location => location.lat))],
        [Math.max(...renderedLocations.map(location => location.lon)), Math.max(...renderedLocations.map(location => location.lat))],
      ],
      { padding: 40, duration: 0 },
    );
    hasFittedRef.current = true;
  }, [mapReady, renderedLocations]);

  if (renderedLocations.length === 0) {
    return (
      <div className="grid h-[520px] place-items-center rounded-lg border border-dashed border-amber-300 bg-amber-50 p-6 text-center">
        <div>
          <div className="text-sm font-bold text-amber-900">No mappable TOD activity</div>
          <p className="mt-1 text-sm text-amber-800">The selected daily reports do not contain usable location coordinates.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-[620px] w-full overflow-hidden rounded-lg">
      <Legend metric={metric} />
      <div className="absolute right-2 top-2 z-[1000] max-w-xs rounded-lg border border-purple-200 bg-white/95 px-3 py-2 text-xs shadow-md">
        <div className="font-extrabold uppercase tracking-wide text-purple-700">Transit On Demand only</div>
        <div className="mt-0.5 text-[11px] leading-snug text-gray-500">
          Daily {label} for the selected Ridership period; fixed-route boardings are not included.
        </div>
      </div>
      {selectedLocation && (
        <div className="absolute left-2 top-2 z-[1000] w-72 rounded-lg border border-gray-200 bg-white/95 p-3 shadow-lg">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-bold leading-tight text-gray-900">{selectedLocation.name}</div>
              <div className="mt-1 text-[10px] uppercase tracking-wide text-gray-400">Transit On Demand {label}</div>
            </div>
            <button type="button" onClick={() => setSelectedLocation(null)} className="text-gray-400 hover:text-gray-600" aria-label="Close location details">×</button>
          </div>
          <div className="mt-3 rounded-lg bg-amber-50 p-3 text-center">
            <div className="text-2xl font-extrabold text-amber-700">
              {getTodActivityValue(selectedLocation, metric).toLocaleString()}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-amber-600">TOD {label}</div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-center text-xs">
            <div className="rounded-md bg-gray-50 px-2 py-1.5 text-gray-600">Pickups <strong className="text-gray-900">{selectedLocation.pickups.toLocaleString()}</strong></div>
            <div className="rounded-md bg-gray-50 px-2 py-1.5 text-gray-600">Drop-offs <strong className="text-gray-900">{selectedLocation.dropoffs.toLocaleString()}</strong></div>
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
        interactiveLayerIds={[TOD_ACTIVITY_LAYER_ID]}
        onMouseMove={handleMapMouseMove}
        onMouseLeave={handleMapMouseLeave}
        onClick={handleMapClick}
        style={{ borderRadius: '0.5rem' }}
      >
        <HeatmapDotLayer
          idPrefix="tod-activity"
          points={renderedLocations.map(location => ({
            id: location.id,
            lat: location.lat,
            lon: location.lon,
            value: location.value,
          }))}
          bins={BINS}
          outlineColor={OUTLINE_COLOR}
        />
        <Source id="tod-activity-labels-src" type="geojson" data={labelGeoJSON}>
          <Layer
            id="tod-activity-labels-major"
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
        {hoveredLocation && (
          <Popup
            longitude={hoverInfo?.longitude ?? hoveredLocation.lon}
            latitude={hoverInfo?.latitude ?? hoveredLocation.lat}
            closeButton={false}
            closeOnClick={false}
            anchor="bottom"
            offset={8}
          >
            <div style={{ fontSize: 12, lineHeight: 1.4 }}>
              <strong>{hoveredLocation.name}</strong>
              <br />
              {metricTitle(metric)}: {hoveredLocation.value.toLocaleString()}
              <br />
              <span style={{ color: '#6b7280' }}>Pickups {hoveredLocation.pickups.toLocaleString()} · Drop-offs {hoveredLocation.dropoffs.toLocaleString()}</span>
            </div>
          </Popup>
        )}
      </MapBase>
    </div>
  );
};
