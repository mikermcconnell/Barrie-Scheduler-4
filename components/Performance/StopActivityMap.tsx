import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layer, Popup, Source } from 'react-map-gl/mapbox';
import type { MapMouseEvent, MapRef } from 'react-map-gl/mapbox';
import type { StopMetrics } from '../../utils/performanceDataTypes';
import { findStopCoords } from '../../utils/gtfs/gtfsStopLookup';
import { loadGtfsRouteShapes } from '../../utils/gtfs/gtfsShapesLoader';
import {
  getStopActivityBreakdown,
  getStopRouteActivityBreakdown,
  getStopActivityValue,
  hasHourlyDataForStops,
  matchesStopSearch,
} from '../../utils/performanceStopActivity';
import { HeatmapDotLayer, LassoControl, MapBase, RouteOverlay, toGeoJSON, pointInPolygon } from '../shared';

interface StopActivityMapProps { stops: StopMetrics[]; }
type ViewMode = 'total' | 'boardings' | 'alightings';
interface EnrichedStop extends StopMetrics { activity: number; filteredBoardings: number; filteredAlightings: number; }
interface RenderedStop extends EnrichedStop { bin: number; sortKey: number; }
interface HoverInfo { stopId: string; latitude: number; longitude: number; }

const BARRIE_CENTER: [number, number] = [44.38, -79.69];
const OUTLINE_COLOR = '#374151';
const STOP_CIRCLE_LAYER_ID = 'stop-activity-circles';
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
const HOUR_PRESETS = [
  { label: 'Early AM', detail: '5-6 AM', hours: [5, 6] },
  { label: 'AM Peak', detail: '7-9 AM', hours: [7, 8, 9] },
  { label: 'Midday', detail: '10 AM-2 PM', hours: [10, 11, 12, 13, 14] },
  { label: 'PM Peak', detail: '3-6 PM', hours: [15, 16, 17, 18] },
  { label: 'Evening', detail: '7-9 PM', hours: [19, 20, 21] },
  { label: 'Late Night', detail: '10 PM-1 AM', hours: [22, 23, 0, 1] },
] as const;
const BARRIE_COORD_BOUNDS = {
  minLat: 44.2,
  maxLat: 44.55,
  minLon: -79.9,
  maxLon: -79.5,
} as const;

function zoomScale(zoom: number): number {
  return Math.max(0.3, Math.min(Math.pow(2, (zoom - 14) * 0.5), 2));
}

function assignBins(activities: number[]): number[] {
  const nonZero = activities.filter((a) => a > 0);
  if (nonZero.length === 0) return activities.map(() => 0);
  const logMax = Math.log(Math.max(...nonZero) + 1);
  if (logMax === 0) return activities.map((a) => (a > 0 ? 1 : 0));
  return activities.map((a) => (a === 0 ? 0 : Math.max(1, Math.min(9, Math.ceil((Math.log(a + 1) / logMax) * 9)))));
}

function hasUsableBarrieCoords(lat: number, lon: number): boolean {
  return Number.isFinite(lat)
    && Number.isFinite(lon)
    && lat >= BARRIE_COORD_BOUNDS.minLat
    && lat <= BARRIE_COORD_BOUNDS.maxLat
    && lon >= BARRIE_COORD_BOUNDS.minLon
    && lon <= BARRIE_COORD_BOUNDS.maxLon;
}

const Legend = () => (
  <div className="absolute bottom-6 left-2 z-[1000] bg-white/95 rounded-lg shadow-md border border-gray-200 px-2.5 py-2 text-[10px] pointer-events-auto">
    <div className="font-bold text-gray-600 mb-1 text-[11px]">Activity</div>
    {BINS.map((bin, i) => (
      <div key={i} className="flex items-center gap-1.5 py-[1px]">
        <span className="inline-block w-3 h-3 rounded-full border" style={{ backgroundColor: bin.fill === 'transparent' ? 'white' : bin.fill, borderColor: OUTLINE_COLOR, borderWidth: i === 0 ? 1.5 : 1, opacity: i === 0 ? 0.5 : bin.fillOpacity + 0.1 }} />
        <span className="text-gray-500">{bin.label}</span>
      </div>
    ))}
  </div>
);

