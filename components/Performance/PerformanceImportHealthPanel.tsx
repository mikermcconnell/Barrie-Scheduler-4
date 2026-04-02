import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ShieldAlert, Clock3, Database, CalendarDays, Route, ChevronDown, ChevronUp } from 'lucide-react';
import type { PerformanceDataSummary } from '../../utils/performanceDataTypes';
import { buildPerformanceImportHealth, type ImportHealthStatus } from '../../utils/performanceImportHealth';

interface PerformanceImportHealthPanelProps {
  data: PerformanceDataSummary;
}

const STATUS_STYLES: Record<ImportHealthStatus, {
  panel: string;
  badge: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = {
  healthy: {
    panel: 'border-emerald-200 bg-emerald-50/70',
    badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    icon: CheckCircle2,
  },
  warning: {
    panel: 'border-amber-200 bg-amber-50/70',
    badge: 'bg-amber-100 text-amber-700 border-amber-200',
    icon: AlertTriangle,
  },
  critical: {
    panel: 'border-rose-200 bg-rose-50/70',
    badge: 'bg-rose-100 text-rose-700 border-rose-200',
    icon: ShieldAlert,
  },
};

const CHECK_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  'import-recency': Clock3,
  'service-coverage': CalendarDays,
  'runtime-logic': Database,
  'history-consistency': Database,
  'trip-linked-runtimes': Route,
};

const CHECK_STATUS_STYLES: Record<ImportHealthStatus, string> = {
  healthy: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-100 text-amber-700 border-amber-200',
  critical: 'bg-rose-100 text-rose-700 border-rose-200',
};

export const PerformanceImportHealthPanel: React.FC<PerformanceImportHealthPanelProps> = ({ data }) => {
  const health = useMemo(() => buildPerformanceImportHealth(data), [data]);
  const [isExpanded, setIsExpanded] = useState(false);
  const statusStyle = STATUS_STYLES[health.overallStatus];
  const StatusIcon = statusStyle.icon;
  const ToggleIcon = isExpanded ? ChevronUp : ChevronDown;

  return (
    <div className={`mb-4 rounded-xl border p-4 ${statusStyle.panel}`}>
      <button
        type="button"
        onClick={() => setIsExpanded((current) => !current)}
        aria-expanded={isExpanded}
        className="flex w-full flex-col gap-4 text-left lg:flex-row lg:items-start lg:justify-between"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusIcon size={18} className="shrink-0" />
            <h3 className="text-sm font-bold text-gray-900">Import health</h3>
            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${statusStyle.badge}`}>
              {health.headline}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white/80 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-gray-600">
              {isExpanded ? 'Hide details' : 'Show details'}
              <ToggleIcon size={12} />
            </span>
          </div>
          <p className="mt-2 text-sm text-gray-700">
            {health.summary}
          </p>
        </div>

        <div className="grid gap-2 text-xs text-gray-600 sm:grid-cols-2 lg:text-right">
          <div>
            <span className="font-semibold text-gray-700">Latest import:</span>{' '}
            {health.latestImportAt ? new Date(health.latestImportAt).toLocaleString('en-CA') : 'Unknown'}
          </div>
          <div>
            <span className="font-semibold text-gray-700">Latest service day:</span>{' '}
            {health.latestServiceDate ?? 'Unknown'}
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className="mt-4 grid gap-2 lg:grid-cols-2">
          {health.checks.map((check) => {
            const CheckIcon = CHECK_ICONS[check.id] ?? AlertTriangle;
            return (
              <div
                key={check.id}
                className="rounded-lg border border-white/70 bg-white/80 p-3 shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-md bg-gray-100 p-2 text-gray-600">
                    <CheckIcon size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900">{check.label}</span>
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${CHECK_STATUS_STYLES[check.status]}`}>
                        {check.status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-gray-600">{check.summary}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
