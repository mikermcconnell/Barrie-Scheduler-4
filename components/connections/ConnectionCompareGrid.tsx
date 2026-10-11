import React, { useState } from 'react';
import { Maximize2, Minimize2, TrainFront } from 'lucide-react';
import { formatServiceTime } from '../../utils/regional-transit/connectionAnalysis';
import { CHANGED_OUTCOMES, isConnected, signed, type CellOutcome, type CompareCell, type CompareColumn, type ConnectionComparison } from '../../utils/regional-transit/connectionCompare';
import type { ConnectionCell, LocalConnectionRow } from '../../utils/regional-transit/types';
import { BAND_NAMES, OUTCOME_LABELS, OUTCOME_MARKS, SUMMARY_OUTCOMES } from './connectionLabels';
import { DetailDialog } from './DetailDialog';

interface CompareGridProps {
    comparison: ConnectionComparison;
    stationName: string;
    beforeDate: string;
    afterDate: string;
    visibleRoutes: Set<string>;
    changesOnly: boolean;
    focus: CellOutcome | null;
    onFocus: (outcome: CellOutcome | null) => void;
    routeLabel: (row: LocalConnectionRow) => string;
    fullScreen: boolean;
    onToggleFullScreen: () => void;
}

interface CompareDetailState { row: LocalConnectionRow; column: CompareColumn; cell: CompareCell }

const isGood = (cell: ConnectionCell | null) => cell?.status === 'comfortable' || cell?.status === 'long';

function waitText(cell: ConnectionCell | null): string {
    return isConnected(cell) ? `${cell.gapMinutes} min · ${BAND_NAMES[cell.status]}` : cell?.status === 'unavailable' ? 'Not assessed' : 'No connection';
}

function trainName(column: CompareColumn): string {
    return column.trainNumber ? `Train ${column.trainNumber}` : `GO trip ${(column.after ?? column.before)!.tripId}`;
}

function explain(column: CompareColumn, cell: CompareCell): string[] {
    const lines: string[] = [];
    if (column.change === 'moved') lines.push(`${trainName(column)} moved ${signed(column.shiftMinutes!)} min (${formatServiceTime(column.before!.minutes)} → ${formatServiceTime(column.after!.minutes)}).`);
    if (column.change === 'added') lines.push(`${trainName(column)} is a new train.`);
    if (column.change === 'removed') lines.push(`${trainName(column)} is cancelled.`);
    if (cell.busChanged) lines.push('A different bus trip now makes the closest connection.');
    const { before, after } = cell;
    if (cell.outcome === 'gained' && isConnected(after)) lines.push(`This route gains a ${after.gapMinutes}-minute ${BAND_NAMES[after.status]} connection.`);
    if (cell.outcome === 'lost' && isConnected(before)) lines.push(`This route loses its ${before.gapMinutes}-minute ${BAND_NAMES[before.status]} connection.`);
    if ((cell.outcome === 'better' || cell.outcome === 'worse') && isConnected(before) && isConnected(after)) {
        lines.push(`The wait goes from ${before.gapMinutes} min (${BAND_NAMES[before.status]}) to ${after.gapMinutes} min (${BAND_NAMES[after.status]}).`);
    }
    if (cell.outcome === 'changed' && isConnected(before) && isConnected(after)) {
        lines.push(`The wait goes from ${before.gapMinutes} to ${after.gapMinutes} min; still ${BAND_NAMES[after.status]}.`);
    }
    if (cell.outcome === 'unchanged') lines.push('No change for riders.');
    if (cell.outcome === 'unassessed') lines.push((after?.status === 'unavailable' ? after : before)?.issue ?? 'This connection could not be assessed.');
    return lines;
}

function CompareDetail({ detail, stationName, beforeDate, afterDate, routeLabel, onClose }: { detail: CompareDetailState; stationName: string; beforeDate: string; afterDate: string; routeLabel: (row: LocalConnectionRow) => string; onClose: () => void }) {
    const { row, column, cell } = detail;
    const toGo = column.direction === 'to-go';
    const side = (label: string, date: string, event: CompareColumn['before'], value: ConnectionCell | null) => <td>
        <strong>{label}</strong><br /><small>{date}</small>
        <dl><dt>GO {toGo ? 'departure' : 'arrival'}</dt><dd>{event ? formatServiceTime(event.minutes) : 'Not running'}</dd>
            <dt>Bus {toGo ? 'arrival' : 'departure'}</dt><dd>{value?.busMinutes === undefined ? '—' : formatServiceTime(value.busMinutes)}</dd>
            <dt>Wait</dt><dd className={`regional-go-${isConnected(value) ? value.status : 'no-connection'}`}>{waitText(value)}</dd>
            <dt>Bus trip</dt><dd>{value?.tripId || '—'}</dd></dl>
    </td>;
    return <DetailDialog titleId="regional-go-compare-title" onClose={onClose}>
        <p className="regional-go-eyebrow">{stationName} · {toGo ? 'To GO' : 'From GO'} · Compare</p>
        <h3 id="regional-go-compare-title">{routeLabel(row)} × {trainName(column)}</h3>
        <div className={`regional-go-detail-status regional-go-outcome regional-go-outcome-${cell.outcome}`}>
            <strong>{OUTCOME_LABELS[cell.outcome]}{cell.waitDelta ? ` · wait ${signed(cell.waitDelta)} min` : ''}</strong>
            {explain(column, cell).map(line => <p key={line}>{line}</p>)}
        </div>
        <table className="regional-go-compare-sides"><tbody><tr>{side('Before', beforeDate, column.before, cell.before)}{side('After', afterDate, column.after, cell.after)}</tr></tbody></table>
        <p>Walking and boarding time are not deducted. Transfers are not guaranteed.</p>
    </DetailDialog>;
}