const LassoSummaryPanel = ({ selected, onClose }: { selected: EnrichedStop[]; onClose: () => void }) => {
  const totalB = selected.reduce((s, x) => s + x.filteredBoardings, 0);
  const totalA = selected.reduce((s, x) => s + x.filteredAlightings, 0);
  return <div className="absolute top-2 left-2 z-[1000] bg-white/95 rounded-lg shadow-lg border border-gray-200 w-80 p-3 pointer-events-auto"><div className="flex items-start justify-between"><div><div className="font-bold text-sm">Lasso Selection</div><div className="text-[10px] text-gray-400">{selected.length} stops selected</div></div><button onClick={onClose} className="text-gray-400 hover:text-gray-600">x</button></div><div className="grid grid-cols-3 gap-2 mt-3 text-center"><div><div className="text-xs font-bold text-cyan-600">{totalB.toLocaleString()}</div><div className="text-[9px] text-gray-400 uppercase">Boardings</div></div><div><div className="text-xs font-bold text-purple-600">{totalA.toLocaleString()}</div><div className="text-[9px] text-gray-400 uppercase">Alightings</div></div><div><div className="text-xs font-bold text-gray-800">{(totalB + totalA).toLocaleString()}</div><div className="text-[9px] text-gray-400 uppercase">Total</div></div></div></div>;
};

const DetailPanel = ({ stop, rank, total, activeHours, onClose }: { stop: EnrichedStop; rank: number; total: number; activeHours: number[] | null; onClose: () => void }) => {
  const routeRows = getStopRouteActivityBreakdown(stop, activeHours);
  const hourlyData = Array.from({ length: 24 }, (_, h) => ({ b: stop.hourlyBoardings?.[h] || 0, a: stop.hourlyAlightings?.[h] || 0 }));
  const maxHourly = Math.max(...hourlyData.map((d) => d.b + d.a), 1);
  return <div className="absolute top-2 left-2 z-[1000] bg-white/95 rounded-lg shadow-lg border border-gray-200 w-72 pointer-events-auto"><div className="flex items-start justify-between px-3 pt-2.5 pb-1"><div><div className="font-bold text-sm leading-tight">{stop.stopName}</div><div className="text-[10px] text-gray-400">Stop {stop.stopId} · #{rank} of {total}</div></div><button onClick={onClose} className="text-gray-400 hover:text-gray-600">x</button></div><div className="grid grid-cols-3 gap-2 px-3 py-2 border-t border-gray-100 text-center"><div><div className="text-xs font-bold text-cyan-600">{stop.filteredBoardings.toLocaleString()}</div><div className="text-[9px] text-gray-400 uppercase">Boardings</div></div><div><div className="text-xs font-bold text-purple-600">{stop.filteredAlightings.toLocaleString()}</div><div className="text-[9px] text-gray-400 uppercase">Alightings</div></div><div><div className="text-xs font-bold text-gray-800">{(stop.filteredBoardings + stop.filteredAlightings).toLocaleString()}</div><div className="text-[9px] text-gray-400 uppercase">Total</div></div></div><div className="px-3 py-2 border-t border-gray-100"><div className="text-[9px] text-gray-400 uppercase mb-1">Ridership by Route</div><table className="w-full text-[10px]"><tbody>{routeRows.slice(0, 6).map((row) => <tr key={row.routeId}><td className="py-0.5 text-gray-700 font-semibold">Route {row.routeId}</td><td className="py-0.5 text-right text-gray-700 tabular-nums">{row.total.toLocaleString()}</td></tr>)}</tbody></table></div><div className="px-3 py-2 border-t border-gray-100"><div className="text-[9px] text-gray-400 uppercase mb-1">Hourly Pattern</div><svg width="100%" height="40" viewBox="0 0 240 40" preserveAspectRatio="none">{hourlyData.map((d, h) => { const barH = ((d.b + d.a) / maxHourly) * 36; return <rect key={h} x={h * 10} y={40 - barH} width="8" height={barH} rx="1" fill={d.b + d.a > 0 ? '#06b6d4' : '#e5e7eb'} opacity="0.8" />; })}</svg></div></div>;
};

