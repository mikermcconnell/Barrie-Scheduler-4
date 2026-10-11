import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, FileSpreadsheet, Info, Link2, Loader2, MapPin, RefreshCw, Upload } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import { useTeam } from '../contexts/TeamContext';
import { Modal } from '../ui/Modal';
import { canAccessWorkspaceFeature } from '../../utils/workspaceAccess';
import { getParkingSettings } from '../../utils/parking/parkingService';
import { getParkingStrategyHistory, saveParkingStrategyHistory, type ParkingStrategyHistoryData } from '../../utils/parking/parkingStrategyHistoryService';
import { getParkingStrategyLocations, saveParkingStrategyLocations, createParkingStrategyLocationLink, type ParkingStrategyLocations } from '../../utils/parking/parkingStrategyLocationService';
import { buildParkingStrategyModel } from '../../utils/parking/parkingStrategyModel';
import { buildParkingLotDataHash, buildParkingStrategyHash, parseParkingStrategyRoute } from '../../utils/parking/parkingStrategyRouting';
import type { ParkingLocoMobiParseResult } from '../../utils/parking/parkingLocoMobiTypes';
import type { ParkingSettings } from '../../utils/parking/parkingTypes';
import { ParkingStrategyMap, type ParkingStrategyMapPoint } from './ParkingStrategyMap';
import './parkingStrategy.css';
import { suggestParkingStrategyLinks } from '../../utils/parking/parkingStrategyLinkSuggestions';

async function parseFiles(files: File[]): Promise<ParkingLocoMobiParseResult> {
  if (!files.length || files.length > 12 || files.reduce((sum, file) => sum + file.size, 0) > 100 * 1024 * 1024) {
    throw new Error('Choose up to 12 Excel workbooks, with a combined size under 100 MB.');
  }
  if (files.some(file => !/\.xlsx?$/i.test(file.name))) throw new Error('Choose Excel .xlsx or .xls workbooks.');
  const { parseParkingLocoMobiWorkbooks } = await import('../../utils/parking/parkingLocoMobiParser');
  const inputs = await Promise.all(files.map(async file => ({ fileName: file.name, buffer: await file.arrayBuffer() })));
  return parseParkingLocoMobiWorkbooks(inputs);
}

export const parkingStrategyServices = {
  loadHistory: getParkingStrategyHistory,
  saveHistory: saveParkingStrategyHistory,
  loadSettings: getParkingSettings,
  loadLocations: getParkingStrategyLocations,
  saveLocations: saveParkingStrategyLocations,
  parseFiles,
};
export type ParkingStrategyServices = typeof parkingStrategyServices;
const number = (value: number) => value.toLocaleString('en-CA');
const dollars = (value: number, decimals = 0) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Parking evidence could not be updated. Please try again.';
type StrategyModel = ReturnType<typeof buildParkingStrategyModel>;
type Area = StrategyModel['areas'][number];

export function ParkingStrategyWorkspace({ embedded = false }: { embedded?: boolean } = {}) {
  const { user, isGlobalAdmin } = useAuth();
  const { team, teamMember, canManageTeam, developerPreview } = useTeam();
  if (!team || !user) return <p className="p-8">Sign in and join a team to use Parking.</p>;
  const canEdit = developerPreview?.readOnly !== true && (isGlobalAdmin || canManageTeam || canAccessWorkspaceFeature('workspaceParking', teamMember));
  return <ParkingStrategyWorkspaceContent key={team.id} teamId={team.id} userId={user.uid} canEdit={canEdit} embedded={embedded} />;
}

