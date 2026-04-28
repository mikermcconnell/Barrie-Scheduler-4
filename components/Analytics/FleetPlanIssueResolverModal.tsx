import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Sparkles, Wand2, X } from 'lucide-react';
import { Modal } from '../ui/Modal';
import {
    applyFleetPlanResolution,
    buildFleetPlanResolutionSuggestions,
    type FleetPlanResolutionSuggestion,
} from '../../utils/fleet-plan/fleetPlanIssueResolver';
import type { FleetPlanWorkbook } from '../../utils/fleet-plan/types';
import type { FleetPlanValidationResult } from '../../utils/fleet-plan/fleetPlanValidation';
import { runFleetPlanAiResolver } from '../../utils/ai/fleetPlanResolverService';
import type { FleetPlanAiResolutionSuggestion } from '../../utils/fleet-plan/fleetPlanAiResolverTypes';

interface FleetPlanIssueResolverModalProps {
    isOpen: boolean;
    workbook: FleetPlanWorkbook;
    validation: FleetPlanValidationResult;
    currentYear: number;
    onApply: (workbook: FleetPlanWorkbook) => void;
    onClose: () => void;
}

function getManualDefault(suggestion: FleetPlanResolutionSuggestion): string {
    if (suggestion.action.type === 'set-unit-number') return suggestion.action.suggestedUnitNumber;
    return suggestion.action.suggestedRetirementYear;
}

function mergeAiSuggestion(
    suggestion: FleetPlanResolutionSuggestion,
    aiSuggestion: FleetPlanAiResolutionSuggestion | undefined,
): FleetPlanResolutionSuggestion {
    if (!aiSuggestion) return suggestion;

    const suggestedValue = aiSuggestion.suggestedValue?.trim();
    if (!suggestedValue) {
        return {
            ...suggestion,
            suggestion: aiSuggestion.suggestion || suggestion.suggestion,
        };
    }

    if (suggestion.action.type === 'set-unit-number') {
        return {
            ...suggestion,
            suggestion: aiSuggestion.suggestion || suggestion.suggestion,
            actionLabel: `Use ${suggestedValue}`,
            action: {
                ...suggestion.action,
                suggestedUnitNumber: suggestedValue,
            },
        };
    }

    if (!/^\d{4}$/.test(suggestedValue)) {
        return {
            ...suggestion,
            suggestion: aiSuggestion.suggestion || suggestion.suggestion,
        };
    }

    return {
        ...suggestion,
        suggestion: aiSuggestion.suggestion || suggestion.suggestion,
        actionLabel: suggestion.issueCode === 'missing-retirement-warning' ? `Set ${suggestedValue}` : `Keep ${suggestedValue}`,
        action: {
            ...suggestion.action,
            suggestedRetirementYear: suggestedValue,
        },
    };
}

