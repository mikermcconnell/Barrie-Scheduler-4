import React, { useState, useMemo, useCallback } from 'react';
import { Send, Sparkles, Loader2, AlertCircle } from 'lucide-react';
import type { DailySummary } from '../../../utils/performanceDataTypes';
import { buildQueryContext, askPerformanceQuestion, type ContextTier } from '../../../utils/ai/performanceQueryService';

interface AIQueryPanelProps {
    filteredDays: DailySummary[];
}

const SUGGESTED_QUESTIONS = [
    'Which routes had the worst OTP this week?',
    'How is ridership trending compared to last period?',
    'Which stops are causing the most delays?',
    'Summarize system performance for the selected period',
    'What are the busiest hours and are there capacity concerns?',
    'Which trips consistently run late?',
];

const TIER_LABELS: Record<ContextTier, string> = {
    system: 'System',
    route: 'Route',
    stops: 'Stops',
    trips: 'Trips',
};

export const AIQueryPanel: React.FC<AIQueryPanelProps> = ({ filteredDays }) => {
    const [question, setQuestion] = useState('');
    const [tier, setTier] = useState<ContextTier>('system');
    const [routeId, setRouteId] = useState('');
    const [answer, setAnswer] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const routes = useMemo(() => {
        const routeMap = new Map<string, string>();
        for (const day of filteredDays) {
            for (const r of day.byRoute) {
                if (!routeMap.has(r.routeId)) routeMap.set(r.routeId, r.routeName);
            }
        }
        return Array.from(routeMap.entries())
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    }, [filteredDays]);

    const handleSubmit = useCallback(async (q?: string) => {
        const query = q ?? question;
        if (!query.trim() || loading) return;

        setLoading(true);
        setError(null);
        setAnswer(null);

        try {
            const context = buildQueryContext(filteredDays, tier, routeId || undefined);
            const result = await askPerformanceQuestion(query, context);
            setAnswer(result.answer);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Failed to get response';
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, [question, filteredDays, tier, routeId, loading]);

    const handleSuggestion = (q: string) => {
        setQuestion(q);
        handleSubmit(q);
    };

    const needsRoute = tier === 'route' || tier === 'stops' || tier === 'trips';

    return (
        <div className="space-y-5">
            {/* Context tier selector */}
            <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-bold text-gray-700">Context level:</span>
                <div className="flex gap-1">
                    {(Object.keys(TIER_LABELS) as ContextTier[]).map(t => (
                        <button
                            key={t}
                            onClick={() => setTier(t)}
                            className={`px-2.5 py-1 text-xs font-bold rounded-full transition-colors ${
                                tier === t
                                    ? 'bg-purple-100 text-purple-700'
                                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                            }`}
                        >
                            {TIER_LABELS[t]}
                        </button>
                    ))}
                </div>
                {needsRoute && (
                    <select
                        value={routeId}
                        onChange={e => setRouteId(e.target.value)}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-300"
                    >
                        <option value="">All routes</option>
                        {routes.map(r => (
                            <option key={r.id} value={r.id}>{r.id} — {r.name}</option>
                        ))}
                    </select>
                )}
                <span className="text-xs text-gray-400 ml-auto">
                    {filteredDays.length} days of data
                </span>
            </div>

            {/* Suggested questions */}
            <div className="flex flex-wrap gap-2">
                {SUGGESTED_QUESTIONS.map(q => (
                    <button
                        key={q}
                        onClick={() => handleSuggestion(q)}
                        disabled={loading}
                        className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 hover:border-gray-300 transition-colors disabled:opacity-50"
                    >
                        {q}
                    </button>
                ))}
            </div>

            {/* Question input */}
            <div className="flex gap-2">
                <input
                    type="text"
                    value={question}
                    onChange={e => setQuestion(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
                    placeholder="Ask a question about your performance data..."
                    className="flex-1 px-4 py-2.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-200 focus:border-purple-300"
                    disabled={loading}
                />
                <button
                    onClick={() => handleSubmit()}
                    disabled={loading || !question.trim()}
                    className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                    Ask
                </button>
            </div>

            {/* Loading state */}
            {loading && (
                <div className="flex items-center gap-3 p-4 bg-purple-50 border border-purple-100 rounded-xl">
                    <Loader2 size={20} className="animate-spin text-purple-500" />
                    <span className="text-sm text-purple-700 font-medium">Analyzing performance data...</span>
                </div>
            )}

            {/* Error state */}
            {error && (
                <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
                    <AlertCircle size={18} className="text-red-500 mt-0.5 flex-shrink-0" />
                    <div>
                        <p className="text-sm font-bold text-red-700">Error</p>
                        <p className="text-xs text-red-600 mt-0.5">{error}</p>
                    </div>
                </div>
            )}

            {/* Answer */}
            {answer && (
                <div className="bg-white border border-gray-200 rounded-xl p-5">
                    <div className="flex items-center gap-2 mb-3">
                        <Sparkles size={16} className="text-purple-500" />
                        <span className="text-sm font-bold text-gray-700">AI Analysis</span>
                    </div>
                    <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap">
                        {answer}
                    </div>
                </div>
            )}

            {/* Empty state */}
            {!loading && !answer && !error && (
                <div className="text-center py-12 text-gray-400">
                    <Sparkles size={40} className="mx-auto mb-3 opacity-30" />
                    <p className="font-medium">Ask a question about your performance data</p>
                    <p className="text-xs mt-1">Try one of the suggested questions above, or type your own</p>
                </div>
            )}
        </div>
    );
};
