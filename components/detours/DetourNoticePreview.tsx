import { forwardRef } from 'react';
import type { CSSProperties } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  DetourExportNoticeInput,
  formatDetourEffectiveSchedule,
  formatDetourRouteLabel,
} from '../../utils/detours/detourCopy';

export interface DetourNoticePreviewProps {
  notice: DetourExportNoticeInput;
  mapImageDataUrl?: string;
  mapAttribution?: string;
  className?: string;
  style?: CSSProperties;
  brandAssets?: {
    transitLogoDataUrl?: string;
    cityLogoDataUrl?: string;
  };
}

/**
 * Fixed 11:8.5 notice preview. The text header is an intentional seam until
 * approved Barrie brand artwork is supplied.
 */
export const DetourNoticePreview = forwardRef<HTMLDivElement, DetourNoticePreviewProps>(function DetourNoticePreview(
  { notice, mapImageDataUrl, mapAttribution = 'Map data © Mapbox © OpenStreetMap', className = '', style, brandAssets },
  ref,
) {
  return (
    <div
      ref={ref}
      className={`relative overflow-hidden bg-white text-slate-900 shadow-sm ring-1 ring-slate-200 ${className}`}
      style={{ width: 1100, height: 850, fontFamily: 'Arial, Helvetica, sans-serif', ...style }}
      aria-label={`Preview of ${notice.title}`}
    >
      <header className="relative flex h-[92px] items-center bg-[#005DAA] px-10 pr-24 text-white">
        <div className="w-[260px] border-r border-white/40 pr-8">
          {brandAssets?.transitLogoDataUrl
            ? <img src={brandAssets.transitLogoDataUrl} alt="Barrie Transit" className="h-12 max-w-[210px] object-contain object-left" />
            : <div className="text-[28px] font-black leading-none tracking-tight">BARRIE TRANSIT</div>}
          <div className="mt-2 text-xs font-bold tracking-[0.22em]">
            {notice.noticeType === 'stop-closure' ? 'STOP CLOSURE' : 'DETOUR NOTICE'}
          </div>
        </div>
        <h1 className="ml-9 max-w-[720px] text-[27px] font-extrabold leading-tight">{notice.title}</h1>
        <AlertTriangle className="absolute right-9 h-12 w-12 fill-white text-red-500" strokeWidth={2.5} aria-hidden="true" />
      </header>

      <main className="grid h-[686px] grid-cols-[2fr_1fr] gap-6 px-10 py-7">
        <section className="relative overflow-hidden rounded-lg border border-slate-300 bg-slate-100" aria-label="Detour map">
          {mapImageDataUrl ? (
            <img src={mapImageDataUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center px-12 text-center text-base font-semibold text-slate-500">
              Map preview will appear after the detour map is captured.
            </div>
          )}
          <div className="absolute right-3 top-3 flex flex-col items-center rounded bg-white/90 px-2 py-1 text-slate-900 shadow-sm" aria-label="North arrow">
            <span className="text-2xl font-black leading-none">↑</span>
            <span className="text-[10px] font-black">N</span>
          </div>
          <div className="absolute bottom-1.5 left-2 rounded bg-white/90 px-1.5 py-0.5 text-[8px] text-slate-600">{mapAttribution}</div>
        </section>

        <aside className="min-w-0">
          <p className="text-[19px] font-extrabold leading-snug text-slate-900">{formatDetourRouteLabel(notice.routes)}</p>
          <section className="mt-4 rounded-lg bg-[#EDF3F8] p-4">
            <h2 className="text-[11px] font-extrabold tracking-[0.13em] text-[#005DAA]">EFFECTIVE</h2>
            <p className="mt-2 text-[14px] font-semibold leading-5 text-slate-800">{formatDetourEffectiveSchedule(notice.effectiveSchedule)}</p>
          </section>
          <section className="mt-5">
            <h2 className="text-[11px] font-extrabold tracking-[0.13em] text-[#005DAA]">DETAILS</h2>
            <p className="mt-2 whitespace-pre-line text-[14px] leading-[1.45] text-slate-700">{notice.publicDetails}</p>
          </section>
          <section className="mt-5">
            <h2 className="text-[11px] font-extrabold tracking-[0.13em] text-[#005DAA]">MAP LEGEND</h2>
            <div className="mt-2 grid grid-cols-1 gap-2 text-[12px] font-semibold text-slate-700">
              <LegendLine color="#005DAA" label="Active routing" />
              <LegendLine color="#6E7B8B" label="Out-of-service routing" dashed />
              <LegendDot color="#1682D4" label="Active stop" />
              <LegendDot color="#D83535" label="Closed stop" />
              <LegendDot color="#1C9B68" label="Temporary stop" />
            </div>
          </section>
        </aside>
      </main>

      <footer className="absolute inset-x-10 bottom-0 flex h-[72px] items-center justify-between border-t border-slate-300 text-[12px] text-slate-600">
        <span className="flex items-center gap-3">{brandAssets?.cityLogoDataUrl && <img src={brandAssets.cityLogoDataUrl} alt="City of Barrie" className="h-9 max-w-24 object-contain" />}<span><strong>Service Barrie 705-726-4242</strong> &nbsp; | &nbsp; servicebarrie@barrie.ca &nbsp; | &nbsp; barrie.ca/TransitNotices</span></span>
        <span className="font-semibold">Revision {Math.max(1, Math.trunc(notice.revision || 1))}</span>
      </footer>
    </div>
  );
});

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-3 w-3 rounded-full ring-1 ring-black/10" style={{ backgroundColor: color }} aria-hidden="true" />
      {label}
    </span>
  );
}

function LegendLine({ color, label, dashed = false }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span
        className={`w-5 border-t-[3px] ${dashed ? 'border-dashed' : ''}`}
        style={{ borderColor: color }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