export const StopActivityMap: React.FC<StopActivityMapProps> = ({ stops }) => {
  const mapRef = useRef<MapRef | null>(null);
  const hasFittedRef = useRef(false);
  const playHourRef = useRef(5);
  const [mapReady, setMapReady] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('total');
  const [selectedRoute, setSelectedRoute] = useState('all');
  const [selectedStop, setSelectedStop] = useState<EnrichedStop | null>(null);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [searchPreviewStopId, setSearchPreviewStopId] = useState<string | null>(null);
  const [activeHours, setActiveHours] = useState<number[] | null>(null);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [showRouteLines, setShowRouteLines] = useState(true);
  const [lassoMode, setLassoMode] = useState(false);
  const [lassoSelection, setLassoSelection] = useState<EnrichedStop[] | null>(null);
  const [bottomNFilter, setBottomNFilter] = useState<number | null>(null);

  const enrichedStops = useMemo(() => stops.map((stop) => {
    const gtfs = findStopCoords(stop.stopId, stop.stopName);
    if (gtfs) {
      return { ...stop, lat: gtfs.lat, lon: gtfs.lon };
    }

    if (hasUsableBarrieCoords(stop.lat, stop.lon)) {
      return stop;
    }

    return { ...stop, lat: Number.NaN, lon: Number.NaN };
  }), [stops]);
  const hasHourlyData = useMemo(() => hasHourlyDataForStops(enrichedStops), [enrichedStops]);
  const availableRoutes = useMemo(() => Array.from(new Set(enrichedStops.flatMap((stop) => stop.routes || []))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [enrichedStops]);
  const routeShapes = useMemo(() => { try { return loadGtfsRouteShapes(); } catch { return []; } }, []);
  const filteredStops = useMemo(() => {
    let result = enrichedStops.filter((stop) => hasUsableBarrieCoords(stop.lat, stop.lon));
    if (selectedRoute !== 'all') result = result.filter((stop) => stop.routes?.includes(selectedRoute));
    return result.map((stop) => {
      const filtered = getStopActivityBreakdown(stop, activeHours);
      return { ...stop, filteredBoardings: filtered.boardings, filteredAlightings: filtered.alightings, activity: getStopActivityValue(stop, viewMode, activeHours) };
    }) as EnrichedStop[];
  }, [activeHours, enrichedStops, selectedRoute, viewMode]);
  const displayedStops = useMemo(() => bottomNFilter === null ? filteredStops : [...filteredStops.filter((stop) => stop.activity > 0)].sort((a, b) => a.activity - b.activity).slice(0, bottomNFilter), [bottomNFilter, filteredStops]);
  const rankedDisplayedStops = useMemo(() => [...displayedStops].sort((a, b) => b.activity - a.activity), [displayedStops]);
  const searchResults = useMemo(() => !searchQuery.trim() ? [] : filteredStops.filter((stop) => matchesStopSearch(stop, searchQuery)).sort((a, b) => b.activity - a.activity).slice(0, 8), [filteredStops, searchQuery]);
  const renderedStops = useMemo(() => {
    const bins = assignBins(displayedStops.map((stop) => stop.activity));
    return displayedStops.map((stop, index) => ({ ...stop, bin: bins[index], sortKey: index })).sort((a, b) => a.bin - b.bin) as RenderedStop[];
  }, [displayedStops]);
  const renderedStopMap = useMemo(() => new Map(renderedStops.map((stop) => [stop.stopId, stop])), [renderedStops]);
  const stopGeoJSON = useMemo((): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: renderedStops.map((stop) => ({ type: 'Feature', properties: { id: stop.stopId, name: stop.stopName, bin: stop.bin, sortKey: stop.sortKey }, geometry: { type: 'Point', coordinates: toGeoJSON([stop.lat, stop.lon]) } })) }), [renderedStops]);
  const routeShapesForDisplay = useMemo(() => !showRouteLines ? [] : selectedRoute === 'all' ? routeShapes : routeShapes.filter((shape) => shape.routeId === selectedRoute || shape.routeShortName === selectedRoute), [routeShapes, selectedRoute, showRouteLines]);
  const hoveredStop = hoverInfo ? renderedStopMap.get(hoverInfo.stopId) ?? null : null;
  const selectedRank = selectedStop ? rankedDisplayedStops.findIndex((stop) => stop.stopId === selectedStop.stopId) + 1 : 0;

  const zoomScaleExpr = useMemo(() => ['interpolate', ['linear'], ['zoom'], 10, zoomScale(10), 14, 1, 18, zoomScale(18)] as mapboxgl.Expression, []);
  const labelLayout = useMemo(() => ({ 'text-field': ['get', 'name'] as mapboxgl.Expression, 'text-size': 9, 'text-anchor': 'left' as const, 'text-offset': [0.9, 0.35] as [number, number], 'text-allow-overlap': false, 'symbol-sort-key': ['get', 'sortKey'] as mapboxgl.Expression }), []);
  const labelPaint = useMemo(() => ({ 'text-color': '#374151', 'text-halo-color': '#ffffff', 'text-halo-width': 1.8, 'text-halo-blur': 0.6 }), []);
  const ringGeoJSON = useCallback((stop: EnrichedStop | null, extra: number) => !stop ? null : ({ type: 'FeatureCollection' as const, features: [{ type: 'Feature' as const, properties: { radiusBase: ((renderedStopMap.get(stop.stopId)?.bin ?? 5) === 0 ? 14 : BINS[renderedStopMap.get(stop.stopId)?.bin ?? 5].radius) + extra }, geometry: { type: 'Point' as const, coordinates: toGeoJSON([stop.lat, stop.lon]) } }] }), [renderedStopMap]);
  const selectedRing = useMemo(() => ringGeoJSON(selectedStop, 6), [ringGeoJSON, selectedStop]);
  const previewRing = useMemo(() => ringGeoJSON(searchPreviewStopId ? filteredStops.find((stop) => stop.stopId === searchPreviewStopId) ?? null : null, 6), [filteredStops, ringGeoJSON, searchPreviewStopId]);
  const lassoRing = useMemo(() => !lassoSelection ? null : ({ type: 'FeatureCollection' as const, features: lassoSelection.map((stop) => ({ type: 'Feature' as const, properties: { radiusBase: ((renderedStopMap.get(stop.stopId)?.bin ?? 5) === 0 ? 14 : BINS[renderedStopMap.get(stop.stopId)?.bin ?? 5].radius) + 4 }, geometry: { type: 'Point' as const, coordinates: toGeoJSON([stop.lat, stop.lon]) } })) }), [lassoSelection, renderedStopMap]);

  const clearLassoSelection = useCallback(() => setLassoSelection(null), []);
  const toggleFullscreen = useCallback(() => setIsFullscreen((prev) => !prev), []);
  const toggleLassoMode = useCallback(() => setLassoMode((prev) => { const next = !prev; if (next) { setSelectedStop(null); setHoverInfo(null); setSearchPreviewStopId(null); setLassoSelection(null); } else { setLassoSelection(null); } return next; }), []);
  const flyToStop = useCallback((stop: EnrichedStop) => { mapRef.current?.flyTo({ center: [stop.lon, stop.lat], zoom: 16, duration: 500 }); setSelectedStop(stop); setHoverInfo(null); setSearchPreviewStopId(null); setSearchFocused(false); setSearchQuery(''); }, []);
  const handleMapLoad = useCallback(() => setMapReady(true), []);
  const handleMapMouseMove = useCallback((event: MapMouseEvent) => {
    if (lassoMode) return;
    const rawId = event.features?.[0]?.properties?.id;
    const stopId = rawId == null || Array.isArray(rawId) ? null : String(rawId);
    if (!stopId || !renderedStopMap.has(stopId)) { setHoverInfo(null); mapRef.current?.getMap().getCanvas().style.setProperty('cursor', ''); return; }
    const stop = renderedStopMap.get(stopId)!;
    setHoverInfo({ stopId, latitude: stop.lat, longitude: stop.lon });
    mapRef.current?.getMap().getCanvas().style.setProperty('cursor', 'pointer');
  }, [lassoMode, renderedStopMap]);
  const handleMapMouseLeave = useCallback(() => { setHoverInfo(null); mapRef.current?.getMap().getCanvas().style.setProperty('cursor', ''); }, []);
  const handleMapClick = useCallback((event: MapMouseEvent) => { if (lassoMode) return; const rawId = event.features?.[0]?.properties?.id; const stopId = rawId == null || Array.isArray(rawId) ? null : String(rawId); if (!stopId) return; const stop = renderedStopMap.get(stopId); if (stop) setSelectedStop(stop); }, [lassoMode, renderedStopMap]);
  const handleLassoComplete = useCallback((polygon: [number, number][]) => { const hits = displayedStops.filter((stop) => pointInPolygon(stop.lat, stop.lon, polygon)); setLassoSelection(hits.length > 0 ? hits : null); }, [displayedStops]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (lassoSelection) { clearLassoSelection(); return; }
      if (lassoMode) { setLassoMode(false); return; }
      if (isFullscreen) setIsFullscreen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [clearLassoSelection, isFullscreen, lassoMode, lassoSelection]);
  useEffect(() => {
    const resize = () => mapRef.current?.getMap().resize();
    const raf = requestAnimationFrame(resize);
    const t1 = setTimeout(resize, 100);
    const t2 = setTimeout(resize, 300);
    return () => { cancelAnimationFrame(raf); clearTimeout(t1); clearTimeout(t2); };
  }, [isFullscreen]);
  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      const next = playHourRef.current + 1;
      if (next > 23) { setIsPlaying(false); setActiveHours(null); setActivePreset(null); playHourRef.current = 5; return; }
      playHourRef.current = next; setActiveHours([next]); setActivePreset(null);
    }, 800);
    return () => clearInterval(timer);
  }, [isPlaying]);
  useEffect(() => { setHoverInfo(null); setLassoSelection(null); }, [displayedStops]);
  useEffect(() => {
    if (!selectedStop) return;
    const nextSelected = displayedStops.find((stop) => stop.stopId === selectedStop.stopId);
    if (!nextSelected) { setSelectedStop(null); return; }
    if (nextSelected !== selectedStop) setSelectedStop(nextSelected);
  }, [displayedStops, selectedStop]);
  useEffect(() => {
    if (!mapReady || displayedStops.length === 0 || hasFittedRef.current) return;
    const boundsStops = enrichedStops.filter((stop) => hasUsableBarrieCoords(stop.lat, stop.lon));
    const target = boundsStops.length > 0 ? boundsStops : displayedStops;
    mapRef.current?.fitBounds([[Math.min(...target.map((stop) => stop.lon as number)), Math.min(...target.map((stop) => stop.lat as number))], [Math.max(...target.map((stop) => stop.lon as number)), Math.max(...target.map((stop) => stop.lat as number))]], { padding: 20, duration: 0 });
    hasFittedRef.current = true;
  }, [displayedStops, enrichedStops, mapReady]);

  return (
    <div className={isFullscreen ? 'fixed inset-0 z-50 bg-white flex flex-col' : 'relative'}>
      <div className="absolute top-2 left-12 right-2 z-[1000] flex flex-wrap items-center gap-2 pointer-events-none">
        <div className="relative pointer-events-auto">
          <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onFocus={() => setSearchFocused(true)} onBlur={() => setTimeout(() => setSearchFocused(false), 200)} placeholder="Search stops..." className="w-48 px-2.5 py-1.5 text-xs bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-cyan-400 focus:border-cyan-400" />
          {searchFocused && searchResults.length > 0 && <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-y-auto">{searchResults.map((stop) => <button key={stop.stopId} onMouseDown={() => flyToStop(stop)} onMouseEnter={() => setSearchPreviewStopId(stop.stopId)} onMouseLeave={() => setSearchPreviewStopId(null)} className="w-full text-left px-3 py-1.5 hover:bg-cyan-50 border-b border-gray-50 last:border-b-0"><span className="text-xs font-medium text-gray-800">{stop.stopName}</span><span className="text-[10px] text-gray-400 ml-1.5">#{stop.stopId}</span><span className="text-[10px] text-gray-400 float-right">{stop.activity.toLocaleString()}</span></button>)}</div>}
        </div>
        <div className="flex bg-white rounded-md border border-gray-300 shadow-sm overflow-hidden pointer-events-auto">{(['total', 'boardings', 'alightings'] as ViewMode[]).map((mode) => <button key={mode} onClick={() => setViewMode(mode)} className={`px-2.5 py-1.5 text-[10px] font-bold uppercase transition-colors ${viewMode === mode ? 'bg-cyan-50 text-cyan-700' : 'text-gray-500 hover:bg-gray-50'}`}>{mode === 'total' ? 'Total' : mode === 'boardings' ? 'Board' : 'Alight'}</button>)}</div>
        {availableRoutes.length > 0 && <select value={selectedRoute} onChange={(e) => setSelectedRoute(e.target.value)} className="px-2 py-1.5 text-xs bg-white border border-gray-300 rounded-md shadow-sm pointer-events-auto focus:outline-none focus:ring-1 focus:ring-cyan-400"><option value="all">All Routes</option>{availableRoutes.map((route) => <option key={route} value={route}>Route {route}</option>)}</select>}
        <button onClick={() => setShowRouteLines((p) => !p)} className={`px-2.5 py-1.5 text-[10px] font-bold rounded-md border shadow-sm transition-colors pointer-events-auto ${showRouteLines ? 'bg-cyan-50 text-cyan-700 border-cyan-300' : 'bg-white text-gray-400 border-gray-300 hover:bg-gray-50'}`}>Routes</button>
        <button onClick={toggleLassoMode} className={`px-2.5 py-1.5 text-[10px] font-bold rounded-md border shadow-sm transition-colors pointer-events-auto ${lassoMode ? 'bg-amber-50 text-amber-700 border-amber-300' : 'bg-white text-gray-400 border-gray-300 hover:bg-gray-50'}`}>Lasso</button>
        <div className="flex bg-white rounded-md border border-gray-300 shadow-sm overflow-hidden pointer-events-auto"><button onClick={() => setBottomNFilter(null)} className={`px-2 py-1.5 text-[10px] font-bold transition-colors ${bottomNFilter === null ? 'bg-cyan-50 text-cyan-700' : 'text-gray-500 hover:bg-gray-50'}`}>All</button>{[10, 25].map((n) => <button key={n} onClick={() => setBottomNFilter(bottomNFilter === n ? null : n)} className={`px-2 py-1.5 text-[10px] font-bold transition-colors ${bottomNFilter === n ? 'bg-red-50 text-red-700' : 'text-gray-500 hover:bg-gray-50'}`}>Low {n}</button>)}</div>
        <div className="flex-1" />
        <button onClick={toggleFullscreen} className="bg-white border border-gray-300 rounded-md px-2 py-1.5 shadow-sm hover:bg-gray-50 transition-colors text-xs font-medium text-gray-600 pointer-events-auto">{isFullscreen ? 'Exit' : 'Fullscreen'}</button>
      </div>
      {hasHourlyData && <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000] bg-white/95 rounded-lg shadow-md border border-gray-200 px-3 py-2 pointer-events-auto" style={{ minWidth: 420 }}><div className="flex items-center gap-1.5 mb-1.5"><span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Time of Day</span><div className="flex-1" /><button onClick={() => { setActiveHours(null); setActivePreset(null); setIsPlaying(false); }} className={`text-[10px] font-bold px-1.5 py-0.5 rounded transition-colors ${activeHours === null ? 'bg-cyan-100 text-cyan-700' : 'text-gray-400 hover:text-gray-600'}`}>All Day</button>{HOUR_PRESETS.map((preset) => <button key={preset.label} onClick={() => { setActiveHours([...preset.hours]); setActivePreset(preset.label); setIsPlaying(false); }} className={`text-[10px] font-bold px-1.5 py-0.5 rounded transition-colors ${activePreset === preset.label ? 'bg-cyan-100 text-cyan-700' : 'text-gray-400 hover:text-gray-600'}`}>{preset.label}</button>)}</div><div className="flex items-center gap-2"><button onClick={() => { if (isPlaying) setIsPlaying(false); else { playHourRef.current = 4; setActivePreset(null); setIsPlaying(true); } }} className="w-6 h-6 flex items-center justify-center rounded-full bg-cyan-100 text-cyan-700 hover:bg-cyan-200 flex-shrink-0">{isPlaying ? '||' : '>'}</button><input type="range" min={0} max={23} value={activeHours?.length === 1 ? activeHours[0] : 12} onChange={(e) => { const hour = parseInt(e.target.value, 10); setActiveHours([hour]); setActivePreset(null); setIsPlaying(false); }} className="flex-1 h-1 accent-cyan-500" /><span className="text-xs font-bold text-gray-700 w-16 text-right tabular-nums">{activeHours === null ? 'All' : activeHours.length === 1 ? `${activeHours[0].toString().padStart(2, '0')}:00` : activePreset || `${activeHours[0]}-${activeHours[activeHours.length - 1]}h`}</span></div></div>}
      <Legend />
      {lassoSelection ? <LassoSummaryPanel selected={lassoSelection} onClose={clearLassoSelection} /> : selectedStop ? <DetailPanel stop={selectedStop} rank={selectedRank} total={rankedDisplayedStops.length} activeHours={activeHours} onClose={() => setSelectedStop(null)} /> : null}
      <div className={isFullscreen ? 'flex-1 w-full min-h-0' : 'h-[750px] w-full rounded-lg overflow-hidden'}>
        <MapBase mapRef={mapRef} latitude={BARRIE_CENTER[0]} longitude={BARRIE_CENTER[1]} zoom={13} showNavigation={true} onLoad={handleMapLoad} interactiveLayerIds={[STOP_CIRCLE_LAYER_ID]} onMouseMove={handleMapMouseMove} onMouseLeave={handleMapMouseLeave} onClick={handleMapClick} style={{ borderRadius: isFullscreen ? 0 : '0.5rem' }}>
          {routeShapesForDisplay.length > 0 && <RouteOverlay shapes={routeShapesForDisplay} opacity={selectedRoute === 'all' ? 0.65 : 0.85} weight={selectedRoute === 'all' ? 2.5 : 4} dashed={false} idPrefix="stop-activity-routes" />}
          <HeatmapDotLayer
            idPrefix="stop-activity"
            points={renderedStops.map((stop) => ({
              id: stop.stopId,
              lat: stop.lat,
              lon: stop.lon,
              value: stop.activity,
            }))}
            bins={BINS}
            outlineColor={OUTLINE_COLOR}
          />
          <Source id="stop-activity-labels-src" type="geojson" data={stopGeoJSON}><Layer id="stop-activity-labels-major" type="symbol" minzoom={15} maxzoom={16} filter={['>=', ['get', 'bin'], 7] as unknown as mapboxgl.FilterSpecification} layout={labelLayout} paint={labelPaint} /><Layer id="stop-activity-labels-all" type="symbol" minzoom={16} layout={labelLayout} paint={labelPaint} /></Source>
          {selectedRing && <Source id="stop-activity-selected-src" type="geojson" data={selectedRing}><Layer id="stop-activity-selected-layer" type="circle" paint={{ 'circle-radius': ['*', ['get', 'radiusBase'], zoomScaleExpr] as mapboxgl.Expression, 'circle-color': '#3b82f6', 'circle-opacity': 0.15, 'circle-stroke-color': '#3b82f6', 'circle-stroke-width': 3 }} /></Source>}
          {previewRing && <Source id="stop-activity-preview-src" type="geojson" data={previewRing}><Layer id="stop-activity-preview-layer" type="circle" paint={{ 'circle-radius': ['*', ['get', 'radiusBase'], zoomScaleExpr] as mapboxgl.Expression, 'circle-color': '#3b82f6', 'circle-opacity': 0.12, 'circle-stroke-color': '#3b82f6', 'circle-stroke-width': 2.5 }} /></Source>}
          {lassoRing && <Source id="stop-activity-lasso-src" type="geojson" data={lassoRing}><Layer id="stop-activity-lasso-layer" type="circle" paint={{ 'circle-radius': ['*', ['get', 'radiusBase'], zoomScaleExpr] as mapboxgl.Expression, 'circle-color': '#f59e0b', 'circle-opacity': 0.2, 'circle-stroke-color': '#f59e0b', 'circle-stroke-width': 2.5 }} /></Source>}
          <LassoControl active={lassoMode} onComplete={handleLassoComplete} onClear={clearLassoSelection} />
          {hoveredStop && !lassoMode && <Popup longitude={hoverInfo?.longitude ?? hoveredStop.lon} latitude={hoverInfo?.latitude ?? hoveredStop.lat} closeButton={false} closeOnClick={false} anchor="bottom" offset={8}><div style={{ fontSize: 12, lineHeight: 1.4 }}><strong>{hoveredStop.stopName}</strong> <span style={{ color: '#9ca3af' }}>({hoveredStop.stopId})</span><br />Boardings: {hoveredStop.filteredBoardings.toLocaleString()}<br />Alightings: {hoveredStop.filteredAlightings.toLocaleString()}<br />Activity: {(hoveredStop.filteredBoardings + hoveredStop.filteredAlightings).toLocaleString()}</div></Popup>}
        </MapBase>
      </div>
    </div>
  );
};
