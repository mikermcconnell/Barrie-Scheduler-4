import { forwardRef } from 'react';
import type { CSSProperties } from 'react';
import { Globe2, Mail, Phone } from 'lucide-react';
import {
  DetourExportNoticeInput,
  formatDetourEffectiveSchedule,
  isDetourEffectiveDateOnly,
} from '../../utils/detours/detourCopy';
import {
  DETOUR_NOTICE_COLORS,
  formatDetourStopSheetRoutes,
  formatDetourStopSheetSubtitle,
  formatDetourStopSheetTitle,
  type DetourStopSheet,
  type DetourStopSheetKind,
} from '../../utils/detours/detourStopSheets';

export interface DetourNoticePreviewProps {
  notice: DetourExportNoticeInput;
  mapImageDataUrl?: string;
  mapAttribution?: string;
  className?: string;
  style?: CSSProperties;
  stopSheet?: DetourStopSheet;
  brandAssets?: {
    transitLogoDataUrl?: string;
    cityLogoDataUrl?: string;
  };
}

/** Fixed 11:8.5 preview modeled on Barrie Transit's existing public notices. */
export const DetourNoticePreview = forwardRef<HTMLDivElement, DetourNoticePreviewProps>(function DetourNoticePreview(
  { notice, mapImageDataUrl, mapAttribution = 'Map data (c) Mapbox (c) OpenStreetMap', className = '', style, brandAssets, stopSheet },
  ref,
) {
  const effectiveSchedule = formatDetourEffectiveSchedule(notice.effectiveSchedule);
  const keepEffectiveDateOnOneLine = isDetourEffectiveDateOnly(notice.effectiveSchedule);
  const themeColor = stopSheet ? DETOUR_NOTICE_COLORS[stopSheet.kind] : DETOUR_NOTICE_COLORS.master;
  const headerTitle = stopSheet
    ? formatDetourStopSheetTitle(stopSheet)
    : notice.noticeType === 'stop-closure' ? 'STOP CLOSURE' : 'DETOUR NOTICE';
  const headerSubtitle = stopSheet
    ? formatDetourStopSheetSubtitle(stopSheet)
    : formatDetourStopSheetRoutes(notice.routes);

  return (
    <div
      ref={ref}
      className={`relative overflow-hidden bg-white text-[#231F20] shadow-sm ring-1 ring-slate-200 ${className}`}
      style={{ width: 1100, height: 850, fontFamily: 'Bahnschrift, "Arial Narrow", Arial, Helvetica, sans-serif', ...style }}
      aria-label={stopSheet ? `Preview of ${headerTitle} ${headerSubtitle}` : `Preview of ${notice.title}`}
    >
      <header className="relative flex h-[146px] items-center px-8 pr-[126px] text-white" style={{ backgroundColor: themeColor }}>
        <div className="flex w-[230px] shrink-0 items-center">
          {brandAssets?.transitLogoDataUrl
            ? <img src={brandAssets.transitLogoDataUrl} alt="Barrie Transit" className="h-[94px] max-w-[218px] object-contain object-left" />
            : <FallbackTransitMark />}
        </div>
        <div className="min-w-0 border-l-2 border-white/20 pl-7">
          <div className={`${headerTitle.length > 20 ? 'text-[50px]' : 'text-[64px]'} whitespace-nowrap font-black leading-[0.92] tracking-[0.015em]`}>
            {headerTitle}
          </div>
          <div className="mt-3 truncate text-[23px] font-bold">{headerSubtitle}</div>
        </div>
        {stopSheet
          ? <TransitStopIcon kind={stopSheet.kind} className="absolute right-7 h-[90px] w-[90px]" dataAttribute />
          : <WarningIcon />}
      </header>

      <main className="grid h-[603px] grid-cols-[676px_1fr] gap-[14px] px-[18px] py-[16px]">
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
          <section className="h-[124px] shrink-0 border-t-[5px] border-[#231F20] px-5 py-3">
            <h2 className="text-[24px] font-black leading-none">Legend</h2>
            <div className="mt-3 grid grid-cols-5 gap-3 text-[10px] font-bold leading-tight">
              <RouteLegendLine label="Active Routing" />
              <LegendLine color="#BF1E2D" label="Out of Service Routing" dashed />
              <LegendStop kind="closed" label="Out-of-Service Stops" />
              <LegendStop kind="active" label="Active Stops" />
              <LegendStop kind="temporary" label="Temporary Stops" />
            </div>
          </section>
        </section>

        <aside className="flex min-h-0 flex-col">
          <section>
            <h2 className="px-3 text-[45px] font-black leading-none">Effective Dates</h2>
            <div className="mt-3 flex h-[207px] items-center justify-center rounded-[18px] border-[5px] border-[#231F20] px-5 text-center">
              <p
                className={`${keepEffectiveDateOnOneLine ? 'whitespace-nowrap text-[20px] tracking-[-0.02em]' : 'text-[34px]'} font-bold leading-[1.12] text-[#F04438]`}
                data-effective-date-nowrap={keepEffectiveDateOnOneLine ? 'true' : undefined}
              >
                {effectiveSchedule}
              </p>
            </div>
          </section>
          <section className="mt-4 flex min-h-0 flex-1 flex-col">
            <h2 className="px-3 text-[45px] font-black leading-none">Details</h2>
            <div className="mt-3 min-h-0 flex-1 rounded-[18px] border-[5px] border-[#231F20] px-4 py-4 text-[16px] font-semibold leading-[1.42]">
              <p className="whitespace-pre-line">{notice.publicDetails}</p>
            </div>
          </section>
        </aside>
      </main>

      <footer className="absolute inset-x-0 bottom-0 flex h-[101px] items-center px-10 text-white" style={{ backgroundColor: themeColor }}>
        <span className="w-[250px] shrink-0">{brandAssets?.cityLogoDataUrl ? <img src={brandAssets.cityLogoDataUrl} alt="City of Barrie" className="h-14 max-w-[190px] object-contain object-left" /> : <CityOfBarrieMark />}</span>
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

function FallbackTransitMark() {
  return <div className="text-[31px] font-black leading-[0.86] tracking-tight"><span className="block">Barrie</span><span className="block">Transit &gt;&gt;</span></div>;
}

function CityOfBarrieMark() {
  return (
    <span className="inline-flex flex-col" aria-label="City of Barrie">
      <span className="text-[39px] font-black leading-[0.75] tracking-tight">Barrie</span>
      <svg viewBox="0 0 134 16" className="mt-2 h-4 w-[134px]" aria-hidden="true">
        <path d="M1 9 C18 2 29 15 47 8 S76 1 94 8 S119 15 133 6" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 100 100" className="absolute right-7 h-[90px] w-[90px]" data-warning-icon="true" aria-hidden="true">
      <path d="M50 10 L91 84 Q94 90 86 90 H14 Q6 90 9 84 Z" fill="white" stroke="#F04438" strokeWidth="9" strokeLinejoin="round" />
      <path d="M50 34 V61" stroke="#231F20" strokeWidth="8" strokeLinecap="round" />
      <circle cx="50" cy="75" r="5" fill="#231F20" />
    </svg>
  );
}

function TransitStopIcon({
  kind,
  className = 'h-10 w-10',
  dataAttribute = false,
}: {
  kind: DetourStopSheetKind | 'active';
  className?: string;
  dataAttribute?: boolean;
}) {
  const ringColor = kind === 'temporary' ? DETOUR_NOTICE_COLORS.temporary : '#07557F';
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      data-stop-sheet-icon={dataAttribute ? kind : undefined}
      aria-hidden="true"
    >
      <circle cx="50" cy="50" r="45" fill="white" stroke={ringColor} strokeWidth="7" />
      <circle cx="50" cy="50" r="35" fill="#07557F" />
      <rect x="28" y="25" width="44" height="47" rx="7" fill="white" />
      <rect x="34" y="32" width="32" height="18" rx="2" fill="#07557F" />
      <rect x="34" y="55" width="32" height="6" rx="2" fill="#07557F" />
      <circle cx="37" cy="72" r="6" fill="white" stroke="#07557F" strokeWidth="3" />
      <circle cx="63" cy="72" r="6" fill="white" stroke="#07557F" strokeWidth="3" />
      {kind === 'closed' ? <path d="M17 82 L83 18" stroke="#BF1E2D" strokeWidth="9" strokeLinecap="round" /> : null}
    </svg>
  );
}

function LegendStop({ kind, label }: { kind: DetourStopSheetKind | 'active'; label: string }) {
  return (
    <span className="flex min-w-0 flex-col items-center gap-1 text-center" data-legend-item="true">
      <TransitStopIcon kind={kind} className="h-8 w-8" />
      <span className="w-full">{label}</span>
    </span>
  );
}

function RouteLegendLine({ label }: { label: string }) {
  return (
    <span className="flex min-w-0 flex-col items-center gap-2 text-center" data-legend-item="true">
      <span className="relative mt-2 h-4 w-[72px]" aria-hidden="true">
        <span className="absolute inset-x-0 top-0 border-t-[8px] border-[#E74C3C]" />
        <span className="absolute inset-x-0 top-[2px] border-t-[4px] border-[#07557F]" />
        <span className="absolute inset-x-0 top-[3px] border-t-2 border-[#231F20]" />
      </span>
      <span className="w-full">{label}</span>
    </span>
  );
}

function LegendLine({ color, label, dashed = false }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex min-w-0 flex-col items-center gap-2 text-center" data-legend-item="true">
      <span className="mt-2 flex h-4 w-full items-center justify-center" aria-hidden="true">
        <span className={`w-16 border-t-[5px] ${dashed ? 'border-dashed' : ''}`} style={{ borderColor: color }} />
      </span>
      <span className="w-full">{label}</span>
    </span>
  );
}
