import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Info, Maximize2, Minimize2, Printer, RefreshCw, TrainFront, X } from 'lucide-react';
import { getRouteConfig, getRouteVariant } from '../../utils/config/routeDirectionConfig';
import { buildRouteIdentity, type DayType } from '../../utils/masterScheduleTypes';
import { getMasterSchedule } from '../../utils/services/masterScheduleService';
import { fetchRegionalGoFeed } from '../../utils/gtfs/regionalGoService';
import { buildLocalConnectionRows, findConnection, formatServiceTime, getGoTrainEvents } from '../../utils/regional-transit/connectionAnalysis';
import type { ConnectionCell, ConnectionDirection, GoStationKey, GoTrainEvent, LocalConnectionRow, PublishedRouteSource, RegionalConnectionsProps, RegionalGoFeed } from '../../utils/regional-transit/types';
import './RegionalTransitConnections.css';

const STATIONS: Record<GoStationKey, string> = { allandale: 'Allandale Waterfront GO', south: 'Barrie South GO' };
const BAND_LABELS: Record<ConnectionCell['status'], string> = {
    comfortable: '6–15 min', tight: '1–5 min · tight', long: '16–30 min',
    'no-connection': 'No Connection', unavailable: 'No Connection',
};

function routeLabel(row: LocalConnectionRow): string {
    const config = getRouteConfig(row.routeNumber);
    if (config?.suffixIsDirection && (row.direction === 'North' || row.direction === 'South')) {
        return `Route ${getRouteVariant(row.routeNumber, row.direction)}`;
    }
    return `Route ${row.routeNumber}${row.direction === 'Not loaded' ? '' : ` ${row.direction}`}`;
}

function localToday(): string {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isValidDate(date: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const parsed = new Date(`${date}T12:00:00`);
    return Number.isFinite(parsed.getTime()) && `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}` === date;
}

function defaultDayType(date: string): DayType {
    const weekday = new Date(`${date}T12:00:00`).getDay();
    return weekday === 0 ? 'Sunday' : weekday === 6 ? 'Saturday' : 'Weekday';
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'The source could not be read.';
}

function displayFeedDate(value?: string): string {
    return value && /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : value || 'not supplied';
}

// Storage reads cannot be aborted. Bound their wait and ignore superseded results.
async function boundedRead<T>(read: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([read, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Master schedule read timed out. Retry the sources.')), 30_000);
        })]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}

interface TimingDetail { row: LocalConnectionRow; event: GoTrainEvent; cell: ConnectionCell }

