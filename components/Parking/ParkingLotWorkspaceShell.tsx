import React from 'react';
import { ArrowLeft, MapPin } from 'lucide-react';

/** Shared navigation; each source retains its own loading, imports and measures. */
export function ParkingLotWorkspaceShell({ source, historyHref, revenueHref, children }: {
  source: 'revenue' | 'history';
  historyHref: string;
  revenueHref: string;
  children: React.ReactNode;
}) {
  return <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">
    <header className="shrink-0 border-b border-slate-200 bg-white px-4 pt-3">
      <div className="flex items-center gap-3">
        <a href="#parking" aria-label="Back to Parking Workspaces" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"><ArrowLeft size={18} /></a>
        <h1 className="flex items-center gap-2 text-lg font-bold text-slate-900"><MapPin size={18} className="text-emerald-700" />Parking Lot Data</h1>
      </div>
      <nav aria-label="Parking data source" className="flex gap-2">
        {([{ id: 'revenue', label: 'HotSpot & QR', href: revenueHref }, { id: 'history', label: 'LocoMobi History', href: historyHref }] as const).map(tab =>
          <a key={tab.id} href={tab.href} aria-current={source === tab.id ? 'page' : undefined}
            onClick={event => { if (source === tab.id) event.preventDefault(); }}
            className={`flex min-h-11 items-center border-b-2 px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${source === tab.id ? 'border-emerald-600 text-emerald-800' : 'border-transparent text-slate-500 hover:text-slate-900'}`}>
            {tab.label}
          </a>)}
      </nav>
    </header>
    <div className="min-h-0 flex-1">{children}</div>
  </div>;
}
