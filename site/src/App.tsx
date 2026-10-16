import { type ChangeEvent, type DragEvent, useMemo, useRef, useState } from 'react';
import { AttentionPanel } from './components/AttentionPanel';
import { KpiGrid } from './components/KpiGrid';
import { RidershipChart } from './components/RidershipChart';
import { RoutesTable } from './components/RoutesTable';
import { YtdPanel } from './components/YtdPanel';
import { importFile, parseWorkbook } from './lib/importWorkbook';
import { attentionItems, computeKpis, ridershipTrend, routeSummaries, yearToDate } from './lib/kpis';
import { addMonths, formatMonth, shortMonthYear, toMonthKey } from './lib/months';
import { clearSaved, loadSaved, save } from './lib/storage';
import { buildWorkbook, downloadWorkbook } from './lib/template';
import type { ImportResult, ReportData } from './lib/types';

const lastCompleteMonth = () => {
  const now = new Date();
  return addMonths(toMonthKey(now.getFullYear(), now.getMonth() + 1), -1);
};

const latestMonth = (data: ReportData) => data.system[data.system.length - 1].month;

function BusIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="3" width="16" height="15" rx="3" />
      <path d="M4 11h16M8 21l1-3M16 21l-1-3" />
      <circle cx="8" cy="14.5" r="0.8" />
      <circle cx="16" cy="14.5" r="0.8" />
    </svg>
  );
}

export default function App() {
  const [saved] = useState(loadSaved);
  const [data, setData] = useState<ReportData | null>(saved);
  const [month, setMonth] = useState<string | null>(saved ? latestMonth(saved) : null);
  const [messages, setMessages] = useState<Pick<ImportResult, 'errors' | 'warnings'> | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const accept = (result: ImportResult) => {
    setMessages(result.errors.length || result.warnings.length ? { errors: result.errors, warnings: result.warnings } : null);
    if (!result.data) return;
    setData(result.data);
    setMonth(latestMonth(result.data));
    setSaveFailed(!save(result.data));
  };

  const onFile = async (file: File | undefined) => {
    if (file) accept(await importFile(file));
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    void onFile(e.target.files?.[0]);
    e.target.value = '';
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void onFile(e.dataTransfer.files?.[0]);
  };

  const loadSample = () => accept(parseWorkbook(buildWorkbook(lastCompleteMonth()), 'Sample data', true));

  const clear = () => {
    if (!window.confirm('Remove the imported data from this computer?')) return;
    clearSaved();
    setData(null);
    setMonth(null);
    setMessages(null);
  };

  const report = useMemo(() => {
    if (!data || !month) return null;
    const kpis = computeKpis(data, month);
    const routes = routeSummaries(data, month);
    return {
      kpis,
      routes,
      trend: ridershipTrend(data, month),
      ytd: yearToDate(data, month),
      alerts: attentionItems(data, month, kpis, routes),
    };
  }, [data, month]);

  const months = data ? [...data.system].reverse().map((m) => m.month) : [];

  return (
    <div
      className={dragging ? 'app dragging' : 'app'}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDrop={onDrop}
    >
      <input ref={fileInput} type="file" accept=".xlsx,.xlsm,.xls,.csv" hidden onChange={onPick} />

      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="brand-mark"><BusIcon /></div>
            <div>
              <div className="eyebrow">Barrie Transit · Management</div>
              <div className="brand-title">Monthly Executive Summary</div>
            </div>
          </div>
          {data && (
            <div className="toolbar no-print">
              <label htmlFor="period" className="eyebrow">Month</label>
              <select id="period" value={month ?? ''} onChange={(e) => setMonth(e.target.value)}>
                {months.map((m) => <option key={m} value={m}>{formatMonth(m)}</option>)}
              </select>
              <button type="button" className="btn accent" onClick={() => fileInput.current?.click()}>Import Excel</button>
              <button type="button" className="btn outline" onClick={() => window.print()}>Print / PDF</button>
            </div>
          )}
        </div>
        <div className="accent-rule" />
      </header>

      <main className="content">
        {messages && (
          <div className={messages.errors.length ? 'notice error no-print' : 'notice no-print'} role="status">
            <div className="notice-head">
              <strong>{messages.errors.length ? 'The workbook could not be imported' : 'Imported with notes'}</strong>
              <button type="button" className="btn ghost" onClick={() => setMessages(null)}>Dismiss</button>
            </div>
            {messages.errors.map((e) => <p key={e}>{e}</p>)}
            {messages.warnings.length > 0 && (
              <details>
                <summary>{messages.warnings.length} note{messages.warnings.length === 1 ? '' : 's'} about the data</summary>
                <ul>{messages.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </details>
            )}
          </div>
        )}
        {saveFailed && <div className="notice no-print">This computer did not allow the data to be saved, so you will need to import it again next time.</div>}

        {!data || !month || !report ? (
          <section className="card empty">
            <h1>Import this month's data</h1>
            <p>
              Choose the monthly Excel workbook, or drag it onto this window. The dashboard reads the
              "System Monthly", "Routes", "Targets" and "Notes" sheets. Your data stays on this computer.
            </p>
            <div className="empty-actions">
              <button type="button" className="btn primary" onClick={() => fileInput.current?.click()}>Choose Excel file</button>
              <button type="button" className="btn outline-dark" onClick={() => downloadWorkbook()}>Download blank template</button>
              <button type="button" className="btn outline-dark" onClick={() => downloadWorkbook(lastCompleteMonth())}>Download sample workbook</button>
              <button type="button" className="btn ghost" onClick={loadSample}>Preview with sample data</button>
            </div>
          </section>
        ) : (
          <>
            <div className="title-row">
              <div>
                <h1>How the system performed in {formatMonth(month)}</h1>
                <p className="muted">Fixed-route service · compared with {shortMonthYear(addMonths(month, -12))} and monthly targets</p>
              </div>
              {data.isSample && <span className="badge-sample">Sample data</span>}
            </div>

            <KpiGrid kpis={report.kpis} />

            <section className="row">
              <div className="card panel main">
                <h2>Monthly ridership, last 12 months</h2>
                <RidershipChart points={report.trend} latestLabel={report.kpis[0].display} />
              </div>
              <YtdPanel ytd={report.ytd} throughLabel={formatMonth(month)} />
            </section>

            <section className="row top">
              <RoutesTable routes={report.routes} />
              <AttentionPanel items={report.alerts} />
            </section>

            <footer className="footer">
              <span>Source: {data.sourceFile} · imported {new Date(data.importedAt).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}</span>
              <span className="no-print footer-actions">
                <button type="button" className="link" onClick={() => downloadWorkbook()}>Blank template</button>
                <button type="button" className="link" onClick={clear}>Remove data</button>
              </span>
            </footer>
          </>
        )}
      </main>
      {dragging && (
        // Full-window overlay: leaving it means the drag left the window.
        <div className="drop-overlay no-print" aria-hidden="true" onDragLeave={() => setDragging(false)}>
          Drop the Excel workbook to import it
        </div>
      )}
    </div>
  );
}