function ConnectionDetail({ detail, stationName, date, onClose }: { detail: TimingDetail; stationName: string; date: string; onClose: () => void }) {
    const closeButton = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const { row, event, cell } = detail;
    useEffect(() => {
        const priorFocus = document.activeElement as HTMLElement | null;
        closeButton.current?.focus();
        const keydown = (key: KeyboardEvent) => {
            if (key.key === 'Escape') { key.preventDefault(); onClose(); }
            if (key.key !== 'Tab') return;
            const targets = Array.from(panel.current?.querySelectorAll<HTMLElement>('button, a[href], [tabindex="0"]') ?? []);
            const first = targets[0], last = targets[targets.length - 1];
            if (key.shiftKey && document.activeElement === first) { key.preventDefault(); last?.focus(); }
            else if (!key.shiftKey && document.activeElement === last) { key.preventDefault(); first?.focus(); }
        };
        document.addEventListener('keydown', keydown);
        return () => { document.removeEventListener('keydown', keydown); priorFocus?.focus(); };
    }, [onClose]);

    return createPortal(<div className="regional-go-modal" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
        <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="regional-go-detail-title" className="regional-go-detail">
            <button ref={closeButton} type="button" onClick={onClose} className="regional-go-button regional-go-close" aria-label="Close connection detail"><X size={16} /> Close</button>
            <p className="regional-go-eyebrow">{stationName} · {date} · {event.direction === 'to-go' ? 'To GO' : 'From GO'}</p>
            <h3 id="regional-go-detail-title">Route {row.routeNumber} {row.direction} × {event.trainNumber ? `Train ${event.trainNumber}` : `GO trip ${event.tripId}`}</h3>
            <p>GO {event.direction === 'to-go' ? 'departure' : 'arrival'}: <strong>{formatServiceTime(event.minutes)}</strong><br />
                Bus {event.direction === 'to-go' ? 'arrival' : 'departure'}: <strong>{cell.busMinutes === undefined ? BAND_LABELS[cell.status] : formatServiceTime(cell.busMinutes)}</strong></p>
            <div className={`regional-go-detail-status regional-go-${cell.status}`}>
                {cell.gapMinutes === undefined ? cell.issue || BAND_LABELS[cell.status] : `${cell.gapMinutes}-minute scheduled gap${cell.status === 'tight' ? ' · tight' : ''}.`}
                {cell.gapMinutes !== undefined && <p>{event.direction === 'to-go' ? 'Train departure − bus arrival' : 'Bus departure − train arrival'} = {cell.gapMinutes} minutes.</p>}
            </div>
            {cell.stopCode === '14' && stationName === STATIONS.allandale && <p>Stop 14 (Essa at Gowan) is across the street from Allandale GO. Allow time to cross.</p>}
            <p>Walking and boarding time are not deducted. Transfers are not guaranteed.</p>
            <dl><dt>Bus stop</dt><dd>{cell.stopName || row.stopNames.join('; ') || 'Not available'}{cell.stopCode && ` · code ${cell.stopCode}`}</dd>
                <dt>Matched bus stop codes</dt><dd>{row.stopCodes.join(', ') || 'None verified'}</dd>
                <dt>Bus trip / master version</dt><dd>{cell.tripId || 'No matching bus trip'} · v{row.version}</dd>
                <dt>GO trip / stop ID</dt><dd>{event.tripId} · {event.stationStopId}</dd></dl>
        </div>
    </div>, document.body);
}

