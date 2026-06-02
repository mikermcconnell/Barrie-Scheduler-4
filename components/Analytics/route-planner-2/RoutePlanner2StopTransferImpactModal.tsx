import { AlertTriangle, ArrowRightLeft, CheckCircle2, X } from 'lucide-react';

import type {
  RoutePlanner2StopTransferMetricImpact,
  RoutePlanner2StopTransferPreview,
  RoutePlanner2StopTransferRouteScheduleImpact,
  RoutePlanner2StopTransferPreviewWarning,
} from '../../../utils/route-planner-2/routePlanner2TransferPreview';

interface RoutePlanner2StopTransferImpactModalProps {
  open: boolean;
  preview: RoutePlanner2StopTransferPreview | null;
  mode: 'copy' | 'move';
  onCancel: () => void;
  onConfirm: () => void;
}

function formatMinutes(value: number | null | undefined): string {
  return value != null ? `${value} min` : 'Not ready';
}

function formatNumber(value: number | null | undefined, singular: string, plural = `${singular}s`): string {
  if (value == null) return 'Not ready';
  return `${value} ${value === 1 ? singular : plural}`;
}

function formatDelta(delta: number | null | undefined, unit = 'min'): string {
  if (delta == null) return '—';
  return `${delta >= 0 ? '+' : ''}${delta} ${unit}`;
}

function metricTransition(metric: RoutePlanner2StopTransferMetricImpact, formatter: (value: number | null) => string): string {
  return `${formatter(metric.before)} → ${formatter(metric.after)}`;
}

