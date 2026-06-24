import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Car,
  CheckCircle2,
  Download,
  Loader2,
  Maximize2,
  Minimize2,
  Palette,
  Plus,
  Save,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTeam } from '../contexts/TeamContext';
import { useToast } from '../contexts/ToastContext';
import { exportParkingWorkbook } from '../../utils/parking/parkingExport';
import { parseParkingFile } from '../../utils/parking/parkingParser';
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
  getParkingData,
  getParkingSettings,
  rebuildParkingSummaryWithRules,
  saveParkingMonthData,
  saveParkingSettings,
} from '../../utils/parking/parkingService';
import {
  DEFAULT_PARKING_SETTINGS,
  type ParkingCodeFamilyMapping,
  type ParkingMonthlyDataset,
  type ParkingPlatePattern,
  type ParkingRawRow,
  type ParkingSettings,
  type ParkingSummary,
  type ParkingUnmappedCodeFamily,
  type ParkingYearCodeFormat,
} from '../../utils/parking/parkingTypes';
import { canAccessWorkspaceFeature } from '../../utils/workspaceAccess';

const money = (value: number | null | undefined) => `$${(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (value: number | null | undefined) => (typeof value === 'number' ? `${value.toFixed(1)}%` : 'New');

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
    .filter(mapping => !mapping.archived)
    .map(mapping => {
      const color = getCodeFamilyColor(mapping.familyKey, mapping.department, settings.codeFamilies);
      const previewYear = getParkingActiveYears(mapping)[0] || new Date().getFullYear();
      return {
        familyKey: mapping.familyKey,
        code: getParkingCodesForYear(mapping, previewYear)[0] || mapping.familyKey,
        department: mapping.department || 'Unnamed department',
        hex: color.hex,
      };
    });
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

function hourToTime(hour: number): string {
  return `${String(Math.floor(hour)).padStart(2, '0')}:00`;
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<ParkingSettings>(DEFAULT_PARKING_SETTINGS);
  const [summary, setSummary] = useState<ParkingSummary | null>(null);
  const [previewDataset, setPreviewDataset] = useState<ParkingMonthlyDataset | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [unmapped, setUnmapped] = useState<ParkingUnmappedCodeFamily[]>([]);
  const [mappingDrafts, setMappingDrafts] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [annualExpanded, setAnnualExpanded] = useState(false);
  const [annualFullscreen, setAnnualFullscreen] = useState(false);
  const [expandedPlateKey, setExpandedPlateKey] = useState('');
  const [departmentManagerOpen, setDepartmentManagerOpen] = useState(false);
  const [departmentSearch, setDepartmentSearch] = useState('');
  const [departmentCodeYear, setDepartmentCodeYear] = useState(new Date().getFullYear());

  const displaySummary = useMemo(() => buildDisplaySummary(summary, settings), [settings, summary]);
  const reviewMonths = useMemo(() => {
    const savedMonths = displaySummary?.months ?? [];
    const months = previewDataset
      ? [...savedMonths.filter(month => month.month !== previewDataset.month), previewDataset]
      : savedMonths;
    return [...months].sort((a, b) => a.month.localeCompare(b.month));
  }, [displaySummary, previewDataset]);
  const latestMonth = reviewMonths.at(-1) ?? null;
  const availableYears = useMemo(() => [...new Set(reviewMonths.map(month => month.month.slice(0, 4)))].sort(), [reviewMonths]);
  const monthsForSelectedYear = useMemo(
    () => reviewMonths.filter(month => month.month.startsWith(`${selectedYear}-`)),
    [reviewMonths, selectedYear],
  );
  const selectedMonthDataset = monthsForSelectedYear.find(month => month.month === selectedMonth) ?? null;
  const canEditParking = canManageTeam || canAccessWorkspaceFeature('workspaceParking', teamMember);
  const annualSummaryRows = useMemo(() => buildAnnualSummaryRows(reviewMonths, selectedYear), [reviewMonths, selectedYear]);
  const annualTotalValue = annualSummaryRows.reduce((sum, row) => sum + row.total, 0);
  const annualTopDepartment = annualSummaryRows[0]?.department ?? '—';
  const selectedMonthLabel = MONTHS.find(month => month.value === selectedMonth.slice(5, 7))?.label ?? selectedMonth;
  const monthlyFlaggedPlates = useMemo(() => {
    if (!selectedMonth) return [];
    if (previewDataset?.month === selectedMonth) return previewDataset.platePatterns.filter(pattern => pattern.flags.length > 0);
    return displaySummary?.platePatterns.filter(pattern => pattern.month === selectedMonth && pattern.flags.length > 0) ?? [];
  }, [displaySummary, previewDataset, selectedMonth]);
  const monthlyDepartmentRows = useMemo(() => {
    if (!selectedMonth) return [];
    if (previewDataset?.month === selectedMonth) return previewDataset.departmentSummaries;
    return displaySummary?.departmentSummaries.filter(row => row.month === selectedMonth) ?? [];
  }, [displaySummary, previewDataset, selectedMonth]);
  const highDepartments = monthlyDepartmentRows.filter(row => row.isHighUsage);
  const rawTransactionRows = useMemo<ParkingRawRow[]>(() => {
    const rows = selectedMonthDataset?.rows ?? [];
    return [...rows].sort((a, b) => (
      b.startDate.localeCompare(a.startDate) ||
      b.startMinutes - a.startMinutes ||
      a.plate.localeCompare(b.plate)
    ));
  }, [selectedMonthDataset]);
  const selectedMonthTotalValue = selectedMonthDataset?.totalValue ?? 0;
  const departmentLegendRows = useMemo(() => getDepartmentRowsForLegend(settings), [settings]);
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
      const [loadedSettings, loadedData] = await Promise.all([
        getParkingSettings(team.id),
        getParkingData(team.id),
      ]);
      setSettings(loadedSettings);
      setSummary(loadedData);
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

  const parseFile = useCallback(async (file: File, nextSettings = settings) => {
    if (!user) return;
    setErrorMessage('');
    setWarnings([]);
    setUnmapped([]);
    setPreviewDataset(null);
    setPendingFile(file);
    try {
      const result = await parseParkingFile(file, user.uid, nextSettings);
      setWarnings(result.warnings);
      setUnmapped(result.unmappedCodeFamilies);
      setPreviewDataset(result.unmappedCodeFamilies.length === 0 ? result.dataset : null);
      setMappingDrafts(Object.fromEntries(result.unmappedCodeFamilies.map(code => [code.familyKey, code.descriptions[0] || ''])));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not parse HotSpot file.');
    }
  }, [settings, user]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void parseFile(file);
    event.target.value = '';
  };

  const applyUnmappedMappings = async () => {
    if (!pendingFile) return;
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
    await parseFile(pendingFile, nextSettings);
  };

  const importPreview = async () => {
    if (!team || !user || !previewDataset) return;
    setSaving(true);
    try {
      const savedSettings = await saveParkingSettings(team.id, user.uid, settings);
      const savedSummary = await saveParkingMonthData(team.id, user.uid, previewDataset, savedSettings);
      setSettings(savedSettings);
      setSummary(savedSummary);
      setPreviewDataset(null);
      setPendingFile(null);
      setWarnings([]);
      toast.success('Parking import saved', `${previewDataset.month} replaced with ${previewDataset.rowCount.toLocaleString()} rows.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not save Parking import.');
    } finally {
      setSaving(false);
    }
  };

  const saveSettingsOnly = async () => {
    if (!team || !user) return;
    setSaving(true);
    try {
      const saved = await saveParkingSettings(team.id, user.uid, settings);
      setSettings(saved);
      toast.success('Parking settings saved');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not save Parking settings.');
    } finally {
      setSaving(false);
    }
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

  const updateCodeFamilyDirectory = (index: number, patch: Partial<ParkingCodeFamilyMapping>) => setSettings(current => ({
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
  }));

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

  const addSpotLocation = () => setSettings(current => ({
    ...current,
    spotLocations: [...current.spotLocations, { spotId: '', locationName: '' }],
  }));

  if (!team || !user) {
    return <div className="p-8 text-sm text-gray-500">Sign in and join a team to use Parking.</div>;
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-gray-500"><Loader2 className="mr-2 animate-spin" /> Loading Parking...</div>;
  }

  return (
    <div className="h-full overflow-y-auto pb-10">
      <div className="mx-auto max-w-7xl space-y-6 px-2">
        <button onClick={() => { window.location.hash = ''; }} className="mt-2 inline-flex items-center gap-1.5 text-sm font-bold text-gray-400 hover:text-gray-600">
          <ArrowLeft size={14} /> Back to Main
        </button>

        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-emerald-700">
                <Car size={14} /> Parking
              </div>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-gray-950">Shared department parking code usage</h2>
              <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-gray-500">
                Import monthly HotSpot workbooks, aggregate usage by department, compare month-over-month changes, and flag plate-level usage patterns for review.
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
            <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-extrabold text-gray-950">Import HotSpot month</h3>
                  <p className="mt-1 text-sm text-gray-500">One workbook must contain one month only. Saving replaces that month.</p>
                </div>
                <label className={`inline-flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold text-white ${canEditParking ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-300'}`}>
                  <Upload size={16} /> Upload .xlsx
                  <input type="file" accept=".xlsx,.xls" disabled={!canEditParking || saving} onChange={handleFileChange} className="hidden" />
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

              {previewDataset ? (
                <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={20} />
                      <div>
                        <h4 className="font-extrabold text-emerald-950">Ready to replace {previewDataset.month}</h4>
                        <p className="mt-1 text-sm font-medium text-emerald-800">
                          {previewDataset.rowCount.toLocaleString()} rows · {money(previewDataset.totalValue)} total value · {previewDataset.platePatterns.filter(p => p.flags.length > 0).length} flagged plates
                        </p>
                      </div>
                    </div>
                    <button disabled={saving || !canEditParking} onClick={() => void importPreview()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                      {saving ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />} Save import
                    </button>
                  </div>
                </div>
              ) : null}
            </section>

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

            <section className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
              <div className="flex flex-col gap-4 border-b border-gray-100 bg-gray-50/70 p-5 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-xs font-extrabold uppercase tracking-wide text-gray-400">{selectedYear || 'No year selected'}</div>
                  <h3 className="mt-1 text-lg font-extrabold text-gray-950">Annual department summary</h3>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={annualSummaryRows.length === 0}
                    onClick={() => setAnnualExpanded(current => !current)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-extrabold text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-40"
                  >
                    {annualExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                    {annualExpanded ? 'Hide table' : 'Show table'}
                  </button>
                  <button
                    type="button"
                    disabled={annualSummaryRows.length === 0}
                    onClick={() => setAnnualFullscreen(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-gray-950 px-3 py-2 text-xs font-extrabold text-white shadow-sm hover:bg-gray-800 disabled:opacity-40"
                  >
                    <Maximize2 size={13} /> Full screen
                  </button>
                </div>
              </div>

              {!annualExpanded ? (
                <div className="grid gap-3 p-5 sm:grid-cols-3">
                  <div className="rounded-2xl border border-gray-100 bg-white p-4">
                    <div className="text-xs font-extrabold uppercase tracking-wide text-gray-400">Departments</div>
                    <div className="mt-2 text-2xl font-extrabold text-gray-950">{annualSummaryRows.length.toLocaleString()}</div>
                  </div>
                  <div className="rounded-2xl border border-gray-100 bg-white p-4">
                    <div className="text-xs font-extrabold uppercase tracking-wide text-gray-400">Annual total</div>
                    <div className="mt-2 text-2xl font-extrabold text-gray-950">{money(annualTotalValue)}</div>
                  </div>
                  <div className="rounded-2xl border border-gray-100 bg-white p-4">
                    <div className="text-xs font-extrabold uppercase tracking-wide text-gray-400">Top department</div>
                    <div className="mt-2 truncate text-lg font-extrabold text-gray-950">{annualTopDepartment}</div>
                  </div>
                </div>
              ) : (
                <div className="max-h-[520px] overflow-auto">
                  <AnnualSummaryTable rows={annualSummaryRows} codeFamilies={settings.codeFamilies} stickyHeader />
                </div>
              )}
            </section>

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

            <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-extrabold text-gray-950">Department month-over-month</h3>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs font-extrabold uppercase tracking-wide text-gray-400">
                    <tr><th className="py-2 pr-4">Month</th><th className="py-2 pr-4">Department</th><th className="py-2 pr-4">Total</th><th className="py-2 pr-4">Change</th><th className="py-2 pr-4">Sessions</th><th className="py-2 pr-4">Flag</th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {monthlyDepartmentRows.slice(0, 80).map(row => (
                      <tr key={`${row.month}-${row.department}-${row.codeFamilyKey}`}>
                        <td className="py-3 pr-4 font-bold text-gray-700">{row.month}</td>
                        <td className="py-3 pr-4"><DepartmentChip department={row.department} codeFamilyKey={row.codeFamilyKey} codeFamilies={settings.codeFamilies} /></td>
                        <td className="py-3 pr-4 font-bold text-gray-900">{money(row.totalValue)}</td>
                        <td className="py-3 pr-4 text-gray-600">{money(row.changeValue ?? 0)} · {pct(row.changePercent)}</td>
                        <td className="py-3 pr-4 text-gray-600">{row.sessionCount}</td>
                        <td className="py-3 pr-4">{row.isHighUsage ? <Badge tone="amber">High department usage</Badge> : <span className="text-gray-300">—</span>}</td>
                      </tr>
                    ))}
                    {monthlyDepartmentRows.length === 0 ? <tr><td colSpan={6} className="py-8 text-center text-gray-400">No department summary for the selected month.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                <div>
                  <h3 className="text-lg font-extrabold text-gray-950">Raw transactions</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    {previewDataset ? 'Preview rows from the uploaded workbook before saving.' : 'Normalized HotSpot transaction rows from saved imports.'}
                  </p>
                </div>
                <span className="text-xs font-extrabold uppercase tracking-wide text-gray-400">{rawTransactionRows.length.toLocaleString()} rows</span>
              </div>
              <div className="mt-4 max-h-[420px] overflow-auto rounded-2xl border border-gray-100">
                <table className="min-w-[980px] w-full text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-gray-50 text-xs font-extrabold uppercase tracking-wide text-gray-400">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Start</th>
                      <th className="px-3 py-2">Plate</th>
                      <th className="px-3 py-2">Department</th>
                      <th className="px-3 py-2">Code</th>
                      <th className="px-3 py-2">Location</th>
                      <th className="px-3 py-2">Duration</th>
                      <th className="px-3 py-2 text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rawTransactionRows.slice(0, 500).map(row => {
                      const color = getCodeFamilyColor(row.codeFamilyKey, row.department, settings.codeFamilies);
                      return (
                        <tr key={row.id} className="hover:bg-gray-50" style={{ borderLeft: `5px solid ${color.hex}` }}>
                          <td className="px-3 py-2 font-bold text-gray-700">{row.startDate}</td>
                          <td className="px-3 py-2 text-gray-600">{minutesToTime(row.startMinutes)}</td>
                          <td className="px-3 py-2 font-extrabold text-gray-950">{row.plate || '(missing)'}</td>
                          <td className="px-3 py-2"><DepartmentChip department={row.department || 'Unmapped'} codeFamilyKey={row.codeFamilyKey} codeFamilies={settings.codeFamilies} compact /></td>
                          <td className="px-3 py-2 text-gray-600">{row.discountCode}</td>
                          <td className="px-3 py-2 text-gray-600">{row.locationName || row.spotId}</td>
                          <td className="px-3 py-2 text-gray-600">{minutesToDuration(row.durationMinutes)}</td>
                          <td className="px-3 py-2 text-right font-bold text-gray-900">{money(row.discountAmount)}</td>
                        </tr>
                      );
                    })}
                    {rawTransactionRows.length === 0 ? <tr><td colSpan={8} className="py-8 text-center text-gray-400">No raw transactions loaded yet.</td></tr> : null}
                  </tbody>
                </table>
              </div>
              {rawTransactionRows.length > 500 ? (
                <p className="mt-2 text-xs font-semibold text-gray-400">Showing the newest 500 rows. Export Excel includes all rows.</p>
              ) : null}
            </section>
          </div>

          <aside className="space-y-6">
            <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
              <h3 className="font-extrabold text-gray-950">Department color legend</h3>
              <p className="mt-1 text-xs font-semibold text-gray-400">Matches the department colors used in the Excel assessment.</p>
              <div className="mt-4 max-h-72 space-y-2 overflow-y-auto pr-1">
                {departmentLegendRows.map(color => (
                  <div key={color.familyKey} className="flex items-center gap-2 text-xs">
                    <span className="h-4 w-4 shrink-0 rounded" style={{ backgroundColor: color.hex }} />
                    <span className="w-14 shrink-0 font-extrabold text-gray-700">{color.code}</span>
                    <span className="min-w-0 truncate font-semibold text-gray-500">{color.department}</span>
                  </div>
                ))}
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

            <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <Settings size={18} className="mt-0.5 text-blue-600" />
                  <div>
                    <h3 className="font-extrabold text-gray-950">Department directory</h3>
                    <p className="mt-1 text-xs font-semibold text-gray-400">Names, colors, and yearly code rules live in one friendly editor.</p>
                  </div>
                </div>
                <button disabled={!canEditParking} onClick={() => setDepartmentManagerOpen(true)} className="text-xs font-extrabold text-blue-600 disabled:text-gray-300">Open</button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3">
                  <div className="text-xs font-extrabold uppercase tracking-wide text-blue-500">Departments</div>
                  <div className="mt-1 text-2xl font-extrabold text-blue-950">{settings.codeFamilies.length}</div>
                </div>
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3">
                  <div className="text-xs font-extrabold uppercase tracking-wide text-emerald-500">Code year</div>
                  <div className="mt-1 text-2xl font-extrabold text-emerald-950">{departmentCodeYear}</div>
                </div>
              </div>
              <button
                type="button"
                disabled={!canEditParking}
                onClick={() => setDepartmentManagerOpen(true)}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-extrabold text-white transition hover:bg-blue-700 disabled:bg-gray-300"
              >
                <Wand2 size={16} /> Manage names, colors, and codes
              </button>
            </section>

            <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-2"><h3 className="font-extrabold text-gray-950">Spot locations</h3><button disabled={!canEditParking} onClick={addSpotLocation} className="text-xs font-extrabold text-blue-600 disabled:text-gray-300">Add</button></div>
              <div className="space-y-3">
                {settings.spotLocations.map((location, index) => (
                  <div key={`${location.spotId}-${index}`} className="grid grid-cols-2 gap-2 rounded-xl border border-gray-100 bg-gray-50 p-3">
                    <TextInput disabled={!canEditParking} value={location.spotId} onChange={value => setSettings(current => ({ ...current, spotLocations: current.spotLocations.map((entry, i) => i === index ? { ...entry, spotId: value } : entry) }))} placeholder="Spot ID" />
                    <TextInput disabled={!canEditParking} value={location.locationName} onChange={value => setSettings(current => ({ ...current, spotLocations: current.spotLocations.map((entry, i) => i === index ? { ...entry, locationName: value } : entry) }))} placeholder="Location" />
                  </div>
                ))}
                {settings.spotLocations.length === 0 ? <p className="text-sm text-gray-400">Optional. Raw spot IDs are used until mapped.</p> : null}
              </div>
            </section>

            {highDepartments.length > 0 ? (
              <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
                <h3 className="font-extrabold text-amber-950">Department alerts</h3>
                <div className="mt-3 space-y-2">{highDepartments.slice(0, 6).map(row => <div key={`${row.month}-${row.department}`} className="text-sm font-semibold text-amber-800">{row.month}: {row.department} · {money(row.totalValue)}</div>)}</div>
              </section>
            ) : null}
          </aside>
        </div>

        {departmentManagerOpen ? (
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
                        <div className="grid gap-4 xl:grid-cols-[minmax(260px,1fr)_150px_210px_180px_90px] xl:items-end">
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
        ) : null}

        {annualFullscreen ? (
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
        ) : null}
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