export const RegionalTransitConnections: React.FC<RegionalConnectionsProps> = ({ schedules, readTeamId, dayTypeForDate, onRefreshSchedules }) => {
    const [date, setDate] = useState(localToday);
    const [station, setStation] = useState<GoStationKey>('allandale');
    const [direction, setDirection] = useState<ConnectionDirection | 'both'>('both');
    const [refresh, setRefresh] = useState(0);
    const [listRefresh, setListRefresh] = useState<{ team: string; loading: boolean; error?: string }>({ team: '', loading: false });
    const listRequest = useRef(0);
    const [feedState, setFeedState] = useState<{ refresh: number; loading: boolean; feed?: RegionalGoFeed; error?: string }>({ refresh: 0, loading: true });
    const [masterState, setMasterState] = useState<{ key: string; loading: boolean; sources: PublishedRouteSource[]; notices: string[] }>({ key: '', loading: true, sources: [], notices: [] });
    const [detail, setDetail] = useState<TimingDetail | null>(null);
    const [fullScreen, setFullScreen] = useState(false);
    const chartRef = useRef<HTMLElement>(null);
    const fullScreenButton = useRef<HTMLButtonElement>(null);
    const closeDetail = React.useCallback(() => setDetail(null), []);
    useEffect(() => {
        if (!fullScreen) return;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        fullScreenButton.current?.focus();
        const onKey = (event: KeyboardEvent) => {
            if (document.querySelector('.regional-go-modal')) return;
            if (event.key === 'Escape') { event.preventDefault(); setFullScreen(false); }
            if (event.key !== 'Tab') return;
            const targets = Array.from(chartRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, a[href], summary, [tabindex="0"]') ?? []).filter(el => el.getClientRects().length > 0);
            const first = targets[0], last = targets[targets.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        };
        document.addEventListener('keydown', onKey);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', onKey);
            queueMicrotask(() => fullScreenButton.current?.focus());
        };
    }, [fullScreen]);
    const validDate = isValidDate(date);
    const dayType = validDate ? (dayTypeForDate?.(date) ?? defaultDayType(date)) : null;
    const relevantSchedules = useMemo(() => schedules.filter(entry => entry.dayType === dayType), [schedules, dayType]);
    const masterKey = JSON.stringify([readTeamId, dayType, refresh, relevantSchedules.map(entry => [entry.id, entry.currentVersion, entry.storagePath])]);
    const masterLoading = validDate && (masterState.key !== masterKey || masterState.loading);
    const feedLoading = feedState.refresh !== refresh || feedState.loading;
    const listRefreshing = listRefresh.team === readTeamId && listRefresh.loading;
    const listRefreshError = listRefresh.team === readTeamId ? listRefresh.error : undefined;
    const refreshBlocked = listRefreshing || Boolean(listRefreshError);
    const sources = masterState.key === masterKey ? masterState.sources : [];

    useEffect(() => () => { listRequest.current += 1; }, [readTeamId]);

    const refreshSources = async () => {
        const request = ++listRequest.current;
        setDetail(null);
        setListRefresh({ team: readTeamId, loading: true });
        try {
            if (onRefreshSchedules) await boundedRead(onRefreshSchedules());
            if (request !== listRequest.current) return;
            setListRefresh({ team: readTeamId, loading: false });
            setRefresh(value => value + 1);
        } catch (error) {
            if (request === listRequest.current) setListRefresh({ team: readTeamId, loading: false, error: errorMessage(error) });
        }
    };

    useEffect(() => {
        const controller = new AbortController();
        setFeedState({ refresh, loading: true });
        fetchRegionalGoFeed({ forceRefresh: refresh > 0, signal: controller.signal })
            .then(feed => { if (!controller.signal.aborted) setFeedState({ refresh, loading: false, feed }); })
            .catch(error => { if (!controller.signal.aborted) setFeedState({ refresh, loading: false, error: errorMessage(error) }); });
        return () => controller.abort();
    }, [refresh]);

    useEffect(() => {
        let cancelled = false;
        setDetail(null);
        if (!readTeamId || !dayType || dayType === 'No Service') {
            setMasterState({ key: masterKey, loading: false, sources: [], notices: [] });
            return;
        }
        setMasterState({ key: masterKey, loading: true, sources: [], notices: [] });
        Promise.allSettled(relevantSchedules.map(async entry => {
            const result = await boundedRead(getMasterSchedule(readTeamId, buildRouteIdentity(entry.routeNumber, entry.dayType)));
            if (!result) throw new Error('Published master schedule is no longer available.');
            if (result.entry.routeNumber !== entry.routeNumber || result.entry.dayType !== entry.dayType || result.content.metadata.routeNumber !== entry.routeNumber || result.content.metadata.dayType !== entry.dayType) {
                throw new Error('Master schedule identity does not match its route and day type.');
            }
            return result;
        })).then(results => {
            if (cancelled) return;
            const notices: string[] = [];
            const loaded = results.map((result, index): PublishedRouteSource => {
                const requested = relevantSchedules[index];
                if (result.status === 'rejected') return { entry: requested, error: errorMessage(result.reason) };
                if (result.value.entry.currentVersion !== requested.currentVersion) {
                    notices.push(`Route ${requested.routeNumber} changed from v${requested.currentVersion} to v${result.value.entry.currentVersion}; the chart uses the newly read version.`);
                }
                return result.value;
            });
            setMasterState({ key: masterKey, loading: false, sources: loaded, notices });
        });
        return () => { cancelled = true; };
        // The key includes every field governing the selected read. Do not refetch for an equivalent array instance.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [masterKey]);

    useEffect(() => { setDetail(null); }, [station, direction, date]);
    const feed = feedState.refresh === refresh ? feedState.feed : undefined;
    const selectServiceDay = (target: DayType) => {
        const base = new Date(`${validDate ? date : localToday()}T12:00:00`);
        // Prefer today/next matching day, then a recent matching day if feed coverage ends.
        const offsets = [0, ...Array.from({ length: 14 }, (_, index) => index + 1), ...Array.from({ length: 14 }, (_, index) => -index - 1)];
        let fallback: string | undefined;
        for (const offset of offsets) {
            const candidate = new Date(base);
            candidate.setDate(base.getDate() + offset);
            const candidateDate = `${candidate.getFullYear()}-${String(candidate.getMonth() + 1).padStart(2, '0')}-${String(candidate.getDate()).padStart(2, '0')}`;
            if ((dayTypeForDate?.(candidateDate) ?? defaultDayType(candidateDate)) !== target) continue;
            fallback ??= candidateDate;
            if (!feed || getGoTrainEvents(feed, station, candidateDate).status !== 'unavailable') {
                setDate(candidateDate);
                return;
            }
        }
        // Keep coverage failures explicit rather than applying the wrong GO timetable.
        if (fallback) setDate(fallback);
    };
    const goResult = useMemo(() => feed && validDate ? getGoTrainEvents(feed, station, date) : null, [feed, validDate, station, date]);
    const rows = useMemo(() => dayType && dayType !== 'No Service' && !masterLoading ? buildLocalConnectionRows(sources, station, date, dayType).flatMap(row => {
        // Keep configured direction labels after failed reads, without inventing timing.
        const config = row.direction === 'Not loaded' ? getRouteConfig(row.routeNumber) : null;
        return config ? config.segments.map(segment => ({ ...row, id: `${row.id}:${segment.name}`, direction: segment.name })) : [row];
    }) : [], [sources, station, date, dayType, masterLoading]);
    const matrices = useMemo(() => (['to-go', 'from-go'] as const).map(connectionDirection => {
        const events = goResult?.events.filter(event => event.direction === connectionDirection) ?? [];
        return { direction: connectionDirection, events, cells: rows.map(row => ({ row, cells: events.map(event => findConnection(row, event)) })) };
    }), [rows, goResult]);
    const connectedRoutes = useMemo(() => new Set(matrices
        .filter(matrix => direction === 'both' || direction === matrix.direction)
        .flatMap(matrix => matrix.cells.filter(item => item.cells.some(cell =>
            cell.status === 'tight' || cell.status === 'comfortable' || cell.status === 'long'))
            .map(item => item.row.routeNumber))), [matrices, direction]);
    const unassessedRows = rows.filter(row => row.status === 'unavailable' || row.arrivalIssue || row.departureIssue);
    const sourceErrors = sources.filter(source => source.error);
    const canShowGrids = goResult?.status === 'ready' && !masterLoading && !feedLoading && !refreshBlocked;

    useEffect(() => {
        const matrices = Array.from(chartRef.current?.querySelectorAll<HTMLElement>('.regional-go-matrix') ?? []);
        const measure = () => matrices.forEach(matrix => {
            const header = matrix.querySelector<HTMLElement>('.regional-go-panel-head');
            const scroll = matrix.querySelector<HTMLElement>('.regional-go-scroll');
            const table = scroll?.querySelector<HTMLElement>('table');
            matrix.style.setProperty('--regional-header-height', `${header?.getBoundingClientRect().height ?? 0}px`);
            // Fit grids stick to the page; wide grids retain both axes in a bounded scroll area.
            scroll?.classList.toggle('regional-go-grid-fits', Boolean(table && table.offsetWidth <= scroll.clientWidth));
        });
        measure();
        const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
        matrices.forEach(matrix => observer?.observe(matrix));
        window.addEventListener('resize', measure);
        return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
    }, [canShowGrids, fullScreen, station, direction, date, rows.length]);

    const renderGrid = (connectionDirection: ConnectionDirection) => {
        const { events, cells } = matrices.find(matrix => matrix.direction === connectionDirection)!;
        const displayedCells = cells.filter(({ row }) => connectedRoutes.has(row.routeNumber));
        const toGo = connectionDirection === 'to-go';
        return <section key={connectionDirection} className="regional-go-matrix" aria-labelledby={`regional-${connectionDirection}-title`}>
            <header className="regional-go-panel-head"><div><div className="regional-go-panel-title"><h3 id={`regional-${connectionDirection}-title`}>{STATIONS[station]}</h3><span className={`regional-go-direction regional-go-direction-${connectionDirection}`}>{toGo ? 'To GO' : 'From GO'}</span></div><p>{date} · {toGo ? 'Bus arrival → GO departure' : 'GO arrival → bus departure'}</p></div><div className="regional-go-panel-actions"><span className="regional-go-train-count"><TrainFront size={15} aria-hidden="true" />{events.length} GO train trips</span>{fullScreen && <button type="button" className="regional-go-button" onClick={() => setFullScreen(false)}><Minimize2 size={15} /> Exit full screen</button>}</div></header>
            {events.length === 0 ? <p className="regional-go-empty">No GO train {toGo ? 'departures' : 'arrivals'} are scheduled at this station for the selected date.</p> : <>
                <div className="regional-go-scroll" tabIndex={0} role="region" aria-label={`${toGo ? 'To GO' : 'From GO'} connection grid; scroll horizontally for all trains`}>
                    <table style={{ minWidth: fullScreen ? 0 : Math.max(560, 170 + events.length * 92) }}>
                        <caption className="regional-go-sr-only">{STATIONS[station]} · {toGo ? 'To GO: bus arrival times' : 'From GO: bus departure times'}. Select a cell for details.</caption>
                        <thead><tr><th scope="col" className="regional-go-sticky">Bus route<br /><span>GO {toGo ? 'departure' : 'arrival'} →</span></th>{events.map(event => <th scope="col" key={event.id}><time>{formatServiceTime(event.minutes)}</time></th>)}</tr></thead>
                        <tbody>{displayedCells.map(({ row, cells: rowCells }) => <tr key={row.id}>
                            <th scope="row" className="regional-go-sticky regional-go-route"><strong>{routeLabel(row)}</strong></th>
                            {rowCells.map((cell, index) => <td className={`regional-go-${cell.status}`} key={events[index].id}><button type="button" className="regional-go-cell" onClick={() => setDetail({ row, event: events[index], cell })} aria-label={`${routeLabel(row)}, GO ${toGo ? 'departure' : 'arrival'} ${formatServiceTime(events[index].minutes)}, ${cell.busMinutes === undefined ? `${BAND_LABELS[cell.status]}${cell.status === 'unavailable' ? ', not assessed; see source warning' : ''}` : `${formatServiceTime(cell.busMinutes)}, ${cell.gapMinutes} minute scheduled gap${cell.status === 'tight' ? ', tight' : ''}`}`}>
                                {cell.busMinutes === undefined ? <span className="regional-go-no-result">No Connection{cell.status === 'unavailable' && <sup aria-hidden="true">†</sup>}</span> : <><time>{formatServiceTime(cell.busMinutes)}</time><small>{`${cell.gapMinutes} min${cell.status === 'tight' ? ' · tight' : ''}`}</small></>}
                            </button></td>)}
                        </tr>)}</tbody>
                        {rows.length > 0 && <tfoot><tr><th scope="row" className="regional-go-sticky">6–30 min gaps*</th>{events.map((event, index) => <td key={event.id}><strong>{cells.filter(({ cells: rowCells }) => rowCells[index].status === 'comfortable' || rowCells[index].status === 'long').length}</strong> / {cells.filter(({ cells: rowCells }) => rowCells[index].status !== 'unavailable').length} checked{cells.some(({ cells: rowCells }) => rowCells[index].status === 'unavailable') && <small> + not assessed</small>}</td>)}</tr></tfoot>}
                    </table>
                </div>
                {rows.length > 0 && displayedCells.length === 0 && <p className="regional-go-empty">No 1–30 minute connections to show. Routes without a connection are hidden.</p>}
                {rows.length === 0 && <p className="regional-go-empty">{dayType === 'No Service' ? 'The local annual calendar marks this date as No Service.' : relevantSchedules.length === 0 ? `No published ${dayType} master schedules are available.` : 'No local master timepoints are mapped to this station. A stop not represented in the master cannot be assessed.'}</p>}
            </>}
            <p className="regional-go-grid-note">*Scheduled gaps only. Walking/boarding not included. +1 day = after midnight.</p>
        </section>;
    };

    const chart = <section ref={chartRef} className={`regional-go-chart${fullScreen ? ' regional-go-fullscreen' : ''}`} role={fullScreen ? 'dialog' : undefined} aria-modal={fullScreen ? true : undefined} aria-label="Regional Transit Connections">
        <header className="regional-go-heading"><div className="regional-go-title"><span className="regional-go-brand-icon" aria-hidden="true"><TrainFront size={23} /></span><img className="regional-go-logo" src="/brand/go-transit-logo.svg" alt="GO Transit" width="69" height="28" /><h2>GO train connections</h2></div><div className="regional-go-actions">
            <button ref={fullScreenButton} type="button" className="regional-go-button regional-go-primary" onClick={() => setFullScreen(value => !value)}>{fullScreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}{fullScreen ? 'Exit full screen' : 'Full screen'}</button>
            <button type="button" className="regional-go-button" onClick={refreshSources} disabled={feedLoading || masterLoading || listRefreshing}><RefreshCw size={15} /> Refresh</button>
            <button type="button" className="regional-go-button" onClick={() => window.print()} disabled={!canShowGrids}><Printer size={15} /> Print</button>
        </div></header>
        <div className="regional-go-controls">
            <div className="regional-go-segments" role="group" aria-label="GO station">{(Object.keys(STATIONS) as GoStationKey[]).map(key => <button type="button" key={key} aria-pressed={station === key} onClick={() => setStation(key)}>{STATIONS[key].replace(' GO', '')}</button>)}</div>
            <div className="regional-go-segments" role="group" aria-label="Service day filter">{(['Weekday', 'Saturday', 'Sunday'] as const).map(value => <button type="button" key={value} aria-pressed={dayType === value} onClick={() => selectServiceDay(value)} title={`Choose a nearby ${value.toLowerCase()} service date`}>{value}</button>)}</div>
            <label>Date<input type="date" value={date} aria-label="Service date" onChange={event => setDate(event.target.value)} /></label>
            <div className="regional-go-segments" role="group" aria-label="Connection direction">{(['both', 'to-go', 'from-go'] as const).map(value => <button type="button" key={value} aria-pressed={direction === value} onClick={() => setDirection(value)}>{value === 'both' ? 'Both directions' : value === 'to-go' ? 'To GO' : 'From GO'}</button>)}</div>
        </div>
        <div className="regional-go-legend" aria-label="Scheduled gap legend">{Object.entries(BAND_LABELS).filter(([band]) => band !== 'unavailable').map(([band, label]) => <span key={band}><i className={`regional-go-${band}`} aria-hidden="true" />{label}</span>)}<span>Scheduled gaps · no walking/boarding allowance</span></div>
        {!validDate && <p className="regional-go-error" role="alert">Choose a valid service date.</p>}
        {!readTeamId && <p className="regional-go-error" role="alert">Select a team to read published master schedules.</p>}
        <div aria-live="polite" aria-atomic="true">
            {listRefreshing && <p className="regional-go-empty" role="status">Refreshing schedules…</p>}
            {listRefreshError && <p className="regional-go-error" role="alert"><strong>Refresh failed.</strong> {listRefreshError} Previous results are hidden. <button type="button" className="regional-go-inline-button" onClick={refreshSources}>Retry sources</button></p>}
            {(feedLoading || masterLoading) && <p className="regional-go-empty" role="status">{feedLoading ? 'Loading GO times… ' : ''}{masterLoading ? `Loading ${dayType ?? ''} bus times…` : ''}</p>}
            {!refreshBlocked && !feedLoading && feedState.error && <p className="regional-go-error" role="alert"><strong>GO times unavailable.</strong> {feedState.error} <button type="button" className="regional-go-inline-button" onClick={refreshSources}>Retry sources</button></p>}
            {!refreshBlocked && sourceErrors.length > 0 && <div className="regional-go-warning" role="alert"><AlertTriangle size={16} aria-hidden="true" /><span>Route{sourceErrors.length > 1 ? 's' : ''} {sourceErrors.map(source => source.entry.routeNumber).join(', ')} not assessed. Check Sources &amp; notes.</span><button type="button" className="regional-go-inline-button" onClick={refreshSources}>Retry sources</button></div>}
            {!refreshBlocked && goResult?.issues.map(issue => <p className="regional-go-notice" key={issue}>{issue}</p>)}
            {!refreshBlocked && !feedLoading && goResult?.status === 'unavailable' && <p className="regional-go-error">No GO times for this date. Check the feed dates in Sources & notes.</p>}
            {!refreshBlocked && !feedLoading && goResult?.status === 'no-service' && <p className="regional-go-empty">No GO trains scheduled for this station and date.</p>}
        </div>
        {canShowGrids && readTeamId && (['to-go', 'from-go'] as const).filter(value => direction === 'both' || direction === value).map(renderGrid)}
        {canShowGrids && unassessedRows.length > 0 && <p className="regional-go-grid-note" role="note">Routes {Array.from(new Set(unassessedRows.map(row => row.routeNumber))).join(', ')} have unassessed timing. Missing data is not confirmed absence of service. See Sources &amp; notes; † marks unassessed cells.</p>}
        <details className="regional-go-notes"><summary><Info size={15} aria-hidden="true" /> Sources &amp; notes</summary><div>
            <p className="regional-go-source-note">{STATIONS[station]} · {date || 'No date selected'}<br />{feed ? <>GO feed loaded {new Date(feed.fetchedAt).toLocaleString()} · {feed.timezone}<br />Feed dates: {displayFeedDate(goResult?.validFrom)} to {displayFeedDate(goResult?.validTo)}</> : 'GO source has not loaded.'}</p>
            <p className="regional-go-scope">{dayType ?? 'Choose a valid date'} · {dayTypeForDate ? 'Local annual calendar applied' : 'Calendar weekday; holiday overrides unavailable'}. Day filters select a matching date.</p>
            {masterState.key === masterKey && masterState.notices.map(notice => <p key={notice}>{notice}</p>)}
            {sourceErrors.length > 0 && <ul>{sourceErrors.map(source => <li key={source.entry.id}>Route {source.entry.routeNumber} · v{source.entry.currentVersion}: {source.error}</li>)}</ul>}
            {unassessedRows.length > 0 && <ul>{unassessedRows.map(row => <li key={row.id}>{routeLabel(row)}: {Array.from(new Set([row.issue, row.arrivalIssue, row.departureIssue].filter(Boolean))).join(' ')}</li>)}</ul>}
            <p>Routes without any 1–30 minute connection in the selected station, date and direction view are hidden. A connected route keeps all its direction rows. Counts include all assessed rows, including hidden routes.</p>
            {station === 'allandale' && <p>Includes Stop 14 (Essa at Gowan), across the street from Allandale GO—not a terminal platform. Walking and crossing time are not deducted.</p>}
            <p>Times are scheduled, not live. To GO uses bus arrival; From GO uses bus departure. Walking and boarding time are not deducted; transfers are not guaranteed.</p>
            <p>White “No Connection” means no 1–30 minute gap is shown. † means the row could not be checked, not confirmed absence of service. Missing data is excluded from the checked count.</p>
            <p>*Counts include 6–30 minute gaps; tight gaps are shown separately in yellow. +1 day means after midnight.</p>
            <p>Published bus schedules and date-valid GO train GTFS only; GO buses, on-demand, fares, accessibility and live reliability are not assessed. Source trip IDs and master versions are in cell details.</p>
            {feed && <p><a href={feed.sourceUrl} target="_blank" rel="noopener noreferrer">GO static timetable source</a></p>}
        </div></details>
        {detail && <ConnectionDetail detail={detail} stationName={STATIONS[station]} date={date} onClose={closeDetail} />}
    </section>;
    return fullScreen ? createPortal(chart, document.body) : chart;
};

export default RegionalTransitConnections;