function warningToneClass(warning: RoutePlanner2StopTransferPreviewWarning): string {
  if (warning.severity === 'blocking') return 'border-red-200 bg-red-50 text-red-900';
  if (warning.severity === 'warning') return 'border-amber-200 bg-amber-50 text-amber-900';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

function RouteImpactRow({ impact }: { impact: RoutePlanner2StopTransferRouteScheduleImpact }) {
  const isTarget = impact.role === 'target';
  const runtimeClass = isTarget ? 'text-emerald-700' : 'text-red-700';

  return (
    <div className="grid gap-3 border-t border-slate-200 p-3 text-sm md:grid-cols-[1.1fr_1fr_1fr_1fr_0.8fr]">
      <div>
        <div className="font-black text-slate-950">{impact.routeName}</div>
        <div className="mt-0.5 text-xs font-bold uppercase tracking-wide text-slate-500">
          {impact.role === 'source' ? 'Source route' : 'Target route'}
        </div>
      </div>
      <div>
        <div className="text-xs font-black uppercase tracking-wide text-slate-500">Runtime</div>
        <div className="mt-1 font-bold text-slate-900">{metricTransition(impact.runtime, formatMinutes)}</div>
        <div className={`text-xs font-black ${runtimeClass}`}>{formatDelta(impact.runtime.delta)}</div>
      </div>
      <div>
        <div className="text-xs font-black uppercase tracking-wide text-slate-500">Cycle</div>
        <div className="mt-1 font-bold text-slate-900">{metricTransition(impact.cycleTime, formatMinutes)}</div>
        <div className="text-xs font-black text-slate-600">{formatDelta(impact.cycleTime.delta)}</div>
      </div>
      <div>
        <div className="text-xs font-black uppercase tracking-wide text-slate-500">Recovery</div>
        <div className="mt-1 font-bold text-slate-900">{metricTransition(impact.recoveryTime, formatMinutes)}</div>
        <div className="text-xs font-semibold text-slate-500">
          {impact.recoveryPercentBefore ?? '—'}% → {impact.recoveryPercentAfter ?? '—'}%
        </div>
      </div>
      <div>
        <div className="text-xs font-black uppercase tracking-wide text-slate-500">Buses</div>
        <div className="mt-1 font-bold text-slate-900">{metricTransition(impact.busesRequired, (value) => formatNumber(value, 'bus', 'buses'))}</div>
        <div className="text-xs font-black text-slate-600">{formatDelta(impact.busesRequired.delta, 'bus')}</div>
      </div>
    </div>
  );
}

export function RoutePlanner2StopTransferImpactModal({
  open,
  preview,
  mode,
  onCancel,
  onConfirm,
}: RoutePlanner2StopTransferImpactModalProps) {
  if (!open || !preview) return null;

  const actionLabel = mode === 'move' ? 'Move stops' : 'Copy stops';
  const combinedWarnings = [...preview.scheduleImpact.warnings, ...preview.warnings];
  const hasWarnings = combinedWarnings.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="rp2-stop-transfer-impact-title"
        data-testid="rp2-stop-transfer-impact-modal"
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-cyan-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-cyan-700">
              <ArrowRightLeft size={14} />
              Reassign stops impact
            </div>
            <h2 id="rp2-stop-transfer-impact-title" className="mt-3 text-xl font-black text-slate-950">
              {mode === 'move' ? 'Move' : 'Copy'} {preview.transferredStopCount} {preview.transferredStopCount === 1 ? 'stop' : 'stops'} from {preview.sourceScenarioName} to {preview.targetScenarioName}
            </h2>
            <p className="mt-1 text-sm font-semibold text-slate-600">
              This shifts <span className="font-black text-slate-950">{formatMinutes(preview.transferredRuntimeMinutes)}</span> of scheduled runtime for planning review.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            aria-label="Close stop transfer impact summary"
          >
            <X size={18} />
          </button>
        </header>

        <div className="overflow-y-auto p-5">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-wide text-slate-500">Runtime shifted</div>
              <div className="mt-1 text-3xl font-black text-slate-950">{formatMinutes(preview.transferredRuntimeMinutes)}</div>
              <p className="mt-1 text-xs font-semibold text-slate-500">Same runtime removed from source and added to target.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-wide text-slate-500">Stop range</div>
              <div className="mt-1 text-lg font-black text-slate-950">{preview.sourceStopRangeLabel}</div>
              <p className="mt-1 text-xs font-semibold text-slate-500">{preview.transferredStopNames.join(', ')}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-wide text-slate-500">Insertion</div>
              <div className="mt-1 text-lg font-black text-slate-950">{preview.insertPositionLabel}</div>
              <p className="mt-1 text-xs font-semibold text-slate-500">{preview.reverseOrder ? 'Stop order reversed on insert.' : 'Stop order preserved.'}</p>
            </div>
          </div>

          <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
            <div className="bg-slate-50 px-4 py-3">
              <h3 className="text-sm font-black text-slate-950">Schedule impact</h3>
              <p className="mt-0.5 text-xs font-semibold text-slate-500">Headline values use moved-runtime accounting. Connector recalculation remains diagnostic only.</p>
            </div>
            <RouteImpactRow impact={preview.scheduleImpact.source} />
            <RouteImpactRow impact={preview.scheduleImpact.target} />
          </div>

          {hasWarnings ? (
            <div className="mt-5 space-y-2">
              <div className="flex items-center gap-2 text-sm font-black text-slate-950">
                <AlertTriangle size={16} className="text-amber-600" />
                Planner review
              </div>
              {combinedWarnings.map((warning) => (
                <div key={warning.id} className={`rounded-2xl border px-3 py-2 text-sm ${warningToneClass(warning)}`}>
                  <div className="font-black">{warning.message}</div>
                  {warning.action && <div className="mt-0.5 text-xs font-semibold opacity-80">{warning.action}</div>}
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-5 flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              <CheckCircle2 size={17} className="mt-0.5 shrink-0" />
              <div>
                <div className="font-black">No schedule risk flags detected.</div>
                <div className="text-xs font-semibold">Review the details below, then apply if this matches the planning intent.</div>
              </div>
            </div>
          )}

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-black text-slate-950">Runtime evidence</h3>
              <div className="mt-3 flex flex-wrap gap-1.5 text-xs font-bold">
                <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">{preview.carriedScheduledSegmentCount} scheduled segment{preview.carriedScheduledSegmentCount === 1 ? '' : 's'}</span>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">{preview.carriedRuntimeEstimateCount} period runtime{preview.carriedRuntimeEstimateCount === 1 ? '' : 's'}</span>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">{preview.carriedManualOverrideCount} manual override{preview.carriedManualOverrideCount === 1 ? '' : 's'}</span>
              </div>
              {preview.matchedRoutes.length > 0 && (
                <p className="mt-3 text-sm font-semibold text-slate-600">
                  Evidence carried from: <span className="font-black text-slate-900">{preview.matchedRoutes.join(', ')}</span>
                </p>
              )}
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-black text-slate-950">Connector diagnostics</h3>
              <div className="mt-3 flex flex-wrap gap-1.5 text-xs font-bold">
                <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">{preview.connectorSegmentCount} connector{preview.connectorSegmentCount === 1 ? '' : 's'}</span>
                <span className={`rounded-full px-2 py-1 ${preview.fallbackConnectorCount > 0 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-700'}`}>{preview.fallbackConnectorCount} fallback connector{preview.fallbackConnectorCount === 1 ? '' : 's'}</span>
                <span className={`rounded-full px-2 py-1 ${preview.duplicateJoinCount > 0 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-700'}`}>{preview.duplicateJoinCount} duplicate join{preview.duplicateJoinCount === 1 ? '' : 's'}</span>
              </div>
              {(preview.targetRuntimeDeltaMinutes !== preview.targetAccountingRuntimeDeltaMinutes
                || preview.sourceRuntimeDeltaMinutes !== preview.sourceAccountingRuntimeDeltaMinutes) && (
                <p className="mt-3 text-sm font-semibold text-slate-600">
                  Full recalculation: source {formatDelta(preview.sourceRuntimeDeltaMinutes)}, target {formatDelta(preview.targetRuntimeDeltaMinutes)}. These connector effects are not counted in moved runtime.
                </p>
              )}
            </div>
          </div>
        </div>

        <footer className="flex flex-col gap-2 border-t border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            data-testid="rp2-confirm-stop-transfer"
            className="rounded-xl border border-cyan-700 bg-cyan-600 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-cyan-700"
          >
            Confirm {actionLabel.toLowerCase()}
          </button>
        </footer>
      </section>
    </div>
  );
}