export const FleetPlanIssueResolverModal: React.FC<FleetPlanIssueResolverModalProps> = ({
    isOpen,
    workbook,
    validation,
    currentYear,
    onApply,
    onClose,
}) => {
    const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
    const [manualValues, setManualValues] = useState<Record<string, string>>({});
    const [aiSuggestions, setAiSuggestions] = useState<FleetPlanAiResolutionSuggestion[]>([]);
    const [aiSummary, setAiSummary] = useState<string>('');
    const [aiCautions, setAiCautions] = useState<string[]>([]);
    const [aiError, setAiError] = useState<string>('');
    const [aiLoading, setAiLoading] = useState(false);

    const deterministicSuggestions = useMemo(() => (
        buildFleetPlanResolutionSuggestions(workbook, validation)
    ), [validation, workbook]);
    const aiSuggestionById = useMemo(() => new Map(
        aiSuggestions.map((suggestion) => [suggestion.deterministicSuggestionId, suggestion]),
    ), [aiSuggestions]);
    const suggestions = useMemo(() => (
        deterministicSuggestions
            .filter((suggestion) => !dismissed.has(suggestion.id))
            .map((suggestion) => mergeAiSuggestion(suggestion, aiSuggestionById.get(suggestion.id)))
    ), [aiSuggestionById, deterministicSuggestions, dismissed]);

    const unresolvedErrorCount = validation.errors.length;
    const unresolvedWarningCount = validation.warnings.length;

    const handleApply = (suggestion: FleetPlanResolutionSuggestion) => {
        const manualValue = manualValues[suggestion.id];
        const nextWorkbook = applyFleetPlanResolution(workbook, suggestion, manualValue);
        onApply(nextWorkbook);
    };

    const handleAskGemma = async () => {
        setAiLoading(true);
        setAiError('');
        try {
            const response = await runFleetPlanAiResolver(workbook, validation, deterministicSuggestions, currentYear);
            setAiSuggestions(response.suggestions);
            setAiSummary(response.summary);
            setAiCautions(response.cautions);
        } catch (error) {
            setAiError(error instanceof Error ? error.message : 'Gemma 4 suggestions are unavailable.');
        } finally {
            setAiLoading(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} size="full" zIndex="highest" className="max-w-5xl">
            <Modal.Header>Resolve Fleet Plan issues</Modal.Header>
            <Modal.Body className="space-y-4">
                <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                    <div className="flex items-start gap-3">
                        <Sparkles className="mt-0.5 text-blue-700" size={18} />
                        <div className="min-w-0 flex-1">
                            <div className="text-sm font-extrabold text-blue-950">Gemma 4 assist</div>
                            <p className="mt-1 text-sm text-blue-900">
                                Gemma 4 can review issues and warnings and improve the suggested values. It never changes the plan until you accept a suggestion.
                            </p>
                            <button
                                type="button"
                                disabled={aiLoading || deterministicSuggestions.length === 0}
                                onClick={() => void handleAskGemma()}
                                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-extrabold text-blue-700 hover:bg-blue-50 disabled:opacity-60"
                            >
                                {aiLoading ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                                {aiLoading ? 'Asking Gemma 4...' : 'Ask Gemma 4'}
                            </button>
                            {aiSummary ? <p className="mt-3 text-sm font-semibold text-blue-950">{aiSummary}</p> : null}
                            {aiError ? <p className="mt-3 text-sm font-semibold text-red-700">{aiError}</p> : null}
                            {aiCautions.length > 0 ? (
                                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-blue-900">
                                    {aiCautions.map((caution) => <li key={caution}>{caution}</li>)}
                                </ul>
                            ) : null}
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h3 className="text-base font-extrabold text-gray-950">
                            {unresolvedErrorCount} blocking issue{unresolvedErrorCount === 1 ? '' : 's'} · {unresolvedWarningCount} warning{unresolvedWarningCount === 1 ? '' : 's'}
                        </h3>
                        <p className="mt-1 text-sm text-gray-500">
                            Accept a suggestion, dismiss it for now, or type a manual value before applying. Missing retirement warnings default to 13 years after first in-service year.
                        </p>
                    </div>
                    {suggestions.length === 0 ? (
                        <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-700">
                            <CheckCircle2 size={16} />
                            No generated suggestions left
                        </div>
                    ) : null}
                </div>

                <div className="space-y-3">
                    {suggestions.map((suggestion) => {
                        const manualValue = manualValues[suggestion.id] ?? getManualDefault(suggestion);
                        return (
                            <div key={suggestion.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <AlertTriangle size={16} className={suggestion.issueSeverity === 'error' ? 'text-red-600' : 'text-amber-600'} />
                                            <h4 className="text-sm font-extrabold text-gray-950">{suggestion.title}</h4>
                                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase ${suggestion.issueSeverity === 'error' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                                                {suggestion.issueSeverity}: {suggestion.issueCode}
                                            </span>
                                        </div>
                                        <p className="mt-2 text-sm text-gray-700">{suggestion.issueMessage}</p>
                                        <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
                                            Suggestion: {suggestion.suggestion}
                                        </p>
                                        {aiSuggestionById.has(suggestion.id) ? (
                                            <p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">
                                                Gemma 4: {aiSuggestionById.get(suggestion.id)?.rationale} Confidence: {aiSuggestionById.get(suggestion.id)?.confidence}.
                                            </p>
                                        ) : null}
                                    </div>
                                    <div className="w-full shrink-0 space-y-2 lg:w-64">
                                        <label className="block text-xs font-extrabold uppercase tracking-wide text-gray-500">
                                            {suggestion.manualLabel}
                                        </label>
                                        <input
                                            value={manualValue}
                                            onChange={(event) => setManualValues((current) => ({
                                                ...current,
                                                [suggestion.id]: event.target.value,
                                            }))}
                                            className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-800 shadow-inner shadow-gray-100/60 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-blue-100"
                                        />
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={() => handleApply(suggestion)}
                                                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand-blue px-3 py-2 text-sm font-bold text-white hover:bg-blue-600"
                                            >
                                                {suggestion.actionLabel}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setDismissed((current) => new Set([...current, suggestion.id]))}
                                                className="inline-flex items-center justify-center rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-600 hover:bg-gray-50"
                                                title="Dismiss this suggestion for this modal session"
                                            >
                                                <X size={16} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </Modal.Body>
            <Modal.Footer>
                <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                >
                    Close
                </button>
            </Modal.Footer>
        </Modal>
    );
};
