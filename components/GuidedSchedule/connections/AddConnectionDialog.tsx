import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bus, CheckCircle2, Clock, Loader2, TrainFront } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import type { DayType, MasterRouteTable } from '../../../utils/parsers/masterScheduleParser';
import type { ConnectionEventType, ConnectionTarget, ConnectionTime, ConnectionType, StopInfo } from '../../../utils/connections/connectionTypes';
import { formatConnectionTime, generateConnectionId } from '../../../utils/connections/connectionTypes';
import {
    deriveRouteTargetTimes,
    normalizeStopForMatch,
    parsePastedTimes,
} from '../../../utils/connections/guidedConnectionSetup';
import { fetchGoTransitGTFS, getCachedData, getGoStationTemplateData } from '../../../utils/gtfs/goTransitService';
import { fetchLinxFeed, getLinxBarrieStops, getLinxEventsForDay, toConnectionTimes, type LinxFeed } from '../../../utils/gtfs/linxTransitService';
import { getAllMasterSchedules, getMasterSchedule } from '../../../utils/services/masterScheduleService';
import type { RouteIdentity } from '../../../utils/masterScheduleTypes';

export type NewTargetInput = Omit<ConnectionTarget, 'id' | 'createdAt' | 'updatedAt'>;

interface AddConnectionDialogProps {
    isOpen: boolean;
    onClose: () => void;
    routeNumber: string;
    routeLabel: string;
    dayType: DayType;
    routeStops: StopInfo[];
    teamId?: string;
    onAdd: (target: NewTargetInput, stop: StopInfo, connectionType: ConnectionType) => void;
}

type Source = 'route' | 'go' | 'linx' | 'other';

const GO_STATIONS = [
    { id: 'allandale-waterfront' as const, name: 'Allandale Waterfront GO', codes: ['9003', '9006'], keyword: 'allandale' },
    { id: 'barrie-south' as const, name: 'Barrie South GO', codes: ['725'], keyword: 'barrie south' },
];

const eventToConnection = (eventType: ConnectionEventType): ConnectionType => (eventType === 'arrival' ? 'feed_arriving' : 'meet_departing');

const matchRouteStop = (routeStops: StopInfo[], codes: string[], keyword: string): StopInfo | null => (
    routeStops.find(stop => codes.includes(stop.code))
    ?? routeStops.find(stop => normalizeStopForMatch(stop.name).includes(keyword))
    ?? null
);

const TimeChips: React.FC<{ times: ConnectionTime[] | number[] }> = ({ times }) => (
    <div className="mt-1 flex max-h-28 flex-wrap gap-1 overflow-auto" data-testid="add-connection-times">
        {times.map((time, index) => {
            const minutes = typeof time === 'number' ? time : time.time;
            return <span key={`${minutes}-${index}`} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-bold text-gray-700">{formatConnectionTime(minutes)}</span>;
        })}
    </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <label className="flex flex-col gap-1">
        <span className="text-[11px] font-extrabold uppercase tracking-wide text-gray-500">{label}</span>
        {children}
    </label>
);

const selectClass = 'rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm';

