import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Popup, type MapRef } from 'react-map-gl/mapbox';
import { Maximize2, Minimize2 } from 'lucide-react';
import { MapBase } from '../shared/MapBase';
import { HeatmapDotLayer, type HeatmapBin } from '../shared/HeatmapDotLayer';
import type { SpecializedTransitLocationV1 } from '../../utils/specialized-transit/types';

export interface SpecializedTransitMapPoint {
  location: SpecializedTransitLocationV1;
  pickups: number;
  dropoffs: number;
}

type MapMetric = 'activity' | 'pickups' | 'dropoffs';

const BINS: readonly HeatmapBin[] = [
  { fill: 'transparent', fillOpacity: 0, radius: 5, label: 'No activity' },
  { fill: '#BAE6FD', fillOpacity: 0.72, radius: 7, label: 'Lower' },
  { fill: '#67E8F9', fillOpacity: 0.76, radius: 10, label: 'Low' },
  { fill: '#22D3EE', fillOpacity: 0.8, radius: 13, label: 'Moderate' },
  { fill: '#0EA5E9', fillOpacity: 0.84, radius: 17, label: 'High' },
  { fill: '#075985', fillOpacity: 0.9, radius: 22, label: 'Highest' },
];

const valueFor = (point: SpecializedTransitMapPoint, metric: MapMetric) => (
  metric === 'pickups' ? point.pickups : metric === 'dropoffs' ? point.dropoffs : point.pickups + point.dropoffs
);

