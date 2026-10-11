import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Marker, type MapRef } from 'react-map-gl/mapbox';
import { placeParkingLabels } from '../../utils/parking/parkingMapLabels';
import { MapBase } from '../shared/MapBase';
import { Maximize2, Minimize2 } from 'lucide-react';

export interface ParkingStrategyMapPoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  recordCount: number;
  reportedAmount: number;
}

export const ParkingStrategyMap: React.FC<{
  points: ParkingStrategyMapPoint[];
  selectedId?: string | null;
  onSelect: (id: string | undefined) => void;
  compact?: boolean;
  metric?: 'rowCount' | 'totalReportedAmount';
  onMetricChange?: (metric: 'rowCount' | 'totalReportedAmount') => void;
  periodLabel?: string;
  coverageLabel?: string;
  selection?: { name: string; recordCount: number; reportedAmount: number; mapped: boolean } | null;
  focusId?: string;
  missingCoordinateCount?: number;
  canEdit?: boolean;
  onReviewLinks?: () => void;
}> = ({ points, selectedId, onSelect, compact = false, metric = 'rowCount', onMetricChange,
  periodLabel = 'Supplied history', coverageLabel, selection, focusId, missingCoordinateCount = 0, canEdit = false, onReviewLinks }) => {
  const mapRef = useRef<MapRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState('');
  useEffect(() => {
    let resizeFrame = 0;
    const syncFullscreen = () => {
      const active = document.fullscreenElement === containerRef.current;
      setFullscreen(active);
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        mapRef.current?.resize();
        if (!active) fullscreenButtonRef.current?.focus();
      });
    };
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreen);
      cancelAnimationFrame(resizeFrame);
    };
  }, []);
  async function toggleFullscreen() {
    setFullscreenError('');
    try {
      if (document.fullscreenElement === containerRef.current) await document.exitFullscreen();
      else if (containerRef.current?.requestFullscreen) await containerRef.current.requestFullscreen();
      else setFullscreenError('Fullscreen is not supported by this browser.');
    } catch {
      setFullscreenError('Fullscreen could not be opened. Check your browser permissions and try again.');
    }
  }
  const [browseLots, setBrowseLots] = useState(false);
  const [bubbles, setBubbles] = useState(true);
  const [screen, setScreen] = useState<{ width: number; height: number; anchors: { id: string; x: number; y: number }[] }>({ width: 0, height: 0, anchors: [] });
  const [loaded, setLoaded] = useState(false);
  const validPoints = useMemo(() => points.filter(point =>
    Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90
    && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180,
  ), [points]);
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map?.getMap) return;
    const native = map.getMap();
    const update = () => {
      const canvas = native.getCanvas();
      setScreen({ width: canvas.clientWidth, height: canvas.clientHeight, anchors: validPoints.map(point => ({ id: point.id, ...map.project([point.longitude, point.latitude]) })) });
    };
    update();
    native.on('move', update);
    native.on('resize', update);
    return () => { native.off('move', update); native.off('resize', update); };
  }, [loaded, validPoints]);
  const labels = useMemo(() => placeParkingLabels(screen.anchors, screen.width, screen.height, selectedId), [screen, selectedId]);
  const amountMode = metric === 'totalReportedAmount';
  const valueOf = (point: ParkingStrategyMapPoint) => amountMode ? point.reportedAmount : point.recordCount;
  const maxMagnitude = Math.max(0, ...validPoints.map(point => Math.abs(valueOf(point))));
  const formatValue = (point: ParkingStrategyMapPoint) => amountMode
    ? point.reportedAmount.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })
    : point.recordCount.toLocaleString('en-CA');
  const fitPoints = useCallback(() => {
    if (!mapRef.current || !validPoints.length) return;
      const lngs = validPoints.map(point => point.longitude);
      const lats = validPoints.map(point => point.latitude);
      mapRef.current.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 65, maxZoom: 15, duration: 300 });
  }, [validPoints]);
  const focusPoint = useCallback((id?: string) => {
    const point = validPoints.find(item => item.id === id);
    if (point) mapRef.current?.easeTo({ center: [point.longitude, point.latitude], zoom: 15, duration: 300 });
  }, [validPoints]);
  const geometryKey = JSON.stringify(validPoints.map(({ id, latitude, longitude }) => [id, latitude, longitude]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  const lastView = useRef<{ geometry: string; focus?: string } | null>(null);
  useEffect(() => {
    if (!loaded) return;
    if (!lastView.current || lastView.current.geometry !== geometryKey) fitPoints();
    else if (lastView.current.focus !== focusId) focusPoint(focusId);
    lastView.current = { geometry: geometryKey, focus: focusId };
  }, [loaded, geometryKey, focusId, fitPoints, focusPoint]);
  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => mapRef.current?.resize());
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);
  async function reviewLinks() {
    if (document.fullscreenElement === containerRef.current) {
      try { await document.exitFullscreen(); }
      catch { setFullscreenError('Exit fullscreen to review location links.'); return; }
    }
    onReviewLinks?.();
  }
  const selectedPoint = validPoints.find(point => point.id === selectedId);
  const currentSelection = selection ?? (selectedPoint ? { ...selectedPoint, mapped: true } : null);
  const togglePoint = (id: string) => {
    if (selectedId === id) onSelect(undefined);
    else { focusPoint(id); onSelect(id); }
  };
  return (
    <div ref={containerRef} className="ps-map-interactive relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-100" style={{ height: fullscreen ? '100dvh' : compact ? 440 : 'clamp(440px, 70dvh, 680px)', width: '100%' }} aria-label={`LocoMobi ${amountMode ? 'source-reported amount' : 'payment records'} at reviewed parking locations`}>
      <button ref={fullscreenButtonRef} type="button" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? 'Exit fullscreen map' : 'View map fullscreen'} title={fullscreen ? 'Exit fullscreen (Esc)' : 'View map fullscreen'} className="absolute right-3 top-3 z-20 flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-800 shadow hover:bg-slate-100 focus-visible:outline focus-visible:outline-4 focus-visible:outline-blue-400">
        {fullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
      </button>
      {fullscreenError && <p role="alert" className="absolute bottom-12 left-3 right-16 z-20 rounded-lg bg-white p-3 text-sm text-red-700 shadow">{fullscreenError}</p>}
      <div className="shrink-0 border-b border-slate-200 bg-white py-2 pl-3 pr-16 text-xs">
        <p>LocoMobi · {periodLabel}</p>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Map measure">
          {onMetricChange ? <>{(['rowCount', 'totalReportedAmount'] as const).map(value => <button key={value} type="button" aria-pressed={metric === value} onClick={() => onMetricChange(value)} className={`min-h-11 rounded-lg px-3 font-bold ${metric === value ? 'bg-blue-100 text-blue-900' : 'text-slate-600 hover:bg-slate-100'}`}>{value === 'rowCount' ? 'Records' : 'Amount'}</button>)}</> : <strong>{amountMode ? 'Source-reported amount (CAD)' : 'Payment records'}</strong>}
          <button type="button" className="min-h-11 rounded-lg px-3 text-blue-800 hover:bg-blue-50 disabled:opacity-50" disabled={!validPoints.length} onClick={fitPoints}>Show all lots</button>
          {(selectedId || currentSelection) && <button type="button" className="min-h-11 rounded-lg px-3 text-blue-800 hover:bg-blue-50" onClick={() => { setBrowseLots(false); onSelect(undefined); }}>Clear selection</button>}
        </div>
        <p>{coverageLabel}</p>
        <div className="flex flex-wrap items-center gap-x-3">
          <button type="button" className="min-h-11 text-blue-800 underline" aria-expanded={browseLots} onClick={() => setBrowseLots(!browseLots)}>Browse lots ({validPoints.length})</button>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={bubbles} onChange={event => setBubbles(event.target.checked)} />Proportional bubbles</label>
          <span className="text-slate-500">Dots mark exact locations. Lines connect lot labels</span>
        </div>
        {bubbles && <p className="text-slate-600">Bubble area: relative {amountMode ? 'absolute amount' : 'record count'}. Largest = {amountMode ? maxMagnitude.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' }) : maxMagnitude.toLocaleString('en-CA')}. Minimum dot size applies</p>}
      </div>
      <div className="ps-map-canvas relative min-h-0 flex-1">
      {!validPoints.length && <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-50/90 p-4 text-center"><div className="max-w-sm rounded-xl border bg-white p-4 shadow-sm"><h3 className="font-bold">No locations mapped yet</h3><p className="mt-2 text-sm">{missingCoordinateCount ? `${missingCoordinateCount} linked locations need valid coordinates in Parking settings. Other unlinked records also remain in totals.` : 'Link the imported meters to physical parking locations to show their activity here. Unlinked records remain in the evidence totals.'}</p>{canEdit && onReviewLinks ? <button type="button" className="mt-3 min-h-11 rounded-lg bg-blue-800 px-4 text-sm font-bold text-white" onClick={() => void reviewLinks()}>Review location links</button> : <p className="mt-3 text-sm">Ask a Parking editor to review location links and coordinates.</p>}</div></div>}
      <MapBase mapRef={mapRef} onLoad={() => setLoaded(true)} latitude={44.389} longitude={-79.69} zoom={13} showNavigation showScale>
        {validPoints.map(point => (
          <Marker key={point.id} latitude={point.latitude} longitude={point.longitude} anchor="center" style={{ zIndex: selectedId === point.id ? 3 : 1 }}>
            <button type="button" onClick={() => { setBrowseLots(selectedId !== point.id); onSelect(selectedId === point.id ? undefined : point.id); }}
              aria-label={selectedId === point.id ? `Deselect ${point.name}` : `Browse lots near ${point.name}`} title={point.name}
              className="flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-4 focus-visible:outline-blue-400">
              <span style={{ width: bubbles ? Math.max(8, 34 * Math.sqrt(Math.abs(valueOf(point)) / (maxMagnitude || 1))) : 12, height: bubbles ? Math.max(8, 34 * Math.sqrt(Math.abs(valueOf(point)) / (maxMagnitude || 1))) : 12 }} className={`block rounded-full border-2 border-white shadow ${selectedId === point.id ? 'ring-4 ring-amber-400' : ''} ${amountMode ? 'bg-emerald-800' : 'bg-blue-800'}`} />
            </button>
          </Marker>
        ))}
      </MapBase>
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
        {labels.placements.map(label => <line key={label.id} x1={label.x} y1={label.y} x2={Math.max(label.left, Math.min(label.x, label.left + labels.labelWidth))} y2={Math.max(label.top, Math.min(label.y, label.top + labels.labelHeight))} stroke={selectedId === label.id ? '#b45309' : '#64748b'} strokeWidth={selectedId === label.id ? 2 : 1} />)}
      </svg>
      {labels.placements.map(label => {
        const point = validPoints.find(item => item.id === label.id);
        if (!point) return null;
        return <button key={point.id} type="button" data-parking-label={point.id} aria-pressed={selectedId === point.id}
          aria-label={`${point.name}: ${formatValue(point)} ${amountMode ? 'CAD source-reported amount' : 'payment records'}`}
          title={`${point.name} - ${formatValue(point)}`} onClick={() => togglePoint(point.id)}
          style={{ position: 'absolute', left: label.left, top: label.top, width: labels.labelWidth, height: labels.labelHeight, zIndex: selectedId === point.id ? 5 : 4 }}
          className={`rounded-lg border bg-white px-2 text-left text-xs shadow-sm focus-visible:outline focus-visible:outline-4 focus-visible:outline-blue-400 ${selectedId === point.id ? 'border-amber-500 ring-2 ring-amber-300' : 'border-slate-300'}`}>
          <span className="block truncate font-semibold text-slate-700">{point.name}</span>
          <strong className={`block ${amountMode ? 'text-emerald-800' : 'text-blue-800'}`}>{formatValue(point)}</strong>
        </button>;
      })}
      {labels.hiddenCount > 0 && !browseLots && <button type="button" className="absolute bottom-10 left-2 z-10 min-h-11 rounded-lg border bg-white px-3 text-xs text-blue-800 shadow" onClick={() => setBrowseLots(true)}>{labels.hiddenCount} more lots - Browse lots</button>}
      {browseLots && <div className="absolute left-2 right-12 top-2 z-10 max-h-[85%] overflow-y-auto rounded-xl border border-slate-300 bg-white p-2 shadow-lg" aria-label="Mapped parking lots">
        <div className="flex items-center justify-between px-2"><strong className="text-sm">Mapped lots</strong><button type="button" className="min-h-11 px-3 text-sm text-blue-800" onClick={() => setBrowseLots(false)}>Close list</button></div>
        {validPoints.map(point => <button key={point.id} type="button" aria-pressed={selectedId === point.id} className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left text-sm ${selectedId === point.id ? 'bg-amber-50 font-bold ring-1 ring-inset ring-amber-400' : 'hover:bg-slate-100'}`} onClick={() => { togglePoint(point.id); setBrowseLots(false); }}><span>{point.name}</span><strong className="shrink-0">{formatValue(point)}</strong></button>)}
      </div>}
      </div>
      <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-2 text-xs" aria-live="polite">
        {currentSelection ? <><strong className="block text-sm">{currentSelection.name}</strong><span>{currentSelection.recordCount.toLocaleString('en-CA')} records · {currentSelection.reportedAmount.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })} source-reported</span>{!currentSelection.mapped && <p className="text-amber-800">Not mapped: review this area's location links or coordinates.</p>}</> : <p>Select a mapped lot to see its name and payment evidence.</p>}
      </div>
    </div>
  );
};