const Notice: React.FC<{ tone: 'ok' | 'warn'; children: React.ReactNode }> = ({ tone, children }) => (
    <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${tone === 'ok' ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}>
        {tone === 'ok' ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-none" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />}
        <span>{children}</span>
    </div>
);

export const AddConnectionDialog: React.FC<AddConnectionDialogProps> = ({
    isOpen,
    onClose,
    routeNumber,
    routeLabel,
    dayType,
    routeStops,
    teamId,
    onAdd,
}) => {
    const [source, setSource] = useState<Source>('go');

    // ----- GO -----
    const [goStationId, setGoStationId] = useState<typeof GO_STATIONS[number]['id']>('allandale-waterfront');
    const [goDirection, setGoDirection] = useState<'southbound' | 'northbound'>('southbound');
    const [goStatus, setGoStatus] = useState<'idle' | 'loading' | 'ready' | 'fallback'>('idle');
    const [goStopCode, setGoStopCode] = useState('');

    // ----- LINX -----
    const [linxFeed, setLinxFeed] = useState<LinxFeed | null>(null);
    const [linxError, setLinxError] = useState<string | null>(null);
    const [linxStopName, setLinxStopName] = useState('');
    const [linxType, setLinxType] = useState<ConnectionEventType>('departure');
    const [linxStopCode, setLinxStopCode] = useState('');

    // ----- Barrie Transit route -----
    const [routeOptions, setRouteOptions] = useState<string[] | null>(null);
    const [otherRoute, setOtherRoute] = useState('');
    const [otherTables, setOtherTables] = useState<MasterRouteTable[] | null>(null);
    const [otherTableIndex, setOtherTableIndex] = useState(0);
    const [otherStop, setOtherStop] = useState('');
    const [routeType, setRouteType] = useState<ConnectionEventType>('departure');
    const [routeError, setRouteError] = useState<string | null>(null);

    // ----- Other -----
    const [otherName, setOtherName] = useState('');
    const [otherType, setOtherType] = useState<ConnectionEventType>('departure');
    const [otherStopCode, setOtherStopCode] = useState(routeStops[0]?.code ?? '');
    const [otherText, setOtherText] = useState('');

    const station = GO_STATIONS.find(item => item.id === goStationId)!;

    useEffect(() => {
        if (!isOpen || source !== 'go' || goStatus !== 'idle') return;
        setGoStatus('loading');
        fetchGoTransitGTFS().then(() => setGoStatus('ready')).catch(() => setGoStatus('fallback'));
    }, [isOpen, source, goStatus]);

    useEffect(() => {
        setGoStopCode(matchRouteStop(routeStops, station.codes, station.keyword)?.code ?? '');
    }, [routeStops, station]);

    const goTemplate = useMemo(() => (
        goStatus === 'ready' || goStatus === 'fallback' ? getGoStationTemplateData(goStationId, dayType, goDirection) : null
    ), [goStatus, goStationId, dayType, goDirection]);

    useEffect(() => {
        if (!isOpen || source !== 'linx' || linxFeed || linxError) return;
        fetchLinxFeed()
            .then(feed => {
                setLinxFeed(feed);
                const first = getLinxBarrieStops(feed)[0];
                if (first) setLinxStopName(first.name);
            })
            .catch(error => setLinxError(error instanceof Error ? error.message : 'Could not load the LINX feed.'));
    }, [isOpen, source, linxFeed, linxError]);

    const linxStopGroups = useMemo(() => {
        if (!linxFeed) return [] as Array<{ name: string; ids: string[] }>;
        const groups = new Map<string, string[]>();
        getLinxBarrieStops(linxFeed).forEach(stop => groups.set(stop.name, [...(groups.get(stop.name) ?? []), stop.stopId]));
        return [...groups.entries()].map(([name, ids]) => ({ name, ids }));
    }, [linxFeed]);

    useEffect(() => {
        const key = normalizeStopForMatch(linxStopName.replace(/^barrie,?\s*/i, '').replace(/\s*-\s*detour$/i, '').replace(/bus station/i, ''));
        const words = key.split(' ').filter(word => word.length > 3);
        const match = routeStops.find(stop => words.some(word => normalizeStopForMatch(stop.name).includes(word)));
        setLinxStopCode(match?.code ?? '');
    }, [linxStopName, routeStops]);

    const linxTimes = useMemo(() => {
        const group = linxStopGroups.find(item => item.name === linxStopName);
        if (!linxFeed || !group) return [];
        return toConnectionTimes(getLinxEventsForDay(linxFeed, group.ids, dayType), dayType, linxType);
    }, [linxFeed, linxStopGroups, linxStopName, dayType, linxType]);

    useEffect(() => {
        if (!isOpen || source !== 'route' || routeOptions || !teamId) return;
        getAllMasterSchedules(teamId)
            .then(entries => setRouteOptions(
                entries
                    .filter(entry => entry.dayType === dayType && entry.routeNumber.toUpperCase() !== routeNumber.toUpperCase())
                    .map(entry => entry.routeNumber)
                    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
            ))
            .catch(() => setRouteError('Could not load the published routes.'));
    }, [isOpen, source, routeOptions, teamId, dayType, routeNumber]);

    useEffect(() => {
        setOtherTables(null);
        setOtherStop('');
        setRouteError(null);
        if (!otherRoute || !teamId) return;
        let cancelled = false;
        getMasterSchedule(teamId, `${otherRoute}-${dayType}` as RouteIdentity)
            .then(result => {
                if (cancelled) return;
                const tables = result ? [result.content.northTable, result.content.southTable].filter(table => table && table.trips.length > 0) : [];
                setOtherTables(tables);
                setOtherTableIndex(0);
                if (tables.length === 0) setRouteError(`Route ${otherRoute} has no ${dayType} master.`);
            })
            .catch(() => !cancelled && setRouteError(`Could not load Route ${otherRoute} ${dayType}.`));
        return () => { cancelled = true; };
    }, [otherRoute, teamId, dayType]);

    /** Stops on the other route that this route also serves (same code or hub name). */
    const sharedStops = useMemo(() => {
        const table = otherTables?.[otherTableIndex];
        if (!table) return [] as Array<{ otherName: string; otherCode: string; routeStop: StopInfo }>;
        return table.stops.flatMap(stopName => {
            const code = table.stopIds?.[stopName] ?? '';
            const routeStop = routeStops.find(stop => stop.code === code)
                ?? routeStops.find(stop => normalizeStopForMatch(stop.name) === normalizeStopForMatch(stopName));
            return routeStop ? [{ otherName: stopName, otherCode: code, routeStop }] : [];
        });
    }, [otherTables, otherTableIndex, routeStops]);

    useEffect(() => {
        setOtherStop(sharedStops[0]?.otherName ?? '');
    }, [sharedStops]);

    const routeTimes = useMemo(() => {
        const table = otherTables?.[otherTableIndex];
        return table && otherStop ? deriveRouteTargetTimes(table, otherStop, dayType) : [];
    }, [otherTables, otherTableIndex, otherStop, dayType]);

    const pastedTimes = useMemo(() => parsePastedTimes(otherText), [otherText]);

    const stopByCode = (code: string) => routeStops.find(stop => stop.code === code) ?? null;
    const routeStopSelect = (value: string, onChange: (code: string) => void, allowNone = false) => (
        <select value={value} onChange={event => onChange(event.target.value)} className={selectClass} aria-label={`Meets ${routeLabel} at`}>
            {allowNone && <option value="">Choose a stop…</option>}
            {routeStops.map(stop => <option key={stop.code} value={stop.code}>{stop.name}</option>)}
        </select>
    );

    let preview: string = '';
    let canAdd = false;
    let submit: () => void = () => undefined;

    if (source === 'go' && goTemplate) {
        const stop = stopByCode(goStopCode);
        canAdd = !!stop && goTemplate.times.length > 0;
        preview = `${goTemplate.times.length} trains · default rule: ${goDirection === 'southbound' ? 'bus arrives 5–15 min before the train leaves' : 'bus leaves 5–15 min after the train arrives'}`;
        submit = () => stop && onAdd({
            name: `GO ${station.name} • ${goDirection === 'southbound' ? 'To Union' : 'From Union'}`,
            type: 'manual',
            icon: 'train',
            location: station.name,
            stopCode: stop.code,
            stopName: stop.name,
            defaultEventType: goTemplate.defaultEventType,
            times: goTemplate.times,
            source: goTemplate.dataSource === 'gtfs' ? 'go-gtfs' : undefined,
            sourceFetchedAt: goTemplate.dataSource === 'gtfs' ? getCachedData()?.fetchedAt : undefined,
        }, stop, eventToConnection(goTemplate.defaultEventType));
    } else if (source === 'linx') {
        const stop = stopByCode(linxStopCode);
        canAdd = !!stop && linxTimes.length > 0;
        preview = linxFeed ? `${linxTimes.length} LINX ${linxType === 'departure' ? 'departures' : 'arrivals'} on ${dayType}` : '';
        submit = () => stop && linxFeed && onAdd({
            name: `LINX at ${linxStopName.replace(/^Barrie,?\s*/i, '')} • ${linxType === 'departure' ? 'Departures' : 'Arrivals'}`,
            type: 'manual',
            icon: 'bus',
            location: linxStopName,
            stopCode: stop.code,
            stopName: stop.name,
            defaultEventType: linxType,
            times: linxTimes,
            source: 'linx-gtfs',
            sourceFetchedAt: linxFeed.fetchedAt,
        }, stop, eventToConnection(linxType));
    } else if (source === 'route') {
        const shared = sharedStops.find(item => item.otherName === otherStop);
        const table = otherTables?.[otherTableIndex];
        canAdd = !!shared && routeTimes.length > 0;
        preview = shared ? `${routeTimes.length} Route ${otherRoute} times at ${otherStop}` : '';
        submit = () => shared && table && onAdd({
            name: `Route ${otherRoute}${otherTables && otherTables.length > 1 ? ` (${table.routeName.match(/\((North|South)\)/)?.[1] ?? 'trips'})` : ''} • ${shared.routeStop.name}`,
            type: 'route',
            icon: 'bus',
            routeIdentity: `${otherRoute}-${dayType}`,
            direction: (table.routeName.match(/\((North|South)\)/)?.[1] as 'North' | 'South' | undefined),
            stopCode: shared.otherCode,
            stopName: shared.otherName,
            defaultEventType: routeType,
            times: routeTimes,
            source: 'route-master',
        }, shared.routeStop, eventToConnection(routeType));
    } else if (source === 'other') {
        const stop = stopByCode(otherStopCode);
        canAdd = !!stop && pastedTimes.length > 0 && otherName.trim().length > 0;
        preview = `${pastedTimes.length} times read`;
        submit = () => stop && onAdd({
            name: otherName.trim(),
            type: 'manual',
            icon: 'clock',
            stopCode: stop.code,
            stopName: stop.name,
            defaultEventType: otherType,
            times: pastedTimes.map(time => ({ id: generateConnectionId(), time, daysActive: [dayType], enabled: true })),
            source: 'pasted',
        }, stop, eventToConnection(otherType));
    }

    const tabs: Array<{ id: Source; label: string; hint: string; icon: React.ReactNode }> = [
        { id: 'route', label: 'Barrie Transit route', hint: 'From the published masters', icon: <Bus className="h-4 w-4 text-violet-600" /> },
        { id: 'go', label: 'GO Transit', hint: 'Metrolinx GTFS', icon: <TrainFront className="h-4 w-4 text-green-700" /> },
        { id: 'linx', label: 'LINX', hint: 'Simcoe County GTFS', icon: <Bus className="h-4 w-4 text-indigo-600" /> },
        { id: 'other', label: 'Other', hint: 'Bells, shifts, events', icon: <Clock className="h-4 w-4 text-teal-600" /> },
    ];

    return (
        <Modal isOpen={isOpen} onClose={onClose} size="lg" zIndex="high">
            <Modal.Header>Add a connection for {routeLabel} · {dayType}</Modal.Header>
            <Modal.Body className="space-y-3">
                <div className="grid grid-cols-4 gap-2" role="tablist" aria-label="Connection source">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={source === tab.id}
                            onClick={() => setSource(tab.id)}
                            className={`rounded-lg border p-2 text-left ${source === tab.id ? 'border-blue-500 ring-2 ring-blue-500/15' : 'border-gray-200 hover:bg-gray-50'}`}
                        >
                            <span className="flex items-center gap-1.5 text-sm font-bold text-gray-900">{tab.icon}{tab.label}</span>
                            <span className="text-[11px] text-gray-500">{tab.hint}</span>
                        </button>
                    ))}
                </div>

                {source === 'go' && (
                    <div className="space-y-3">
                        {goStatus === 'loading' && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading GO times…</p>}
                        {goTemplate && (goTemplate.dataSource === 'gtfs'
                            ? <Notice tone="ok">GO GTFS (Metrolinx) · downloaded {new Date(getCachedData()?.fetchedAt ?? Date.now()).toLocaleDateString()} · {dayType} service.</Notice>
                            : <Notice tone="warn">The GO feed could not be read, so these are typical times, not the published schedule.</Notice>)}
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Station">
                                <select value={goStationId} onChange={event => setGoStationId(event.target.value as typeof goStationId)} className={selectClass}>
                                    {GO_STATIONS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                                </select>
                            </Field>
                            <Field label="Connection">
                                <select value={goDirection} onChange={event => setGoDirection(event.target.value as typeof goDirection)} className={selectClass}>
                                    <option value="southbound">Bus to the train · trains to Union</option>
                                    <option value="northbound">Train to the bus · trains from Union</option>
                                </select>
                            </Field>
                        </div>
                        <Field label={`Meets ${routeLabel} at`}>{routeStopSelect(goStopCode, setGoStopCode, true)}</Field>
                        {!goStopCode && <Notice tone="warn">{routeLabel} does not stop at {station.name}. Choose a stop only if riders walk between them.</Notice>}
                        {goTemplate && (goTemplate.times.length > 0
                            ? <Field label={`${dayType} trains`}><TimeChips times={goTemplate.times} /></Field>
                            : <Notice tone="warn">No {dayType} trains at {station.name} in this direction.</Notice>)}
                    </div>
                )}

                {source === 'linx' && (
                    <div className="space-y-3">
                        {!linxFeed && !linxError && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading LINX times…</p>}
                        {linxError && <Notice tone="warn">Could not load the LINX feed: {linxError}</Notice>}
                        {linxFeed && (
                            <>
                                <Notice tone="ok">LINX GTFS (Simcoe County, hosted by Metrolinx) · {linxFeed.feedVersion ? 'published feed' : 'feed'} downloaded {new Date(linxFeed.fetchedAt).toLocaleDateString()}.</Notice>
                                <div className="grid grid-cols-2 gap-3">
                                    <Field label="LINX stop">
                                        <select value={linxStopName} onChange={event => setLinxStopName(event.target.value)} className={selectClass}>
                                            {linxStopGroups.map(group => <option key={group.name} value={group.name}>{group.name}</option>)}
                                        </select>
                                    </Field>
                                    <Field label="Connection">
                                        <select value={linxType} onChange={event => setLinxType(event.target.value as ConnectionEventType)} className={selectClass}>
                                            <option value="departure">Bus to LINX · LINX departures</option>
                                            <option value="arrival">LINX to the bus · LINX arrivals</option>
                                        </select>
                                    </Field>
                                </div>
                                <Field label={`Meets ${routeLabel} at`}>{routeStopSelect(linxStopCode, setLinxStopCode, true)}</Field>
                                {!linxStopCode && <Notice tone="warn">{routeLabel} has no stop that matches {linxStopName}. Choose one only if riders transfer there.</Notice>}
                                {linxTimes.length > 0
                                    ? <Field label={`${dayType} LINX ${linxType === 'departure' ? 'departures' : 'arrivals'}`}><TimeChips times={linxTimes} /></Field>
                                    : <Notice tone="warn">No LINX service at {linxStopName} on {dayType === 'Weekday' ? 'weekdays' : `${dayType}s`}.</Notice>}
                            </>
                        )}
                    </div>
                )}

                {source === 'route' && (
                    <div className="space-y-3">
                        {!teamId && <Notice tone="warn">Route connections need a team workspace.</Notice>}
                        {teamId && !routeOptions && !routeError && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading routes…</p>}
                        {routeError && <Notice tone="warn">{routeError}</Notice>}
                        {routeOptions && (
                            <div className="grid grid-cols-3 gap-3">
                                <Field label="Route">
                                    <select value={otherRoute} onChange={event => setOtherRoute(event.target.value)} className={selectClass}>
                                        <option value="">Choose…</option>
                                        {routeOptions.map(route => <option key={route} value={route}>Route {route}</option>)}
                                    </select>
                                </Field>
                                <Field label="Trips">
                                    <select value={otherTableIndex} onChange={event => setOtherTableIndex(Number(event.target.value))} className={selectClass} disabled={!otherTables || otherTables.length < 2}>
                                        {(otherTables ?? []).map((table, index) => <option key={table.routeName} value={index}>{table.routeName.match(/\((North|South)\)/)?.[1] ?? table.routeName}</option>)}
                                    </select>
                                </Field>
                                <Field label="Connection">
                                    <select value={routeType} onChange={event => setRouteType(event.target.value as ConnectionEventType)} className={selectClass}>
                                        <option value="departure">{routeLabel} to Route {otherRoute || '…'}</option>
                                        <option value="arrival">Route {otherRoute || '…'} to {routeLabel}</option>
                                    </select>
                                </Field>
                            </div>
                        )}
                        {otherTables && otherTables.length > 0 && (sharedStops.length > 0 ? (
                            <Field label="Shared stop">
                                <select value={otherStop} onChange={event => setOtherStop(event.target.value)} className={selectClass}>
                                    {sharedStops.map(item => <option key={item.otherName} value={item.otherName}>{item.otherName} (meets {routeLabel} at {item.routeStop.name})</option>)}
                                </select>
                            </Field>
                        ) : <Notice tone="warn">Route {otherRoute} and {routeLabel} share no timepoint in this direction.</Notice>)}
                        {routeTimes.length > 0 && <Field label={`${dayType} times`}><TimeChips times={routeTimes} /></Field>}
                    </div>
                )}

                {source === 'other' && (
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Name">
                                <input value={otherName} onChange={event => setOtherName(event.target.value)} placeholder="Georgian College bells" className={selectClass} />
                            </Field>
                            <Field label={`Meets ${routeLabel} at`}>{routeStopSelect(otherStopCode, setOtherStopCode)}</Field>
                        </div>
                        <Field label="These times are">
                            <select value={otherType} onChange={event => setOtherType(event.target.value as ConnectionEventType)} className={selectClass}>
                                <option value="departure">Departures or start times (bus arrives before)</option>
                                <option value="arrival">Arrivals or end times (bus leaves after)</option>
                            </select>
                        </Field>
                        <Field label="Times (paste from a timetable, any format)">
                            <textarea value={otherText} onChange={event => setOtherText(event.target.value)} rows={3} className={`${selectClass} font-mono text-xs`} placeholder="8:00 AM  10:00 AM  1:00 PM  3:00 PM" />
                        </Field>
                        {pastedTimes.length > 0 && <TimeChips times={pastedTimes} />}
                    </div>
                )}
            </Modal.Body>
            <Modal.Footer>
                <span className="mr-auto text-xs text-gray-500" data-testid="add-connection-preview">{preview}</span>
                <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-bold text-gray-700 hover:bg-gray-50">Cancel</button>
                <button
                    type="button"
                    disabled={!canAdd}
                    onClick={submit}
                    className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-bold text-white hover:bg-gray-700 disabled:opacity-40"
                >
                    Add to the bottom of the ranking
                </button>
            </Modal.Footer>
        </Modal>
    );
};