/** Injectable services keep browser verification isolated from real team data. */
export function ParkingStrategyWorkspaceContent({ teamId, userId, canEdit, services = parkingStrategyServices, embedded = false }: {
  teamId: string; userId: string; canEdit: boolean; services?: ParkingStrategyServices; embedded?: boolean;
}) {
  const [route, setRoute] = useState(() => parseParkingStrategyRoute(window.location.hash));
  const [history, setHistory] = useState<ParkingStrategyHistoryData | null>(null);
  const [settings, setSettings] = useState<ParkingSettings | null>(null);
  const [locations, setLocations] = useState<ParkingStrategyLocations | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [pendingImport, setPendingImport] = useState<ParkingLocoMobiParseResult | null>(null);
  const [showMappings, setShowMappings] = useState(false);
  const [draftMappings, setDraftMappings] = useState<Record<string, string>>({});
  const [suggestedLinkCount, setSuggestedLinkCount] = useState(0);
  const [showSources, setShowSources] = useState(false);
  const [metric, setMetric] = useState<'rowCount' | 'totalReportedAmount'>('rowCount');
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const onHash = () => setRoute(parseParkingStrategyRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => { alive.current = false; generation.current++; window.removeEventListener('hashchange', onHash); };
  }, []);

  const reload = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true); setLoadError(''); setError('');
    try {
      const [nextHistory, nextSettings, nextLocations] = await Promise.all([
        services.loadHistory(teamId), services.loadSettings(teamId), services.loadLocations(teamId),
      ]);
      if (!alive.current || generation.current !== request) return;
      setHistory(nextHistory); setSettings(nextSettings); setLocations(nextLocations);
    } catch (cause) {
      if (alive.current && generation.current === request) setLoadError(errorText(cause));
    } finally {
      if (alive.current && generation.current === request) setLoading(false);
    }
  }, [teamId, services]);
  useEffect(() => { void reload(); }, [reload]);

  const navigate = (next: Partial<typeof route>) => {
    const value = { ...route, ...next };
    setRoute(value);
    window.location.hash = buildParkingStrategyHash(value);
  };
  const physicalLocations = useMemo(() => (settings?.revenueLocations ?? []).filter(location => location.locationKind !== 'non_spatial'), [settings]);
  const filters = useMemo(() => ({ fromMonth: route.from, toMonth: route.to }), [route.from, route.to]);
  const overview = useMemo(() => history ? buildParkingStrategyModel(history.snapshot, filters, locations?.links ?? [], physicalLocations) : null, [history, filters, locations, physicalLocations]);
  const ranked = useMemo(() => [...(overview?.areas ?? [])].sort((a, b) => b[metric] - a[metric] || a.label.localeCompare(b.label)), [overview, metric]);
  const selected = route.area ? overview?.areas.find(area => area.key === route.area) ?? null : null;
  const detail = useMemo(() => history && selected ? buildParkingStrategyModel(history.snapshot, { ...filters, areaKey: selected.key }, locations?.links ?? [], physicalLocations) : null, [history, filters, locations, physicalLocations, selected]);
  const allMeters = useMemo(() => history ? buildParkingStrategyModel(history.snapshot, {}, locations?.links ?? [], physicalLocations).meters : [], [history, locations, physicalLocations]);
  const points = useMemo<ParkingStrategyMapPoint[]>(() => ranked.flatMap(area => {
    const location = physicalLocations.find(item => item.id === area.locationId);
    if (!location || location.latitude == null || location.longitude == null || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) || Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180) return [];
    return [{ id: area.key, name: area.label, latitude: location.latitude, longitude: location.longitude, recordCount: area.rowCount, reportedAmount: area.totalReportedAmount }];
  }), [ranked, physicalLocations]);
  const mappedRecords = points.reduce((sum, point) => sum + point.recordCount, 0);
  const mappedAmount = points.reduce((sum, point) => sum + point.reportedAmount, 0);
  const months = history?.snapshot.coverage.observedMonths ?? [];
  const years = history?.snapshot.coverage.observedYears ?? [];
  const crossSourcePeriod = { from: route.from ?? months[0], to: route.to ?? months.at(-1) };
  const periodLabel = route.from || route.to ? `${route.from ?? months[0] ?? 'Start'} to ${route.to ?? months.at(-1) ?? 'Latest'}` : 'All supplied history';

  async function selectFiles(files: File[]) {
    if (!canEdit || busy || loading || loadError) return;
    setBusy('Reading workbooks…'); setError(''); setNotice('');
    try {
      const parsed = await services.parseFiles(files);
      if (!parsed.rows.length) throw new Error('No accepted payment records were found in these workbooks.');
      if (alive.current) setPendingImport(parsed);
    } catch (cause) { if (alive.current) setError(errorText(cause)); }
    finally { if (alive.current) setBusy(''); if (input.current) input.current.value = ''; }
  }

  async function confirmImport() {
    if (!canEdit || !pendingImport || busy) return;
    setBusy('Saving and verifying history…'); setError('');
    try {
      const saved = await services.saveHistory(teamId, userId, pendingImport, history?.manifest.revision ?? 0);
      const verified = await services.loadHistory(teamId);
      if (!verified || verified.manifest.revision !== saved.manifest.revision || verified.manifest.importFingerprint !== saved.manifest.importFingerprint) {
        throw new Error('The saved history changed before verification. Refresh to load the current revision.');
      }
      if (alive.current) {
        setHistory(verified); setPendingImport(null);
        setNotice(`History revision ${verified.manifest.revision} saved and read back: ${number(verified.snapshot.reconciliation.acceptedRowCount)} records.`);
        navigate({ from: undefined, to: undefined, area: undefined });
      }
    } catch (cause) { if (alive.current) setError(errorText(cause)); }
    finally { if (alive.current) setBusy(''); }
  }

  function openMappings() {
    const existing = Object.fromEntries((locations?.links ?? []).map(link => [link.sourceKey, link.locationId]));
    const draft = canEdit ? suggestParkingStrategyLinks(allMeters, physicalLocations, existing) : { mappings: existing, suggestedKeys: [] };
    setDraftMappings(draft.mappings);
    setSuggestedLinkCount(draft.suggestedKeys.length);
    setShowMappings(true); setError('');
  }
  async function confirmMappings() {
    if (!canEdit || !locations || busy) return;
    setBusy('Saving reviewed location links…'); setError('');
    try {
      const knownKeys = new Set(allMeters.map(meter => meter.sourceKey));
      const preserved = locations.links.filter(link => !knownKeys.has(link.sourceKey));
      const reviewed = allMeters.flatMap(meter => {
        const locationId = draftMappings[meter.sourceKey];
        if (!locationId) return [];
        if (!physicalLocations.some(location => location.id === locationId)) throw new Error('A selected parking location is no longer available. Refresh the location settings.');
        return [createParkingStrategyLocationLink(meter.domain, meter.meterId, locationId)];
      });
      const saved = await services.saveLocations(teamId, userId, [...preserved, ...reviewed], locations.revision);
      const verified = await services.loadLocations(teamId);
      if (verified.revision !== saved.revision) throw new Error('Location links changed before verification. Refresh to load the current revision.');
      if (alive.current) { setLocations(verified); setShowMappings(false); setNotice('Reviewed location links saved and read back.'); navigate({ area: undefined }); }
    } catch (cause) { if (alive.current) setError(errorText(cause)); }
    finally { if (alive.current) setBusy(''); }
  }

  async function exportBrief() {
    if (!history || !overview?.periodAvailable || busy) return;
    setBusy('Preparing the evidence briefing…'); setError('');
    try {
      const { exportParkingStrategyBrief } = await import('../../utils/parking/parkingStrategyExport');
      await exportParkingStrategyBrief({ snapshot: history.snapshot, model: overview, periodLabel, selectedAreaLabel: selected?.label });
    } catch (cause) { if (alive.current) setError(errorText(cause)); }
    finally { if (alive.current) setBusy(''); }
  }

  const renderMetrics = () => <div className="ps-segment" aria-label="Ranking metric">{(['rowCount', 'totalReportedAmount'] as const).map(value => <button key={value} type="button" aria-pressed={metric === value} className={metric === value ? 'active' : ''} onClick={() => setMetric(value)}>{value === 'rowCount' ? 'Records' : 'Amount'}</button>)}</div>;
  const renderRank = (areas: Area[]) => <div className="ps-ranks">{areas.map((area, index) => <button key={area.key} type="button" className={`ps-rank ${selected?.key === area.key ? 'active' : ''}`} aria-pressed={selected?.key === area.key} onClick={() => navigate({ area: selected?.key === area.key ? undefined : area.key })}>
    <span className="ps-rank-title"><span>{index + 1}. {area.label}</span><strong>{metric === 'rowCount' ? number(area.rowCount) : dollars(area.totalReportedAmount)}</strong></span>
    <span className="ps-track"><span style={{ width: `${ranked[0]?.[metric] > 0 ? area[metric] / ranked[0][metric] * 100 : 0}%` }} /></span>
    <span className="ps-small">{area.sourceKeys.length} meter{area.sourceKeys.length === 1 ? '' : 's'} · {area.kind === 'reviewed_location' ? 'Reviewed lot link' : 'Source area · needs lot link'}</span>
  </button>)}</div>;
  const renderMap = (compact = false) => <div className="ps-map-shell"><div className="ps-map-heading"><strong>{metric === 'rowCount' ? 'Payment records by location' : 'Source-reported amount by location'}</strong><span className="ps-small">Reviewed location links only</span></div><ParkingStrategyMap points={points} metric={metric} onMetricChange={setMetric} periodLabel={periodLabel} coverageLabel={`${number(mappedRecords)} of ${number(overview?.totals.rowCount ?? 0)} records mapped · ${dollars(mappedAmount)} mapped reported amount`} selection={selected ? { name: selected.label, recordCount: selected.rowCount, reportedAmount: selected.totalReportedAmount, mapped: points.some(point => point.id === selected.key) } : null} selectedId={selected?.key} focusId={route.area} missingCoordinateCount={overview?.areas.filter(area => area.locationId && !points.some(point => point.id === area.key)).length ?? 0} canEdit={canEdit} onReviewLinks={openMappings} onSelect={key => navigate({ area: key })} compact={compact} /><p className="ps-map-foot">Unmatched records remain in totals.</p></div>;

  return <div className="parking-strategy h-full overflow-y-auto"><div className="ps-page">
    {!embedded && <a className="ps-back" href="#parking"><ArrowLeft size={14} /> Parking workspace</a>}
    <div className="ps-heading"><div><p className="ps-eyebrow">Municipal Parking Strategy</p><h1>{route.view === 'map' ? 'Parking Map Analysis' : 'Parking Strategy Evidence'}</h1><p className="ps-muted">{route.view === 'map' ? 'Explore the locations behind the evidence, with the same period and source.' : 'Understand payment patterns, explore locations, and identify the next questions.'}</p></div><div className="ps-actions"><button className="ps-button" disabled={!!busy || loading} onClick={() => void reload()}><RefreshCw size={15} /> Refresh</button><button className="ps-button" disabled={!!busy || loading || !!loadError || !overview?.periodAvailable} onClick={() => void exportBrief()}><Download size={15} /> Export briefing PDF</button>{canEdit && <button className="ps-primary" disabled={!!busy || loading || !!loadError} onClick={() => input.current?.click()}><Upload size={16} /> Import history</button>}</div></div>
    <input ref={input} type="file" multiple accept=".xlsx,.xls" className="sr-only" aria-label="LocoMobi history workbooks" disabled={!canEdit || !!busy || loading} onChange={event => void selectFiles(Array.from(event.target.files ?? []))} />
    <div className="ps-tabs" role="tablist" aria-label="Parking strategy view"><button role="tab" aria-selected={route.view === 'board'} onClick={() => navigate({ view: 'board' })}>Trends and Graphs</button><button role="tab" aria-selected={route.view === 'map'} onClick={() => navigate({ view: 'map', area: selected?.key })}>Map analysis</button></div>
    {busy && <p role="status" className="ps-message"><Loader2 size={16} className="animate-spin" />{busy}</p>}
    {error && <p role="alert" className="ps-error">{error}</p>}{notice && <p role="status" className="ps-success">{notice}</p>}
    {loading ? <p role="status" className="ps-empty"><Loader2 size={22} className="animate-spin" /> Loading saved parking evidence…</p> : loadError ? <div role="alert" className="ps-error"><h2>Parking evidence could not be loaded</h2><p>{loadError}</p><button className="ps-button" onClick={() => void reload()}>Retry loading</button></div> : !history ? <div className="ps-card ps-empty"><FileSpreadsheet size={36} /><h2>No strategy history has been imported</h2><p>Import the LocoMobi / Worldstream workbooks together to build the executive board and map evidence.</p><p className="ps-small">Only privacy-minimized activity and aggregates are saved. Original workbooks, plates and payment identifiers are not uploaded.</p>{canEdit ? <button className="ps-primary" disabled={!!busy} onClick={() => input.current?.click()}>Choose history workbooks</button> : <p>Ask a Parking editor to import the history. This session is read-only.</p>}</div> : overview && <>
      <div className="ps-filters"><div className="ps-filter-fields"><label>From month<select aria-label="From month" value={route.from ?? ''} disabled={!history.snapshot.locationMonths} onChange={event => navigate({ from: event.target.value || undefined, to: route.to && event.target.value > route.to ? event.target.value : route.to })}><option value="">First supplied month</option>{months.map(month => <option key={month}>{month}</option>)}</select></label><label>To month<select aria-label="To month" value={route.to ?? ''} disabled={!history.snapshot.locationMonths} onChange={event => navigate({ to: event.target.value || undefined, from: route.from && event.target.value && event.target.value < route.from ? event.target.value : route.from })}><option value="">Latest supplied month</option>{months.map(month => <option key={month}>{month}</option>)}</select></label><button className="ps-link" onClick={() => navigate({ from: undefined, to: undefined })}>All history</button></div><div className="ps-actions"><span className="ps-badge">LocoMobi history</span><button className="ps-link" onClick={() => setShowSources(true)}><Info size={14} /> Sources &amp; method</button><button className="ps-button" onClick={openMappings}><Link2 size={14} /> Location links</button></div></div>
      {!history.snapshot.locationMonths && <p className="ps-warning">This archive predates linked period filters. Re-import the original workbooks to enable filtering by both location and month. Whole-archive evidence remains available.</p>}
      {route.area && !overview.areas.some(area => area.key === route.area) && <p className="ps-warning">The requested area has no evidence in this period or its mapping has changed. Select another area to inspect its evidence.</p>}
      {!overview.periodAvailable ? <p className="ps-warning">{overview.unavailableReason}</p> : <>
      {route.view === 'board' ? <>
        <div className="ps-coverage"><div><strong>Evidence coverage</strong><p className="ps-small">Observed records, not full-year coverage</p></div><div className="ps-years">{Array.from(new Set([2021, 2022, 2023, 2024, 2025, ...years])).sort().map(year => <button key={year} disabled={!years.includes(year) || !history.snapshot.locationMonths} className={years.includes(year) ? 'observed' : ''} onClick={() => navigate({ from: months.find(month => month.startsWith(String(year))), to: months.filter(month => month.startsWith(String(year))).at(-1) })}><strong>{year}</strong><span>{years.includes(year) ? 'Observed · partial archive' : 'Not supplied'}</span></button>)}</div></div>
        <p className="ps-small ps-scope">{periodLabel} · Archive observed {history.snapshot.coverage.observedStartDate} to {history.snapshot.coverage.observedEndDate}. Missing history is never zero.</p>
        <div className="ps-kpis"><Kpi title="Payment records" value={number(overview.totals.rowCount)} note="Accepted, deduplicated activity" /><Kpi title="Source-reported amount" value={dollars(overview.totals.totalReportedAmount)} note="CAD · tax treatment unconfirmed" /><Kpi title="Locations / source areas" value={number(overview.areas.length)} note={`${overview.meters.length} meters · grouped by reviewed links where available`} /><Kpi title="Zero-dollar records" value={number(overview.totals.zeroAmountRowCount)} note={`${overview.totals.rowCount ? (overview.totals.zeroAmountRowCount / overview.totals.rowCount * 100).toFixed(1) : '0.0'}% of records · included in totals`} /></div>
        <div className="ps-top-grid"><section className="ps-card"><div className="ps-card-heading"><div><p className="ps-eyebrow">Pattern over time</p><h2>Monthly payment activity</h2><p className="ps-small">{periodLabel} · all areas</p></div>{renderMetrics()}</div><div className="ps-chart" aria-label="Monthly payment activity chart"><ResponsiveContainer width="100%" height={220}><BarChart data={overview.monthly}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 11 }} minTickGap={25} /><YAxis tick={{ fontSize: 11 }} width={65} tickFormatter={value => metric === 'rowCount' ? number(value) : dollars(value)} /><Tooltip formatter={value => metric === 'rowCount' ? number(Number(value)) : dollars(Number(value), 2)} /><Bar name={metric === 'rowCount' ? 'Payment records' : 'Source-reported amount'} dataKey={metric} fill="#159be8" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div><p className="ps-small">Observed totals only. First and last months may be partial; no annualized estimates.</p></section>
        <section className="ps-card"><p className="ps-eyebrow">Evidence into questions</p><h2>What deserves a closer look?</h2><div className="ps-signal"><h3>Activity is concentrated</h3><p>The leading three areas account for {overview.totals[metric] ? (ranked.slice(0, 3).reduce((sum, area) => sum + area[metric], 0) / overview.totals[metric] * 100).toFixed(1) : '0.0'}% of {metric === 'rowCount' ? 'records' : 'reported amount'} in this period.</p><button className="ps-link" disabled={!ranked.length} onClick={() => navigate({ view: 'map', area: ranked[0]?.key })}>Explore leading area <ArrowRight size={14} /></button></div><div className="ps-signal"><h3>Activity and amount tell different stories</h3><p>Switch the metric to see how the ranking changes. Rates, payment mix and zero-dollar records need context.</p></div><div className="ps-signal"><h3>Where should we measure occupancy?</h3><p>These payment records can inform study priorities. They do not measure occupied spaces or time parked.</p></div></section></div>
        <section className="ps-spatial ps-card"><div className="ps-ranking"><p className="ps-eyebrow">Location concentration</p><h2>Explore the parking areas</h2><p className="ps-small">Reviewed lots and unmatched source areas</p>{renderRank(ranked.slice(0, 6))}<button className="ps-link" onClick={() => navigate({ view: 'map', area: selected?.key })}>Open all areas in Map Analysis <ArrowRight size={14} /></button></div><div>{renderMap(true)}{selected && <div className="ps-selection"><div><p className="ps-eyebrow">Selected area</p><h3>{selected.label}</h3><p className="ps-small">{number(selected.rowCount)} records · {dollars(selected.totalReportedAmount)} reported · {selected.sourceKeys.length} meters</p></div><button className="ps-primary" onClick={() => navigate({ view: 'map', area: selected.key })}>Explore on map <ArrowRight size={15} /></button></div>}</div></section>
      </> : <>
        <div className="ps-context"><span>{periodLabel} / LocoMobi / {selected?.label ?? 'No area selected'}</span><button className="ps-link" onClick={() => navigate({ view: 'board' })}><ArrowLeft size={14} /> Return to Trends and Graphs</button></div>
        <div className="ps-workspace"><aside className="ps-card ps-ranking"><p className="ps-eyebrow">Locations and source areas</p><h2>Locations</h2>{renderMetrics()}{renderRank(ranked)}</aside>{renderMap()}<aside className="ps-card ps-details" aria-live="polite">{selected && detail ? <>
          <p className="ps-eyebrow">Location evidence</p><h2>{selected.label}</h2><p className="ps-small">{selected.kind === 'reviewed_location' ? 'Reviewed link to the shared parking location registry' : 'Source area · physical lot link needs review'}</p>
          <div className="ps-detail-kpis"><Kpi title="Payment records" value={number(selected.rowCount)} note={periodLabel} /><Kpi title="Reported amount" value={dollars(selected.totalReportedAmount)} note="Source-reported CAD" /></div>
          <div className="ps-detail-section"><h3>Included meters</h3>{detail.meters.filter(meter => selected.sourceKeys.includes(meter.sourceKey)).map(meter => <div className="ps-meter" key={meter.sourceKey}><span>{meter.locationLabel}<small>{meter.meterId}</small></span><strong>{number(meter.rowCount)}</strong></div>)}</div>
          <div className="ps-detail-section"><h3>When payments are recorded</h3>{detail.hourlyCounts ? <><div className="ps-hours" role="img" aria-label={`Hourly payment activity for ${selected.label}`}>{detail.hourlyCounts.map((count, hour) => <span key={hour} title={`${hour}:00 — ${number(count)} records`} style={{ height: `${Math.max(...detail.hourlyCounts!) ? count / Math.max(...detail.hourlyCounts!) * 100 : 0}%` }} />)}</div><div className="ps-axis"><span>00:00</span><span>12:00</span><span>23:00</span></div></> : <p className="ps-small">Re-import this archive to see hourly activity for individual areas.</p>}</div>
          <div className="ps-detail-section"><h3>Evidence at this location</h3><div className="ps-source-card"><strong>LocoMobi · {periodLabel}</strong><p>{dollars(selected.totalReportedAmount, 2)} source-reported amount</p><p>{number(selected.zeroAmountRowCount)} zero-dollar records</p></div><div className="ps-source-card"><strong>HotSpot / QR</strong><p>Tax-inclusive revenue and its own source coverage. Opens the same calendar-month range; boundary months may have different observed days.</p>{selected.locationId ? <a className="ps-link" href={buildParkingLotDataHash({ ...crossSourcePeriod, area: selected.key, location: selected.locationId })}>Open this lot in Parking Lot Data <ArrowRight size={14} /></a> : <p>Review location links before opening the same physical lot in the revenue workspace.</p>}</div></div>
          <div className="ps-detail-section"><h3>Next management question</h3><p className="ps-small">{selected.rowCount && selected.zeroAmountRowCount / selected.rowCount > 0.1 ? 'What explains the zero-dollar records here? Review rates, exemptions and payment-system configuration.' : 'Which days and hours should an occupancy study sample at this location?'}</p><button className="ps-link" onClick={openMappings}><MapPin size={14} /> Review location links</button></div>
        </> : <p>No payment activity is available for this period.</p>}</aside></div>
      </>}
      {!overview.totals.rowCount && <p className="ps-warning">No records are supplied for this selection. This is not evidence of zero parking activity.</p>}
      </>}
      <footer className="ps-footer"><span>History revision {history.manifest.revision} · Imported {history.manifest.importedAt?.slice(0, 10) || 'date unavailable'} · No plate or payment identifiers in strategy evidence.</span><a href={buildParkingLotDataHash(crossSourcePeriod)}>Open HotSpot / QR workspace</a></footer>
    </>}

    <Modal isOpen={!!pendingImport} onClose={() => { if (!busy) setPendingImport(null); }} size="xl" closeOnEscape={!busy} closeOnBackdropClick={!busy}>
      <Modal.Header showClose={!busy}>Review history import</Modal.Header><Modal.Body>{pendingImport && <div className="space-y-4"><p><strong>{number(pendingImport.reconciliation.acceptedRowCount)} accepted records</strong> · {dollars(pendingImport.reconciliation.totalReportedAmount, 2)} source-reported amount.</p><p>Observed {pendingImport.coverage.observedStartDate} through {pendingImport.coverage.observedEndDate}.</p><div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">This replaces the entire strategy-history archive{history ? ` (current revision ${history.manifest.revision})` : ''}. Select all workbooks you want to retain together. HotSpot / QR records and reviewed location links are not changed.</div><ul className="list-disc pl-5 text-sm">{pendingImport.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul><div className="text-sm">{pendingImport.sourceTables.map(table => <p key={`${table.fileName}/${table.sheetName}`}>{table.fileName} — {table.sheetName}: {number(table.acceptedRowCount)} records</p>)}</div><p className="text-xs text-gray-500">Original workbooks and direct identifiers are not uploaded. Only privacy-minimized history and aggregates are saved.</p>{error && <p role="alert" className="text-red-700">{error}</p>}{busy && <p role="status">{busy}</p>}</div>}</Modal.Body><Modal.Footer><button className="ps-button" disabled={!!busy} onClick={() => setPendingImport(null)}>Cancel</button><button className="ps-primary" disabled={!!busy || !canEdit} onClick={() => void confirmImport()}>Save history archive</button></Modal.Footer>
    </Modal>
    <Modal isOpen={showMappings} onClose={() => { if (!busy) setShowMappings(false); }} size="full" closeOnEscape={!busy} closeOnBackdropClick={!busy}>
      {canEdit && <p role="status" className="m-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">First-pass draft: {suggestedLinkCount} meter links prefilled from specific source-area names and your current location registry. Existing links are preserved. These suggestions are not saved or shown as map pins until you review the selections and choose Save reviewed links. Ambiguous or missing matches remain unlinked.</p>}
      <Modal.Header showClose={!busy}>Review LocoMobi location links</Modal.Header><Modal.Body><p className="mb-4 text-sm text-gray-600">Link each meter to its confirmed physical parking location. Multiple meters may share one lot; distinct lots must remain separate. Unlinked meters stay in totals without a map pin.</p><div className="grid gap-3">{allMeters.map(meter => <label key={meter.sourceKey} className="grid gap-2 rounded-lg border p-3 md:grid-cols-2"><span className="text-sm"><strong>{meter.locationLabel}</strong><br /><span className="text-xs text-gray-500">{meter.domain} · {meter.meterId}</span></span><select className="min-w-0 rounded-lg border bg-white p-2 text-sm" aria-label={`Physical location for ${meter.locationLabel}`} disabled={!canEdit || !!busy} value={draftMappings[meter.sourceKey] ?? ''} onChange={event => setDraftMappings(current => ({ ...current, [meter.sourceKey]: event.target.value }))}><option value="">Unlinked — needs review</option>{draftMappings[meter.sourceKey] && !physicalLocations.some(location => location.id === draftMappings[meter.sourceKey]) && <option value={draftMappings[meter.sourceKey]}>Previously linked location no longer available</option>}{physicalLocations.map(location => <option key={location.id} value={location.id}>{location.displayName}{location.latitude == null || location.longitude == null ? ' (coordinates needed)' : ''}</option>)}</select></label>)}</div>{error && <p role="alert" className="mt-4 text-red-700">{error}</p>}{busy && <p role="status">{busy}</p>}</Modal.Body><Modal.Footer><button className="ps-button" disabled={!!busy} onClick={() => setShowMappings(false)}>Close</button>{canEdit && <button className="ps-primary" disabled={!!busy} onClick={() => void confirmMappings()}>Save reviewed links</button>}</Modal.Footer>
    </Modal>
    <Modal isOpen={showSources} onClose={() => setShowSources(false)} size="xl"><Modal.Header>Sources &amp; method</Modal.Header><Modal.Body><div className="space-y-4 text-sm"><p>LocoMobi / Worldstream history uses one canonical source table per workbook, removes exact duplicate source rows, then drops direct identifiers before saving.</p><p>Transaction Time defines activity time; Entry Time is used only when Transaction Time is unavailable. Zero-dollar approved/paid records remain in activity totals.</p><p>Source domains group unlinked meters. Confirmed links group meters by the existing physical parking-location registry. Coordinates describe the parking asset, not the exact meter position.</p><p>Source-reported amounts have no supplied tax breakdown and are not added to HotSpot / QR tax-inclusive revenue. Occupancy, turnover and stay length are not inferred.</p><p>Period filters use calendar months. Missing months are unavailable, not zero; observed dates do not prove complete collection coverage.</p>{history?.snapshot.sourceTables.map(table => <div key={`${table.fileName}/${table.sheetName}`} className="rounded-lg bg-gray-50 p-3"><strong>{table.fileName}</strong><p>{table.sheetName} · {number(table.acceptedRowCount)} accepted · {number(table.duplicateRowCount)} duplicates · {number(table.skippedRowCount)} excluded</p></div>)}</div></Modal.Body></Modal>
  </div></div>;
}

function Kpi({ title, value, note }: { title: string; value: string; note: string }) {
  return <div className="ps-kpi"><p>{title}</p><strong>{value}</strong><small>{note}</small></div>;
}