export const ConnectionCompareGrid: React.FC<CompareGridProps> = ({ comparison, stationName, beforeDate, afterDate, visibleRoutes, changesOnly, focus, onFocus, routeLabel, fullScreen, onToggleFullScreen }) => {
    const [detail, setDetail] = useState<CompareDetailState | null>(null);
    const closeDetail = React.useCallback(() => setDetail(null), []);
    const { direction, columns, rows, counts } = comparison;
    const toGo = direction === 'to-go';
    const changed = (cell: CompareCell) => CHANGED_OUTCOMES.includes(cell.outcome);
    const shownColumns = columns.map((column, index) => ({ column, index }))
        .filter(({ column, index }) => !changesOnly || column.change !== 'same' || rows.some(item => changed(item.cells[index])));
    const shownRows = rows.filter(({ row, cells }) => visibleRoutes.has(row.routeNumber) && (!changesOnly || shownColumns.some(({ index }) => changed(cells[index]))));
    const affected = rows.map(item => ({ item, lost: item.cells.filter(cell => cell.outcome === 'lost').length, worse: item.cells.filter(cell => cell.outcome === 'worse').length }))
        .filter(entry => entry.lost + entry.worse > 0).sort((a, b) => b.lost * 2 + b.worse - (a.lost * 2 + a.worse)).slice(0, 3);

    const header = (column: CompareColumn) => {
        const event = column.after ?? column.before!;
        return <>
            <time>{column.change === 'removed' ? <s>{formatServiceTime(event.minutes)}</s> : formatServiceTime(event.minutes)}</time>
            {column.change !== 'same' && <small className="regional-go-demo-tag">{column.change === 'moved' ? `Moved ${signed(column.shiftMinutes!)}` : column.change === 'added' ? 'New' : 'Cancelled'}</small>}
            {column.change === 'moved' && <small className="regional-go-compare-was">was {formatServiceTime(column.before!.minutes)}</small>}
        </>;
    };

    const body = (cell: CompareCell) => {
        const { before, after, outcome } = cell;
        if (isConnected(after)) return <>
            <time>{formatServiceTime(after.busMinutes!)}</time>
            <small>{after.gapMinutes} min{cell.waitDelta ? ` · ${signed(cell.waitDelta)}` : ''}{cell.busChanged && <span title="Different bus trip"> ↻</span>}</small>
            {outcome === 'gained' ? <small className="regional-go-compare-was">was none</small>
                : isConnected(before) && before.gapMinutes !== after.gapMinutes && <small className="regional-go-compare-was">was {before.gapMinutes} min</small>}
        </>;
        if (outcome === 'lost' && isConnected(before)) return <><span className="regional-go-no-result">Lost</span><small className="regional-go-compare-was">was {before.gapMinutes} min</small></>;
        return <span className="regional-go-no-result">No connection{outcome === 'unassessed' && <sup aria-hidden="true">†</sup>}</span>;
    };

    return <section className="regional-go-matrix regional-go-compare" aria-labelledby={`regional-compare-${direction}-title`}>
        <header className="regional-go-panel-head"><div><div className="regional-go-panel-title"><h3 id={`regional-compare-${direction}-title`}>{stationName}</h3><span className={`regional-go-direction regional-go-direction-${direction}`}>{toGo ? 'To GO' : 'From GO'}</span><span className="regional-go-compare-badge">Compare</span></div>
            <p>{beforeDate === afterDate ? beforeDate : `${beforeDate} → ${afterDate}`} · change in rider wait · {toGo ? 'bus arrival → GO departure' : 'GO arrival → bus departure'}</p></div>
            <div className="regional-go-panel-actions"><span className="regional-go-train-count"><TrainFront size={15} aria-hidden="true" />{columns.filter(column => column.change !== 'same').length} train changes</span><button type="button" className="regional-go-button" onClick={onToggleFullScreen}>{fullScreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}{fullScreen ? 'Exit full screen' : 'Full screen'}</button></div></header>
        <div className="regional-go-compare-summary" role="group" aria-label={`${toGo ? 'To GO' : 'From GO'} connection changes`}>
            {SUMMARY_OUTCOMES.map(outcome => <button type="button" key={outcome} className={`regional-go-outcome regional-go-outcome-${outcome}`} aria-pressed={focus === outcome} onClick={() => onFocus(focus === outcome ? null : outcome)} disabled={counts[outcome] === 0}>
                {OUTCOME_MARKS[outcome] && <span aria-hidden="true">{OUTCOME_MARKS[outcome]} </span>}<strong>{counts[outcome]}</strong> {OUTCOME_LABELS[outcome].toLowerCase()}
            </button>)}
            {affected.length > 0 && <span className="regional-go-compare-affected">Most affected: {affected.map(({ item, lost, worse }) => `${routeLabel(item.row)} (${[lost && `${lost} lost`, worse && `${worse} worse`].filter(Boolean).join(', ')})`).join(' · ')}</span>}
        </div>
        {columns.length === 0 ? <p className="regional-go-empty">No GO train {toGo ? 'departures' : 'arrivals'} in either timetable.</p> : <>
            <div className="regional-go-scroll" tabIndex={0} role="region" aria-label={`${toGo ? 'To GO' : 'From GO'} comparison grid; scroll horizontally for all trains`}>
                <table style={{ minWidth: fullScreen ? 0 : Math.max(560, 170 + shownColumns.length * 96) }}>
                    <caption className="regional-go-sr-only">{stationName} · {toGo ? 'To GO' : 'From GO'} · before and after comparison. Select a cell for details.</caption>
                    <thead><tr><th scope="col" className="regional-go-sticky">Bus route<br /><span>GO {toGo ? 'departure' : 'arrival'} →</span></th>
                        {shownColumns.map(({ column }) => <th scope="col" key={column.id} className={column.change === 'same' ? undefined : 'regional-go-demo-column'}>{header(column)}</th>)}</tr></thead>
                    <tbody>{shownRows.map(({ row, cells }) => <tr key={row.id}>
                        <th scope="row" className="regional-go-sticky regional-go-route"><strong>{routeLabel(row)}</strong></th>
                        {shownColumns.map(({ column, index }) => {
                            const cell = cells[index];
                            const quiet = cell.outcome === 'unchanged' || cell.outcome === 'none';
                            const dim = focus !== null && cell.outcome !== focus;
                            const status = isConnected(cell.after) ? cell.after.status : 'no-connection';
                            const event = column.after ?? column.before!;
                            return <td key={column.id} className={`regional-go-${status} regional-go-outcome regional-go-outcome-${cell.outcome}${quiet ? ' regional-go-compare-quiet' : ''}${dim ? ' regional-go-compare-dim' : ''}`}>
                                <button type="button" className="regional-go-cell" onClick={() => setDetail({ row, column, cell })}
                                    aria-label={`${routeLabel(row)}, ${trainName(column)}, GO ${toGo ? 'departure' : 'arrival'} ${formatServiceTime(event.minutes)}: ${OUTCOME_LABELS[cell.outcome]}. Before: ${waitText(cell.before)}. After: ${waitText(cell.after)}.`}>
                                    {OUTCOME_MARKS[cell.outcome] && <span className="regional-go-outcome-mark" aria-hidden="true">{OUTCOME_MARKS[cell.outcome]}</span>}
                                    {body(cell)}
                                </button>
                            </td>;
                        })}
                    </tr>)}</tbody>
                    {rows.length > 0 && <tfoot><tr><th scope="row" className="regional-go-sticky">Comfortable or long wait*</th>{shownColumns.map(({ column, index }) => {
                        const before = rows.filter(item => isGood(item.cells[index].before)).length;
                        const after = rows.filter(item => isGood(item.cells[index].after)).length;
                        return <td key={column.id}><strong>{after}</strong>{after !== before && <small> ({signed(after - before)})</small>}</td>;
                    })}</tr></tfoot>}
                </table>
            </div>
            {shownRows.length === 0 && <p className="regional-go-empty">{changesOnly ? 'No bus connections change in this direction.' : 'No 1–30 minute connections in either timetable.'}</p>}
        </>}
        <p className="regional-go-grid-note">Fill shows the after wait. Edge shows the rider result: <b className="regional-go-key-better">▲ better</b> · <b className="regional-go-key-worse">▼ worse</b> · <b className="regional-go-key-gained">+ gained</b> · <b className="regional-go-key-lost">× lost</b>. ↻ = a different bus trip. *After counts, change in brackets.</p>
        {detail && <CompareDetail detail={detail} stationName={stationName} beforeDate={beforeDate} afterDate={afterDate} routeLabel={routeLabel} onClose={closeDetail} />}
    </section>;
};

export default ConnectionCompareGrid;
