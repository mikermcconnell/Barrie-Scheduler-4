import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CalendarDays,
  Car,
  CheckCircle2,
  Clock3,
  Download,
  Loader2,
  MapPin,
  Maximize2,
  Minimize2,
  Palette,
  Plus,
  Save,
  Search,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import { Layer, Marker, Source } from 'react-map-gl/mapbox';
import type { LayerProps } from 'react-map-gl/mapbox';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import { useTeam } from '../contexts/TeamContext';
import { useToast } from '../contexts/ToastContext';
import { MapBase } from '../shared';
import { exportParkingWorkbook } from '../../utils/parking/parkingExport';
import { parseParkingFile } from '../../utils/parking/parkingParser';
import {
  buildParkingPlannerAnalysis,
  buildParkingTrendOverview,
  type ParkingAnalysisChartPoint,
  type ParkingLotComparisonPoint,
  type ParkingSourceMixPoint,
  type ParkingTrendComparison,
  type ParkingTrendDirection,
} from '../../utils/parking/parkingAnalysis';
import {
  buildParkingRevenueAnalytics,
  buildParkingRevenueReplacementSummary,
  getParkingRevenueAvailableMonths,
  getParkingRevenueSourceLabel,
  parseParkingRevenueFile,
} from '../../utils/parking/parkingRevenue';
import {
  BARRIE_PUBLIC_PARKING_VIEWER_URL,
  fetchBarriePublicParkingLocations,
  findPublicParkingLocationFallback,
  type PublicParkingLocation,
  type PublicParkingLocationMatch,
} from '../../utils/parking/publicParkingLocations';
import {
  buildParkingRevenueMapDisplayLocations,
  getParkingMapMetricLabel,
  getParkingMapMetricValue,
  type ParkingMapMetric,
} from '../../utils/parking/parkingMapDisplay';
import {
  buildParkingGeneratedCode,
  getParkingActiveYears,
  getParkingCodeFamilyKey,
  getParkingCodeOverridesForYear,
  getParkingCodesForYear,
  inferParkingYearCodeFormat,
  normalizeParkingCode,
  parseParkingActiveYearsFromCodes,
  parseParkingCodesInput,
} from '../../utils/parking/parkingCodeRules';
import {
  normalizeParkingCategoryId,
  UNCATEGORIZED_PARKING_CATEGORY_ID,
} from '../../utils/parking/parkingCategories';
import {
  getParkingData,
  getParkingRevenueData,
  getParkingSettings,
  rebuildParkingSummaryWithRules,
  saveParkingMonthsData,
  saveParkingRevenueDatasets,
  saveParkingSettings,
} from '../../utils/parking/parkingService';
import {
  DEFAULT_PARKING_SETTINGS,
  type ParkingCodeFamilyMapping,
  type ParkingDepartmentLegendSortKey,
  type ParkingMonthlyDataset,
  type ParkingPlatePattern,
  type ParkingRawRow,
  type ParkingRevenueLocationCategory,
  type ParkingRevenueDataset,
  type ParkingRevenueFilters,
  type ParkingRevenueLocationMapping,
  type ParkingRevenueLocationSummary,
  type ParkingRevenueSource,
  type ParkingRevenueSummary,
  type ParkingSettings,
  type ParkingSortDirection,
  type ParkingSummary,
  type ParkingUnmappedCodeFamily,
  type ParkingYearCodeFormat,
} from '../../utils/parking/parkingTypes';
import { searchRoutePlanner2Addresses, type RoutePlanner2AddressSuggestion } from '../../utils/route-planner-2/routePlanner2AddressSearch';
import { canAccessWorkspaceFeature } from '../../utils/workspaceAccess';

const money = (value: number | null | undefined) => `$${(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const FLAG_LABELS: Record<string, string> = {
  missing_plate: 'Missing plate',
  high_frequency: 'High frequency use',
  high_value: 'High plate value',
  long_duration: 'Long durations',
  same_location: 'Consistent location use',
  consecutive_weekdays: 'Repeated weekday use',
  unusual_timing: 'Unusual timing',
  multiple_daily_sessions: 'Multiple daily sessions',
};

const MONTHS = [
  { value: '01', short: 'Jan', label: 'January' },
  { value: '02', short: 'Feb', label: 'February' },
  { value: '03', short: 'Mar', label: 'March' },
  { value: '04', short: 'Apr', label: 'April' },
  { value: '05', short: 'May', label: 'May' },
  { value: '06', short: 'Jun', label: 'June' },
  { value: '07', short: 'Jul', label: 'July' },
  { value: '08', short: 'Aug', label: 'August' },
  { value: '09', short: 'Sep', label: 'September' },
  { value: '10', short: 'Oct', label: 'October' },
  { value: '11', short: 'Nov', label: 'November' },
  { value: '12', short: 'Dec', label: 'December' },
];

const DEPARTMENT_COLORS = [
  { familyKey: 'AB', code: 'AB2025', department: 'Access Barrie', hex: '#993366' },
  { familyKey: 'BFES', code: 'BFES25', department: 'Barrie Fire and Emergency Services', hex: '#7030A0' },
  { familyKey: 'BS', code: 'BS2025', department: 'Building Services', hex: '#990099' },
  { familyKey: 'CA', code: 'CA2025', department: 'Corporate Asset Management', hex: '#CC3399' },
  { familyKey: 'CF', code: 'CF2025', department: 'Corporate Facilities', hex: '#CC99FF' },
  { familyKey: 'CUPE', code: 'CUPE25', department: 'CUPE', hex: '#FF66CC' },
  { familyKey: 'DS', code: 'DS2025', department: 'Development Services', hex: '#FF0066' },
  { familyKey: 'ECD', code: 'ECD25', department: 'Economic and Creative Development', hex: '#FF5050' },
  { familyKey: 'IF', code: 'IF2025', department: 'Infrastructure', hex: '#ED7D31' },
  { familyKey: 'IGM', code: 'IGM25', department: 'IGM Office', hex: '#0F9ED5' },
  { familyKey: 'IT', code: 'IT2025', department: 'Information Technology', hex: '#92D050' },
  { familyKey: 'LC', code: 'LC25', department: 'Legislative and Court Services', hex: '#00CC99' },
  { familyKey: 'RS', code: 'RS2025', department: 'Recreation Services', hex: '#009999' },
  { familyKey: 'TP', code: 'TP2025', department: 'Transit', hex: '#00B0F0' },
  { familyKey: 'WM', code: 'WM2025', department: 'Waste Management and Environmental Sustainability', hex: '#0070C0' },
  { familyKey: 'WO', code: 'WO2025', department: 'Water Operations', hex: '#104861' },
  { familyKey: 'WW', code: 'WW2025', department: 'Waste Water Operations', hex: '#333F4F' },
  { familyKey: 'OP', code: 'OP2025', department: 'Operations', hex: '#292929' },
  { familyKey: 'P1', code: 'P12026', department: 'City Staff Underground Parking', hex: '#6B7280' },
];

const normalizeText = (value: string | null | undefined) => (value || '').trim().toLowerCase();
const DEFAULT_DEPARTMENT_LEGEND_SORT = DEFAULT_PARKING_SETTINGS.departmentLegendSort || { key: 'color' as ParkingDepartmentLegendSortKey, direction: 'asc' as ParkingSortDirection };
const ALL_REVENUE_SOURCES: Array<ParkingRevenueSource | 'all'> = ['all', 'hotspot', 'qr'];
const ALL_REVENUE_DAY_TYPES: Array<NonNullable<ParkingRevenueFilters['dayType']>> = ['all', 'weekday', 'weekend', 'saturday', 'sunday'];

const REVENUE_DAY_TYPE_LABELS: Record<NonNullable<ParkingRevenueFilters['dayType']>, string> = {
  all: 'All',
  weekday: 'Weekdays',
  weekend: 'Weekend',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

type ParkingWorkspaceView = 'dashboard' | 'plate-monitor' | 'lot-data';
type ParkingLotViewMode = 'map' | 'analysis';
type ParkingLotMapMode = 'markers' | 'heatmap';

function parseParkingWorkspaceViewFromHash(hash = window.location.hash): ParkingWorkspaceView {
  const normalized = hash.replace(/^#\/?/, '').toLowerCase();
  if (normalized.includes('plate-monitor') || normalized.includes('plate')) return 'plate-monitor';
  if (normalized.includes('lot-data') || normalized.includes('lot') || normalized.includes('data')) return 'lot-data';
  return 'dashboard';
}

interface DepartmentLegendRow {
  familyKey: string;
  code: string;
  department: string;
  hex: string;
  ignoreFlags: boolean;
  mappingIndex: number;
}

interface RevenueLocationSearchState {
  query: string;
  searching: boolean;
  error: string;
  suggestions: RoutePlanner2AddressSuggestion[];
}

const ParkingDashboardCard: React.FC<{
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
  color: 'emerald' | 'amber';
}> = ({ onClick, icon, title, description, color }) => {
  const colorClasses = {
    emerald: {
      bg: 'bg-emerald-50/50',
      text: 'text-emerald-600',
      border: 'hover:border-emerald-300',
      arrow: 'group-hover:text-emerald-500',
    },
    amber: {
      bg: 'bg-amber-50/50',
      text: 'text-amber-600',
      border: 'hover:border-amber-300',
      arrow: 'group-hover:text-amber-500',
    },
  }[color];

  return (
    <button
      onClick={onClick}
      className={`group flex h-full flex-col rounded-xl border border-gray-200 bg-white p-6 text-left shadow-sm transition-all hover:shadow-md active:scale-[0.99] ${colorClasses.border}`}
    >
      <div className="mb-4 flex items-center justify-between">
        <div className={`${colorClasses.bg} rounded-lg p-2.5 ${colorClasses.text} transition-colors`}>{icon}</div>
        <ArrowRight size={16} className={`text-gray-300 transition-colors ${colorClasses.arrow}`} />
      </div>
      <h3 className="mb-1 text-lg font-bold text-gray-900">{title}</h3>
      <p className="text-sm leading-relaxed text-gray-500">{description}</p>
    </button>
  );
};

const ParkingChartCard: React.FC<{
  title: string;
  subtitle: string;
  children: React.ReactNode;
  tall?: boolean;
}> = ({ title, subtitle, children, tall = false }) => (
  <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="mb-3">
      <h3 className="font-black text-slate-950">{title}</h3>
      <p className="mt-1 text-xs font-semibold text-slate-400">{subtitle}</p>
    </div>
    <div className={tall ? 'h-72' : 'h-56'}>{children}</div>
  </section>
);

const EmptyChartState: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-center text-sm font-bold text-slate-400">
    {label}
  </div>
);

const tooltipValue = (value: unknown, name: unknown) => {
  const numeric = typeof value === 'number' ? value : Number(value);
  const label = String(name || '');
  if (label.toLowerCase().includes('revenue')) return money(numeric);
  if (label.toLowerCase().includes('stay')) return minutesToDuration(numeric);
  return Number.isFinite(numeric) ? numeric.toLocaleString() : String(value ?? '');
};

const HourlyRevenueChart: React.FC<{ data: ParkingAnalysisChartPoint[]; compact?: boolean }> = ({ data, compact = false }) => (
  data.some(point => point.sessions > 0) ? (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: compact ? -28 : -12, bottom: compact ? 0 : 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
        <XAxis dataKey="label" interval={compact ? 5 : 2} tick={{ fontSize: 10, fill: '#64748B' }} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={compactMoney} tick={{ fontSize: 10, fill: '#64748B' }} tickLine={false} axisLine={false} />
        <Tooltip formatter={tooltipValue} labelClassName="font-bold text-slate-700" />
        <Bar dataKey="revenue" name="Revenue" fill="#059669" radius={[8, 8, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  ) : <EmptyChartState label="No hourly activity in this filter." />
);

const TrendAreaChart: React.FC<{ data: ParkingAnalysisChartPoint[]; color?: string }> = ({ data, color = '#2563EB' }) => (
  data.length > 0 ? (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 10, left: -14, bottom: 8 }}>
        <defs>
          <linearGradient id="parkingRevenueGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.35} />
            <stop offset="95%" stopColor={color} stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748B' }} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={compactMoney} tick={{ fontSize: 10, fill: '#64748B' }} tickLine={false} axisLine={false} />
        <Tooltip formatter={tooltipValue} labelClassName="font-bold text-slate-700" />
        <Area type="monotone" dataKey="revenue" name="Revenue" stroke={color} strokeWidth={3} fill="url(#parkingRevenueGradient)" />
      </AreaChart>
    </ResponsiveContainer>
  ) : <EmptyChartState label="Import more revenue data to show a trend." />
);

const TopLotsChart: React.FC<{ data: ParkingLotComparisonPoint[] }> = ({ data }) => (
  data.length > 0 ? (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data.slice(0, 8)} layout="vertical" margin={{ top: 4, right: 18, left: 16, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
        <XAxis type="number" tickFormatter={compactMoney} tick={{ fontSize: 10, fill: '#64748B' }} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 10, fill: '#334155', fontWeight: 700 }} tickLine={false} axisLine={false} />
        <Tooltip formatter={tooltipValue} labelClassName="font-bold text-slate-700" />
        <Bar dataKey="revenue" name="Revenue" fill="#2563EB" radius={[0, 8, 8, 0]} />
      </BarChart>
    </ResponsiveContainer>
  ) : <EmptyChartState label="No lots to compare yet." />
);

function sourceMixColor(source: ParkingRevenueSource): string {
  return source === 'hotspot' ? '#059669' : '#2563EB';
}

const SourceMixChart: React.FC<{ data: ParkingSourceMixPoint[] }> = ({ data }) => (
  data.some(point => point.sessions > 0) ? (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data.filter(point => point.sessions > 0 || point.revenue > 0) as unknown as Record<string, unknown>[]} dataKey="revenue" nameKey="label" innerRadius="52%" outerRadius="78%" paddingAngle={3}>
          {data.filter(point => point.sessions > 0 || point.revenue > 0).map(entry => <Cell key={entry.key} fill={sourceMixColor(entry.key)} />)}
        </Pie>
        <Tooltip formatter={tooltipValue} />
        <Legend verticalAlign="bottom" height={28} wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
      </PieChart>
    </ResponsiveContainer>
  ) : <EmptyChartState label="No app or QR split yet." />
);

function readableTextColor(hex: string): string {
  const value = hex.replace('#', '');
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  return (red * 299 + green * 587 + blue * 114) / 1000 > 150 ? '#111827' : '#FFFFFF';
}

function getCodeFamilyColor(codeFamilyKey?: string, department?: string, mappings: ParkingCodeFamilyMapping[] = []) {
  const key = (codeFamilyKey || '').trim().toUpperCase();
  const mapped = mappings.find(mapping => {
    const familyKey = getParkingCodeFamilyKey(mapping.familyKey);
    return familyKey === key
      || (mapping.codes || []).some(code => getParkingCodeFamilyKey(code) === key || normalizeParkingCode(code) === key)
      || normalizeText(mapping.department) === normalizeText(department);
  });
  const fallback = DEPARTMENT_COLORS.find(color => color.familyKey === key)
    || DEPARTMENT_COLORS.find(color => normalizeText(color.department) === normalizeText(department))
    || { familyKey: key || 'OTHER', code: key || 'OTHER', department: department || 'Unmapped', hex: '#E5E7EB' };

  const years = mapped ? getParkingActiveYears(mapped) : [];
  const code = mapped && years[0]
    ? getParkingCodesForYear(mapped, years[0])[0] || fallback.code
    : fallback.code;
  return {
    familyKey: mapped?.familyKey || fallback.familyKey,
    code,
    department: mapped?.department || department || fallback.department,
    hex: mapped?.colorHex || fallback.hex,
  };
}

function getDepartmentRowsForLegend(settings: ParkingSettings) {
  return settings.codeFamilies
    .map((mapping, mappingIndex) => ({ mapping, mappingIndex }))
    .filter(({ mapping }) => !mapping.archived)
    .map(({ mapping, mappingIndex }): DepartmentLegendRow => {
      const color = getCodeFamilyColor(mapping.familyKey, mapping.department, settings.codeFamilies);
      const previewYear = getParkingActiveYears(mapping)[0] || new Date().getFullYear();
      return {
        familyKey: mapping.familyKey,
        code: getParkingCodesForYear(mapping, previewYear)[0] || mapping.familyKey,
        department: mapping.department || 'Unnamed department',
        hex: color.hex,
        ignoreFlags: Boolean(mapping.ignoreFlags),
        mappingIndex,
      };
    });
}

function getHexSortValue(hex: string): number {
  const value = hex.replace('#', '');
  const red = parseInt(value.slice(0, 2), 16) / 255;
  const green = parseInt(value.slice(2, 4), 16) / 255;
  const blue = parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  const saturation = max === 0 ? 0 : delta / max;
  const lightness = (max + min) / 2;
  return hue * 10_000 + saturation * 100 + lightness;
}

function sortDepartmentLegendRows(rows: DepartmentLegendRow[], sortKey: ParkingDepartmentLegendSortKey, direction: ParkingSortDirection): DepartmentLegendRow[] {
  const multiplier = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    let result = 0;
    if (sortKey === 'color') {
      result = getHexSortValue(a.hex) - getHexSortValue(b.hex);
    } else if (sortKey === 'code') {
      result = a.code.localeCompare(b.code);
    } else if (sortKey === 'department') {
      result = a.department.localeCompare(b.department);
    } else {
      result = Number(a.ignoreFlags) - Number(b.ignoreFlags);
    }
    return (result * multiplier)
      || a.department.localeCompare(b.department)
      || a.familyKey.localeCompare(b.familyKey);
  });
}

function mergeUnmappedCodeFamilies(values: ParkingUnmappedCodeFamily[]): ParkingUnmappedCodeFamily[] {
  const merged = new Map<string, ParkingUnmappedCodeFamily>();
  for (const value of values) {
    const existing = merged.get(value.familyKey) || {
      familyKey: value.familyKey,
      codes: [],
      descriptions: [],
      rowCount: 0,
    };
    existing.codes = [...new Set([...existing.codes, ...value.codes])].sort();
    existing.descriptions = [...new Set([...existing.descriptions, ...value.descriptions].filter(Boolean))].sort();
    existing.rowCount += value.rowCount;
    merged.set(value.familyKey, existing);
  }
  return [...merged.values()].sort((a, b) => a.familyKey.localeCompare(b.familyKey));
}

function summarizeImportMonths(datasets: ParkingMonthlyDataset[]): string {
  const months = datasets.map(dataset => dataset.month).sort();
  if (months.length === 0) return '';
  if (months.length === 1) return months[0];
  return `${months[0]} to ${months.at(-1)} (${months.length} months)`;
}

function minutesToDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function minutesToTime(minutes: number): string {
  const safe = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function formatHour(hour: number | null | undefined): string {
  if (typeof hour !== 'number') return '—';
  return `${String(hour).padStart(2, '0')}:00`;
}

function compactMoney(value: number | null | undefined): string {
  const safe = value || 0;
  if (Math.abs(safe) >= 1000) return `$${Math.round(safe / 100) / 10}k`;
  return money(safe).replace('.00', '');
}

function shortNumber(value: number | null | undefined): string {
  const safe = value || 0;
  if (Math.abs(safe) >= 1000) return `${Math.round(safe / 100) / 10}k`;
  return safe.toLocaleString();
}

function formatUtilization(value: number | null | undefined): string {
  return typeof value === 'number' ? `${value.toFixed(1)}%` : '—';
}

function formatHourOption(hour: number): string {
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:00 ${suffix}`;
}

