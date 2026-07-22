import { forwardRef } from 'react';
import type { CSSProperties } from 'react';
import { AlertTriangle, Globe2, Mail, Phone } from 'lucide-react';
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

/** Fixed 11:8.5 preview modeled on Barrie Transit's existing public notices. */
export const DetourNoticePreview = forwardRef<HTMLDivElement, DetourNoticePreviewProps>(function DetourNoticePreview(
  { notice, mapImageDataUrl, mapAttribution = 'Map data (c) Mapbox (c) OpenStreetMap', className = '', style, brandAssets },
  ref,
) {
  return (
    <div
      ref={ref}
      className={`relative overflow-hidden bg-white text-[#231F20] shadow-sm ring-1 ring-slate-200 ${className}`}
      style={{ width: 1100, height: 850, fontFamily: 'Arial, Helvetica, sans-serif', ...style }}
      aria-label={`Preview of ${notice.title}`}
    >
      <header className="relative flex h-[132px] items-center bg-[#07557F] px-8 pr-24 text-white">
        <div className="flex w-[230px] shrink-0 items-center">
          {brandAssets?.transitLogoDataUrl
            ? <img src={brandAssets.transitLogoDataUrl} alt="Barrie Transit" className="h-[82px] max-w-[210px] object-contain object-left" />
            : <div className="text-[31px] font-black leading-[0.86] tracking-tight"><span className="block">Barrie</span><span className="block">Transit &gt;&gt;</span></div>}
        </div>
        <div className="min-w-0 border-l border-white/25 pl-7">
          <div className="text-[51px] font-black leading-none tracking-[0.015em]">
            {notice.noticeType === 'stop-closure' ? 'STOP CLOSURE' : 'DETOUR NOTICE'}
          </div>
          <div className="mt-2 truncate text-[22px] font-extrabold">{formatDetourRouteLabel(notice.routes)}</div>
        </div>
        <AlertTriangle className="absolute right-7 h-[82px] w-[82px] fill-white text-[#F04438]" strokeWidth={2.67} data-warning-icon="true" aria-hidden="true" />
      </header>

      <main className="grid h-[626px] grid-cols-[676px_1fr] gap-[14px] px-[18px] py-[16px]">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-[16px] border-[5px] border-[#231F20] bg-white">
          <div className="relative min-h-0 flex-1 overflow-hidden bg-slate-100" aria-label="Detour map">
            {mapImageDataUrl ? (
              <img src={mapImageDataUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center px-12 text-center text-base font-semibold text-slate-500">
                Map preview will appear after the detour map is captured.
              </div>
            )}
            <div className="absolute left-4 top-4 flex flex-col items-center text-[#231F20]" aria-label="North arrow">
              <span className="text-[45px] font-black leading-[0.7]">&#8593;</span>
              <span className="mt-2 text-[22px] font-black">N</span>
            </div>
            <div className="absolute bottom-1.5 left-2 rounded bg-white/90 px-1.5 py-0.5 text-[7px] text-slate-600">{mapAttribution}</div>
          </div>
          <section className="h-[132px] shrink-0 border-t-[5px] border-[#231F20] px-5 py-3">
            <h2 className="text-[24px] font-black leading-none">Legend</h2>
            <div className="mt-4 grid grid-cols-5 gap-3 text-[11px] font-bold leading-tight">
              <LegendLine color="#111111" label="Active Routing" />
              <LegendLine color="#646464" label="Out of Service Routing" dashed />
              <LegendDot color="#F04438" label="Out-of-Service Stops" />
              <LegendDot color="#056596" label="Active Stops" />
              <LegendDot color="#079447" label="Temporary Stops" />
            </div>
          </section>
        </section>

        <aside className="flex min-h-0 flex-col">
          <section>
            <h2 className="px-3 text-[36px] font-black leading-none">Effective Date</h2>
            <div className="mt-3 flex h-[174px] items-center justify-center rounded-[18px] border-[5px] border-[#231F20] px-6 text-center">
              <p className="text-[30px] font-semibold leading-[1.18] text-[#F04438]">{formatDetourEffectiveSchedule(notice.effectiveSchedule)}</p>
            </div>
          </section>
          <section className="mt-5 flex min-h-0 flex-1 flex-col">
            <h2 className="px-3 text-[36px] font-black leading-none">Details</h2>
            <div className="mt-3 min-h-0 flex-1 rounded-[18px] border-[5px] border-[#231F20] px-4 py-4 text-[16px] font-semibold leading-[1.42]">
              <p className="whitespace-pre-line">{notice.publicDetails}</p>
              <p className="mt-5">Routes not shown are on regular routing.</p>
            </div>
          </section>
        </aside>
      </main>

      <footer className="absolute inset-x-0 bottom-0 flex h-[92px] items-center bg-[#07557F] px-10 text-white">
        <span className="w-[250px] shrink-0">{brandAssets?.cityLogoDataUrl ? <img src={brandAssets.cityLogoDataUrl} alt="City of Barrie" className="h-14 max-w-[190px] object-contain object-left" /> : <span className="text-[37px] font-black tracking-tight">Barrie</span>}</span>
        <span className="flex-1 text-center text-[16px]">For More Information Contact:</span>
        <span className="w-[310px] space-y-1 text-[13px] font-medium leading-none">
          <span className="flex items-center gap-2"><Phone className="h-4 w-4 shrink-0" strokeWidth={1.8} data-contact-icon="phone" aria-hidden="true" /><span>Service Barrie at 705-726-4242</span></span>
          <span className="flex items-center gap-2"><Mail className="h-4 w-4 shrink-0" strokeWidth={1.8} data-contact-icon="email" aria-hidden="true" /><span>ServiceBarrie@barrie.ca</span></span>
          <span className="flex items-center gap-2"><Globe2 className="h-4 w-4 shrink-0" strokeWidth={1.8} data-contact-icon="website" aria-hidden="true" /><span>www.barrie.ca/TransitNotices</span></span>
        </span>
      </footer>
    </div>
  );
});

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex min-w-0 flex-col items-center gap-2 text-center" data-legend-item="true">
      <span className="flex h-4 w-full items-center justify-center" aria-hidden="true">
        <span className="h-4 w-4 rounded-full ring-2 ring-white shadow-[0_0_0_1px_rgba(0,0,0,0.18)]" style={{ backgroundColor: color }} />
      </span>
      <span className="w-full">{label}</span>
    </span>
  );
}

function LegendLine({ color, label, dashed = false }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex min-w-0 flex-col items-center gap-2 text-center" data-legend-item="true">
      <span className="flex h-4 w-full items-center justify-center" aria-hidden="true">
        <span className={`w-16 border-t-[5px] ${dashed ? 'border-dashed' : ''}`} style={{ borderColor: color }} />
      </span>
      <span className="w-full">{label}</span>
    </span>
  );
}
