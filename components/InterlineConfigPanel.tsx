import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Zap, Clock, Calendar, MapPin, ArrowRight, ToggleLeft, ToggleRight } from 'lucide-react';
import {
    InterlineRule,
    InterlineConfig,
    DayType,
    Direction,
    MasterRouteTable,
    detectInterlineRules
} from '../utils/masterScheduleParser';

interface InterlineConfigPanelProps {
    isOpen: boolean;
    onClose: () => void;
    config: InterlineConfig;
    onConfigChange: (config: InterlineConfig) => void;
    tables: MasterRouteTable[];
    onApplyRules: () => void;
}

const DAYS: DayType[] = ['Weekday', 'Saturday', 'Sunday'];
const DIRECTIONS: Direction[] = ['North', 'South'];

// Helper to format minutes to time string
const formatTime = (minutes: number): string => {
    // Normalize to 0-23 range (handles midnight = 1440 = 24:00 → 0:00)
    const h = Math.floor(minutes / 60) % 24;
    const m = minutes % 60;
    const period = (h >= 12 && h < 24) ? 'PM' : 'AM';
    const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${displayH}:${m.toString().padStart(2, '0')} ${period}`;
};

// Helper to parse time string to minutes
const parseTime = (timeStr: string): number => {
    const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!match) return 0;
    let h = parseInt(match[1]);
    const m = parseInt(match[2]);
    const period = match[3]?.toUpperCase();
    if (period === 'PM' && h !== 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;
    return h * 60 + m;
};

// Extract unique route names from tables
const extractRoutes = (tables: MasterRouteTable[]): string[] => {
    const routes = new Set<string>();
    tables.forEach(t => {
        const match = t.routeName.match(/^([\dA-Za-z]+)/);
        if (match) routes.add(match[1]);
    });
    return Array.from(routes).sort();
};

// Extract unique stop names from tables
const extractStops = (tables: MasterRouteTable[]): string[] => {
    const stops = new Set<string>();
    tables.forEach(t => t.stops.forEach(s => stops.add(s)));
    return Array.from(stops).sort();
};

export const InterlineConfigPanel: React.FC<InterlineConfigPanelProps> = ({
    isOpen,
    onClose,
    config,
    onConfigChange,
    tables,
    onApplyRules
}) => {
    const [editingRule, setEditingRule] = useState<InterlineRule | null>(null);
    const [showAddForm, setShowAddForm] = useState(false);

    const routes = extractRoutes(tables);
    const stops = extractStops(tables);

    // Get the preferred stop for interline
    const getInterlineStop = () =>
        stops.find(s => s.toLowerCase().includes('barrie allandale transit terminal'))
        || stops.find(s => s.toLowerCase().includes('allandale'))
        || stops[0] || '';

    // Create default rules for 8A/8B interline if config is empty
    const createDefaultRules = (): InterlineRule[] => {
        const atStop = getInterlineStop();
        const has8A = routes.includes('8A');
        const has8B = routes.includes('8B');

        if (!has8A || !has8B || !atStop) return [];

        return [
            // Weekday/Saturday rules (8 PM to 1:35 AM)
            {
                id: 'rule-8a-8b-weekday',
                fromRoute: '8A',
                fromDirection: 'North',
                toRoute: '8B',
                toDirection: 'North',
                atStop,
                timeRange: { start: 1200, end: 1535 }, // 8:00 PM to 1:35 AM (1440 + 95 = 1535)
                days: ['Weekday', 'Saturday'],
                enabled: true
            },
            {
                id: 'rule-8b-8a-weekday',
                fromRoute: '8B',
                fromDirection: 'North',
                toRoute: '8A',
                toDirection: 'North',
                atStop,
                timeRange: { start: 1200, end: 1535 }, // 8:00 PM to 1:35 AM
                days: ['Weekday', 'Saturday'],
                enabled: true
            },
            // Sunday rules (All Day)
            {
                id: 'rule-8a-8b-sunday',
                fromRoute: '8A',
                fromDirection: 'North',
                toRoute: '8B',
                toDirection: 'North',
                atStop,
                timeRange: { start: 0, end: 1535 }, // All day (midnight to 1:35 AM next day)
                days: ['Sunday'],
                enabled: true
            },
            {
                id: 'rule-8b-8a-sunday',
                fromRoute: '8B',
                fromDirection: 'North',
                toRoute: '8A',
                toDirection: 'North',
                atStop,
                timeRange: { start: 0, end: 1535 }, // All day (to 1:35 AM)
                days: ['Sunday'],
                enabled: true
            }
        ];
    };

    // Auto-initialize with default rules if config is empty
    React.useEffect(() => {
        if (config.rules.length === 0 && routes.includes('8A') && routes.includes('8B')) {
            const defaultRules = createDefaultRules();
            if (defaultRules.length > 0) {
                onConfigChange({
                    ...config,
                    rules: defaultRules,
                    lastUpdated: new Date().toISOString()
                });
            }
        }
    }, [routes]); // Only run when routes are loaded

    // New rule template - defaults to 8A→8B interline at Barrie Allandale Transit Terminal
    const createNewRule = (): InterlineRule => {
        // Find preferred routes/stops or fall back to first available
        const fromRoute = routes.includes('8A') ? '8A' : routes[0] || '';
        const toRoute = routes.includes('8B') ? '8B' : routes[1] || routes[0] || '';
        const atStop = getInterlineStop();

        return {
            id: `rule-${Date.now()}`,
            fromRoute,
            fromDirection: 'North',
            toRoute,
            toDirection: 'North',
            atStop,
            timeRange: { start: 1200, end: 1535 }, // 8:00 PM to 1:35 AM
            days: ['Weekday', 'Saturday'],
            enabled: true
        };
    };

    const handleAddRule = (rule: InterlineRule) => {
        const newConfig: InterlineConfig = {
            ...config,
            rules: [...config.rules, rule],
            lastUpdated: new Date().toISOString()
        };
        onConfigChange(newConfig);
        setShowAddForm(false);
    };

    const handleUpdateRule = (updatedRule: InterlineRule) => {
        const newConfig: InterlineConfig = {
            ...config,
            rules: config.rules.map(r => r.id === updatedRule.id ? updatedRule : r),
            lastUpdated: new Date().toISOString()
        };
        onConfigChange(newConfig);
        setEditingRule(null);
    };

    const handleDeleteRule = (ruleId: string) => {
        const newConfig: InterlineConfig = {
            ...config,
            rules: config.rules.filter(r => r.id !== ruleId),
            lastUpdated: new Date().toISOString()
        };
        onConfigChange(newConfig);
    };

    const handleToggleRule = (ruleId: string) => {
        const newConfig: InterlineConfig = {
            ...config,
            rules: config.rules.map(r =>
                r.id === ruleId ? { ...r, enabled: !r.enabled } : r
            ),
            lastUpdated: new Date().toISOString()
        };
        onConfigChange(newConfig);
    };

    const handleAutoDetect = () => {
        const detected = detectInterlineRules(tables);
        if (detected.length === 0) {
            alert('No interline patterns detected. Try loading more routes or check that routes share stops.');
            return;
        }

        // Merge with existing rules (avoid duplicates)
        const existingKeys = new Set(
            config.rules.map(r => `${r.fromRoute}-${r.fromDirection}-${r.toRoute}-${r.toDirection}-${r.atStop}`)
        );

        const newRules = detected.filter(r => {
            const key = `${r.fromRoute}-${r.fromDirection}-${r.toRoute}-${r.toDirection}-${r.atStop}`;
            return !existingKeys.has(key);
        });

        if (newRules.length === 0) {
            alert('All detected interlines already exist in your configuration.');
            return;
        }

        const newConfig: InterlineConfig = {
            ...config,
            rules: [...config.rules, ...newRules],
            lastUpdated: new Date().toISOString()
        };
        onConfigChange(newConfig);
        alert(`Detected ${newRules.length} new interline pattern(s). Review and enable them below.`);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-200">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 rounded-lg">
                            <ArrowRight className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-gray-900">Interline Configuration</h2>
                            <p className="text-sm text-gray-500">Define route connections at terminals</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5 text-gray-500" />
                    </button>
                </div>

                {/* Toolbar */}
                <div className="flex items-center gap-2 p-4 border-b border-gray-100 bg-gray-50">
                    <button
                        onClick={() => setShowAddForm(true)}
                        className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                    >
                        <Plus className="w-4 h-4" />
                        Add Rule
                    </button>
                    <button
                        onClick={handleAutoDetect}
                        className="flex items-center gap-2 px-3 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition-colors text-sm font-medium"
                    >
                        <Zap className="w-4 h-4" />
                        Auto-Detect
                    </button>
                    <div className="flex-1" />
                    <button
                        onClick={onApplyRules}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm font-medium"
                    >
                        Apply Rules
                    </button>
                </div>

                {/* Rules List */}
                <div className="flex-1 overflow-auto p-4">
                    {config.rules.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <ArrowRight className="w-12 h-12 mx-auto mb-4 opacity-30" />
                            <p className="font-medium">No interline rules configured</p>
                            <p className="text-sm mt-1">Add a rule manually or use Auto-Detect</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {config.rules.map(rule => (
                                <RuleCard
                                    key={rule.id}
                                    rule={rule}
                                    onEdit={() => setEditingRule(rule)}
                                    onDelete={() => handleDeleteRule(rule.id)}
                                    onToggle={() => handleToggleRule(rule.id)}
                                />
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-gray-200 bg-gray-50 text-xs text-gray-500">
                    {config.rules.length} rule(s) configured
                    {config.lastUpdated && ` • Last updated: ${new Date(config.lastUpdated).toLocaleString()}`}
                </div>
            </div>

            {/* Add/Edit Modal */}
            {(showAddForm || editingRule) && (
                <RuleEditor
                    rule={editingRule || createNewRule()}
                    isNew={!editingRule}
                    routes={routes}
                    stops={stops}
                    onSave={editingRule ? handleUpdateRule : handleAddRule}
                    onCancel={() => {
                        setShowAddForm(false);
                        setEditingRule(null);
                    }}
                />
            )}
        </div>
    );
};

// --- Sub-components ---

interface RuleCardProps {
    rule: InterlineRule;
    onEdit: () => void;
    onDelete: () => void;
    onToggle: () => void;
}

const RuleCard: React.FC<RuleCardProps> = ({ rule, onEdit, onDelete, onToggle }) => {
    return (
        <div className={`border rounded-lg p-4 transition-all ${
            rule.enabled
                ? 'border-blue-200 bg-blue-50/50'
                : 'border-gray-200 bg-gray-50 opacity-60'
        }`}>
            <div className="flex items-center gap-4">
                {/* Toggle */}
                <button
                    onClick={onToggle}
                    className="flex-shrink-0"
                    title={rule.enabled ? 'Disable rule' : 'Enable rule'}
                >
                    {rule.enabled ? (
                        <ToggleRight className="w-8 h-8 text-blue-600" />
                    ) : (
                        <ToggleLeft className="w-8 h-8 text-gray-400" />
                    )}
                </button>

                {/* Route Flow */}
                <div className="flex items-center gap-2 flex-1">
                    <div className="flex items-center gap-1 px-3 py-1.5 bg-white rounded-lg border border-gray-200">
                        <span className="font-bold text-gray-900">{rule.fromRoute}</span>
                        <span className="text-xs text-gray-500">{rule.fromDirection}</span>
                    </div>
                    <ArrowRight className="w-4 h-4 text-gray-400" />
                    <div className="flex items-center gap-1 px-3 py-1.5 bg-white rounded-lg border border-gray-200">
                        <span className="font-bold text-gray-900">{rule.toRoute}</span>
                        <span className="text-xs text-gray-500">{rule.toDirection}</span>
                    </div>
                </div>

                {/* Stop */}
                <div className="flex items-center gap-1.5 text-sm text-gray-600">
                    <MapPin className="w-4 h-4" />
                    <span className="max-w-[150px] truncate">{rule.atStop}</span>
                </div>

                {/* Time Range */}
                {rule.timeRange && (
                    <div className="flex items-center gap-1.5 text-sm text-gray-600">
                        <Clock className="w-4 h-4" />
                        <span>{formatTime(rule.timeRange.start)} - {formatTime(rule.timeRange.end)}</span>
                    </div>
                )}

                {/* Days */}
                <div className="flex items-center gap-1.5 text-sm text-gray-600">
                    <Calendar className="w-4 h-4" />
                    <span>{rule.days.length === 3 ? 'All Days' : rule.days.join(', ')}</span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                    <button
                        onClick={onEdit}
                        className="p-2 hover:bg-white rounded-lg transition-colors text-gray-500 hover:text-gray-700"
                        title="Edit rule"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                    </button>
                    <button
                        onClick={onDelete}
                        className="p-2 hover:bg-red-50 rounded-lg transition-colors text-gray-500 hover:text-red-600"
                        title="Delete rule"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
};

interface RuleEditorProps {
    rule: InterlineRule;
    isNew: boolean;
    routes: string[];
    stops: string[];
    onSave: (rule: InterlineRule) => void;
    onCancel: () => void;
}

const RuleEditor: React.FC<RuleEditorProps> = ({
    rule,
    isNew,
    routes,
    stops,
    onSave,
    onCancel
}) => {
    const [form, setForm] = useState<InterlineRule>(rule);
    const [useTimeRange, setUseTimeRange] = useState(!!rule.timeRange);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        const finalRule: InterlineRule = {
            ...form,
            timeRange: useTimeRange ? form.timeRange : undefined
        };

        onSave(finalRule);
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-[250] flex items-center justify-center p-4">
            <form
                onSubmit={handleSubmit}
                className="bg-white rounded-xl shadow-2xl w-full max-w-lg"
            >
                <div className="p-4 border-b border-gray-200">
                    <h3 className="text-lg font-bold text-gray-900">
                        {isNew ? 'Add Interline Rule' : 'Edit Interline Rule'}
                    </h3>
                </div>

                <div className="p-4 space-y-4">
                    {/* From Route */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">From Route</label>
                            <select
                                value={form.fromRoute}
                                onChange={e => setForm({ ...form, fromRoute: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                                {routes.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Direction</label>
                            <select
                                value={form.fromDirection}
                                onChange={e => setForm({ ...form, fromDirection: e.target.value as Direction })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                                {DIRECTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* To Route */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">To Route</label>
                            <select
                                value={form.toRoute}
                                onChange={e => setForm({ ...form, toRoute: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                                {routes.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Direction</label>
                            <select
                                value={form.toDirection}
                                onChange={e => setForm({ ...form, toDirection: e.target.value as Direction })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                                {DIRECTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* At Stop */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">At Stop (Transfer Point)</label>
                        <select
                            value={form.atStop}
                            onChange={e => setForm({ ...form, atStop: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                            {stops.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>

                    {/* Days */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Days</label>
                        <div className="flex gap-2">
                            {DAYS.map(day => (
                                <button
                                    key={day}
                                    type="button"
                                    onClick={() => {
                                        const newDays = form.days.includes(day)
                                            ? form.days.filter(d => d !== day)
                                            : [...form.days, day];
                                        setForm({ ...form, days: newDays.length > 0 ? newDays : [day] });
                                    }}
                                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                        form.days.includes(day)
                                            ? 'bg-blue-600 text-white'
                                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                                >
                                    {day}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Time Range Toggle */}
                    <div>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={useTimeRange}
                                onChange={e => {
                                    setUseTimeRange(e.target.checked);
                                    if (e.target.checked && !form.timeRange) {
                                        setForm({
                                            ...form,
                                            timeRange: { start: 1200, end: 1440 } // 8PM - Midnight default
                                        });
                                    }
                                }}
                                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm font-medium text-gray-700">Limit to time range</span>
                        </label>
                    </div>

                    {/* Time Range Inputs */}
                    {useTimeRange && (
                        <div className="grid grid-cols-2 gap-4 pl-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                                <input
                                    type="time"
                                    value={`${Math.floor((form.timeRange?.start || 0) / 60).toString().padStart(2, '0')}:${((form.timeRange?.start || 0) % 60).toString().padStart(2, '0')}`}
                                    onChange={e => {
                                        const [h, m] = e.target.value.split(':').map(Number);
                                        setForm({
                                            ...form,
                                            timeRange: {
                                                ...form.timeRange!,
                                                start: h * 60 + m
                                            }
                                        });
                                    }}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
                                <input
                                    type="time"
                                    value={`${Math.floor((form.timeRange?.end || 0) / 60).toString().padStart(2, '0')}:${((form.timeRange?.end || 0) % 60).toString().padStart(2, '0')}`}
                                    onChange={e => {
                                        const [h, m] = e.target.value.split(':').map(Number);
                                        setForm({
                                            ...form,
                                            timeRange: {
                                                ...form.timeRange!,
                                                end: h * 60 + m
                                            }
                                        });
                                    }}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>
                        </div>
                    )}

                    {/* Enabled */}
                    <div>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={form.enabled}
                                onChange={e => setForm({ ...form, enabled: e.target.checked })}
                                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm font-medium text-gray-700">Enable this rule</span>
                        </label>
                    </div>
                </div>

                <div className="flex justify-end gap-2 p-4 border-t border-gray-200 bg-gray-50">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                        {isNew ? 'Add Rule' : 'Save Changes'}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default InterlineConfigPanel;