export const SpecializedTransitMap: React.FC<{ points: SpecializedTransitMapPoint[] }> = ({ points }) => {
  const [metric, setMetric] = useState<MapMetric>('activity');
  const [search, setSearch] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tableMode, setTableMode] = useState<'top' | 'all'>('top');
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState('');
  const containerRef = useRef<HTMLElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapRef>(null);
  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => mapRef.current?.resize());
    if (mapContainerRef.current) observer?.observe(mapContainerRef.current);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      observer?.disconnect();
    };
  }, []);
  const toggleFullscreen = async () => {
    setFullscreenError('');
    try {
      if (document.fullscreenElement === containerRef.current) await document.exitFullscreen();
      else await containerRef.current?.requestFullscreen();
    } catch {
      setFullscreenError('Full screen is unavailable in this browser.');
    }
  };
  const filteredPoints = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('en-CA');
    return points.filter(point => !query || [point.location.displayName, ...point.location.aliases].some(name => name.toLocaleLowerCase('en-CA').includes(query)));
  }, [points, search]);
  const hasCoordinates = (point: SpecializedTransitMapPoint) => Number.isFinite(point.location.latitude) && Number.isFinite(point.location.longitude);
  const mappedPoints = filteredPoints.filter(hasCoordinates);
  const activePoint = mappedPoints.find(point => point.location.id === (selectedId ?? hoveredId)) ?? null;
  const rankedPoints = [...filteredPoints].sort((a, b) => valueFor(b, metric) - valueFor(a, metric) || a.location.displayName.localeCompare(b.location.displayName));
  const tablePoints = tableMode === 'top' ? rankedPoints.slice(0, 10) : rankedPoints;
  const selectPoint = (point: SpecializedTransitMapPoint) => {
    if (!hasCoordinates(point)) return;
    setSelectedId(point.location.id);
    mapRef.current?.flyTo({ center: [point.location.longitude!, point.location.latitude!], zoom: 15, duration: 900 });
  };

  return (
    <section ref={containerRef} aria-label="Common-location activity map" className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm ${fullscreen ? 'flex h-screen w-screen flex-col overflow-auto' : ''}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-bold text-gray-900">Common-location activity</h3>
          <p className="mt-1 text-xs text-gray-500">Bubble activity is pickup plus drop-off endpoint touches. A named-to-named booking contributes two touches.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search locations" aria-label="Search specialized transit locations" className="min-h-10 rounded-lg border border-gray-200 px-3 text-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100" />
          <div className="flex overflow-hidden rounded-lg border border-gray-200">
            {(['activity', 'pickups', 'dropoffs'] as MapMetric[]).map(option => (
              <button key={option} type="button" aria-pressed={metric === option} onClick={() => setMetric(option)} className={`min-h-10 px-3 text-xs font-bold capitalize ${metric === option ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>{option}</button>
            ))}
          </div>
          <button type="button" onClick={() => void toggleFullscreen()} aria-pressed={fullscreen} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-gray-200 px-3 text-xs font-bold text-gray-700 hover:bg-gray-50">
            {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}{fullscreen ? 'Exit full screen' : 'Full screen'}
          </button>
        </div>
      </div>
      {fullscreenError && <p role="status" className="mt-2 text-xs text-amber-700">{fullscreenError}</p>}
      <div className={`mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px] ${fullscreen ? 'min-h-0 flex-1' : ''}`}>
      <div ref={mapContainerRef} className={`overflow-hidden rounded-xl border border-gray-200 ${fullscreen ? 'min-h-[300px] h-[45vh] lg:h-full' : 'h-[480px] lg:h-[620px]'}`}>
        <MapBase mapRef={mapRef} zoom={12.5} showNavigation showScale interactiveLayerIds={['specialized-transit-circles']} onClick={event => {
          const id = event.features?.[0]?.properties?.id;
          const point = mappedPoints.find(candidate => candidate.location.id === id);
          if (point) selectPoint(point);
          else setSelectedId(null);
        }} onMouseMove={event => {
          const id = event.features?.[0]?.properties?.id;
          setHoveredId(typeof id === 'string' ? id : null);
        }} onMouseLeave={() => setHoveredId(null)}>
          <HeatmapDotLayer idPrefix="specialized-transit" bins={BINS} points={mappedPoints.map(point => ({
            id: point.location.id,
            lat: point.location.latitude!,
            lon: point.location.longitude!,
            value: valueFor(point, metric),
            outlineColor: point.location.status === 'reviewed' ? '#374151' : '#D97706',
          }))} />
          {activePoint && (
            <Popup longitude={activePoint.location.longitude!} latitude={activePoint.location.latitude!} closeButton={selectedId !== null} closeOnClick={false} onClose={() => { setSelectedId(null); setHoveredId(null); }} anchor="bottom" offset={10}>
              <div className="text-xs leading-relaxed">
                <strong>{activePoint.location.displayName}</strong><br />
                Pickups: {activePoint.pickups.toLocaleString()}<br />
                Drop-offs: {activePoint.dropoffs.toLocaleString()}<br />
                Activity: {(activePoint.pickups + activePoint.dropoffs).toLocaleString()}<br />
                <span className={activePoint.location.status === 'reviewed' ? 'text-emerald-700' : 'text-amber-700'}>{activePoint.location.status === 'reviewed' ? 'Reviewed location' : 'Automatic location'}</span>
              </div>
            </Popup>
          )}
        </MapBase>
      </div>
      <div className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 ${fullscreen ? 'max-h-[40vh] lg:max-h-none' : 'max-h-[420px] lg:max-h-[620px]'}`}>
        <div className="flex shrink-0 gap-2 border-b border-gray-200 bg-gray-50 p-3">
          {(['top', 'all'] as const).map(mode => <button key={mode} type="button" aria-pressed={tableMode === mode} onClick={() => setTableMode(mode)} className={`min-h-10 rounded-lg px-3 text-xs font-bold ${tableMode === mode ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>{mode === 'top' ? 'Top 10 locations' : 'All locations'}</button>)}
        </div>
        <div className="min-h-0 overflow-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Locations ranked by {metric}. Select a mapped location to show it on the map.</caption>
            <thead className="sticky top-0 bg-gray-50 text-gray-500"><tr><th scope="col" className="p-3">Location</th><th scope="col" className="p-2 text-right">Pickups</th><th scope="col" className="p-2 text-right">Drop-offs</th><th scope="col" className="p-2 text-right">Activity</th></tr></thead>
            <tbody>{tablePoints.map(point => <tr key={point.location.id} className={`border-t border-gray-100 ${selectedId === point.location.id ? 'bg-cyan-50' : ''}`}>
              <td className="p-3">{hasCoordinates(point) ? <button type="button" onClick={() => selectPoint(point)} aria-label={`Show ${point.location.displayName} on map`} aria-pressed={selectedId === point.location.id} className="text-left font-semibold text-sky-700 hover:underline focus-visible:outline-sky-600">{point.location.displayName}</button> : <><span className="font-semibold text-gray-700">{point.location.displayName}</span><span className="mt-1 block text-amber-700">Location unavailable</span></>}</td>
              <td className="p-2 text-right tabular-nums">{point.pickups.toLocaleString()}</td><td className="p-2 text-right tabular-nums">{point.dropoffs.toLocaleString()}</td><td className="p-2 text-right font-semibold tabular-nums">{(point.pickups + point.dropoffs).toLocaleString()}</td>
            </tr>)}</tbody>
          </table>
          {tablePoints.length === 0 && <p className="p-4 text-sm text-gray-500">No locations match this search.</p>}
        </div>
      </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-gray-500">
        <span>{mappedPoints.length.toLocaleString()} mapped location{mappedPoints.length === 1 ? '' : 's'}</span>
        <span>{Math.max(0, filteredPoints.length - mappedPoints.length).toLocaleString()} unresolved</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full border-2 border-amber-600 bg-cyan-300" /> Automatic coordinate</span>
      </div>
    </section>
  );
};