function formatTrendMetric(value: number | null | undefined, format: ParkingTrendComparison['format']): string {
  if (format === 'money') return money(value || 0);
  if (format === 'duration') return minutesToDuration(Math.round(value || 0));
  return (value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatTrendChange(card: ParkingTrendComparison): string {
  if (card.changeValue == null) return 'No comparison';
  const sign = card.changeValue > 0 ? '+' : '';
  const percent = card.changePercent == null ? 'new' : `${sign}${card.changePercent.toFixed(1)}%`;
  return `${percent} · ${sign}${formatTrendMetric(card.changeValue, card.format)}`;
}

function trendTone(direction: ParkingTrendDirection): { box: string; text: string; icon: React.ReactNode; rail: string } {
  if (direction === 'up') return {
    box: 'border-emerald-200 bg-emerald-50',
    text: 'text-emerald-700',
    icon: <TrendingUp size={15} />,
    rail: 'from-emerald-500 to-teal-400',
  };
  if (direction === 'down') return {
    box: 'border-rose-200 bg-rose-50',
    text: 'text-rose-700',
    icon: <TrendingDown size={15} />,
    rail: 'from-rose-500 to-orange-400',
  };
  if (direction === 'flat') return {
    box: 'border-slate-200 bg-slate-50',
    text: 'text-slate-600',
    icon: <ArrowRight size={15} />,
    rail: 'from-slate-400 to-slate-300',
  };
  return {
    box: 'border-slate-200 bg-white',
    text: 'text-slate-400',
    icon: <ArrowRight size={15} />,
    rail: 'from-slate-300 to-slate-200',
  };
}

const TrendComparisonCard: React.FC<{ card: ParkingTrendComparison; compact?: boolean }> = ({ card, compact = false }) => {
  const tone = trendTone(card.direction);
  return (
    <div className={`relative overflow-hidden rounded-3xl border ${tone.box} ${compact ? 'p-3' : 'p-4'} shadow-sm`}>
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${tone.rail}`} />
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{card.label}</div>
          <div className={`${compact ? 'text-xl' : 'text-2xl'} mt-1 font-black text-slate-950`}>{formatTrendMetric(card.value, card.format)}</div>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 ${compact ? 'text-[10px]' : 'text-[11px]'} font-black shadow-sm ${tone.text}`}>
          {tone.icon}
          {card.changePercent == null ? 'New' : `${card.changePercent > 0 ? '+' : ''}${card.changePercent.toFixed(1)}%`}
        </span>
      </div>
      <div className={`${compact ? 'mt-2 text-[11px] leading-4' : 'mt-3 text-xs leading-5'} font-bold text-slate-500`}>
        {card.currentLabel} vs {card.comparisonLabel}
        <br />
        <span className={tone.text}>{formatTrendChange(card)}</span>
      </div>
    </div>
  );
};

const PARKING_MAP_METRICS: ParkingMapMetric[] = ['revenue', 'sessions', 'averageStay', 'revenuePerSpace'];

function formatMapMetricValue(value: number, metric: ParkingMapMetric): string {
  if (metric === 'revenue' || metric === 'revenuePerSpace') return compactMoney(value);
  if (metric === 'averageStay') return minutesToDuration(value);
  return shortNumber(value);
}

function mapMetricColor(ratio: number): string {
  if (ratio >= 0.75) return '#047857';
  if (ratio >= 0.45) return '#059669';
  if (ratio >= 0.2) return '#34D399';
  return '#A7F3D0';
}

const parkingHeatmapLayer: LayerProps = {
  id: 'parking-revenue-heatmap',
  type: 'heatmap',
  paint: {
    'heatmap-weight': ['get', 'intensity'] as unknown as mapboxgl.Expression,
    'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 11, 0.8, 15, 2.2] as unknown as mapboxgl.Expression,
    'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 11, 28, 15, 56] as unknown as mapboxgl.Expression,
    'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.75, 16, 0.35] as unknown as mapboxgl.Expression,
    'heatmap-color': [
      'interpolate',
      ['linear'],
      ['heatmap-density'],
      0,
      'rgba(236,253,245,0)',
      0.2,
      'rgba(167,243,208,0.65)',
      0.45,
      'rgba(52,211,153,0.75)',
      0.7,
      'rgba(5,150,105,0.86)',
      1,
      'rgba(4,120,87,0.95)',
    ] as unknown as mapboxgl.Expression,
  },
};

const parkingHeatmapPointLayer: LayerProps = {
  id: 'parking-revenue-heatmap-points',
  type: 'circle',
  minzoom: 14,
  paint: {
    'circle-radius': 5,
    'circle-color': '#047857',
    'circle-opacity': 0.55,
    'circle-stroke-color': '#ffffff',
    'circle-stroke-width': 1,
  },
};

function hourToTime(hour: number): string {
  return `${String(Math.floor(hour)).padStart(2, '0')}:00`;
}

function revenueLocationKey(location: ParkingRevenueLocationSummary): string {
  return location.key;
}

function revenueLocationRefsOverlap(summary: ParkingRevenueLocationSummary, mapping: ParkingRevenueLocationMapping): boolean {
  const summaryRefs = new Set(summary.sourceIds.map(ref => `${ref.source}:${String(ref.sourceId).trim().toUpperCase()}`));
  return (mapping.sourceRefs || []).some(ref => summaryRefs.has(`${ref.source}:${String(ref.sourceId).trim().toUpperCase()}`));
}

function getPlatePatternKey(pattern: ParkingPlatePattern): string {
  return `${pattern.month}-${pattern.displayPlate}-${pattern.department}`;
}

function getUnusualTimingReason(row: ParkingRawRow, settings: ParkingSettings): string {
  const reasons: string[] = [];
  if (row.isWeekend) reasons.push('weekend');
  if (row.startMinutes < settings.flagRules.workdayStartHour * 60) reasons.push(`before ${hourToTime(settings.flagRules.workdayStartHour)}`);
  if (row.endMinutes > settings.flagRules.workdayEndHour * 60) reasons.push(`after ${hourToTime(settings.flagRules.workdayEndHour)}`);
  return reasons.join(', ');
}

function buildFlagEvidence(pattern: ParkingPlatePattern, settings: ParkingSettings, rows: ParkingRawRow[]): Array<{
  label: string;
  detail: string;
  evidence: string[];
}> {
  return pattern.flags.map(flag => {
    if (flag === 'high_value') {
      return {
        label: FLAG_LABELS[flag],
        detail: `${money(pattern.totalValue)} monthly plate value is at or above the ${money(settings.flagRules.plateMonthlyValueDollars)} threshold.`,
        evidence: [`${money(pattern.totalValue)} ≥ ${money(settings.flagRules.plateMonthlyValueDollars)}`],
      };
    }
    if (flag === 'high_frequency') {
      return {
        label: FLAG_LABELS[flag],
        detail: `${pattern.activeDays} active parking day${pattern.activeDays === 1 ? '' : 's'} this month.`,
        evidence: [`${pattern.activeDays} days ≥ ${settings.flagRules.plateActiveDaysPerMonth} threshold`],
      };
    }
    if (flag === 'consecutive_weekdays') {
      return {
        label: FLAG_LABELS[flag],
        detail: `Longest repeated weekday run is ${pattern.maxConsecutiveWeekdays} day${pattern.maxConsecutiveWeekdays === 1 ? '' : 's'}.`,
        evidence: [`${pattern.maxConsecutiveWeekdays} weekdays ≥ ${settings.flagRules.consecutiveWeekdays} threshold`],
      };
    }
    if (flag === 'long_duration') {
      const longRows = rows.filter(row => row.durationMinutes >= settings.flagRules.longSessionHours * 60);
      return {
        label: FLAG_LABELS[flag],
        detail: `${pattern.longSessionCount} long session${pattern.longSessionCount === 1 ? '' : 's'} at or above ${settings.flagRules.longSessionHours} hours.`,
        evidence: longRows.slice(0, 3).map(row => `${row.startDate} ${minutesToTime(row.startMinutes)} · ${minutesToDuration(row.durationMinutes)}`),
      };
    }
    if (flag === 'same_location') {
      return {
        label: FLAG_LABELS[flag],
        detail: `${pattern.topLocationDays} day${pattern.topLocationDays === 1 ? '' : 's'} at ${pattern.topLocationName || pattern.topSpotId}.`,
        evidence: [`${pattern.topLocationDays} days ≥ ${settings.flagRules.sameLocationDays} threshold`, `Top location: ${pattern.topLocationName || pattern.topSpotId}`],
      };
    }
    if (flag === 'unusual_timing') {
      const unusualRows = rows.filter(row => row.isWeekend || row.startMinutes < settings.flagRules.workdayStartHour * 60 || row.endMinutes > settings.flagRules.workdayEndHour * 60);
      return {
        label: FLAG_LABELS[flag],
        detail: `${pattern.unusualTimingCount} session${pattern.unusualTimingCount === 1 ? '' : 's'} outside ${hourToTime(settings.flagRules.workdayStartHour)}–${hourToTime(settings.flagRules.workdayEndHour)} or on a weekend.`,
        evidence: unusualRows.slice(0, 3).map(row => `${row.startDate} ${minutesToTime(row.startMinutes)}–${minutesToTime(row.endMinutes)} · ${getUnusualTimingReason(row, settings)}`),
      };
    }
    if (flag === 'multiple_daily_sessions') {
      const counts = new Map<string, number>();
      rows.forEach(row => counts.set(row.startDate, (counts.get(row.startDate) || 0) + 1));
      return {
        label: FLAG_LABELS[flag],
        detail: `${pattern.multipleDailySessionDays} day${pattern.multipleDailySessionDays === 1 ? '' : 's'} had multiple bookings for this plate.`,
        evidence: [...counts.entries()]
          .filter(([, count]) => count >= settings.flagRules.multipleDailySessions)
          .slice(0, 3)
          .map(([date, count]) => `${date}: ${count} sessions`),
      };
    }
    return {
      label: FLAG_LABELS[flag] || flag,
      detail: 'This plate matched a review rule.',
      evidence: [],
    };
  });
}

function TextInput({ value, onChange, placeholder, disabled = false }: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      value={value}
      disabled={disabled}
      onChange={event => onChange(event.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 disabled:bg-gray-100"
    />
  );
}

function CompactTextInput({ value, onChange, placeholder, disabled = false }: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      value={value}
      disabled={disabled}
      onChange={event => onChange(event.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs font-semibold text-gray-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-100"
    />
  );
}

function NumberInput({ value, onChange, suffix, min = 0, step = 1, disabled = false }: {
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  min?: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
      <input
        type="number"
        min={min}
        step={step}
        value={value}
        disabled={disabled}
        onChange={event => onChange(Number(event.target.value))}
        className="w-full bg-transparent text-sm font-bold text-gray-800 outline-none disabled:text-gray-400"
      />
      {suffix ? <span className="text-xs font-bold uppercase tracking-wide text-gray-400">{suffix}</span> : null}
    </label>
  );
}

function buildDisplaySummary(summary: ParkingSummary | null, settings: ParkingSettings): ParkingSummary | null {
  if (!summary) return null;
  return rebuildParkingSummaryWithRules(summary, summary.metadata.importedBy, summary.metadata.storagePath, settings);
}

interface AnnualSummaryRow {
  codeLabel: string;
  department: string;
  codeFamilyKey: string;
  monthlyValues: number[];
  total: number;
  percent: number | null;
}

function buildAnnualSummaryRows(months: ParkingMonthlyDataset[], year: string): AnnualSummaryRow[] {
  const groups = new Map<string, {
    codeFamilyKey: string;
    department: string;
    monthlyValues: number[];
    codes: Set<string>;
  }>();

  for (const month of months.filter(entry => entry.month.startsWith(`${year}-`))) {
    for (const row of month.rows) {
      const codeFamilyKey = row.codeFamilyKey || 'OTHER';
      const department = row.department || row.description || 'Unmapped';
      const key = `${codeFamilyKey}|${department}`;
      const group = groups.get(key) || {
        codeFamilyKey,
        department,
        monthlyValues: Array(12).fill(0) as number[],
        codes: new Set<string>(),
      };
      const monthIndex = Number(row.startMonth.slice(5, 7)) - 1;
      if (monthIndex >= 0 && monthIndex < 12) {
        group.monthlyValues[monthIndex] += row.discountAmount;
      }
      if (row.discountCode) group.codes.add(row.discountCode);
      groups.set(key, group);
    }
  }

  const annualTotal = [...groups.values()].reduce(
    (sum, group) => sum + group.monthlyValues.reduce((monthSum, value) => monthSum + value, 0),
    0,
  );
  const colorOrder = new Map(DEPARTMENT_COLORS.map((color, index) => [color.familyKey, index]));

  return [...groups.values()].map(group => {
    const total = group.monthlyValues.reduce((sum, value) => sum + value, 0);
    const yearCode = [...group.codes].find(code => code.includes(year)) || [...group.codes][0] || `${group.codeFamilyKey}${year}`;
    return {
      codeLabel: yearCode,
      department: group.department,
      codeFamilyKey: group.codeFamilyKey,
      monthlyValues: group.monthlyValues.map(value => Math.round(value * 100) / 100),
      total: Math.round(total * 100) / 100,
      percent: annualTotal > 0 ? total / annualTotal : null,
    };
  }).sort((a, b) => (
    (colorOrder.get(a.codeFamilyKey) ?? 999) - (colorOrder.get(b.codeFamilyKey) ?? 999) ||
    a.department.localeCompare(b.department)
  ));
}

const AnnualSummaryTable: React.FC<{ rows: AnnualSummaryRow[]; codeFamilies: ParkingCodeFamilyMapping[]; stickyHeader?: boolean }> = ({ rows, codeFamilies, stickyHeader = false }) => (
  <table className="min-w-[1100px] w-full text-left text-sm">
    <thead className={`${stickyHeader ? 'sticky top-0 z-10' : ''} bg-gray-50 text-xs font-extrabold uppercase tracking-wide text-gray-400`}>
      <tr>
        <th className="px-3 py-2">Discount code</th>
        <th className="px-3 py-2">Department</th>
        <th className="px-3 py-2 text-right">Annual total</th>
        <th className="px-3 py-2 text-right">% total</th>
        {MONTHS.map(month => <th key={month.value} className="px-3 py-2 text-right">{month.short}</th>)}
      </tr>
    </thead>
    <tbody className="divide-y divide-gray-100">
      {rows.map(row => {
        const color = getCodeFamilyColor(row.codeFamilyKey, row.department, codeFamilies);
        return (
          <tr key={`${row.codeFamilyKey}-${row.department}`} className="hover:bg-gray-50">
            <td
              className="px-3 py-2 font-extrabold"
              style={{ backgroundColor: color.hex, color: readableTextColor(color.hex) }}
            >
              {row.codeLabel}
            </td>
            <td className="px-3 py-2 font-semibold text-gray-700">{row.department}</td>
            <td className="px-3 py-2 text-right font-extrabold text-gray-950">{money(row.total)}</td>
            <td className="px-3 py-2 text-right font-bold text-gray-600">{row.percent == null ? '—' : `${(row.percent * 100).toFixed(1)}%`}</td>
            {row.monthlyValues.map((value, index) => (
              <td key={MONTHS[index].value} className="px-3 py-2 text-right font-semibold text-gray-600">{value ? money(value) : '—'}</td>
            ))}
          </tr>
        );
      })}
      {rows.length === 0 ? <tr><td colSpan={16} className="py-8 text-center text-gray-400">No annual summary data for this year.</td></tr> : null}
    </tbody>
  </table>
);

const DepartmentChip: React.FC<{ department: string; codeFamilyKey?: string; codeFamilies?: ParkingCodeFamilyMapping[]; compact?: boolean }> = ({ department, codeFamilyKey, codeFamilies = [], compact = false }) => {
  const color = getCodeFamilyColor(codeFamilyKey, department, codeFamilies);
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full font-extrabold ${compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'}`}
      style={{ backgroundColor: color.hex, color: readableTextColor(color.hex) }}
      title={`${color.code} = ${department || color.department}`}
    >
      <span className="truncate">{department || color.department}</span>
    </span>
  );
};

export const ParkingWorkspace: React.FC = () => {
  const { user } = useAuth();
  const { team, teamMember, canManageTeam } = useTeam();
  const toast = useToast();
  const [activeWorkspace, setActiveWorkspace] = useState<ParkingWorkspaceView>(() => parseParkingWorkspaceViewFromHash());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<ParkingSettings>(DEFAULT_PARKING_SETTINGS);
  const settingsRef = useRef<ParkingSettings>(DEFAULT_PARKING_SETTINGS);
  const [summary, setSummary] = useState<ParkingSummary | null>(null);
  const [revenueSummary, setRevenueSummary] = useState<ParkingRevenueSummary | null>(null);
  const [previewRevenueDatasets, setPreviewRevenueDatasets] = useState<ParkingRevenueDataset[]>([]);
  const [revenueWarnings, setRevenueWarnings] = useState<string[]>([]);
  const [revenueImportStatus, setRevenueImportStatus] = useState('');
  const [revenueSourceFilter, setRevenueSourceFilter] = useState<ParkingRevenueSource | 'all'>('all');
  const [revenueDayTypeFilter, setRevenueDayTypeFilter] = useState<NonNullable<ParkingRevenueFilters['dayType']>>('all');
  const [selectedRevenueYear, setSelectedRevenueYear] = useState('all');
  const [selectedRevenueMonth, setSelectedRevenueMonth] = useState('all');
  const [selectedRevenueCategory, setSelectedRevenueCategory] = useState('all');
  const [revenueHourStart, setRevenueHourStart] = useState(0);
  const [revenueHourEnd, setRevenueHourEnd] = useState(23);
  const [selectedRevenueLocationKey, setSelectedRevenueLocationKey] = useState('');
  const [lotViewMode, setLotViewMode] = useState<ParkingLotViewMode>('map');
  const [lotMapMode, setLotMapMode] = useState<ParkingLotMapMode>('markers');
  const [parkingMapMetric, setParkingMapMetric] = useState<ParkingMapMetric>('revenue');
  const [locationSearchById, setLocationSearchById] = useState<Record<string, RevenueLocationSearchState>>({});
  const [lotLeftRailOpen, setLotLeftRailOpen] = useState(true);
  const [lotFiltersCollapsed, setLotFiltersCollapsed] = useState(true);
  const [lotRightRailOpen, setLotRightRailOpen] = useState(true);
  const [parkingLegendCollapsed, setParkingLegendCollapsed] = useState(false);
  const [publicParkingLocations, setPublicParkingLocations] = useState<PublicParkingLocation[]>([]);
  const [publicParkingLoading, setPublicParkingLoading] = useState(false);
  const [publicParkingError, setPublicParkingError] = useState('');
  const [previewDatasets, setPreviewDatasets] = useState<ParkingMonthlyDataset[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [unmapped, setUnmapped] = useState<ParkingUnmappedCodeFamily[]>([]);
  const [mappingDrafts, setMappingDrafts] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [annualFullscreen, setAnnualFullscreen] = useState(false);
  const [expandedPlateKey, setExpandedPlateKey] = useState('');
  const [departmentManagerOpen, setDepartmentManagerOpen] = useState(false);
  const [departmentSearch, setDepartmentSearch] = useState('');
  const [departmentCodeYear, setDepartmentCodeYear] = useState(new Date().getFullYear());
  const [departmentLegendSort, setDepartmentLegendSort] = useState(DEFAULT_DEPARTMENT_LEGEND_SORT);

  const displaySummary = useMemo(() => buildDisplaySummary(summary, settings), [settings, summary]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    const handleHashChange = () => setActiveWorkspace(parseParkingWorkspaceViewFromHash());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigateWorkspace = (view: ParkingWorkspaceView) => {
    setActiveWorkspace(view);
    window.location.hash = view === 'dashboard' ? 'parking' : `parking/${view}`;
  };

  useEffect(() => {
    if (activeWorkspace !== 'lot-data') return;
    setParkingLegendCollapsed(false);
    const timer = window.setTimeout(() => setParkingLegendCollapsed(true), 10000);
    return () => window.clearTimeout(timer);
  }, [activeWorkspace]);

  const reviewMonths = useMemo(() => {
    const savedMonths = displaySummary?.months ?? [];
    const previewMonthKeys = new Set(previewDatasets.map(month => month.month));
    const months = previewDatasets.length > 0
      ? [...savedMonths.filter(month => !previewMonthKeys.has(month.month)), ...previewDatasets]
      : savedMonths;
    return [...months].sort((a, b) => a.month.localeCompare(b.month));
  }, [displaySummary, previewDatasets]);
  const latestMonth = reviewMonths.at(-1) ?? null;
  const availableYears = useMemo(() => [...new Set(reviewMonths.map(month => month.month.slice(0, 4)))].sort(), [reviewMonths]);
  const monthsForSelectedYear = useMemo(
    () => reviewMonths.filter(month => month.month.startsWith(`${selectedYear}-`)),
    [reviewMonths, selectedYear],
  );
  const selectedMonthDataset = monthsForSelectedYear.find(month => month.month === selectedMonth) ?? null;
  const selectedPreviewDataset = previewDatasets.find(month => month.month === selectedMonth) ?? null;
  const canEditParking = canManageTeam || canAccessWorkspaceFeature('workspaceParking', teamMember);
  const annualSummaryRows = useMemo(() => buildAnnualSummaryRows(reviewMonths, selectedYear), [reviewMonths, selectedYear]);
  const selectedMonthLabel = MONTHS.find(month => month.value === selectedMonth.slice(5, 7))?.label ?? selectedMonth;
  const monthlyFlaggedPlates = useMemo(() => {
    if (!selectedMonth) return [];
    if (selectedPreviewDataset) return selectedPreviewDataset.platePatterns.filter(pattern => pattern.flags.length > 0);
    return displaySummary?.platePatterns.filter(pattern => pattern.month === selectedMonth && pattern.flags.length > 0) ?? [];
  }, [displaySummary, selectedMonth, selectedPreviewDataset]);
  const monthlyDepartmentRows = useMemo(() => {
    if (!selectedMonth) return [];
    if (selectedPreviewDataset) return selectedPreviewDataset.departmentSummaries;
    return displaySummary?.departmentSummaries.filter(row => row.month === selectedMonth) ?? [];
  }, [displaySummary, selectedMonth, selectedPreviewDataset]);
  const rawTransactionRows = useMemo<ParkingRawRow[]>(() => {
    const rows = selectedMonthDataset?.rows ?? [];
    return [...rows].sort((a, b) => (
      b.startDate.localeCompare(a.startDate) ||
      b.startMinutes - a.startMinutes ||
      a.plate.localeCompare(b.plate)
    ));
  }, [selectedMonthDataset]);
  const displayRevenueSummary = useMemo(() => {
    if (previewRevenueDatasets.length === 0) return revenueSummary;
    return buildParkingRevenueReplacementSummary(
      revenueSummary,
      previewRevenueDatasets,
      user?.uid || 'preview',
      revenueSummary?.metadata.storagePath || 'preview-parking-revenue.json',
    );
  }, [previewRevenueDatasets, revenueSummary, user?.uid]);
  const revenueMonths = useMemo(() => getParkingRevenueAvailableMonths(displayRevenueSummary), [displayRevenueSummary]);
  const revenueYears = useMemo(() => [...new Set(revenueMonths.map(month => month.slice(0, 4)))].sort((a, b) => b.localeCompare(a)), [revenueMonths]);
  const revenueMonthsForSelectedYear = useMemo(() => (
    revenueMonths
      .filter(month => selectedRevenueYear === 'all' || month.startsWith(`${selectedRevenueYear}-`))
      .sort((a, b) => b.localeCompare(a))
  ), [revenueMonths, selectedRevenueYear]);
  const revenueFilterMonths = useMemo(() => {
    if (selectedRevenueMonth !== 'all') return [selectedRevenueMonth];
    if (selectedRevenueYear !== 'all') return revenueMonths.filter(month => month.startsWith(`${selectedRevenueYear}-`));
    return undefined;
  }, [revenueMonths, selectedRevenueMonth, selectedRevenueYear]);
  const revenueCategoryOptions = useMemo(() => [
    ...(settings.revenueLocationCategories || []).filter(category => !category.archived),
  ], [settings.revenueLocationCategories]);
  const revenueFilters = useMemo<ParkingRevenueFilters>(() => ({
    months: revenueFilterMonths,
    source: revenueSourceFilter,
    dayType: revenueDayTypeFilter,
    categoryId: selectedRevenueCategory,
    hourStart: revenueHourStart,
    hourEnd: revenueHourEnd,
  }), [revenueDayTypeFilter, revenueFilterMonths, revenueHourEnd, revenueHourStart, revenueSourceFilter, selectedRevenueCategory]);
  const revenueAnalytics = useMemo(
    () => buildParkingRevenueAnalytics(displayRevenueSummary, settings, revenueFilters),
    [displayRevenueSummary, revenueFilters, settings],
  );
  const revenueTrendFilterMonths = useMemo(() => {
    if (selectedRevenueYear === 'all') return undefined;
    return revenueMonths.filter(month => month.startsWith(`${selectedRevenueYear}-`));
  }, [revenueMonths, selectedRevenueYear]);
  const revenueTrendFilters = useMemo<ParkingRevenueFilters>(() => ({
    ...revenueFilters,
    months: revenueTrendFilterMonths,
  }), [revenueFilters, revenueTrendFilterMonths]);
  const revenueTrendAnalytics = useMemo(
    () => buildParkingRevenueAnalytics(displayRevenueSummary, settings, revenueTrendFilters),
    [displayRevenueSummary, revenueTrendFilters, settings],
  );
  const publicParkingMatchesByKey = useMemo(() => {
    const matches = new Map<string, PublicParkingLocationMatch>();
    if (publicParkingLocations.length === 0) return matches;
    for (const location of revenueAnalytics.locationSummaries) {
      if (location.isMapped) continue;
      const match = findPublicParkingLocationFallback(location, publicParkingLocations);
      if (match) matches.set(location.key, match);
    }
    return matches;
  }, [publicParkingLocations, revenueAnalytics.locationSummaries]);
  const allPublicParkingMatchesByKey = useMemo(() => {
    const matches = new Map<string, PublicParkingLocationMatch>();
    if (publicParkingLocations.length === 0) return matches;
    for (const location of revenueAnalytics.locationSummaries) {
      const match = findPublicParkingLocationFallback(location, publicParkingLocations);
      if (match) matches.set(location.key, match);
    }
    return matches;
  }, [publicParkingLocations, revenueAnalytics.locationSummaries]);
  const publicCapacityByLocationKey = useMemo(() => (
    Object.fromEntries(revenueAnalytics.locationSummaries.map(location => {
      const reviewedLocation = (settings.revenueLocations || []).find(mapping => (
        mapping.id === location.key || revenueLocationRefsOverlap(location, mapping)
      ));
      const match = allPublicParkingMatchesByKey.get(location.key);
      return [location.key, {
        spaces: reviewedLocation?.capacitySpaces ?? match?.location.numSpaces ?? null,
        activeDayCount: revenueAnalytics.activeDayCount || 0,
        hourWindowMinutes: revenueAnalytics.hourWindowMinutes || 1440,
        sourceLabel: reviewedLocation?.capacitySpaces != null
          ? 'Reviewed location import'
          : match
            ? (match.location.commonName || match.location.name || 'City parking source')
            : undefined,
      }];
    }))
  ), [allPublicParkingMatchesByKey, revenueAnalytics.activeDayCount, revenueAnalytics.hourWindowMinutes, revenueAnalytics.locationSummaries, settings.revenueLocations]);
  const mapLocationSummaries = useMemo(() => (
    buildParkingRevenueMapDisplayLocations(
      revenueAnalytics.locationSummaries,
      publicParkingMatchesByKey,
      publicCapacityByLocationKey,
    )
  ), [publicCapacityByLocationKey, publicParkingMatchesByKey, revenueAnalytics.locationSummaries]);
  const publicFallbackPinCount = mapLocationSummaries.filter(entry => entry.coordinateSource === 'public').length;
  const selectedRevenueLocation = useMemo(() => {
    if (!selectedRevenueLocationKey) return null;
    return revenueAnalytics.locationSummaries.find(location => revenueLocationKey(location) === selectedRevenueLocationKey) || null;
  }, [revenueAnalytics.locationSummaries, selectedRevenueLocationKey]);
  const selectedTrendLocation = useMemo(() => {
    if (!selectedRevenueLocationKey) return selectedRevenueLocation;
    return selectedRevenueLocation
      || revenueTrendAnalytics.locationSummaries.find(location => revenueLocationKey(location) === selectedRevenueLocationKey)
      || null;
  }, [revenueTrendAnalytics.locationSummaries, selectedRevenueLocation, selectedRevenueLocationKey]);
  const parkingTrendOverview = useMemo(() => (
    buildParkingTrendOverview(
      revenueTrendAnalytics,
      selectedTrendLocation,
      selectedRevenueMonth === 'all' ? revenueMonthsForSelectedYear[0] : selectedRevenueMonth,
    )
  ), [revenueMonthsForSelectedYear, revenueTrendAnalytics, selectedRevenueMonth, selectedTrendLocation]);
  const activeMapLocation = useMemo(() => (
    selectedRevenueLocation ? mapLocationSummaries.find(entry => entry.sourceLocationKeys.includes(selectedRevenueLocation.key)) || null : null
  ), [mapLocationSummaries, selectedRevenueLocation]);
  const mapMetricMax = useMemo(() => Math.max(...mapLocationSummaries.map(location => getParkingMapMetricValue(location, parkingMapMetric)), 1), [mapLocationSummaries, parkingMapMetric]);
  const mapHeatmapGeoJson = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: mapLocationSummaries.map(location => {
      const value = getParkingMapMetricValue(location, parkingMapMetric);
      return {
        type: 'Feature',
        properties: {
          id: location.key,
          value,
          intensity: Math.max(0.05, Math.min(1, value / mapMetricMax)),
          label: location.displayName,
        },
        geometry: {
          type: 'Point',
          coordinates: [location.longitude, location.latitude],
        },
      };
    }),
  }), [mapLocationSummaries, mapMetricMax, parkingMapMetric]);
  const parkingPlannerAnalysis = useMemo(
    () => buildParkingPlannerAnalysis(revenueAnalytics, selectedRevenueLocation, publicCapacityByLocationKey),
    [publicCapacityByLocationKey, revenueAnalytics, selectedRevenueLocation],
  );
  const selectedRevenueCategoryLabel = useMemo(() => (
    selectedRevenueCategory === 'all'
      ? ''
      : selectedRevenueCategory === UNCATEGORIZED_PARKING_CATEGORY_ID
        ? 'Uncategorized'
        : revenueCategoryOptions.find(category => category.id === selectedRevenueCategory)?.label || selectedRevenueCategory
  ), [revenueCategoryOptions, selectedRevenueCategory]);
  const peakPeriodScopeLabel = parkingPlannerAnalysis.selectedLot
    ? 'Selected lot'
    : selectedRevenueCategoryLabel
      ? selectedRevenueCategoryLabel
      : 'Current filters';
  const peakPeriodRows = useMemo(() => (
    (parkingPlannerAnalysis.selectedLot?.hourlyProfile || parkingPlannerAnalysis.hourlyProfile)
      .filter(point => point.revenue > 0 || point.sessions > 0)
      .slice()
      .sort((a, b) => b.revenue - a.revenue || b.sessions - a.sessions)
      .slice(0, 5)
  ), [parkingPlannerAnalysis]);
  const topDayRows = useMemo(() => (
    (parkingPlannerAnalysis.selectedLot?.dailyTrend || parkingPlannerAnalysis.dailyTrend)
      .filter(point => point.revenue > 0 || point.sessions > 0)
      .slice()
      .sort((a, b) => b.revenue - a.revenue || b.sessions - a.sessions)
      .slice(0, 5)
  ), [parkingPlannerAnalysis]);
  const selectedMonthTotalValue = selectedMonthDataset?.totalValue ?? 0;
  const previewRowCount = previewDatasets.reduce((sum, dataset) => sum + dataset.rowCount, 0);
  const previewTotalValue = previewDatasets.reduce((sum, dataset) => sum + dataset.totalValue, 0);
  const previewFlaggedPlateCount = previewDatasets.reduce((sum, dataset) => sum + dataset.platePatterns.filter(pattern => pattern.flags.length > 0).length, 0);
  const departmentLegendRows = useMemo(
    () => sortDepartmentLegendRows(getDepartmentRowsForLegend(settings), departmentLegendSort.key, departmentLegendSort.direction),
    [departmentLegendSort.direction, departmentLegendSort.key, settings],
  );
  const filteredCodeFamilies = useMemo(() => {
    const query = normalizeText(departmentSearch);
    return settings.codeFamilies
      .map((mapping, index) => ({ mapping, index }))
      .filter(({ mapping }) => !query
        || normalizeText(mapping.department).includes(query)
        || normalizeText(mapping.familyKey).includes(query)
        || (mapping.codes || []).some(code => normalizeText(code).includes(query)));
  }, [departmentSearch, settings.codeFamilies]);
  const departmentManagerWarnings = useMemo(() => {
    const warnings: string[] = [];
    const seen = new Set<string>();
    for (const mapping of settings.codeFamilies) {
      const key = getParkingCodeFamilyKey(mapping.familyKey);
      if (!key || !mapping.department.trim()) warnings.push('Every department needs a short code and name.');
      if (key && seen.has(key)) warnings.push(`Duplicate short code: ${key}`);
      if (key) seen.add(key);
    }
    return [...new Set(warnings)];
  }, [settings.codeFamilies]);

  const load = useCallback(async () => {
    if (!team) return;
    setLoading(true);
    try {
      const [loadedSettings, loadedData, loadedRevenueData] = await Promise.all([
        getParkingSettings(team.id),
        getParkingData(team.id),
        getParkingRevenueData(team.id),
      ]);
      settingsRef.current = loadedSettings;
      setSettings(loadedSettings);
      setDepartmentLegendSort(loadedSettings.departmentLegendSort || DEFAULT_DEPARTMENT_LEGEND_SORT);
      setSummary(loadedData);
      setRevenueSummary(loadedRevenueData);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not load Parking data.');
    } finally {
      setLoading(false);
    }
  }, [team]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (activeWorkspace !== 'lot-data' || publicParkingLocations.length > 0) return undefined;
    let cancelled = false;
    setPublicParkingLoading(true);
    setPublicParkingError('');
    fetchBarriePublicParkingLocations()
      .then(locations => {
        if (cancelled) return;
        setPublicParkingLocations(locations);
      })
      .catch(error => {
        if (cancelled) return;
        setPublicParkingError(error instanceof Error ? error.message : 'Could not load public parking locations.');
      })
      .finally(() => {
        if (!cancelled) setPublicParkingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeWorkspace, publicParkingLocations.length]);

  useEffect(() => {
    if (availableYears.length === 0) {
      setSelectedYear('');
      return;
    }
    if (!selectedYear || !availableYears.includes(selectedYear)) {
      setSelectedYear(latestMonth?.month.slice(0, 4) || availableYears.at(-1) || '');
    }
  }, [availableYears, latestMonth, selectedYear]);

  useEffect(() => {
    if (!selectedYear || monthsForSelectedYear.length === 0) {
      setSelectedMonth('');
      return;
    }
    if (!selectedMonth || !monthsForSelectedYear.some(month => month.month === selectedMonth)) {
      setSelectedMonth(monthsForSelectedYear.at(-1)?.month || '');
    }
  }, [monthsForSelectedYear, selectedMonth, selectedYear]);

  useEffect(() => {
    if (revenueMonths.length === 0) {
      setSelectedRevenueYear('all');
      setSelectedRevenueMonth('all');
      return;
    }
    if (selectedRevenueYear !== 'all' && !revenueYears.includes(selectedRevenueYear)) {
      setSelectedRevenueYear(revenueYears[0] || 'all');
      setSelectedRevenueMonth('all');
      return;
    }
    if (selectedRevenueMonth !== 'all' && !revenueMonthsForSelectedYear.includes(selectedRevenueMonth)) {
      setSelectedRevenueMonth('all');
    }
  }, [revenueMonths.length, revenueMonthsForSelectedYear, revenueYears, selectedRevenueMonth, selectedRevenueYear]);

  useEffect(() => {
    if (!annualFullscreen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAnnualFullscreen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [annualFullscreen]);

  useEffect(() => {
    if (!departmentManagerOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDepartmentManagerOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [departmentManagerOpen]);

  useEffect(() => {
    setExpandedPlateKey('');
  }, [selectedMonth]);

  const parseFiles = useCallback(async (files: File[], nextSettings = settings) => {
    if (!user || files.length === 0) return;
    setErrorMessage('');
    setWarnings([]);
    setUnmapped([]);
    setPreviewDatasets([]);
    setPendingFiles(files);
    try {
      const parsed = [];
      for (const file of files) {
        parsed.push({ fileName: file.name, result: await parseParkingFile(file, user.uid, nextSettings) });
      }

      const months = new Set<string>();
      for (const entry of parsed) {
        const month = entry.result.dataset.month;
        if (months.has(month)) {
          throw new Error(`Multiple selected Parking files contain ${month}. Pick one file per month.`);
        }
        months.add(month);
      }

      const combinedWarnings = parsed.flatMap(entry => (
        entry.result.warnings.map(warning => files.length > 1 ? `${entry.fileName}: ${warning}` : warning)
      ));
      const combinedUnmapped = mergeUnmappedCodeFamilies(parsed.flatMap(entry => entry.result.unmappedCodeFamilies));
      const datasets = parsed.map(entry => entry.result.dataset).sort((a, b) => a.month.localeCompare(b.month));
      setWarnings(combinedWarnings);
      setUnmapped(combinedUnmapped);
      setPreviewDatasets(combinedUnmapped.length === 0 ? datasets : []);
      setMappingDrafts(Object.fromEntries(combinedUnmapped.map(code => [code.familyKey, code.descriptions[0] || ''])));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not parse HotSpot files.');
    }
  }, [settings, user]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) void parseFiles(files);
    event.target.value = '';
  };

  const persistRevenueDatasets = async (datasets: ParkingRevenueDataset[], nextSettings = settings) => {
    if (!team || !user || datasets.length === 0) return;
    const rowCount = datasets.reduce((sum, dataset) => sum + dataset.rowCount, 0);
    setSaving(true);
    setRevenueImportStatus(`Saving ${rowCount.toLocaleString()} revenue rows...`);
    const savedSettings = await saveParkingSettings(team.id, user.uid, nextSettings);
    const savedRevenue = await saveParkingRevenueDatasets(team.id, user.uid, datasets, savedSettings);
    settingsRef.current = savedSettings;
    setSettings(savedSettings);
    setRevenueSummary(savedRevenue);
    setPreviewRevenueDatasets([]);
    setRevenueWarnings([]);
    setRevenueImportStatus('');
    toast.success(
      'Parking revenue import saved',
      `${datasets.length} source/month dataset${datasets.length === 1 ? '' : 's'} saved with ${rowCount.toLocaleString()} rows.`,
    );
  };

  const parseRevenueFiles = async (files: File[], nextSettings = settings) => {
    if (!team || !user || files.length === 0) return;
    setErrorMessage('');
    setRevenueWarnings([]);
    setPreviewRevenueDatasets([]);
    setRevenueImportStatus('Reading revenue workbook...');
    try {
      const parsed = [];
      for (const file of files) {
        parsed.push({ fileName: file.name, result: await parseParkingRevenueFile(file, user.uid, nextSettings) });
      }
      const keys = new Set<string>();
      for (const entry of parsed) {
        const key = `${entry.result.dataset.month}|${entry.result.dataset.source}`;
        if (keys.has(key)) {
          throw new Error(`Multiple selected revenue files contain ${entry.result.dataset.month} ${getParkingRevenueSourceLabel(entry.result.dataset.source)} data. Pick one file per source/month.`);
        }
        keys.add(key);
      }
      const datasets = parsed.map(entry => entry.result.dataset).sort((a, b) => a.month.localeCompare(b.month) || a.source.localeCompare(b.source));
      setRevenueWarnings(parsed.flatMap(entry => entry.result.warnings.map(warning => files.length > 1 ? `${entry.fileName}: ${warning}` : warning)));
      setPreviewRevenueDatasets(datasets);
      await persistRevenueDatasets(datasets, nextSettings);
    } catch (error) {
      setRevenueImportStatus('');
      setErrorMessage(error instanceof Error ? error.message : 'Could not import Parking revenue files.');
    } finally {
      setSaving(false);
    }
  };

  const handleRevenueFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) void parseRevenueFiles(files);
    event.target.value = '';
  };

  const saveRevenuePreview = async () => {
    if (!team || !user || previewRevenueDatasets.length === 0) return;
    try {
      await persistRevenueDatasets(previewRevenueDatasets);
    } catch (error) {
      setRevenueImportStatus('');
      setErrorMessage(error instanceof Error ? error.message : 'Could not save Parking revenue import.');
    } finally {
      setSaving(false);
    }
  };

  const applyUnmappedMappings = async () => {
    if (pendingFiles.length === 0) return;
    const newMappings: ParkingCodeFamilyMapping[] = unmapped.map(code => ({
      familyKey: code.familyKey,
      codes: code.codes,
      activeYears: parseParkingActiveYearsFromCodes(code.codes),
      yearCodeFormat: code.codes.some(value => /20\d{2}$/.test(value)) ? 'yyyy' : 'yy',
      department: (mappingDrafts[code.familyKey] || '').trim(),
      description: code.descriptions.join('; '),
    }));
    if (newMappings.some(mapping => !mapping.department)) {
      setErrorMessage('Enter a department for every unmapped discount code before continuing.');
      return;
    }
    const existingFamilies = new Set(settings.codeFamilies.map(mapping => getParkingCodeFamilyKey(mapping.familyKey)));
    const nextSettings = {
      ...settings,
      codeFamilies: [
        ...settings.codeFamilies.filter(mapping => !newMappings.some(newMapping => getParkingCodeFamilyKey(newMapping.familyKey) === getParkingCodeFamilyKey(mapping.familyKey))),
        ...newMappings.filter(mapping => !existingFamilies.has(getParkingCodeFamilyKey(mapping.familyKey)) || mapping.department),
      ].sort((a, b) => a.familyKey.localeCompare(b.familyKey)),
    };
    setSettings(nextSettings);
    await parseFiles(pendingFiles, nextSettings);
  };

  const importPreview = async () => {
    if (!team || !user || previewDatasets.length === 0) return;
    setSaving(true);
    try {
      const savedSettings = await saveParkingSettings(team.id, user.uid, settings);
      const savedSummary = await saveParkingMonthsData(team.id, user.uid, previewDatasets, savedSettings);
      applySettingsState(savedSettings);
      setDepartmentLegendSort(savedSettings.departmentLegendSort || DEFAULT_DEPARTMENT_LEGEND_SORT);
      setSummary(savedSummary);
      setPreviewDatasets([]);
      setPendingFiles([]);
      setWarnings([]);
      toast.success(
        'Parking import saved',
        previewDatasets.length === 1
          ? `${previewDatasets[0].month} replaced with ${previewDatasets[0].rowCount.toLocaleString()} rows.`
          : `${previewDatasets.length} months replaced with ${previewRowCount.toLocaleString()} total rows.`,
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not save Parking import.');
    } finally {
      setSaving(false);
    }
  };

  const applySettingsState = (nextSettings: ParkingSettings) => {
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
  };

  const persistParkingSettings = async (nextSettings: ParkingSettings, options: { showSaving?: boolean; showToast?: boolean } = {}) => {
    if (!team || !user) return;
    applySettingsState(nextSettings);
    if (options.showSaving) setSaving(true);
    try {
      const saved = await saveParkingSettings(team.id, user.uid, nextSettings);
      applySettingsState(saved);
      setDepartmentLegendSort(saved.departmentLegendSort || DEFAULT_DEPARTMENT_LEGEND_SORT);
      if (options.showToast) toast.success('Parking settings saved');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not save Parking settings.');
    } finally {
      if (options.showSaving) setSaving(false);
    }
  };

  const saveSettingsOnly = async () => {
    await persistParkingSettings(settingsRef.current, { showSaving: true, showToast: true });
  };

  const addCodeFamily = () => setSettings(current => ({
    ...current,
    codeFamilies: [
      ...current.codeFamilies,
      {
        familyKey: '',
        codes: [],
        activeYears: [departmentCodeYear || new Date().getFullYear()],
        yearCodeFormat: 'yyyy',
        department: '',
        colorHex: '#0F9ED5',
      },
    ],
  }));

  const buildSettingsWithCodeFamilyPatch = (current: ParkingSettings, index: number, patch: Partial<ParkingCodeFamilyMapping>): ParkingSettings => ({
    ...current,
    codeFamilies: current.codeFamilies.map((mapping, i) => {
      if (i !== index) return mapping;
      const next = { ...mapping, ...patch };
      const familyKey = (next.familyKey || '').trim().toUpperCase();
      const activeYears = getParkingActiveYears(next);
      const yearCodeFormat = inferParkingYearCodeFormat(next);
      return {
        ...next,
        familyKey,
        activeYears,
        yearCodeFormat,
        codes: activeYears.map(year => buildParkingGeneratedCode(familyKey, year, yearCodeFormat)).filter(Boolean),
      };
    }),
  });

  const updateCodeFamilyDirectory = (index: number, patch: Partial<ParkingCodeFamilyMapping>) => setSettings(current => buildSettingsWithCodeFamilyPatch(current, index, patch));

  const updateCodeFamilyDirectoryAndSave = (index: number, patch: Partial<ParkingCodeFamilyMapping>) => {
    const nextSettings = buildSettingsWithCodeFamilyPatch(settingsRef.current, index, patch);
    void persistParkingSettings(nextSettings);
  };

  const updateCodeFamilyOverridesForYear = (index: number, year: number, codesText: string) => setSettings(current => ({
    ...current,
    codeFamilies: current.codeFamilies.map((mapping, i) => {
      if (i !== index) return mapping;
      const codeOverrides = { ...(mapping.codeOverrides || {}) };
      const codes = parseParkingCodesInput(codesText);
      if (codes.length > 0) codeOverrides[String(year)] = codes;
      else delete codeOverrides[String(year)];
      return { ...mapping, codeOverrides };
    }),
  }));

  const deleteCodeFamily = (index: number) => setSettings(current => ({
    ...current,
    codeFamilies: current.codeFamilies.filter((_, i) => i !== index),
  }));

  const toggleDepartmentLegendSort = (key: ParkingDepartmentLegendSortKey) => setDepartmentLegendSort(current => {
    const nextSort = {
      key,
      direction: (current.key === key && current.direction === 'asc' ? 'desc' : 'asc') as ParkingSortDirection,
    };
    const nextSettings = {
      ...settingsRef.current,
      departmentLegendSort: nextSort,
    };
    void persistParkingSettings(nextSettings);
    return nextSort;
  });

  const renderDepartmentLegendHeader = (key: ParkingDepartmentLegendSortKey, label: string, className = '') => (
    <button
      type="button"
      onClick={() => toggleDepartmentLegendSort(key)}
      className={`inline-flex items-center gap-1 text-left hover:text-blue-700 ${className}`}
    >
      {label}
      <span className="text-[9px] text-gray-400">
        {departmentLegendSort.key === key ? (departmentLegendSort.direction === 'asc' ? '▲' : '▼') : '↕'}
      </span>
    </button>
  );

  const toggleRevenueLocationSelection = useCallback((locationKey: string, isAlreadySelected?: boolean) => {
    setSelectedRevenueLocationKey(current => ((isAlreadySelected ?? current === locationKey) ? '' : locationKey));
  }, []);

  const updateRevenueLocation = (id: string, patch: Partial<ParkingRevenueLocationMapping>) => {
    setSettings(current => ({
      ...current,
      revenueLocations: (current.revenueLocations || []).map(location => (
        location.id === id ? { ...location, ...patch } : location
      )),
    }));
  };

  const addRevenueCategory = () => {
    const baseLabel = 'New category';
    setSettings(current => {
      const existing = new Set((current.revenueLocationCategories || []).map(category => category.id));
      let index = 1;
      let id = normalizeParkingCategoryId(baseLabel);
      while (existing.has(id)) {
        index += 1;
        id = normalizeParkingCategoryId(`${baseLabel} ${index}`);
      }
      const nextCategory: ParkingRevenueLocationCategory = {
        id,
        label: index === 1 ? baseLabel : `${baseLabel} ${index}`,
        colorHex: '#64748B',
      };
      return {
        ...current,
        revenueLocationCategories: [...(current.revenueLocationCategories || []), nextCategory],
      };
    });
  };

  const updateRevenueCategory = (id: string, patch: Partial<ParkingRevenueLocationCategory>) => {
    setSettings(current => ({
      ...current,
      revenueLocationCategories: (current.revenueLocationCategories || []).map(category => (
        category.id === id ? { ...category, ...patch } : category
      )),
    }));
  };

  const archiveRevenueCategory = (id: string) => {
    setSettings(current => ({
      ...current,
      revenueLocationCategories: (current.revenueLocationCategories || []).map(category => (
        category.id === id ? { ...category, archived: true } : category
      )),
      revenueLocations: (current.revenueLocations || []).map(location => (
        location.categoryId === id ? { ...location, categoryId: null } : location
      )),
    }));
    if (selectedRevenueCategory === id) setSelectedRevenueCategory('all');
  };

  const searchRevenueLocation = async (location: ParkingRevenueLocationMapping) => {
    const query = locationSearchById[location.id]?.query || location.displayName;
    setLocationSearchById(current => ({
      ...current,
      [location.id]: { query, searching: true, error: '', suggestions: [] },
    }));
    try {
      const suggestions = await searchRoutePlanner2Addresses(`${query}, Barrie, ON`, { limit: 4 });
      setLocationSearchById(current => ({
        ...current,
        [location.id]: { query, searching: false, error: suggestions.length === 0 ? 'No Mapbox suggestions found.' : '', suggestions },
      }));
    } catch (error) {
      setLocationSearchById(current => ({
        ...current,
        [location.id]: { query, searching: false, error: error instanceof Error ? error.message : 'Mapbox search failed.', suggestions: [] },
      }));
    }
  };

  const applyRevenueLocationSuggestion = (locationId: string, suggestion: RoutePlanner2AddressSuggestion) => {
    updateRevenueLocation(locationId, { latitude: suggestion.lat, longitude: suggestion.lng });
    setLocationSearchById(current => ({
      ...current,
      [locationId]: {
        ...(current[locationId] || { query: '', searching: false, error: '', suggestions: [] }),
        query: suggestion.label,
        suggestions: [],
        error: '',
      },
    }));
  };

  const applyPublicRevenueLocationFallback = (locationId: string, publicMatch: PublicParkingLocationMatch) => {
    updateRevenueLocation(locationId, {
      latitude: publicMatch.location.latitude,
      longitude: publicMatch.location.longitude,
    });
    setLocationSearchById(current => ({
      ...current,
      [locationId]: {
        ...(current[locationId] || { query: '', searching: false, error: '', suggestions: [] }),
        query: [publicMatch.location.commonName || publicMatch.location.name, publicMatch.location.address].filter(Boolean).join(', '),
        suggestions: [],
        error: '',
      },
    }));
  };

  const departmentManagerModal = departmentManagerOpen ? (
          <div className="fixed inset-0 z-50 bg-gray-950/40 p-3 md:p-6" role="dialog" aria-modal="true" aria-label="Manage departments">
            <div className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-3xl border-2 border-gray-200 bg-gray-50 shadow-2xl">
              <div className="border-b border-gray-200 bg-white p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-blue-700">
                      <Wand2 size={14} /> Department code manager
                    </div>
                    <h2 className="mt-3 text-2xl font-extrabold text-gray-950">Pick a year and edit each department</h2>
                    <p className="mt-1 max-w-3xl text-sm font-medium text-gray-500">
                      Change the year below and the code shown on every department updates automatically.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={saving || !canEditParking}
                      onClick={() => void saveSettingsOnly()}
                      className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-emerald-700 disabled:bg-gray-300"
                    >
                      {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Save settings
                    </button>
                    <button
                      type="button"
                      onClick={() => setDepartmentManagerOpen(false)}
                      className="inline-flex items-center gap-2 rounded-xl bg-gray-950 px-4 py-2 text-sm font-extrabold text-white hover:bg-gray-800"
                    >
                      <X size={16} /> Close
                    </button>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_170px] lg:items-center">
                  <label className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
                    <Search size={16} className="text-gray-400" />
                    <input
                      value={departmentSearch}
                      onChange={event => setDepartmentSearch(event.target.value)}
                      placeholder="Search department, short code, or saved code"
                      className="w-full text-sm font-semibold text-gray-700 outline-none"
                    />
                  </label>
                  <label className="rounded-2xl border-2 border-blue-100 bg-blue-50 px-4 py-2">
                    <span className="block text-[10px] font-extrabold uppercase tracking-wide text-blue-500">Show codes for year</span>
                    <input
                      type="number"
                      min={2000}
                      max={2099}
                      value={departmentCodeYear}
                      onChange={event => setDepartmentCodeYear(Number(event.target.value) || new Date().getFullYear())}
                      className="mt-0.5 w-full bg-transparent text-2xl font-extrabold text-blue-950 outline-none"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!canEditParking}
                    onClick={addCodeFamily}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-extrabold text-white hover:bg-blue-700 disabled:bg-gray-300"
                  >
                    <Plus size={16} /> Add department
                  </button>
                </div>

                {departmentManagerWarnings.length > 0 ? (
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">
                    {departmentManagerWarnings.map(warning => <div key={warning}>{warning}</div>)}
                  </div>
                ) : null}
              </div>

              <div className="min-h-0 flex-1 overflow-auto p-5">
                <div className="mb-4 rounded-3xl border border-emerald-100 bg-emerald-50 p-4">
                  <div className="text-sm font-extrabold text-emerald-950">Simple rule</div>
                  <p className="mt-1 text-sm font-medium text-emerald-700">
                    Enter the short code once. Pick whether the department uses the full year or short year. The code preview updates when you change the year.
                  </p>
                </div>

                <div className="grid gap-3">
                  {filteredCodeFamilies.map(({ mapping, index }) => {
                    const format = inferParkingYearCodeFormat(mapping);
                    const color = getCodeFamilyColor(mapping.familyKey, mapping.department, settings.codeFamilies);
                    const fullYearCode = buildParkingGeneratedCode(mapping.familyKey, departmentCodeYear, 'yyyy');
                    const shortYearCode = buildParkingGeneratedCode(mapping.familyKey, departmentCodeYear, 'yy');
                    const generated = buildParkingGeneratedCode(mapping.familyKey, departmentCodeYear, format);
                    const overrides = getParkingCodeOverridesForYear(mapping, departmentCodeYear);
                    const finalCodes = getParkingCodesForYear(mapping, departmentCodeYear);
                    return (
                      <div key={`${mapping.familyKey}-${index}`} className="rounded-3xl border-2 border-gray-200 bg-white p-4 shadow-sm">
                        <div className="grid gap-4 xl:grid-cols-[minmax(260px,1fr)_150px_210px_180px_120px_90px] xl:items-end">
                          <div>
                            <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wide text-gray-400">Department</div>
                            <TextInput disabled={!canEditParking} value={mapping.department} onChange={value => updateCodeFamilyDirectory(index, { department: value })} placeholder="Department name" />
                          </div>

                          <div>
                            <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wide text-gray-400">Short code</div>
                            <CompactTextInput disabled={!canEditParking} value={mapping.familyKey} onChange={value => updateCodeFamilyDirectory(index, { familyKey: value })} placeholder="AB" />
                          </div>

                          <div>
                            <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wide text-gray-400">Code style</div>
                            <div className="grid grid-cols-2 gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1">
                              {[
                                { value: 'yyyy' as ParkingYearCodeFormat, label: fullYearCode || 'AB2026' },
                                { value: 'yy' as ParkingYearCodeFormat, label: shortYearCode || 'AB26' },
                              ].map(option => (
                                <button
                                  key={option.value}
                                  type="button"
                                  disabled={!canEditParking}
                                  onClick={() => updateCodeFamilyDirectory(index, { yearCodeFormat: option.value })}
                                  className={`rounded-lg px-2 py-2 text-xs font-extrabold transition ${format === option.value ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-800 disabled:text-gray-300'}`}
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div>
                            <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wide text-gray-400">Preview for {departmentCodeYear}</div>
                            <div
                              className="flex min-h-10 items-center justify-center rounded-xl px-3 py-2 text-lg font-extrabold shadow-sm"
                              style={{ backgroundColor: color.hex, color: readableTextColor(color.hex) }}
                            >
                              {generated || 'Add short code'}
                            </div>
                          </div>

                          <label className="flex min-h-10 items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                            <input
                              type="checkbox"
                              disabled={!canEditParking}
                              checked={Boolean(mapping.ignoreFlags)}
                              onChange={event => updateCodeFamilyDirectoryAndSave(index, { ignoreFlags: event.target.checked })}
                              className="h-4 w-4 rounded border-gray-300 text-blue-600 disabled:opacity-40"
                            />
                            <span className="text-xs font-extrabold text-gray-600">Ignore flags</span>
                          </label>

                          <div className="flex items-end gap-2">
                            <label className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-gray-50" title="Department color">
                              <input
                                type="color"
                                disabled={!canEditParking}
                                value={mapping.colorHex || color.hex}
                                onChange={event => updateCodeFamilyDirectory(index, { colorHex: event.target.value })}
                                className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
                              />
                            </label>
                            <button
                              type="button"
                              disabled={!canEditParking}
                              onClick={() => deleteCodeFamily(index)}
                              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-100 bg-red-50 text-red-600 hover:bg-red-100 disabled:text-gray-300"
                              title="Delete department"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>

                        <details className="mt-3 rounded-2xl border border-gray-100 bg-gray-50 px-3 py-2">
                          <summary className="cursor-pointer text-xs font-extrabold text-gray-500">Advanced: extra matching codes</summary>
                          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(240px,1fr)_minmax(220px,1fr)] lg:items-end">
                            <div>
                              <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wide text-gray-400">Also match these codes in {departmentCodeYear}</div>
                              <TextInput
                                disabled={!canEditParking}
                                value={overrides.join(', ')}
                                onChange={value => updateCodeFamilyOverridesForYear(index, departmentCodeYear, value)}
                                placeholder="Only for exceptions, comma separated"
                              />
                            </div>
                            <div>
                              <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wide text-gray-400">Final matched codes</div>
                              <div className="flex min-h-10 flex-wrap items-center gap-1 rounded-xl border border-gray-100 bg-white px-2 py-1.5">
                                {finalCodes.map(code => <span key={code} className="rounded-full bg-gray-100 px-2 py-1 text-xs font-extrabold text-gray-700">{code}</span>)}
                                {finalCodes.length === 0 ? <span className="text-xs font-bold text-gray-400">No codes yet</span> : null}
                              </div>
                            </div>
                          </div>
                        </details>
                      </div>
                    );
                  })}
                  {filteredCodeFamilies.length === 0 ? (
                    <div className="rounded-3xl border border-gray-200 bg-white p-8 text-center text-sm font-semibold text-gray-400">
                      No departments match your search.
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
  ) : null;

  const annualFullscreenModal = annualFullscreen ? (
          <div className="fixed inset-0 z-50 bg-white p-4 md:p-6" role="dialog" aria-modal="true" aria-label="Annual department summary full screen">
            <div className="flex flex-col gap-3 border-b border-gray-200 pb-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-2xl font-extrabold text-gray-950">Annual department summary</h2>
                <p className="mt-1 text-sm font-semibold text-gray-500">
                  {selectedYear || 'No year selected'} · {annualSummaryRows.length.toLocaleString()} departments
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAnnualFullscreen(false)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-950 px-4 py-2 text-sm font-extrabold text-white hover:bg-gray-800"
              >
                <X size={16} /> Close
              </button>
            </div>
            <div className="mt-4 h-[calc(100vh-120px)] overflow-auto rounded-2xl border border-gray-200">
              <AnnualSummaryTable rows={annualSummaryRows} codeFamilies={settings.codeFamilies} stickyHeader />
            </div>
          </div>
  ) : null;

  if (!team || !user) {
    return <div className="p-8 text-sm text-gray-500">Sign in and join a team to use Parking.</div>;
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-gray-500"><Loader2 className="mr-2 animate-spin" /> Loading Parking...</div>;
  }

  if (activeWorkspace === 'dashboard') {
    return (
      <div className="h-full overflow-y-auto pb-12">
        <div className="mx-auto max-w-6xl animate-in fade-in slide-in-from-bottom-2 duration-500 pt-8">
          <div className="mb-8 px-4">
            <button
              onClick={() => { window.location.hash = ''; }}
              className="mb-3 flex items-center gap-1.5 text-sm font-medium text-gray-400 transition-colors hover:text-gray-600"
            >
              <ArrowLeft size={14} /> Back to Main
            </button>
            <h2 className="mb-2 text-2xl font-bold tracking-tight text-gray-900">Parking Workspace</h2>
            <p className="text-gray-500">Select a parking tool to review plates, revenue, lots, and usage trends.</p>
          </div>

          <div className="grid grid-cols-1 gap-4 px-4 md:grid-cols-2">
            <ParkingDashboardCard
              onClick={() => navigateWorkspace('plate-monitor')}
              icon={<Search size={20} />}
              color="amber"
              title="Plate Monitor"
              description="Review flagged plates, repeat activity, unusual timing, and plate-level pattern evidence."
            />
            <ParkingDashboardCard
              onClick={() => navigateWorkspace('lot-data')}
              icon={<MapPin size={20} />}
              color="emerald"
              title="Parking Lot Data"
              description="Import revenue files, map HotSpot locations, and compare lot usage, revenue, and peak periods."
            />
          </div>
        </div>
      </div>
    );
  }

  if (activeWorkspace === 'lot-data') {
    const mapMetricLabel = getParkingMapMetricLabel(parkingMapMetric);
    const activeLocation = selectedRevenueLocation;
    const hasVisibleRevenuePins = mapLocationSummaries.length > 0;

    return (
      <div className="h-full overflow-hidden bg-slate-100">
        <main
          data-testid="parking-lot-data-map-first-shell"
          data-layout="map-first"
          className="relative h-full min-h-0 overflow-hidden bg-slate-100"
        >
          <div className={`absolute inset-0 transition-opacity ${lotViewMode === 'analysis' ? 'opacity-25' : 'opacity-100'}`}>
            <MapBase latitude={44.389} longitude={-79.69} zoom={13} showNavigation showScale>
              {lotMapMode === 'heatmap' && mapLocationSummaries.length > 0 ? (
                <Source id="parking-revenue-heatmap-src" type="geojson" data={mapHeatmapGeoJson}>
                  <Layer {...parkingHeatmapLayer} />
                  <Layer {...parkingHeatmapPointLayer} />
                </Source>
              ) : null}
              {lotMapMode === 'markers' ? mapLocationSummaries.map(entry => {
                const value = getParkingMapMetricValue(entry, parkingMapMetric);
                const ratio = Math.min(1, value / mapMetricMax);
                const size = Math.max(42, Math.min(72, 42 + Math.sqrt(ratio) * 30));
                const isSelected = Boolean(activeLocation && entry.sourceLocationKeys.includes(activeLocation.key));
                const fillColor = mapMetricColor(ratio);
                const borderColor = isSelected ? '#FBBF24' : entry.coordinateSource === 'public' ? '#2563EB' : entry.coordinateSource === 'mixed' ? '#7C3AED' : '#FFFFFF';
                return (
                  <Marker key={entry.key} longitude={entry.longitude} latitude={entry.latitude} anchor="center">
                    <div className="group relative flex flex-col items-center">
                      <button
                        type="button"
                        onClick={() => toggleRevenueLocationSelection(entry.primaryLocation.key, isSelected)}
                        title={`${entry.displayName}: ${formatMapMetricValue(value, parkingMapMetric)} ${mapMetricLabel.toLowerCase()}${entry.aggregateCount > 1 ? ' · same-lot source IDs grouped' : ''}`}
                        className={`relative flex items-center justify-center rounded-full border-[3px] shadow-lg transition hover:scale-110 focus:outline-none focus:ring-4 focus:ring-amber-200/80 ${
                          isSelected ? 'z-10 ring-4 ring-amber-200/80' : ''
                        } ${activeLocation && !isSelected ? 'opacity-35' : 'opacity-100'}`}
                        style={{ width: size, height: size, backgroundColor: fillColor, borderColor }}
                      >
                        <span className="rounded-full bg-white/95 px-1.5 py-0.5 text-[10px] font-black text-slate-800 shadow-sm">{formatMapMetricValue(value, parkingMapMetric)}</span>
                      </button>
                      <div className={`pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-48 -translate-x-1/2 rounded-2xl border border-slate-200 bg-white/95 p-2 text-left shadow-xl transition ${
                        isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}>
                        <div className="truncate text-xs font-black text-slate-950">{entry.displayName}</div>
                        <div className="mt-1 text-sm font-black text-emerald-700">{formatMapMetricValue(value, parkingMapMetric)}</div>
                        <div className="mt-1 text-[11px] font-semibold text-slate-500">
                          {entry.rowCount.toLocaleString()} sessions · {money(entry.totalRevenue)}
                        </div>
                      </div>
                    </div>
                  </Marker>
                );
              }) : null}
            </MapBase>
          </div>

          <div className="pointer-events-none absolute left-3 top-3 z-30 flex max-w-[calc(100%-1.5rem)] items-start gap-3">
            <div className="pointer-events-auto flex min-w-0 items-center gap-2 rounded-3xl border border-slate-200 bg-white/95 px-3 py-2 shadow-xl backdrop-blur">
              <button type="button" onClick={() => navigateWorkspace('dashboard')} aria-label="Back to Parking Workspaces" className="rounded-xl border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-50">
                <ArrowLeft size={18} />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700">
                  <MapPin size={16} /> Parking Lot Data
                </div>
                <div className="truncate text-lg font-black text-slate-950">Map-first lot activity</div>
              </div>
              <span className="hidden rounded-full bg-emerald-50 px-3 py-1 text-xs font-extrabold text-emerald-700 sm:inline-flex">{mapMetricLabel} map</span>
              <span className={`hidden rounded-full px-3 py-1 text-xs font-extrabold sm:inline-flex ${
                publicParkingError
                  ? 'bg-amber-50 text-amber-700'
                  : publicParkingLoading
                    ? 'bg-blue-50 text-blue-700'
                    : 'bg-blue-50 text-blue-700'
              }`}>
                {publicParkingError ? 'City source unavailable' : publicParkingLoading ? 'Loading public lots' : `${publicFallbackPinCount} City-source groups`}
              </span>
              <div className="hidden rounded-2xl border border-slate-200 bg-slate-50 p-1 lg:grid lg:grid-cols-2">
                {(['map', 'analysis'] as ParkingLotViewMode[]).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setLotViewMode(mode)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-black capitalize transition ${
                      lotViewMode === mode ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                    }`}
                    aria-pressed={lotViewMode === mode}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <div className="hidden rounded-2xl border border-slate-200 bg-slate-50 p-1 xl:grid xl:grid-cols-2">
                {(['markers', 'heatmap'] as ParkingLotMapMode[]).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setLotMapMode(mode)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-black capitalize transition ${
                      lotMapMode === mode ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                    }`}
                    aria-pressed={lotMapMode === mode}
                  >
                    {mode === 'heatmap' ? 'Heat map' : 'Pins'}
                  </button>
                ))}
              </div>
              <label className={`inline-flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-xs font-extrabold text-white ${canEditParking ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-gray-300'}`}>
                <Upload size={14} /> Import revenue
                <input type="file" accept=".xlsx,.xls" multiple disabled={!canEditParking || saving} onChange={handleRevenueFileChange} className="hidden" />
              </label>
              {saving && previewRevenueDatasets.length > 0 ? (
                <span className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-extrabold text-emerald-700">
                  <Loader2 className="animate-spin" size={14} /> Auto-saving
                </span>
              ) : null}
            </div>
          </div>

          <div
            className={`absolute top-24 z-20 hidden rounded-3xl border border-slate-200 bg-white/95 text-xs font-bold text-slate-600 shadow-xl backdrop-blur transition-all xl:block ${
              parkingLegendCollapsed ? 'pointer-events-auto max-w-[11rem] p-2' : 'pointer-events-none max-w-xs p-3'
            }`}
            style={{ left: lotLeftRailOpen ? 350 : 92 }}
            aria-label="Parking map legend"
          >
            {parkingLegendCollapsed ? (
              <button
                type="button"
                onClick={() => setParkingLegendCollapsed(false)}
                className="flex w-full items-center gap-2 rounded-2xl px-2 py-1 text-left text-[11px] font-black uppercase tracking-wide text-slate-600 hover:bg-slate-50"
                aria-expanded="false"
              >
                <span className="inline-block h-3 w-3 rounded-full bg-emerald-700" />
                Map legend
              </button>
            ) : (
              <>
                <div className="mb-2 text-[11px] font-black uppercase tracking-wide text-slate-500">Map legend</div>
                <div className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-full bg-emerald-700" />
                  <span>{mapMetricLabel}: darker/larger means higher value</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-full border-[3px] border-white bg-emerald-400 shadow" />
                  <span>Reviewed location</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-full border-[3px] border-blue-600 bg-emerald-300 shadow" />
                  <span>City public source</span>
                </div>
                <div className="mt-1 text-[11px] font-semibold text-slate-400">
                  {lotMapMode === 'heatmap' ? 'Heat map summarizes concentration; switch to Pins for exact lots.' : `Numbers inside pins show ${mapMetricLabel.toLowerCase()}.`}
                </div>
              </>
            )}
          </div>

          <aside
            data-state={lotLeftRailOpen ? 'expanded' : 'collapsed'}
            className={`pointer-events-auto absolute bottom-3 left-3 top-20 z-30 flex flex-col rounded-3xl border border-slate-200 bg-white/95 shadow-xl backdrop-blur transition-all duration-200 ${
              lotLeftRailOpen ? 'w-80 overflow-hidden p-3' : 'w-16 items-center p-2'
            }`}
            aria-label="Parking lot filters and list"
          >
            {lotLeftRailOpen ? (
              <>
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-black uppercase tracking-wide text-slate-500">Parking lots</div>
                <p className="text-[11px] font-semibold text-slate-400">Browse lots first; filters can tuck away.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-blue-50 px-2 py-1 text-[11px] font-black text-blue-700">{mapLocationSummaries.length} pins</span>
                <button
                  type="button"
                  onClick={() => setLotFiltersCollapsed(current => !current)}
                  className="inline-flex h-8 items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-2 text-[11px] font-black text-slate-600 hover:bg-slate-50"
                  aria-expanded={!lotFiltersCollapsed}
                  title={lotFiltersCollapsed ? 'Show filters' : 'Hide filters'}
                >
                  <SlidersHorizontal size={13} />
                  {lotFiltersCollapsed ? 'Filters' : 'Hide'}
                </button>
                <button
                  type="button"
                  onClick={() => setLotLeftRailOpen(false)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  aria-label="Collapse map filters"
                  title="Collapse filters"
                >
                  <Minimize2 size={14} />
                </button>
              </div>
            </div>

            {!lotFiltersCollapsed ? (
            <div className="mt-3 shrink-0 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wide text-slate-400">Year</div>
                  <select value={selectedRevenueYear} onChange={event => { setSelectedRevenueYear(event.target.value); setSelectedRevenueMonth('all'); }} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">
                    <option value="all">All years</option>
                    {revenueYears.map(year => <option key={year} value={year}>{year}</option>)}
                  </select>
                </div>
                <div>
                  <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wide text-slate-400">Month</div>
                  <select value={selectedRevenueMonth} onChange={event => setSelectedRevenueMonth(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">
                    <option value="all">{selectedRevenueYear === 'all' ? 'All months' : `All ${selectedRevenueYear}`}</option>
                    {revenueMonthsForSelectedYear.map(month => <option key={month} value={month}>{month}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wide text-slate-400">Lot category</div>
                <select value={selectedRevenueCategory} onChange={event => setSelectedRevenueCategory(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">
                  <option value="all">All categories</option>
                  {revenueCategoryOptions.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}
                  <option value={UNCATEGORIZED_PARKING_CATEGORY_ID}>Uncategorized</option>
                </select>
              </div>
              <div>
                <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wide text-slate-400">Source</div>
                <div className="grid grid-cols-3 gap-1 rounded-2xl border border-slate-200 bg-white p-1">
                  {ALL_REVENUE_SOURCES.map(source => (
                    <button key={source} type="button" onClick={() => setRevenueSourceFilter(source)} className={`rounded-xl px-2 py-2 text-xs font-extrabold ${revenueSourceFilter === source ? 'bg-emerald-50 text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                      {source === 'all' ? 'All' : source === 'hotspot' ? 'App' : 'QR'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wide text-slate-400">Day type</div>
                <div className="grid grid-cols-2 gap-1 rounded-2xl border border-slate-200 bg-white p-1">
                  {ALL_REVENUE_DAY_TYPES.map(dayType => (
                    <button key={dayType} type="button" onClick={() => setRevenueDayTypeFilter(dayType)} className={`rounded-xl px-2 py-2 text-xs font-extrabold ${revenueDayTypeFilter === dayType ? 'bg-blue-50 text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                      {REVENUE_DAY_TYPE_LABELS[dayType]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wide text-slate-400">Map metric</div>
                <div className="grid grid-cols-2 gap-1 rounded-2xl border border-slate-200 bg-white p-1">
                  {PARKING_MAP_METRICS.map(metric => (
                    <button
                      key={metric}
                      type="button"
                      onClick={() => setParkingMapMetric(metric)}
                      className={`rounded-xl px-2 py-2 text-xs font-extrabold ${parkingMapMetric === metric ? 'bg-emerald-50 text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      {getParkingMapMetricLabel(metric)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="rounded-2xl border border-slate-200 bg-white p-2">
                  <span className="block text-[10px] font-extrabold uppercase tracking-wide text-slate-400">From</span>
                  <select value={revenueHourStart} onChange={event => setRevenueHourStart(Number(event.target.value))} className="mt-1 w-full bg-transparent text-sm font-extrabold text-slate-900 outline-none">
                    {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{formatHourOption(hour)}</option>)}
                  </select>
                </label>
                <label className="rounded-2xl border border-slate-200 bg-white p-2">
                  <span className="block text-[10px] font-extrabold uppercase tracking-wide text-slate-400">To</span>
                  <select value={revenueHourEnd} onChange={event => setRevenueHourEnd(Number(event.target.value))} className="mt-1 w-full bg-transparent text-sm font-extrabold text-slate-900 outline-none">
                    {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{formatHourOption(hour)}</option>)}
                  </select>
                </label>
              </div>
              <p className="text-[11px] font-semibold leading-4 text-slate-400">Time filters use session start time. Utilization uses paid minutes inside the selected hour range.</p>
            </div>
            ) : (
              <div className="mt-3 shrink-0 rounded-2xl border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] font-bold leading-4 text-blue-800">
                Filters hidden to give the lot list more height. Showing {selectedRevenueYear === 'all' ? 'all years' : selectedRevenueYear}, {selectedRevenueMonth === 'all' ? 'all months' : selectedRevenueMonth}, {REVENUE_DAY_TYPE_LABELS[revenueDayTypeFilter].toLowerCase()}.
              </div>
            )}

            <div className="mt-3 grid shrink-0 grid-cols-2 gap-2">
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3">
                <div className="text-[10px] font-black uppercase tracking-wide text-emerald-500">Revenue</div>
                <div className="mt-1 text-lg font-black text-emerald-950">{money(revenueAnalytics.totalRevenue)}</div>
              </div>
              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3">
                <div className="text-[10px] font-black uppercase tracking-wide text-blue-500">Sessions</div>
                <div className="mt-1 text-lg font-black text-blue-950">{revenueAnalytics.rowCount.toLocaleString()}</div>
              </div>
              <div className="rounded-2xl border border-amber-100 bg-amber-50 p-3">
                <div className="text-[10px] font-black uppercase tracking-wide text-amber-500">Avg stay</div>
                <div className="mt-1 text-lg font-black text-amber-950">{minutesToDuration(revenueAnalytics.averageStayMinutes)}</div>
              </div>
              <div className="rounded-2xl border border-violet-100 bg-violet-50 p-3">
                <div className="text-[10px] font-black uppercase tracking-wide text-violet-500">Peak</div>
                <div className="mt-1 text-lg font-black text-violet-950">{formatHour(revenueAnalytics.peakHour)}</div>
              </div>
            </div>

            <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-black uppercase tracking-wide text-slate-500">Parking lots</div>
                <div className="text-[11px] font-bold text-slate-400">{revenueAnalytics.locationSummaries.length.toLocaleString()} total</div>
              </div>
              <div className="space-y-2">
                {revenueAnalytics.locationSummaries.slice(0, 80).map(location => {
                  const publicMatch = publicParkingMatchesByKey.get(location.key);
                  return (
                    <button
                      key={location.key}
                      type="button"
                      onClick={() => toggleRevenueLocationSelection(location.key)}
                      className={`w-full rounded-2xl border p-3 text-left transition ${
                        activeLocation?.key === location.key ? 'border-emerald-300 bg-emerald-50 shadow-sm' : 'border-slate-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-black text-slate-950">{location.displayName}</div>
                          <div className="mt-1 text-[11px] font-bold text-slate-400">{location.rowCount.toLocaleString()} sessions · avg {minutesToDuration(location.averageStayMinutes)}</div>
                        </div>
                        <div className="shrink-0 text-right text-sm font-black text-emerald-700">{money(location.totalRevenue)}</div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {location.sourceIds.slice(0, 3).map(ref => <span key={`${ref.source}-${ref.sourceId}`} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{getParkingRevenueSourceLabel(ref.source)} {ref.sourceId}</span>)}
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: `${location.categoryColorHex || '#64748B'}22`, color: location.categoryColorHex || '#64748B' }}>{location.categoryLabel || 'Uncategorized'}</span>
                        {location.isMapped ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Reviewed map</span> : publicMatch ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">City source</span> : null}
                      </div>
                    </button>
                  );
                })}
                {revenueAnalytics.locationSummaries.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white/80 p-5 text-center text-sm font-bold text-slate-400">
                    Upload HotSpot or QR revenue files to start.
                  </div>
                ) : null}
              </div>
            </div>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setLotLeftRailOpen(true)}
                className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                aria-label="Expand map filters"
                title="Expand filters"
              >
                <SlidersHorizontal size={20} />
                <span className="[writing-mode:vertical-rl] rotate-180 text-xs font-black uppercase tracking-wide">Filters</span>
                <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-black text-blue-700">{mapLocationSummaries.length}</span>
              </button>
            )}
          </aside>

          {lotViewMode === 'analysis' ? (
            <section
              className="pointer-events-auto absolute bottom-4 left-3 right-3 top-24 z-20 overflow-y-auto rounded-3xl border border-slate-200 bg-slate-50/95 p-4 shadow-2xl backdrop-blur xl:left-[350px] xl:right-[400px]"
              aria-label="Parking data analysis summary"
            >
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-violet-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-violet-700">
                    <BarChart3 size={14} /> Analysis summary
                  </div>
                  <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Parking lot data analysis</h2>
                  <p className="mt-1 max-w-2xl text-sm font-semibold leading-6 text-slate-500">
                    Chart-first view of revenue, sessions, stay length, payment source, and lot utilization for the current filters.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setLotViewMode('map')}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  <MapPin size={16} /> Back to map
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-4">
                  <div className="text-xs font-black uppercase tracking-wide text-emerald-600">Filtered revenue</div>
                  <div className="mt-1 text-2xl font-black text-emerald-950">{money(revenueAnalytics.totalRevenue)}</div>
                  <p className="mt-1 text-xs font-bold text-emerald-700">{revenueAnalytics.rowCount.toLocaleString()} sessions</p>
                </div>
                <div className="rounded-3xl border border-amber-100 bg-amber-50 p-4">
                  <div className="text-xs font-black uppercase tracking-wide text-amber-600">Average stay</div>
                  <div className="mt-1 text-2xl font-black text-amber-950">{minutesToDuration(revenueAnalytics.averageStayMinutes)}</div>
                  <p className="mt-1 text-xs font-bold text-amber-700">Peak starts {formatHour(revenueAnalytics.peakHour)}.</p>
                </div>
                <div className="rounded-3xl border border-violet-100 bg-violet-50 p-4">
                  <div className="text-xs font-black uppercase tracking-wide text-violet-600">Known capacity</div>
                  <div className="mt-1 text-2xl font-black text-violet-950">{parkingPlannerAnalysis.capacityRows.length.toLocaleString()} lots</div>
                  <p className="mt-1 text-xs font-bold text-violet-700">Uses reviewed and City spaces where matched.</p>
                </div>
              </div>

              <section className="mt-4 overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 bg-gradient-to-r from-slate-950 via-emerald-950 to-blue-950 p-5 text-white">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-emerald-100">
                        <TrendingUp size={14} /> Trend overview
                      </div>
                      <h3 className="mt-2 text-2xl font-black tracking-tight">{parkingTrendOverview.scopeLabel}</h3>
                      <p className="mt-1 max-w-3xl text-sm font-semibold leading-6 text-slate-200">
                        Month-over-month, year-over-year, and day-pattern movement. Weekday, Saturday, and Sunday charts use average activity per active day so month length does not distort the trend.
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white/10 px-4 py-3 text-right">
                      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-300">Focus month</div>
                      <div className="mt-1 text-xl font-black">{parkingTrendOverview.targetMonth || '—'}</div>
                    </div>
                  </div>
                </div>
                <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
                  {parkingTrendOverview.comparisonCards.map(card => (
                    <TrendComparisonCard key={card.key} card={card} />
                  ))}
                </div>
                <div className="grid gap-4 border-t border-slate-100 bg-slate-50/70 p-4 xl:grid-cols-3">
                  <ParkingChartCard title="Weekday trend" subtitle="Average revenue per active weekday.">
                    <TrendAreaChart data={parkingTrendOverview.weekdayTrend} color="#2563EB" />
                  </ParkingChartCard>
                  <ParkingChartCard title="Saturday trend" subtitle="Average Saturday activity by month.">
                    <TrendAreaChart data={parkingTrendOverview.saturdayTrend} color="#7C3AED" />
                  </ParkingChartCard>
                  <ParkingChartCard title="Sunday trend" subtitle="Average Sunday activity by month.">
                    <TrendAreaChart data={parkingTrendOverview.sundayTrend} color="#EA580C" />
                  </ParkingChartCard>
                </div>
                {parkingTrendOverview.fastestGrowingLot ? (
                  <div className="border-t border-emerald-100 bg-emerald-50 px-5 py-4 text-sm font-bold text-emerald-900">
                    Fastest-growing lot this month: <span className="font-black">{parkingTrendOverview.fastestGrowingLot.label}</span>
                    {' '}increased by {money(parkingTrendOverview.fastestGrowingLot.changeValue)}
                    {parkingTrendOverview.fastestGrowingLot.changePercent == null ? '' : ` (${parkingTrendOverview.fastestGrowingLot.changePercent.toFixed(1)}%)`}.
                  </div>
                ) : null}
              </section>

              <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="grid gap-4 xl:grid-cols-2">
                  <ParkingChartCard
                    title={selectedRevenueMonth === 'all' ? 'Revenue trend' : 'Daily revenue trend'}
                    subtitle={selectedRevenueMonth === 'all' ? 'Monthly revenue movement for the current filter.' : 'Daily movement within the selected month.'}
                  >
                    <TrendAreaChart data={selectedRevenueMonth === 'all' ? parkingPlannerAnalysis.monthlyTrend : parkingPlannerAnalysis.dailyTrend} />
                  </ParkingChartCard>
                  <ParkingChartCard title="Hourly demand profile" subtitle="When paid parking activity is happening.">
                    <HourlyRevenueChart data={parkingPlannerAnalysis.hourlyProfile} />
                  </ParkingChartCard>
                  <ParkingChartCard title="Top lots by revenue" subtitle="Quick comparison of the highest value parking locations." tall>
                    <TopLotsChart data={parkingPlannerAnalysis.topLotsByRevenue} />
                  </ParkingChartCard>
                  <ParkingChartCard title="Category comparison" subtitle="Revenue by lot category for the current filters." tall>
                    <TopLotsChart data={parkingPlannerAnalysis.categoryComparisonRows} />
                  </ParkingChartCard>
                </div>

                <div className="space-y-4">
                  <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-center gap-2">
                      <CheckCircle2 className="text-emerald-600" size={18} />
                      <h3 className="font-black text-slate-950">Planner insights</h3>
                    </div>
                    <div className="space-y-2">
                      {parkingPlannerAnalysis.insights.map(insight => (
                        <div key={insight} className="rounded-2xl border border-slate-100 bg-slate-50 p-3 text-sm font-bold leading-5 text-slate-700">
                          {insight}
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-3xl border border-violet-100 bg-violet-50 p-4 shadow-sm">
                    <div className="text-xs font-black uppercase tracking-wide text-violet-600">Capacity/utilization</div>
                    <h3 className="mt-1 font-black text-violet-950">Known spaces and estimated use</h3>
                    <div className="mt-3 space-y-2">
                      {parkingPlannerAnalysis.capacityRows.slice(0, 5).map(row => (
                        <div key={row.key} className="rounded-2xl bg-white p-3">
                          <div className="flex items-start justify-between gap-2 text-sm font-black text-slate-800">
                            <span className="min-w-0 truncate">{row.label}</span>
                            <span>{formatUtilization(row.utilizationPercent)}</span>
                          </div>
                          <div className="mt-1 text-xs font-bold text-slate-400">
                            {row.spaces?.toLocaleString() || 'Unknown'} spaces · {row.revenuePerSpace == null ? '—' : `${money(row.revenuePerSpace)}/space`}
                          </div>
                        </div>
                      ))}
                      {parkingPlannerAnalysis.capacityRows.length === 0 ? (
                        <div className="rounded-2xl bg-white p-3 text-sm font-bold text-violet-700">No matched public-space counts yet.</div>
                      ) : null}
                    </div>
                  </section>

                  <section className="rounded-3xl border border-blue-100 bg-blue-50 p-4 shadow-sm">
                    <div className="text-xs font-black uppercase tracking-wide text-blue-600">Category capacity</div>
                    <h3 className="mt-1 font-black text-blue-950">Compare parking areas</h3>
                    <div className="mt-3 space-y-2">
                      {parkingPlannerAnalysis.categoryComparisonRows.slice(0, 6).map(row => (
                        <div key={row.key} className="rounded-2xl bg-white p-3">
                          <div className="flex items-start justify-between gap-2 text-sm font-black text-slate-800">
                            <span className="min-w-0 truncate">{row.label}</span>
                            <span>{row.spaces == null ? '—' : `${row.spaces.toLocaleString()} spaces`}</span>
                          </div>
                          <div className="mt-1 text-xs font-bold text-slate-400">
                            {money(row.revenue)} · {row.sessions.toLocaleString()} sessions · avg stay {minutesToDuration(row.averageStayMinutes)}
                          </div>
                          <div className="mt-1 text-xs font-bold text-slate-400">
                            {row.revenuePerSpace == null ? '—' : `${money(row.revenuePerSpace)}/space`} · utilization {formatUtilization(row.utilizationPercent)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              </div>

              {parkingPlannerAnalysis.selectedLot ? (
                <section className="mt-4 rounded-3xl border border-emerald-100 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="text-xs font-black uppercase tracking-wide text-emerald-600">Selected lot drilldown</div>
                      <h3 className="mt-1 text-xl font-black text-slate-950">{parkingPlannerAnalysis.selectedLot.displayName}</h3>
                      <p className="mt-1 text-sm font-semibold text-slate-500">
                        #{parkingPlannerAnalysis.selectedLot.revenueRank} by revenue · {parkingPlannerAnalysis.selectedLot.revenueSharePercent}% of filtered revenue · {parkingPlannerAnalysis.selectedLot.spaces ? `${parkingPlannerAnalysis.selectedLot.spaces} known spaces` : 'capacity not matched yet'}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-right text-xs font-black text-slate-600 sm:grid-cols-4">
                      <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-800">Rev/space<br /><span className="text-base">{parkingPlannerAnalysis.selectedLot.revenuePerSpace == null ? '—' : money(parkingPlannerAnalysis.selectedLot.revenuePerSpace)}</span></div>
                      <div className="rounded-2xl bg-blue-50 p-3 text-blue-800">Utilization<br /><span className="text-base">{formatUtilization(parkingPlannerAnalysis.selectedLot.utilizationPercent)}</span></div>
                      <div className="rounded-2xl bg-amber-50 p-3 text-amber-800">Avg stay<br /><span className="text-base">{minutesToDuration(activeLocation?.averageStayMinutes || 0)}</span></div>
                      <div className="rounded-2xl bg-violet-50 p-3 text-violet-800">System avg<br /><span className="text-base">{minutesToDuration(parkingPlannerAnalysis.selectedLot.systemAverageStayMinutes)}</span></div>
                    </div>
                  </div>
                  <div className="grid gap-4 xl:grid-cols-3">
                    <ParkingChartCard title="Selected-lot hourly profile" subtitle="Peak pattern for this lot only.">
                      <HourlyRevenueChart data={parkingPlannerAnalysis.selectedLot.hourlyProfile} compact />
                    </ParkingChartCard>
                    <ParkingChartCard
                      title={selectedRevenueMonth === 'all' ? 'Selected-lot trend' : 'Selected-lot daily trend'}
                      subtitle={selectedRevenueMonth === 'all' ? 'Revenue trend for this lot only.' : 'Daily movement for this lot in the selected month.'}
                    >
                      <TrendAreaChart data={selectedRevenueMonth === 'all' ? parkingPlannerAnalysis.selectedLot.monthlyTrend : parkingPlannerAnalysis.selectedLot.dailyTrend} color="#059669" />
                    </ParkingChartCard>
                    <ParkingChartCard title="Selected-lot payment mix" subtitle="App compared with QR for this lot.">
                      <SourceMixChart data={parkingPlannerAnalysis.selectedLot.sourceMix} />
                    </ParkingChartCard>
                  </div>
                </section>
              ) : null}
            </section>
          ) : null}

          <aside
            data-state={lotRightRailOpen ? 'expanded' : 'collapsed'}
            className={`pointer-events-auto absolute bottom-4 right-3 top-4 z-30 flex flex-col rounded-3xl border border-slate-200 bg-white/95 shadow-xl backdrop-blur transition-all duration-200 ${
              lotRightRailOpen ? 'w-[380px] p-3' : 'w-16 items-center p-2'
            }`}
            aria-label="Parking lot trends and details"
          >
            {lotRightRailOpen ? (
              <>
              <button
                type="button"
                onClick={() => setLotRightRailOpen(false)}
                className="mb-2 ml-auto inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                aria-label="Collapse parking trends"
                title="Collapse trends"
              >
                <Minimize2 size={14} />
              </button>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <section className="rounded-3xl border border-emerald-100 bg-emerald-50 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-black uppercase tracking-wide text-emerald-600">
                      {activeMapLocation?.coordinateSource === 'reviewed'
                        ? 'Selected reviewed lot'
                        : activeMapLocation?.coordinateSource === 'public'
                          ? 'Selected public-source match'
                          : 'Parking trends'}
                    </div>
                    <h3 className="mt-1 text-lg font-black text-emerald-950">{activeMapLocation?.displayName || activeLocation?.displayName || 'All parking lots'}</h3>
                  </div>
                  <BarChart3 className="text-emerald-700" size={22} />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <div className="rounded-2xl bg-white p-3">
                    <div className="text-[10px] font-black uppercase text-emerald-500">Revenue</div>
                    <div className="mt-1 text-lg font-black text-emerald-950">{money(activeMapLocation?.totalRevenue || activeLocation?.totalRevenue || revenueAnalytics.totalRevenue)}</div>
                  </div>
                  <div className="rounded-2xl bg-white p-3">
                    <div className="text-[10px] font-black uppercase text-blue-500">Sessions</div>
                    <div className="mt-1 text-lg font-black text-blue-950">{(activeMapLocation?.rowCount || activeLocation?.rowCount || revenueAnalytics.rowCount).toLocaleString()}</div>
                  </div>
                  <div className="rounded-2xl bg-white p-3">
                    <div className="text-[10px] font-black uppercase text-amber-500">Peak</div>
                    <div className="mt-1 text-lg font-black text-amber-950">{formatHour(activeMapLocation?.peakHour ?? activeLocation?.peakHour ?? revenueAnalytics.peakHour)}</div>
                  </div>
                </div>
                {(activeMapLocation || activeLocation) ? (
                  <div className="mt-3 rounded-2xl bg-white p-3 text-xs font-bold text-slate-600">
                    HotSpot app: {money(activeMapLocation?.hotspotRevenue ?? activeLocation?.hotspotRevenue)} · QR: {money(activeMapLocation?.qrRevenue ?? activeLocation?.qrRevenue)} · unique plates: {(activeMapLocation?.uniquePlateCount || activeLocation?.uniquePlateCount || 0).toLocaleString()}
                    {activeMapLocation && activeMapLocation.aggregateCount > 1 ? (
                      <div className="mt-2 rounded-xl bg-slate-50 p-2 text-slate-600">
                        Same-lot source IDs grouped: {activeMapLocation.aggregateCount}.
                      </div>
                    ) : null}
                    {activeMapLocation?.coordinateSource === 'public' ? (
                      <div className="mt-2 rounded-xl bg-blue-50 p-2 text-blue-700">
                        City source pin: {activeMapLocation.publicMatch?.location.commonName || activeMapLocation.publicMatch?.location.name}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>

              <section className="mt-3 rounded-3xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center gap-2">
                  <BarChart3 className="text-emerald-600" size={18} />
                  <h3 className="font-black text-slate-950">Quick charts</h3>
                </div>
                <div className="h-44">
                  <HourlyRevenueChart data={parkingPlannerAnalysis.selectedLot?.hourlyProfile || parkingPlannerAnalysis.hourlyProfile} compact />
                </div>
                <div className="mt-3 h-44">
                  <SourceMixChart data={parkingPlannerAnalysis.selectedLot?.sourceMix || parkingPlannerAnalysis.sourceMix} />
                </div>
              </section>

              <section className="mt-3 rounded-3xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Trend snapshot</div>
                    <h3 className="mt-1 font-black text-slate-950">{parkingTrendOverview.scopeLabel}</h3>
                    <p className="mt-1 text-xs font-bold text-slate-400">
                      Comparing {parkingTrendOverview.targetMonth || 'latest month'} across all imported months.
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700">MoM / YoY</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {parkingTrendOverview.comparisonCards.map(card => (
                    <TrendComparisonCard key={card.key} card={card} compact />
                  ))}
                </div>
                {parkingTrendOverview.fastestGrowingLot ? (
                  <div className="mt-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-xs font-bold text-emerald-800">
                    Fastest-growing lot: <span className="font-black">{parkingTrendOverview.fastestGrowingLot.label}</span>
                    {' '}up {money(parkingTrendOverview.fastestGrowingLot.changeValue)}
                    {parkingTrendOverview.fastestGrowingLot.changePercent == null ? '' : ` (${parkingTrendOverview.fastestGrowingLot.changePercent.toFixed(1)}%)`}.
                  </div>
                ) : null}
              </section>

              <section className="mt-3 rounded-3xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Clock3 className="text-amber-600" size={18} />
                    <h3 className="font-black text-slate-950">Peak periods</h3>
                  </div>
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-black text-amber-700">{peakPeriodScopeLabel}</span>
                </div>
                <div className="space-y-2">
                  {peakPeriodRows.map(point => (
                    <div key={point.key} className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                      <div className="flex items-center justify-between text-sm font-black text-slate-800"><span>{point.label}</span><span>{money(point.revenue)}</span></div>
                      <div className="mt-1 text-xs font-semibold text-slate-400">{point.sessions.toLocaleString()} sessions · avg {minutesToDuration(point.averageStayMinutes)}</div>
                    </div>
                  ))}
                  {peakPeriodRows.length === 0 ? <p className="text-sm font-semibold text-slate-400">No peak periods yet.</p> : null}
                </div>
              </section>

              <section className="mt-3 rounded-3xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center gap-2">
                  <CalendarDays className="text-blue-600" size={18} />
                  <h3 className="font-black text-slate-950">Top single days</h3>
                </div>
                <div className="space-y-2">
                  {topDayRows.map(point => (
                    <div key={point.key} className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                      <div className="flex items-center justify-between text-sm font-black text-slate-800"><span>{point.label}</span><span>{money(point.revenue)}</span></div>
                      <div className="mt-1 text-xs font-semibold text-slate-400">{point.sessions.toLocaleString()} sessions</div>
                    </div>
                  ))}
                  {topDayRows.length === 0 ? <p className="text-sm font-semibold text-slate-400">Upload revenue files to populate daily trends.</p> : null}
                </div>
              </section>

              <details className="mt-3 rounded-3xl border border-slate-200 bg-white p-4">
                <summary className="cursor-pointer text-sm font-black text-slate-950">
                  Map location settings
                </summary>
                <a href={BARRIE_PUBLIC_PARKING_VIEWER_URL} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs font-black text-blue-700 hover:text-blue-900">
                  City public parking source
                </a>
                <p className="mt-2 text-xs font-semibold text-slate-500">
                  Built-in ParkingLatLong coordinates are applied automatically.
                </p>
                <div className="mt-3 space-y-3">
                  <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-black uppercase tracking-wide text-blue-700">Lot categories</div>
                        <p className="mt-0.5 text-[11px] font-semibold text-blue-700">Create labels and assign them to reviewed lots.</p>
                      </div>
                      <button type="button" disabled={!canEditParking} onClick={addRevenueCategory} className="rounded-xl bg-blue-600 px-3 py-1.5 text-[11px] font-black text-white hover:bg-blue-700 disabled:bg-gray-300">
                        Add
                      </button>
                    </div>
                    <div className="space-y-2">
                      {revenueCategoryOptions.map(category => (
                        <div key={category.id} className="grid grid-cols-[34px_minmax(0,1fr)_34px] items-center gap-2 rounded-xl bg-white p-2">
                          <input
                            type="color"
                            disabled={!canEditParking}
                            value={category.colorHex || '#64748B'}
                            onChange={event => updateRevenueCategory(category.id, { colorHex: event.target.value })}
                            className="h-8 w-8 rounded border-0 bg-transparent p-0"
                            aria-label={`${category.label} color`}
                          />
                          <CompactTextInput disabled={!canEditParking} value={category.label} onChange={value => updateRevenueCategory(category.id, { label: value })} placeholder="Category" />
                          <button type="button" disabled={!canEditParking} onClick={() => archiveRevenueCategory(category.id)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-100 bg-red-50 text-red-600 hover:bg-red-100 disabled:text-gray-300" title="Archive category">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                  {(settings.revenueLocations || []).map(location => {
                    const search = locationSearchById[location.id] || { query: location.displayName, searching: false, error: '', suggestions: [] };
                    const sourceSummary = revenueAnalytics.locationSummaries.find(summary => summary.key === location.id || revenueLocationRefsOverlap(summary, location));
                    const publicMatch = sourceSummary ? publicParkingMatchesByKey.get(sourceSummary.key) || null : null;
                    return (
                      <div key={location.id} className="rounded-2xl border border-amber-100 bg-white p-3">
                        <TextInput disabled={!canEditParking} value={location.displayName} onChange={value => updateRevenueLocation(location.id, { displayName: value })} />
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <TextInput disabled={!canEditParking} value={location.latitude == null ? '' : String(location.latitude)} onChange={value => updateRevenueLocation(location.id, { latitude: value ? Number(value) : null })} placeholder="Latitude" />
                          <TextInput disabled={!canEditParking} value={location.longitude == null ? '' : String(location.longitude)} onChange={value => updateRevenueLocation(location.id, { longitude: value ? Number(value) : null })} placeholder="Longitude" />
                        </div>
                        <div className="mt-2">
                          <TextInput disabled={!canEditParking} value={location.capacitySpaces == null ? '' : String(location.capacitySpaces)} onChange={value => updateRevenueLocation(location.id, { capacitySpaces: value ? Number(value) : null })} placeholder="Spaces" />
                        </div>
                        <div className="mt-2">
                          <select
                            disabled={!canEditParking}
                            value={location.categoryId || UNCATEGORIZED_PARKING_CATEGORY_ID}
                            onChange={event => updateRevenueLocation(location.id, { categoryId: event.target.value === UNCATEGORIZED_PARKING_CATEGORY_ID ? null : event.target.value })}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none disabled:bg-slate-50"
                          >
                            <option value={UNCATEGORIZED_PARKING_CATEGORY_ID}>Uncategorized</option>
                            {revenueCategoryOptions.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}
                          </select>
                        </div>
                        <div className="mt-2 flex gap-2">
                          <input value={search.query} disabled={!canEditParking} onChange={event => setLocationSearchById(current => ({ ...current, [location.id]: { ...search, query: event.target.value } }))} className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none" />
                          <button type="button" disabled={!canEditParking || search.searching} onClick={() => void searchRevenueLocation(location)} className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-white disabled:bg-gray-300">
                            {search.searching ? '...' : 'Find'}
                          </button>
                        </div>
                        {publicMatch ? (
                          <div className="mt-2 rounded-xl border border-blue-100 bg-blue-50 p-2 text-xs font-bold text-blue-800">
                            <div>Public source match: {publicMatch.location.commonName || publicMatch.location.name}{publicMatch.location.address ? ` · ${publicMatch.location.address}` : ''}</div>
                            <button type="button" disabled={!canEditParking} onClick={() => applyPublicRevenueLocationFallback(location.id, publicMatch)} className="mt-2 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-black text-white hover:bg-blue-700 disabled:bg-gray-300">
                              Use public coordinates
                            </button>
                          </div>
                        ) : null}
                        {search.error ? <div className="mt-2 text-xs font-bold text-amber-700">{search.error}</div> : null}
                        {search.suggestions.length > 0 ? (
                          <div className="mt-2 space-y-1.5">
                            {search.suggestions.map(suggestion => (
                              <button key={suggestion.id} type="button" onClick={() => applyRevenueLocationSuggestion(location.id, suggestion)} className="w-full rounded-xl border border-blue-100 bg-blue-50 p-2 text-left text-xs font-bold text-blue-800 hover:bg-blue-100">
                                {suggestion.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {(settings.revenueLocations || []).length === 0 ? (
                    <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3 text-xs font-bold text-blue-800">
                      City public parking locations are used automatically for matching pins. Add reviewed coordinates only when you want to override a public match.
                    </div>
                  ) : null}
                  <button type="button" disabled={saving || !canEditParking} onClick={() => void saveSettingsOnly()} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white hover:bg-blue-700 disabled:bg-gray-300">
                    {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Save map locations
                  </button>
                </div>
              </details>

              <details className="mt-3 rounded-3xl border border-slate-200 bg-white p-4">
                <summary className="cursor-pointer text-sm font-black text-slate-950">Department-code import and older tables</summary>
                <div className="mt-3 space-y-3">
                  <label className={`inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-black text-white ${canEditParking ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-300'}`}>
                    <Upload size={16} /> Upload department .xlsx
                    <input type="file" accept=".xlsx,.xls" multiple disabled={!canEditParking || saving} onChange={handleFileChange} className="hidden" />
                  </label>
                  {warnings.length > 0 ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">{warnings.map(warning => <div key={warning}>{warning}</div>)}</div> : null}
                  {unmapped.length > 0 ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                      <div className="font-black text-amber-950">Map discount codes before saving</div>
                      <div className="mt-2 space-y-2">
                        {unmapped.map(code => (
                          <div key={code.familyKey} className="rounded-xl bg-white p-3">
                            <div className="text-sm font-black text-slate-800">{code.familyKey}</div>
                            <div className="mb-2 text-xs font-medium text-slate-500">{code.codes.join(', ')} · {code.rowCount} rows</div>
                            <TextInput value={mappingDrafts[code.familyKey] || ''} onChange={value => setMappingDrafts(current => ({ ...current, [code.familyKey]: value }))} placeholder="Department" />
                          </div>
                        ))}
                      </div>
                      <button onClick={() => void applyUnmappedMappings()} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-sm font-black text-white hover:bg-amber-700">
                        <CheckCircle2 size={16} /> Apply mappings
                      </button>
                    </div>
                  ) : null}
                  {previewDatasets.length > 0 ? (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
                      <div className="font-black text-emerald-950">Ready to replace {summarizeImportMonths(previewDatasets)}</div>
                      <p className="mt-1 text-sm font-semibold text-emerald-800">{previewRowCount.toLocaleString()} rows · {money(previewTotalValue)} total value</p>
                      <button disabled={saving || !canEditParking} onClick={() => void importPreview()} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-50">
                        {saving ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />} Save import
                      </button>
                    </div>
                  ) : null}
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                    <div className="text-xs font-black uppercase tracking-wide text-slate-400">Review period</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {availableYears.length > 0 ? availableYears.map(year => (
                        <button key={year} onClick={() => setSelectedYear(year)} className={`rounded-full px-3 py-1.5 text-xs font-black ${selectedYear === year ? 'bg-slate-950 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}>{year}</button>
                      )) : <span className="text-xs font-semibold text-slate-400">Import a month to start.</span>}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {MONTHS.map(month => {
                        const monthKey = `${selectedYear}-${month.value}`;
                        const hasData = monthsForSelectedYear.some(entry => entry.month === monthKey);
                        return (
                          <button key={month.value} disabled={!hasData} onClick={() => setSelectedMonth(monthKey)} className={`rounded-full px-2.5 py-1 text-[11px] font-black ${selectedMonth === monthKey ? 'bg-blue-600 text-white' : hasData ? 'bg-blue-50 text-blue-700 hover:bg-blue-100' : 'bg-white text-slate-300'}`}>
                            {month.short}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                      <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Dept rows</div>
                      <div className="mt-1 text-lg font-black text-slate-950">{monthlyDepartmentRows.length.toLocaleString()}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                      <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Raw rows</div>
                      <div className="mt-1 text-lg font-black text-slate-950">{rawTransactionRows.length.toLocaleString()}</div>
                    </div>
                  </div>
                  <button disabled={!canEditParking} onClick={() => setDepartmentManagerOpen(true)} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white hover:bg-blue-700 disabled:bg-gray-300">
                    <Wand2 size={16} /> Manage departments
                  </button>
                  <button type="button" disabled={annualSummaryRows.length === 0} onClick={() => setAnnualFullscreen(true)} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-40">
                    <Maximize2 size={16} /> Annual department summary
                  </button>
                </div>
              </details>
            </div>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setLotRightRailOpen(true)}
                className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                aria-label="Expand parking trends"
                title="Expand trends"
              >
                <BarChart3 size={20} />
                <span className="[writing-mode:vertical-rl] rotate-180 text-xs font-black uppercase tracking-wide">Trends</span>
                <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">{money(revenueAnalytics.totalRevenue).replace('.00', '')}</span>
              </button>
            )}
          </aside>

          {(errorMessage || publicParkingError || previewRevenueDatasets.length > 0 || revenueImportStatus || !hasVisibleRevenuePins) ? (
            <div className="pointer-events-none absolute bottom-4 left-[350px] right-[400px] z-30 hidden xl:block">
              <div className="pointer-events-auto rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-xl backdrop-blur">
                {errorMessage ? <div className="mb-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{errorMessage}</div> : null}
                {publicParkingError ? <div className="mb-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">City public parking source could not load: {publicParkingError}</div> : null}
                {revenueImportStatus ? <div className="mb-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{revenueImportStatus}</div> : null}
                {(previewRevenueDatasets.length > 0 || !hasVisibleRevenuePins) && revenueWarnings.length > 0 ? <div className="mb-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">{revenueWarnings.map(warning => <div key={warning}>{warning}</div>)}</div> : null}
                {previewRevenueDatasets.length > 0 ? (
                  <div className="flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="font-black text-emerald-950">{saving ? 'Auto-saving revenue import' : 'Revenue import needs attention'}</div>
                      <div className="mt-1 text-sm font-semibold text-emerald-800">
                        {previewRevenueDatasets.reduce((sum, dataset) => sum + dataset.rowCount, 0).toLocaleString()} rows · {money(previewRevenueDatasets.reduce((sum, dataset) => sum + dataset.totalRevenue, 0))} revenue.
                        {saving ? ' Saving automatically...' : ' Auto-save did not finish. You can retry below.'}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {previewRevenueDatasets.map(dataset => (
                          <span key={`${dataset.source}-${dataset.month}`} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-emerald-800">
                            {getParkingRevenueSourceLabel(dataset.source)} · {dataset.month} · {dataset.rowCount.toLocaleString()} rows · {money(dataset.totalRevenue)}
                          </span>
                        ))}
                      </div>
                    </div>
                    {saving ? (
                      <span className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white">
                        <Loader2 className="animate-spin" size={16} /> Saving
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={!canEditParking}
                        onClick={() => void saveRevenuePreview()}
                        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-700 disabled:bg-gray-300"
                      >
                        <Save size={16} /> Retry auto-save
                      </button>
                    )}
                  </div>
                ) : !hasVisibleRevenuePins ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">
                    <div>The map is ready. Import revenue files; reviewed coordinates or public City matches will light up the pins.</div>
                    <label className={`mt-3 inline-flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-sm font-black text-white ${canEditParking ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-gray-300'}`}>
                      <Upload size={16} /> Import revenue .xlsx
                      <input type="file" accept=".xlsx,.xls" multiple disabled={!canEditParking || saving} onChange={handleRevenueFileChange} className="hidden" />
                    </label>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {departmentManagerModal}
          {annualFullscreenModal}
        </main>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto pb-10">
      <div className="mx-auto max-w-7xl space-y-6 px-2">
        <button onClick={() => navigateWorkspace('dashboard')} className="mt-2 inline-flex items-center gap-1.5 text-sm font-bold text-gray-400 hover:text-gray-600">
          <ArrowLeft size={14} /> Back to Parking Workspaces
        </button>

        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-emerald-700">
                <Car size={14} /> Parking
              </div>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-gray-950">
                {activeWorkspace === 'plate-monitor' ? 'Parking Plate Monitor' : 'Parking Lot Data'}
              </h2>
              <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-gray-500">
                {activeWorkspace === 'plate-monitor'
                  ? 'Review flagged plates, repeat activity, unusual timing, and plate-level pattern evidence.'
                  : 'Import revenue files, map HotSpot locations, and compare lot usage, revenue, and peak periods.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                disabled={!displaySummary}
                onClick={() => displaySummary && exportParkingWorkbook(displaySummary, `parking-usage-${latestMonth?.month || 'report'}.xlsx`)}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
              >
                <Download size={16} /> Export Excel
              </button>
              <button
                disabled={!canEditParking}
                onClick={() => setDepartmentManagerOpen(true)}
                className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 transition hover:bg-blue-100 disabled:opacity-50"
              >
                <Palette size={16} /> Manage departments
              </button>
              <button
                disabled={!canEditParking || saving}
                onClick={() => void saveSettingsOnly()}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Save settings
              </button>
            </div>
          </div>
        </section>

        {errorMessage ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{errorMessage}</div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-6">

{activeWorkspace === 'plate-monitor' ? (
            <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-extrabold text-gray-950">Import department parking data</h3>
                  <p className="mt-1 text-sm text-gray-500">Upload HotSpot shared-code workbooks. Each workbook must contain one month; multiple files can replace different months together.</p>
                </div>
                <label className={`inline-flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold text-white ${canEditParking ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-300'}`}>
                  <Upload size={16} /> Import department .xlsx
                  <input type="file" accept=".xlsx,.xls" multiple disabled={!canEditParking || saving} onChange={handleFileChange} className="hidden" />
                </label>
              </div>

              {warnings.length > 0 ? (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
                  {warnings.map(warning => <div key={warning}>{warning}</div>)}
                </div>
              ) : null}

              {unmapped.length > 0 ? (
                <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-start gap-2 text-amber-800">
                    <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                    <div>
                      <h4 className="font-extrabold">Map discount codes before saving</h4>
                      <p className="mt-1 text-sm">The file preview is blocked until every code family has a department.</p>
                    </div>
                  </div>
                  <div className="mt-4 space-y-3">
                    {unmapped.map(code => (
                      <div key={code.familyKey} className="grid gap-3 rounded-xl bg-white p-3 md:grid-cols-[160px_minmax(0,1fr)_220px] md:items-center">
                        <div className="text-sm font-extrabold text-gray-800">{code.familyKey}</div>
                        <div className="text-xs font-medium text-gray-500">{code.codes.join(', ')} · {code.rowCount} rows · {code.descriptions.join('; ') || 'No description'}</div>
                        <TextInput value={mappingDrafts[code.familyKey] || ''} onChange={value => setMappingDrafts(current => ({ ...current, [code.familyKey]: value }))} placeholder="Department" />
                      </div>
                    ))}
                  </div>
                  <button onClick={() => void applyUnmappedMappings()} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700">
                    <CheckCircle2 size={16} /> Apply mappings and preview
                  </button>
                </div>
              ) : null}

              {previewDatasets.length > 0 ? (
                <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={20} />
                      <div>
                        <h4 className="font-extrabold text-emerald-950">Ready to replace {summarizeImportMonths(previewDatasets)}</h4>
                        <p className="mt-1 text-sm font-medium text-emerald-800">
                          {previewRowCount.toLocaleString()} rows · {money(previewTotalValue)} total value · {previewFlaggedPlateCount} flagged plates
                        </p>
                        {previewDatasets.length > 1 ? (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {previewDatasets.map(dataset => (
                              <span key={dataset.month} className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-extrabold text-emerald-800">
                                {dataset.month}: {dataset.rowCount.toLocaleString()} rows
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <button disabled={saving || !canEditParking} onClick={() => void importPreview()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                      {saving ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />} Save import
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
            ) : null}

            <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h3 className="text-lg font-extrabold text-gray-950">Review period</h3>
                  <p className="mt-1 text-sm text-gray-500">Select a year for the annual summary, then a month for the detailed review tables.</p>
                </div>
                {selectedMonth ? <Badge tone="green">Viewing {selectedMonthLabel} {selectedYear}</Badge> : null}
              </div>
              <div className="mt-4">
                <div className="mb-2 text-xs font-extrabold uppercase tracking-wide text-gray-400">Year</div>
                <div className="flex flex-wrap gap-2">
                  {availableYears.length > 0 ? availableYears.map(year => (
                    <button
                      key={year}
                      onClick={() => setSelectedYear(year)}
                      className={`rounded-full px-4 py-2 text-sm font-extrabold transition ${selectedYear === year ? 'bg-gray-950 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >
                      {year}
                    </button>
                  )) : <span className="text-sm font-semibold text-gray-400">Import a month to start.</span>}
                </div>
              </div>
              <div className="mt-4">
                <div className="mb-2 text-xs font-extrabold uppercase tracking-wide text-gray-400">Month</div>
                <div className="flex flex-wrap gap-2">
                  {MONTHS.map(month => {
                    const monthKey = `${selectedYear}-${month.value}`;
                    const hasData = monthsForSelectedYear.some(entry => entry.month === monthKey);
                    return (
                      <button
                        key={month.value}
                        disabled={!hasData}
                        onClick={() => setSelectedMonth(monthKey)}
                        className={`rounded-full px-3 py-1.5 text-xs font-extrabold transition ${
                          selectedMonth === monthKey
                            ? 'bg-blue-600 text-white'
                            : hasData
                              ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                              : 'bg-gray-50 text-gray-300'
                        }`}
                      >
                        {month.short}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="grid gap-4 md:grid-cols-4">
              <Metric label="Selected month" value={selectedMonthLabel || '—'} />
              <Metric label="Rows" value={(selectedMonthDataset?.rowCount ?? 0).toLocaleString()} />
              <Metric label="Total value" value={money(selectedMonthTotalValue)} />
              <Metric label="Flagged plates" value={monthlyFlaggedPlates.length.toLocaleString()} tone={monthlyFlaggedPlates.length ? 'amber' : 'green'} />
            </section>

{activeWorkspace === 'plate-monitor' ? (
            <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-extrabold text-gray-950">Flagged plate indicators</h3>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs font-extrabold uppercase tracking-wide text-gray-400">
                    <tr><th className="py-2 pr-4">Month</th><th className="py-2 pr-4">Plate</th><th className="py-2 pr-4">Department</th><th className="py-2 pr-4">Value</th><th className="py-2 pr-4">Days</th><th className="py-2 pr-4">Top location</th><th className="py-2 pr-4">Indicators</th><th className="py-2 pr-4">Why</th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {monthlyFlaggedPlates.slice(0, 120).map(pattern => {
                      const patternKey = getPlatePatternKey(pattern);
                      const isExpanded = expandedPlateKey === patternKey;
                      const plateRows = rawTransactionRows.filter(row => (
                        row.startMonth === pattern.month &&
                        (row.plate || '(missing)') === (pattern.plate || pattern.displayPlate)
                      ));
                      const evidence = buildFlagEvidence(pattern, settings, plateRows);
                      return (
                        <React.Fragment key={patternKey}>
                          <tr className={isExpanded ? 'bg-amber-50/40' : undefined}>
                            <td className="py-3 pr-4 font-bold text-gray-700">{pattern.month}</td>
                            <td className="py-3 pr-4 font-extrabold text-gray-950">{pattern.displayPlate}</td>
                            <td className="py-3 pr-4"><DepartmentChip department={pattern.department} codeFamilies={settings.codeFamilies} compact /></td>
                            <td className="py-3 pr-4 font-bold text-gray-900">{money(pattern.totalValue)}</td>
                            <td className="py-3 pr-4 text-gray-600">{pattern.activeDays}</td>
                            <td className="py-3 pr-4 text-gray-600">{pattern.topLocationName || pattern.topSpotId}</td>
                            <td className="py-3 pr-4"><div className="flex flex-wrap gap-1">{pattern.flags.map(flag => <Badge key={flag} tone="amber">{FLAG_LABELS[flag] || flag}</Badge>)}</div></td>
                            <td className="py-3 pr-4">
                              <button
                                type="button"
                                onClick={() => setExpandedPlateKey(current => current === patternKey ? '' : patternKey)}
                                className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-extrabold text-amber-700 hover:bg-amber-100"
                              >
                                {isExpanded ? 'Hide why' : 'View why'}
                              </button>
                            </td>
                          </tr>
                          {isExpanded ? (
                            <tr>
                              <td colSpan={8} className="bg-amber-50/30 px-4 py-4">
                                <div className="grid gap-3 md:grid-cols-2">
                                  {evidence.map(item => (
                                    <div key={item.label} className="rounded-2xl border border-amber-100 bg-white p-4 shadow-sm">
                                      <div className="text-sm font-extrabold text-gray-950">{item.label}</div>
                                      <p className="mt-1 text-sm font-medium text-gray-600">{item.detail}</p>
                                      {item.evidence.length > 0 ? (
                                        <div className="mt-3 flex flex-wrap gap-1.5">
                                          {item.evidence.map(detail => (
                                            <span key={detail} className="rounded-full bg-gray-100 px-2 py-1 text-[11px] font-bold text-gray-600">{detail}</span>
                                          ))}
                                        </div>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                                <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-4">
                                  <div className="text-xs font-extrabold uppercase tracking-wide text-gray-400">Transactions reviewed</div>
                                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                                    {plateRows.slice(0, 6).map(row => (
                                      <div key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-gray-600">
                                        <span className="font-extrabold text-gray-900">{row.startDate}</span>
                                        <span>{minutesToTime(row.startMinutes)}–{minutesToTime(row.endMinutes)}</span>
                                        <span>{minutesToDuration(row.durationMinutes)}</span>
                                        <span>{money(row.discountAmount)}</span>
                                        <span>{row.locationName || row.spotId}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </React.Fragment>
                      );
                    })}
                    {monthlyFlaggedPlates.length === 0 ? <tr><td colSpan={8} className="py-8 text-center text-gray-400">No flagged plate indicators for the selected month and thresholds.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </section>
            ) : null}

</div>

          <aside className="space-y-6">
            {activeWorkspace === 'plate-monitor' ? (
            <>
            <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-extrabold text-gray-950">Department color legend</h3>
                  <p className="mt-1 text-xs font-semibold text-gray-400">Click a column header to sort. Ignore flags suppresses plate indicators for that department.</p>
                </div>
              </div>
              <div className="mt-4 max-h-80 overflow-y-auto rounded-2xl border border-gray-100">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-gray-50 text-[10px] font-extrabold uppercase tracking-wide text-gray-400">
                    <tr>
                      <th className="px-3 py-2">{renderDepartmentLegendHeader('color', 'Color')}</th>
                      <th className="px-3 py-2">{renderDepartmentLegendHeader('code', 'Code')}</th>
                      <th className="px-3 py-2">{renderDepartmentLegendHeader('department', 'Department')}</th>
                      <th className="px-3 py-2 text-center">{renderDepartmentLegendHeader('ignoreFlags', 'Ignore flags', 'mx-auto')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {departmentLegendRows.map(color => (
                      <tr key={`${color.familyKey}-${color.mappingIndex}`} className="bg-white">
                        <td className="px-3 py-2"><span className="block h-4 w-4 rounded" style={{ backgroundColor: color.hex }} /></td>
                        <td className="px-3 py-2 font-extrabold text-gray-700">{color.code}</td>
                        <td className="min-w-0 px-3 py-2 font-semibold text-gray-500">{color.department}</td>
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={color.ignoreFlags}
                            disabled={!canEditParking}
                            onChange={event => updateCodeFamilyDirectoryAndSave(color.mappingIndex, { ignoreFlags: event.target.checked })}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 disabled:opacity-40"
                            aria-label={`Ignore plate flags for ${color.department}`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2"><SlidersHorizontal size={18} className="text-emerald-600" /><h3 className="font-extrabold text-gray-950">Indicator thresholds</h3></div>
              <div className="space-y-3 text-sm">
                <SettingNumber label="High plate value" value={settings.flagRules.plateMonthlyValueDollars} suffix="$" disabled={!canEditParking} onChange={value => setSettings(current => ({ ...current, flagRules: { ...current.flagRules, plateMonthlyValueDollars: value } }))} />
                <SettingNumber label="High frequency use" value={settings.flagRules.plateActiveDaysPerMonth} disabled={!canEditParking} onChange={value => setSettings(current => ({ ...current, flagRules: { ...current.flagRules, plateActiveDaysPerMonth: value } }))} />
                <SettingNumber label="Long duration hours" value={settings.flagRules.longSessionHours} disabled={!canEditParking} onChange={value => setSettings(current => ({ ...current, flagRules: { ...current.flagRules, longSessionHours: value } }))} />
                <SettingNumber label="Long duration count" value={settings.flagRules.longSessionCount} disabled={!canEditParking} onChange={value => setSettings(current => ({ ...current, flagRules: { ...current.flagRules, longSessionCount: value } }))} />
                <SettingNumber label="Consistent location days" value={settings.flagRules.sameLocationDays} disabled={!canEditParking} onChange={value => setSettings(current => ({ ...current, flagRules: { ...current.flagRules, sameLocationDays: value } }))} />
                <SettingNumber label="High department usage" value={settings.flagRules.departmentMonthlyValueDollars} suffix="$" disabled={!canEditParking} onChange={value => setSettings(current => ({ ...current, flagRules: { ...current.flagRules, departmentMonthlyValueDollars: value } }))} />
                <SettingNumber label="Department increase" value={settings.flagRules.departmentIncreasePercent} suffix="%" disabled={!canEditParking} onChange={value => setSettings(current => ({ ...current, flagRules: { ...current.flagRules, departmentIncreasePercent: value } }))} />
              </div>
            </section>
            </>
            ) : null}

</aside>
        </div>

        {departmentManagerModal}

        {annualFullscreenModal}
      </div>
    </div>
  );
};

const Metric: React.FC<{ label: string; value: React.ReactNode; tone?: 'green' | 'amber' }> = ({ label, value, tone = 'green' }) => (
  <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
    <div className="text-xs font-extrabold uppercase tracking-wide text-gray-400">{label}</div>
    <div className={`mt-2 text-2xl font-extrabold ${tone === 'amber' ? 'text-amber-600' : 'text-gray-950'}`}>{value}</div>
  </div>
);

const Badge: React.FC<{ children: React.ReactNode; tone: 'amber' | 'green' }> = ({ children, tone }) => (
  <span className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold ${tone === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{children}</span>
);

const SettingNumber: React.FC<{ label: string; value: number; onChange: (value: number) => void; suffix?: string; disabled?: boolean }> = ({ label, value, onChange, suffix, disabled }) => (
  <div className="grid grid-cols-[1fr_120px] items-center gap-3">
    <span className="font-bold text-gray-600">{label}</span>
    <NumberInput value={value} onChange={onChange} suffix={suffix} disabled={disabled} />
  </div>
);
